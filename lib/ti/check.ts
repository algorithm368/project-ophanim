import type { CheckResult, SourceResult } from "./types";
import { sources } from "./registry";
import { aggregateRisk, computeStats } from "./aggregate";
import { runAll } from "./orchestrate";
import { overlayResolution, reconcileGeo } from "./geo/reconcile";

export async function checkIp(
  ip: string,
  onSettled?: (result: SourceResult) => void,
): Promise<CheckResult> {
  const results = await runAll(sources, ip, onSettled);
  const { riskScore, verdict } = aggregateRisk(results);
  const geoResolution = reconcileGeo(results);
  const reverse = results.find((r) => r.geo?.reverse)?.geo?.reverse;
  const fcrdns = results.find((r) => r.geo?.fcrdns)?.geo?.fcrdns;

  return {
    ip,
    checkedAt: new Date().toISOString(),
    riskScore,
    verdict,
    geo: geoResolution
      ? overlayResolution(geoResolution, { reverse, fcrdns })
      : undefined,
    geoResolution,
    sources: results,
    stats: computeStats(results),
  };
}
