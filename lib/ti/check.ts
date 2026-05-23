import type { CheckResult, GeoContext, SourceResult, TiSource } from "./types";
import { sources } from "./registry";
import { aggregateRisk, computeStats } from "./aggregate";

const PER_SOURCE_TIMEOUT_MS = 8000;

async function runSource(source: TiSource, ip: string): Promise<SourceResult> {
  const enabled = source.isEnabled();
  const started = Date.now();

  if (!enabled) {
    return {
      source: source.meta,
      enabled: false,
      status: "skipped",
      summary: source.meta.keyEnv
        ? `Set ${source.meta.keyEnv} to enable`
        : "Disabled",
      durationMs: 0,
    };
  }

  try {
    const finding = await source.check(
      ip,
      AbortSignal.timeout(PER_SOURCE_TIMEOUT_MS),
    );
    return {
      source: source.meta,
      enabled: true,
      durationMs: Date.now() - started,
      ...finding,
    };
  } catch (err) {
    return {
      source: source.meta,
      enabled: true,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    };
  }
}

/** Merge geo context from whichever sources provide it (first non-empty wins per field). */
function mergeGeo(results: SourceResult[]): GeoContext | undefined {
  const geos = results
    .filter((r) => r.status === "ok" && r.geo)
    .map((r) => r.geo as GeoContext);
  if (geos.length === 0) return undefined;

  const merged: GeoContext = {};
  for (const geo of geos) {
    for (const [key, value] of Object.entries(geo) as [
      keyof GeoContext,
      unknown,
    ][]) {
      if (
        merged[key] === undefined &&
        value !== undefined &&
        value !== null &&
        value !== ""
      ) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (merged as any)[key] = value;
      }
    }
  }
  return merged;
}

export async function checkIp(ip: string): Promise<CheckResult> {
  const results = await Promise.all(sources.map((s) => runSource(s, ip)));
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
