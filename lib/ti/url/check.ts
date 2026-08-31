import { parseUrl } from "@/lib/url";
import { aggregateRisk, computeStats } from "../aggregate";
import {
  getCachedDomainResult,
  getCachedResult,
  setCachedDomainResult,
  setCachedResult,
} from "../cache";
import { checkIp } from "../check";
import { checkDomain } from "../domain/check";
import { answers, dohQuery, RESOLVERS } from "../dns/doh";
import { runAll } from "../orchestrate";
import type { SourceResult } from "../types";
import { selectHeadline } from "./layers";
import { urlSources } from "./registry";
import { annotateSharedHost } from "./shared-host";
import type { LayerKind, UrlCheckResult, UrlLayer } from "./types";

/** Seams for the tests, so composition can be driven without a network. Nothing
 *  in production passes these. */
export interface CheckUrlDeps {
  resolve?: (host: string, signal: AbortSignal) => Promise<string[]>;
  checkDomainLayer?: typeof checkDomain;
  checkIpLayer?: typeof checkIp;
  getCachedDomain?: typeof getCachedDomainResult;
  getCachedIp?: typeof getCachedResult;
  setCachedDomain?: typeof setCachedDomainResult;
  setCachedIp?: typeof setCachedResult;
  runUrlSources?: (
    url: string,
    onSettled?: (result: SourceResult) => void,
  ) => Promise<SourceResult[]>;
}

const RESOLVE_TIMEOUT_MS = 5000;

/**
 * A/AAAA lookup over DoH. This is the one part of a "passive" check that emits
 * a packet the target can eventually observe, since an uncached name reaches
 * its authoritative nameserver. Going through a public resolver means the
 * operator sees Cloudflare's address rather than ours.
 */
async function resolveHost(
  host: string,
  signal: AbortSignal,
): Promise<string[]> {
  const a = answers(await dohQuery(RESOLVERS.cloudflare, host, "A", signal));
  if (a.length > 0) return a;
  return answers(await dohQuery(RESOLVERS.cloudflare, host, "AAAA", signal));
}

/** Build a layer by scoring rows this file gathered itself (the URL layer). */
function layerFromSources(
  kind: LayerKind,
  indicator: string,
  results: SourceResult[],
): UrlLayer {
  const { riskScore, verdict, breakdown } = aggregateRisk(results);
  return {
    kind,
    indicator,
    status: "ok",
    riskScore,
    verdict,
    sources: results,
    stats: computeStats(results),
    scoreBreakdown: breakdown,
  };
}

/**
 * Build a layer from a per-type result that has already been scored.
 *
 * The verdict is copied, never recomputed from `sources`. Those pipelines apply
 * rules on top of aggregateRisk that the raw rows no longer carry: a domain
 * returning NXDOMAIN is forced from clean to unknown by assembleDomainResult,
 * because every blocklist's "not listed" is vacuous for a name that does not
 * exist. Re-aggregating here would quietly restore the clean verdict that rule
 * exists to prevent.
 */
function layerFromResult(
  kind: LayerKind,
  indicator: string,
  result: {
    riskScore: number;
    verdict: UrlLayer["verdict"];
    sources: SourceResult[];
    stats: UrlLayer["stats"];
    scoreBreakdown?: NonNullable<UrlLayer["scoreBreakdown"]>;
  },
  cachedAt?: string,
): UrlLayer {
  return {
    kind,
    indicator,
    status: "ok",
    riskScore: result.riskScore,
    verdict: result.verdict,
    sources: result.sources,
    stats: result.stats,
    scoreBreakdown: result.scoreBreakdown,
    ...(cachedAt ? { cachedAt } : {}),
  };
}

/** A layer with no verdict. Never `clean`: see LayerStatus in ./types. */
function absentLayer(
  kind: LayerKind,
  indicator: string,
  status: "unavailable" | "not-applicable",
  reason: string,
): UrlLayer {
  return {
    kind,
    indicator,
    status,
    reason,
    riskScore: 0,
    verdict: "unknown",
    sources: [],
    stats: {
      total: 0,
      queried: 0,
      flagged: 0,
      skipped: 0,
      errored: 0,
      rateLimited: 0,
    },
  };
}

