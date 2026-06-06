import type {
  CheckResult,
  DomainCheckResult,
  DomainContext,
  HashCheckResult,
  HashContext,
  SourceResult,
} from "./types";
import type { HashAlgorithm } from "@/lib/hash";
import { aggregateRisk, computeStats } from "./aggregate";
import { mergeFields } from "./orchestrate";
import { overlayResolution, reconcileGeo } from "./geo/reconcile";

/**
 * Pure result assembly from a set of settled `SourceResult`s. This is the single
 * shared builder used both server-side (after `runAll` completes) and on the
 * client to compute a *provisional* result from the sources that have streamed
 * in so far — so the verdict can render before the slowest source settles. Given
 * the same sources it produces an identical result, so the early view and the
 * final view agree. `cached`/`history` are layered on by the route, not here.
 */
export function assembleIpResult(
  ip: string,
  results: SourceResult[],
  checkedAt: string,
): CheckResult {
  const { riskScore, verdict } = aggregateRisk(results);
  const geoResolution = reconcileGeo(results);
  const reverse = results.find((r) => r.geo?.reverse)?.geo?.reverse;
  const fcrdns = results.find((r) => r.geo?.fcrdns)?.geo?.fcrdns;

  return {
    ip,
    checkedAt,
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

function mergeDomainContext(results: SourceResult[]): DomainContext | undefined {
  return mergeFields(
    results
      .filter((r) => r.status === "ok" && r.domainContext)
      .map((r) => r.domainContext as DomainContext),
  );
}

export function assembleDomainResult(
  domain: string,
  results: SourceResult[],
  checkedAt: string,
): DomainCheckResult {
  const { riskScore, verdict } = aggregateRisk(results);
  return {
    domain,
    checkedAt,
    riskScore,
    verdict,
    context: mergeDomainContext(results),
    sources: results,
    stats: computeStats(results),
  };
}

function mergeHashContext(results: SourceResult[]): HashContext | undefined {
  return mergeFields(
    results
      .filter((r) => r.status === "ok" && r.hashContext)
      .map((r) => r.hashContext as HashContext),
  );
}

export function assembleHashResult(
  hash: string,
  algorithm: HashAlgorithm,
  results: SourceResult[],
  checkedAt: string,
): HashCheckResult {
  const { riskScore, verdict } = aggregateRisk(results);
  return {
    hash,
    algorithm,
    checkedAt,
    riskScore,
    verdict,
    context: mergeHashContext(results),
    sources: results,
    stats: computeStats(results),
  };
}
