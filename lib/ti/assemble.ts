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
import { collectCertificates, collectPassiveDns, collectSubdomains } from "./deep";
import { overlayResolution, reconcileGeo } from "./geo/reconcile";
import { isKnownBenignHash } from "./benign";
import { resolveFileName } from "./hash/resolve-name";

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
  const { riskScore, verdict, breakdown } = aggregateRisk(results);
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
    passiveDns: collectPassiveDns(results),
    sources: results,
    stats: computeStats(results),
    scoreBreakdown: breakdown,
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
  const { riskScore, verdict, breakdown } = aggregateRisk(results);
  const context = mergeDomainContext(results);
  const stats = computeStats(results);
  // A name that returns NXDOMAIN doesn't exist in DNS, so every blocklist's
  // "not listed" is vacuous — "clean" would read as vetted-good. Rate it
  // unknown instead. A flagged NXDOMAIN (e.g. a taken-down C2 still on
  // blocklists) keeps its scored verdict.
  const finalVerdict =
    context?.nxdomain && stats.flagged === 0 && verdict === "clean"
      ? "unknown"
      : verdict;
  return {
    domain,
    checkedAt,
    riskScore,
    verdict: finalVerdict,
    context,
    certificates: collectCertificates(results),
    subdomains: collectSubdomains(results),
    passiveDns: collectPassiveDns(results),
    sources: results,
    stats,
    scoreBreakdown: breakdown,
  };
}

function mergeHashContext(
  results: SourceResult[],
  hash: string,
  algorithm: HashAlgorithm,
): HashContext | undefined {
  const merged = mergeFields(
    results
      .filter((r) => r.status === "ok" && r.hashContext)
      .map((r) => r.hashContext as HashContext),
  );
  if (!merged) return undefined;
  const hashes = {
    md5: merged.md5 ?? (algorithm === "md5" ? hash : undefined),
    sha1: merged.sha1 ?? (algorithm === "sha1" ? hash : undefined),
    sha256: merged.sha256 ?? (algorithm === "sha256" ? hash : undefined),
  };
  const resolved = resolveFileName(results, hashes);
  return {
    ...merged,
    fileName: resolved.fileName,
    fileNames: resolved.fileNames,
  };
}

export function assembleHashResult(
  hash: string,
  algorithm: HashAlgorithm,
  results: SourceResult[],
  checkedAt: string,
): HashCheckResult {
  const { riskScore, verdict, breakdown } = aggregateRisk(results);
  // EICAR and other known-benign artifacts are benign by definition; the source
  // rows still show every detection, but the aggregate verdict is corrected.
  const benignOverride = isKnownBenignHash(hash);
  return {
    hash,
    algorithm,
    checkedAt,
    riskScore: benignOverride ? 0 : riskScore,
    verdict: benignOverride ? "clean" : verdict,
    context: mergeHashContext(results, hash, algorithm),
    sources: results,
    stats: computeStats(results),
    scoreBreakdown: benignOverride
      ? { ...breakdown, benignOverride, floorApplied: false }
      : breakdown,
  };
}
