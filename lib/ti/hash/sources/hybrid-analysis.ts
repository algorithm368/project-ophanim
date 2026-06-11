import type { RelatedIndicator, SourceFinding, TiSource } from "../../types";
import { errorMessage, getJson, isTimeout } from "../../http";

interface HaOverview {
  sha256?: string;
  threat_score?: number | null;
  verdict?: string | null;
  vx_family?: string | null;
  type?: string | null;
  type_short?: string[] | null;
  size?: number | null;
  last_file_name?: string | null;
  analysis_start_time?: string | null;
  whitelisted?: boolean | null;
  /** SHA-256s of samples that bundle/drop this file. */
  related_parent_hashes?: string[] | null;
  /** SHA-256s of files this sample dropped/extracted. */
  related_children_hashes?: string[] | null;
  message?: string;
}

/**
 * The overview's parent/child links as typed pivots: parents bundle or drop
 * this file (relation "parent"); children are files this one dropped (relation
 * "drops"). Self-references and duplicates are removed. These ride along on the
 * overview response — no extra request.
 */
export function haRelatedHashes(
  parents: string[] | null | undefined,
  children: string[] | null | undefined,
  selfHash: string,
  cap = 6,
): RelatedIndicator[] {
  const self = selfHash.toLowerCase();
  const pick = (arr: string[] | null | undefined, relation: string) =>
    [
      ...new Set(
        (arr ?? [])
          .map((h) => h?.toLowerCase())
          .filter((h): h is string => Boolean(h) && h !== self),
      ),
    ]
      .slice(0, cap)
      .map((value) => ({ value, type: "hash" as const, relation }));
  return [...pick(parents, "parent"), ...pick(children, "drops")];
}

/**
 * CrowdStrike Hybrid Analysis - sandbox detonation verdicts (free API key).
 *
 * The legacy /search/hash endpoint is deprecated; this uses the v2 overview
 * endpoint, which is keyed by SHA-256 only. The request must hit the apex host
 * (www. cross-redirects strip the api-key header) and carry the Falcon Sandbox
 * user agent.
 */
/**
 * Sandbox verdict → score. Whitelisted wins (0); malicious/suspicious set a
 * floor under the raw threat score; otherwise the threat score stands.
 */
export function hybridAnalysisScore(
  verdict: string,
  threatScore: number | undefined,
  whitelisted: boolean | null | undefined,
): number {
  if (whitelisted || verdict === "whitelisted") return 0;
  if (verdict === "malicious") return Math.max(threatScore ?? 0, 75);
  if (verdict === "suspicious") return Math.max(threatScore ?? 0, 45);
  return threatScore ?? 0;
}

export const hybridAnalysisSource: TiSource = {
  meta: {
    id: "hybrid-analysis",
    name: "Hybrid Analysis",
    url: "https://www.hybrid-analysis.com",
    category: "scanner",
    requiresKey: true,
    weight: 0.85,
    keyEnv: "HYBRID_ANALYSIS_API_KEY",
    timeoutMs: 12000,
  },
  isEnabled: () => Boolean(process.env.HYBRID_ANALYSIS_API_KEY),
  async check(hash, signal): Promise<SourceFinding> {
    const key = process.env.HYBRID_ANALYSIS_API_KEY;
    if (!key) return { status: "skipped" };

    // The overview endpoint only accepts SHA-256. Skip (rather than report a
    // clean "ok") for MD5/SHA-1 so the UI shows "N/A · SHA-256 only", not a
    // green pass the source never actually made.
    if (hash.length !== 64) {
      return {
        status: "skipped",
        summary: "SHA-256 only — paste a SHA-256 hash to query Hybrid Analysis",
      };
    }

    try {
      const { ok, status, data } = await getJson<HaOverview>(
        `https://hybrid-analysis.com/api/v2/overview/${hash}`,
        signal,
        { "api-key": key, "User-Agent": "Falcon Sandbox" },
      );

      if (status === 404) {
        return { status: "ok", summary: "No sandbox report for this file" };
      }
      if (!ok || !data) {
        return { status: "error", error: data?.message ?? `HTTP ${status}` };
      }

      const verdict = data.verdict ?? "unknown";
      const threatScore =
        typeof data.threat_score === "number" ? data.threat_score : undefined;
      const family = data.vx_family?.trim() || undefined;
      const fileType =
        data.type?.trim() ||
        (data.type_short?.length ? data.type_short.join(", ") : undefined);

      const score = hybridAnalysisScore(verdict, threatScore, data.whitelisted);
      const relations = haRelatedHashes(
        data.related_parent_hashes,
        data.related_children_hashes,
        hash,
      );

      return {
        status: "ok",
        malicious: verdict === "malicious",
        score,
        categories: family ? [family] : [],
        lastSeen: data.analysis_start_time ?? undefined,
        summary: `Sandbox verdict: ${verdict}${family ? ` (${family})` : ""}${
          threatScore !== undefined ? `, threat score ${threatScore}/100` : ""
        }`,
        hashContext: {
          sha256: data.sha256?.toLowerCase(),
          fileName: data.last_file_name ?? undefined,
          fileType,
          fileSize: data.size ?? undefined,
          malwareFamily: family,
        },
        details: {
          verdict,
          threatScore,
          vxFamily: family,
          whitelisted: data.whitelisted ?? undefined,
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
