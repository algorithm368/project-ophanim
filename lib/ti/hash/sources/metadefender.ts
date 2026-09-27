import type { SourceFinding, TiSource } from "../../types";
import { errorMessage, getJson, isTimeout } from "../../http";
import { vtDefinitive } from "../../vt-verdict";

interface FilescanReputation {
  sha256?: string;
  overall_verdict?: string;
  fuzzyhash?: { hash?: string | null; verdict?: string } | null;
  mdcloud?: {
    total_av_engines?: number;
    detected_av_engines?: number;
    scan_time?: string;
  } | null;
  filescan_reports?: { verdict?: string }[] | null;
  detail?: unknown;
}

export const VERDICT_FLOOR: Record<string, number> = {
  malicious: 75,
  suspicious: 45,
  likely_malicious: 60,
  no_threat: 0,
  benign: 0,
  informational: 0,
};

/** Higher of the multi-AV detection ratio and the verdict floor (0-100). */
export function metadefenderScore(
  detected: number,
  total: number,
  verdict: string,
): number {
  const mdScore = total > 0 ? Math.round((detected / total) * 100) : 0;
  return Math.max(mdScore, VERDICT_FLOOR[verdict] ?? 0);
}

/**
 * OPSWAT MetaDefender Cloud, via the public (key-free) Filescan.io reputation
 * API. The response bundles MetaDefender Cloud's multi-AV result (`mdcloud`)
 * with Filescan sandbox verdicts. The endpoint accepts SHA-256 only.
 */
export const metadefenderHashSource: TiSource = {
  meta: {
    id: "metadefender",
    name: "MetaDefender Cloud",
    url: "https://www.filescan.io",
    category: "reputation",
    requiresKey: false,
    weight: 0.9,
    algorithms: ["sha256"],
  },
  isEnabled: () => true,
  async check(hash, signal): Promise<SourceFinding> {
    if (hash.length !== 64) {
      return {
        status: "skipped",
        summary: "SHA-256 only, paste a SHA-256 hash to query MetaDefender",
      };
    }
    try {
      const { ok, status, data } = await getJson<FilescanReputation>(
        `https://www.filescan.io/api/reputation/hash?sha256=${hash}`,
        signal,
      );
      if (!ok || !data || data.detail) {
        return { status: "error", error: `HTTP ${status}` };
      }

      const verdict = data.overall_verdict ?? "unknown";
      const md = data.mdcloud ?? undefined;
      const total = md?.total_av_engines ?? 0;
      const detected = md?.detected_av_engines ?? 0;
      const reports = data.filescan_reports ?? [];

      // Nothing on record: no AV scan, no sandbox report, no verdict. Treat as
      // no signal rather than a clean result.
      if (verdict === "unknown" && !md && reports.length === 0) {
        return { status: "ok", summary: "Not seen by MetaDefender / Filescan" };
      }

      const score = metadefenderScore(detected, total, verdict);

      const parts: string[] = [];
      if (md) parts.push(`MetaDefender ${detected}/${total} engines`);
      if (reports.length) parts.push(`${reports.length} sandbox report(s)`);
      const summary = `${parts.join(", ") || "Reputation data"}; verdict: ${verdict}`;

      return {
        status: "ok",
        // MetaDefender's own verdict is curated; a bare engine tally needs the
        // same definitive bar as VirusTotal before it can floor the aggregate.
        malicious: verdict === "malicious" || vtDefinitive(detected, total),
        score,
        categories: verdict !== "unknown" ? [verdict] : [],
        lastSeen: md?.scan_time,
        summary,
        hashContext: { sha256: data.sha256?.toLowerCase() },
        details: {
          overallVerdict: verdict,
          detectedEngines: md ? detected : undefined,
          totalEngines: md ? total : undefined,
          sandboxReports: reports.length,
          fuzzyhashVerdict: data.fuzzyhash?.verdict,
        },
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
