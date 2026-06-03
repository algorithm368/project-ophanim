import type { CheckResult, GeoContext, GeoResolution, SourceResult } from "./types";
import { sources } from "./registry";
import { aggregateRisk, computeStats } from "./aggregate";
import { runAll } from "./orchestrate";
import { reconcileGeo } from "./geo/reconcile";

/** Flatten a GeoResolution into the legacy GeoContext (winning values only),
 *  so existing consumers (OG image, history, bulk geo) keep working. */
function flattenResolution(
  res: GeoResolution | undefined,
  results: SourceResult[],
): GeoContext | undefined {
  if (!res) return undefined;
  // reverse / fcrdns are not reconciled fields; take them from any source that has them.
  const reverse = results.find((r) => r.geo?.reverse)?.geo?.reverse;
  const fcrdns = results.find((r) => r.geo?.fcrdns)?.geo?.fcrdns;
  return {
    country: res.country?.value,
    countryCode: res.countryCode,
    region: res.region?.value,
    city: res.city?.value,
    lat: res.coordinates?.value.lat,
    lon: res.coordinates?.value.lon,
    asn: res.asn?.value,
    asnOrg: res.asnOrg?.value,
    isp: res.isp?.value,
    reverse,
    fcrdns,
    isHosting: res.flags.isHosting,
    isProxy: res.flags.isProxy,
    isMobile: res.flags.isMobile,
  };
}

export async function checkIp(
  ip: string,
  onSettled?: (result: SourceResult) => void,
): Promise<CheckResult> {
  const results = await runAll(sources, ip, onSettled);
  const { riskScore, verdict } = aggregateRisk(results);
  const geoResolution = reconcileGeo(results);

  return {
    ip,
    checkedAt: new Date().toISOString(),
    riskScore,
    verdict,
    geo: flattenResolution(geoResolution, results),
    geoResolution,
    sources: results,
    stats: computeStats(results),
  };
}