/**
 * Check a URL as three layers: the URL itself, its host, and the host's
 * address. Each layer runs the existing pipeline for its own indicator type and
 * scores through the unchanged aggregateRisk, so this file composes rather than
 * re-implements.
 *
 * The host and IP layers read the existing per-type caches first, and write
 * back what they had to compute. That is what keeps a URL-heavy triage session
 * from paying for the same host twenty times, and with it the reverse-IP
 * provider's daily budget. Reading without writing only half-solved it: a host
 * checked here still cost a second full fan-out when checked on its own.
 *
 * The write is deliberately cache-only. A layer computed inside a URL check is
 * a real observation, but it is not one the analyst asked for, and recording it
 * on the indicator's own timeline would push the history of a popular host out
 * with entries nobody can explain.
 */
export async function checkUrl(
  url: string,
  onSettled?: (result: SourceResult) => void,
  deps: CheckUrlDeps = {},
): Promise<UrlCheckResult> {
  const parsed = parseUrl(url);
  if (!parsed) throw new Error("Unparseable URL");

  const resolve = deps.resolve ?? resolveHost;
  const runDomain = deps.checkDomainLayer ?? checkDomain;
  const runIp = deps.checkIpLayer ?? checkIp;
  const cachedDomain = deps.getCachedDomain ?? getCachedDomainResult;
  const cachedIp = deps.getCachedIp ?? getCachedResult;
  const storeDomain = deps.setCachedDomain ?? setCachedDomainResult;
  const storeIp = deps.setCachedIp ?? setCachedResult;
  const runUrl =
    deps.runUrlSources ??
    ((target: string, settled?: (result: SourceResult) => void) =>
      runAll(urlSources, target, settled));

  const urlLayer = layerFromSources(
    "url",
    parsed.canonical,
    await runUrl(parsed.canonical, onSettled),
  );

  // A URL that addresses an IP directly has no host to check. That is an
  // absence of subject, not a failure to look.
  let hostLayer: UrlLayer;
  if (parsed.isIpHost) {
    hostLayer = absentLayer(
      "domain",
      parsed.host,
      "not-applicable",
      "The URL addresses an IP directly, so there is no host to check",
    );
  } else {
    const hit = await cachedDomain(parsed.host);
    if (hit) {
      hostLayer = layerFromResult("domain", parsed.host, hit, hit.checkedAt);
    } else {
      const fresh = await runDomain(parsed.host, onSettled);
      // Fire and forget: a failed cache write is swallowed in cache.ts, and an
      // answer the analyst already has should not wait on storing it.
      void storeDomain(parsed.host, fresh);
      hostLayer = layerFromResult("domain", parsed.host, fresh);
    }
  }

  // One address is checked. Running the IP pipeline per address would multiply
  // an already wide fan-out, so the rest are reported as unchecked rather than
  // quietly treated as cleared.
  const addresses = parsed.isIpHost
    ? [parsed.host]
    : await resolve(parsed.host, AbortSignal.timeout(RESOLVE_TIMEOUT_MS));
  const [first, ...others] = addresses;

  let ipLayer: UrlLayer;
  if (!first) {
    ipLayer = absentLayer(
      "ip",
      parsed.host,
      "unavailable",
      "The host did not resolve, so there is no address to check",
    );
  } else {
    const hit = await cachedIp(first);
    let layer: UrlLayer;
    if (hit) {
      layer = layerFromResult("ip", first, hit, hit.checkedAt);
    } else {
      const fresh = await runIp(first, onSettled);
      void storeIp(first, fresh);
      layer = layerFromResult("ip", first, fresh);
    }
    ipLayer = annotateSharedHost(layer);
  }

  const layers = [urlLayer, hostLayer, ipLayer];
  const headline = selectHeadline(layers);
  const sources = layers.flatMap((layer) => layer.sources);

  return {
    url: parsed.canonical,
    checkedAt: new Date().toISOString(),
    riskScore: headline.riskScore,
    verdict: headline.verdict,
    headlineLayer: headline.kind,
    layers,
    ...(others.length ? { otherAddresses: others } : {}),
    sources,
    stats: computeStats(sources),
  };
}
