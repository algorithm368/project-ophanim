import type { RelatedIndicator, SourceFinding, TiSource } from "../../types";
import { errorMessage, getJson, isTimeout } from "../../http";
import { detectIOC } from "@/lib/ioc";
import { parseIPv4 } from "@/lib/ip";

interface TriageSearch {
  data?: { id?: string; status?: string }[];
}
interface TriageOverview {
  sample?: { id?: string; target?: string; size?: number };
  analysis?: { score?: number; family?: string[] };
  targets?: {
    target?: string;
    score?: number;
    family?: string[];
    tags?: string[];
    signatures?: { name?: string }[];
    // Sandbox-observed network IOCs for this target (mixes C2 with benign OS
    // noise); read defensively.
    iocs?: { domains?: string[]; ips?: string[]; urls?: string[] };
  }[];
  // Extracted network IOCs vary in shape; read defensively.
  extracted?: {
    config?: { c2?: string[]; domains?: string[]; hosts?: string[] };
  }[];
}

/** Drop only non-routable hosts (loopback / RFC1918 / link-local / CGNAT / …);
 *  a bare domain or any public IP is kept. */
function isRoutableHost(host: string): boolean {
  const ip = parseIPv4(host);
  return !ip || (!ip.isPrivate && !ip.isReserved);
}

/**
 * Network pivots for a Triage report, from two places that ride along on the
 * overview we already fetch: the extracted malware `config` (clean C2) and each
 * target's sandbox-observed `iocs` (which also surfaces contacts for samples
 * that yielded no extracted config). Values are normalized to a bare host,
 * typed by what they parse as, deduped, and non-routable hosts dropped.
 */
export function extractTriageRelations(
  data: TriageOverview,
  cap = 12,
): RelatedIndicator[] {
  const relations: RelatedIndicator[] = [];
  const seen = new Set<string>();
  const add = (raw: unknown) => {
    if (typeof raw !== "string") return;
    const host = bareHost(raw);
    if (!host || seen.has(host) || !isRoutableHost(host)) return;
    seen.add(host);
    relations.push({
      value: host,
      type: detectIOC(host) === "ip" ? "ip" : "domain",
      relation: "contacts",
    });
  };
  for (const e of data.extracted ?? []) {
    const cfg = e.config ?? {};
    for (const raw of [
      ...(cfg.c2 ?? []),
      ...(cfg.domains ?? []),
      ...(cfg.hosts ?? []),
    ])
      add(raw);
  }
  for (const t of data.targets ?? []) {
    const iocs = t.iocs ?? {};
    for (const raw of [...(iocs.domains ?? []), ...(iocs.ips ?? [])]) add(raw);
  }
  return relations.slice(0, cap);
}

const API = "https://tria.ge/api/v0";

/**
 * Reduce a raw Triage config entry — which may carry a scheme, path, or :port —
 * to a bare host. Triage `c2`/`domains`/`hosts` strings are not normalized
 * upstream and routinely mix hostnames and IPs.
 */
export function bareHost(raw: string): string {
  const noScheme = raw.replace(/^\w+:\/\//, "").split("/")[0].trim();
  // IPv6 in brackets, optionally with a port: "[2001:db8::1]:443" -> "2001:db8::1".
  const v6 = noScheme.match(/^\[([^\]]+)\]/);
  if (v6) return v6[1];
  // host:port (IPv4 or domain; single colon) -> drop the trailing :port.
  // An unbracketed IPv6 has multiple colons and is left intact by [^:]+.
  const hostPort = noScheme.match(/^([^:]+):\d{1,5}$/);
  return hostPort ? hostPort[1] : noScheme;
}

/** Hatching Triage — sandbox family/score + network IOCs (free research key). */
export const triageSource: TiSource = {
  meta: {
    id: "triage",
    name: "Hatching Triage",
    url: "https://tria.ge",
    category: "scanner",
    requiresKey: true,
    weight: 0.8,
    keyEnv: "TRIAGE_API_KEY",
    timeoutMs: 15000,
  },
  isEnabled: () => Boolean(process.env.TRIAGE_API_KEY),
  async check(hash, signal): Promise<SourceFinding> {
    const key = process.env.TRIAGE_API_KEY;
    if (!key) return { status: "skipped" };
    const auth = { Authorization: `Bearer ${key}` };
    try {
      const search = await getJson<TriageSearch>(
        `${API}/search?query=${encodeURIComponent(hash)}`,
        signal,
        auth,
      );
      const sampleId = search.data?.data?.[0]?.id;
      if (!search.ok) {
        return { status: "error", error: `HTTP ${search.status}` };
      }
      if (!sampleId) {
        return { status: "ok", summary: "No Triage report for this file" };
      }

      const ov = await getJson<TriageOverview>(
        `${API}/samples/${sampleId}/overview.json`,
        signal,
        auth,
      );
      if (!ov.ok || !ov.data) {
        return { status: "error", error: `HTTP ${ov.status}` };
      }
      const data = ov.data;

      const rawScore =
        data.analysis?.score ??
        data.targets?.reduce((m, t) => Math.max(m, t.score ?? 0), 0) ??
        0;
      // Triage scores are 0-10; scale to 0-100.
      const score = Math.min(100, Math.round(rawScore * 10));

      const families = [
        ...new Set([
          ...(data.analysis?.family ?? []),
          ...(data.targets ?? []).flatMap((t) => t.family ?? []),
        ]),
      ];
      const signatures = [
        ...new Set(
          (data.targets ?? []).flatMap((t) =>
            (t.signatures ?? []).map((s) => s.name).filter(Boolean),
          ),
        ),
      ] as string[];

      const relations = extractTriageRelations(data);

      const fileNames = [
        ...new Set(
          [
            data.sample?.target,
            ...(data.targets ?? []).map((t) => t.target),
          ].filter((n): n is string => Boolean(n && n.trim())),
        ),
      ];

      return {
        status: "ok",
        malicious: score >= 80,
        score,
        categories: [...families, ...signatures.slice(0, 6)].slice(0, 12),
        summary: `Triage score ${rawScore}/10${
          families.length ? ` (${families.join(", ")})` : ""
        }`,
        hashContext: {
          malwareFamily: families[0],
          fileName: data.sample?.target,
          fileNames: fileNames.length ? fileNames : undefined,
          fileSize: data.sample?.size,
        },
        relations: relations.length ? relations : undefined,
        raw: data,
      };
    } catch (err) {
      return {
        status: isTimeout(err) ? "timeout" : "error",
        error: errorMessage(err),
      };
    }
  },
};
