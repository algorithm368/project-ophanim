import type { CheckResult, GeoContext, SourceResult } from "./types";
import { sources } from "./registry";
import { aggregateRisk, computeStats } from "./aggregate";
import { mergeFields, runAll } from "./orchestrate";

/** Merge geo context from whichever sources provide it (first non-empty per field). */
function mergeGeo(results: SourceResult[]): GeoContext | undefined {
  return mergeFields(
    results
      .filter((r) => r.status === "ok" && r.geo)
      .map((r) => r.geo as GeoContext),
  );
}

export async function checkIp(
  ip: string,
  onSettled?: (result: SourceResult) => void,
): Promise<CheckResult> {
  const results = await runAll(sources, ip, onSettled);
  const { riskScore, verdict } = aggregateRisk(results);

  return {
    ip,
    checkedAt: new Date().toISOString(),
    riskScore,
    verdict,
    geo: mergeGeo(results),
    sources: results,
    stats: computeStats(results),
  };
}
