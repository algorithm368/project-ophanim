import type { SourceFinding, TiSource } from "../../types";
import { errorMessage, isTimeout, postJson } from "../../http";
import { count } from "@/lib/text";

interface YaraRule {
  rule_name?: string;
  author?: string;
  description?: string | null;
}

interface YaraTask {
  static_results?: YaraRule[];
  clamav_results?: string[] | null;
}

interface YaraifyResponse {
  query_status?: string;
  data?: {
    metadata?: {
      first_seen?: string | null;
      last_seen?: string | null;
      sightings?: number;
      sha3_384?: string;
      imphash?: string;
      tlsh?: string;
      ssdeep?: string;
    };
    tasks?: YaraTask[];
  };
}

const API = "https://yaraify-api.abuse.ch/api/v1/";

/** Distinct rule names across every scan task, in first-seen order, capped. */
export function ruleNames(tasks: YaraTask[] | undefined, cap = 8): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const task of tasks ?? []) {
    for (const rule of task.static_results ?? []) {
      const name = rule.rule_name?.trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push(name);
      if (out.length >= cap) return out;
    }
  }
  return out;
}

/** Distinct ClamAV signature names across every task, capped. */
export function clamavNames(tasks: YaraTask[] | undefined, cap = 5): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const task of tasks ?? []) {
    for (const name of task.clamav_results ?? []) {
      const value = name?.trim();
      if (!value || seen.has(value.toLowerCase())) continue;
      seen.add(value.toLowerCase());
      out.push(value);
      if (out.length >= cap) return out;
    }
  }
  return out;
}

/** Build the finding from a YARAify hit. Exported for its test. */
export function yaraifyFinding(body: YaraifyResponse): SourceFinding {
  if (body.query_status !== "ok" || !body.data) {
    return { status: "ok", summary: "No YARAify record for this file" };
  }

  const meta = body.data.metadata ?? {};
  const rules = ruleNames(body.data.tasks);
  const clamav = clamavNames(body.data.tasks);

  const parts: string[] = [];
  if (rules.length) parts.push(`${count(rules.length, "YARA rule")} matched`);
  if (clamav.length) parts.push(`${count(clamav.length, "ClamAV signature")}`);
  if (meta.sightings) parts.push(`${count(meta.sightings, "sighting")}`);

  return {
    status: "ok",
    // No score. A YARA match names a rule, it does not weigh a file, and the
    // corpus behind it is abuse.ch's, which MalwareBazaar and ThreatFox already
    // vote with. Scoring it would count one organisation's data three times.
    lastSeen: meta.last_seen ?? undefined,
    categories: rules.length ? rules.slice(0, 4) : undefined,
    summary: parts.length ? parts.join(", ") : "No YARA rule matched this file",
    details: {
      ...(rules.length ? { yaraRules: rules } : {}),
      ...(clamav.length ? { clamavSignatures: clamav } : {}),
      ...(meta.sightings ? { sightings: meta.sightings } : {}),
      ...(meta.sha3_384 ? { sha3_384: meta.sha3_384 } : {}),
    },
    hashContext: {
      firstSeen: meta.first_seen ?? undefined,
      lastSeen: meta.last_seen ?? undefined,
      imphash: meta.imphash ?? undefined,
      tlsh: meta.tlsh ?? undefined,
      ssdeep: meta.ssdeep ?? undefined,
      detectionNames: clamav.length ? clamav : undefined,
    },
  };
}

/**
 * YARAify (abuse.ch): which YARA rules match a sample, and who wrote them.
 *
 * The multi-engine sources answer "how many flagged it". This answers "what
 * did they recognise", with named rules and their authors, which is the
 * difference between a number to quote and a lead to follow.
 *
 * abuse.ch services share one Auth-Key, so this reuses THREATFOX_API_KEY and
 * needs no new credential.
 */
export const yaraifySource: TiSource = {
  meta: {
    id: "yaraify",
    name: "YARAify",
    url: "https://yaraify.abuse.ch",
    category: "context",
    requiresKey: true,
    keyEnv: "THREATFOX_API_KEY",
    weight: 0,
    // The lookup endpoint takes MD5, SHA-1, SHA-256 and SHA3-384.
    algorithms: ["md5", "sha1", "sha256"],
  },
  isEnabled: () => Boolean(process.env.THREATFOX_API_KEY),
  async check(hash, signal): Promise<SourceFinding> {
    const key = process.env.THREATFOX_API_KEY;
    if (!key) return { status: "skipped", error: "No abuse.ch Auth-Key" };
    try {
      const { ok, status, data } = await postJson<YaraifyResponse>(
        API,
        signal,
        { query: "lookup_hash", search_term: hash },
        { "Auth-Key": key },
      );
      if (status === 429) {
        return { status: "rate_limited", error: "abuse.ch fair-use limit" };
      }
      if (!ok || !data) return { status: "error", error: `HTTP ${status}` };
      return yaraifyFinding(data);
    } catch (err) {
      return {
        status: isTimeout(err) ? "timeout" : "error",
        error: errorMessage(err),
      };
    }
  },
};
