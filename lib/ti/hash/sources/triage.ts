import type { RelatedIndicator, SourceFinding, TiSource } from "../../types";
import { errorMessage, getJson, isTimeout } from "../../http";
import { detectIOC } from "@/lib/ioc";

interface TriageSearch {
  data?: { id?: string; status?: string }[];
}
interface TriageOverview {
  sample?: { id?: string; target?: string; size?: number };
  analysis?: { score?: number; family?: string[] };
  targets?: {
    score?: number;
    family?: string[];
    tags?: string[];
    signatures?: { name?: string }[];
  }[];
  // Extracted network IOCs vary in shape; read defensively.
  extracted?: {
    config?: { c2?: string[]; domains?: string[]; hosts?: string[] };
  }[];
}

const API = "https://tria.ge/api/v0";

/**
 * Reduce a raw Triage config entry — which may carry a scheme, path, or :port —
 * to a bare host. Triage `c2`/`domains`/`hosts` strings are not normalized
 * upstream and routinely mix hostnames and IPs.
 */
function bareHost(raw: string): string {
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

      const relations: RelatedIndicator[] = [];
      const seen = new Set<string>();
      // c2 / domains / hosts mix hostnames and raw IPs (sometimes with a
      // scheme, path, or :port). Normalize to a bare host, skip non-strings
      // so one malformed entry can't fail the whole finding, and type each
      // by what it actually parses as rather than which list it came from.
      for (const e of data.extracted ?? []) {
        const cfg = e.config ?? {};
        for (const raw of [
          ...(cfg.c2 ?? []),
          ...(cfg.domains ?? []),
          ...(cfg.hosts ?? []),
        ]) {
          if (typeof raw !== "string") continue;
          const host = bareHost(raw);
          if (!host || seen.has(host)) continue;
          seen.add(host);
          relations.push({
            value: host,
            type: detectIOC(host) === "ip" ? "ip" : "domain",
            relation: "contacts",
          });
        }
      }

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
          fileSize: data.sample?.size,
        },
        relations: relations.slice(0, 10).length
          ? relations.slice(0, 10)
          : undefined,
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
