import { getRedis } from "./cache";
import { domainSources } from "./domain/registry";
import { gradeSource, sortHealth, type HealthEntry, type SourceHealth } from "./health";
import { hashSources } from "./hash/registry";
import { sources as ipSources } from "./registry";
import type { SourceResult, TiSource } from "./types";

/**
 * Where source health lives in Redis. Written by the indicator routes after
 * each fresh run (a cache hit contacted no source, so it records nothing),
 * read by the homepage's source rail. Optional like the rest of the cache:
 * without Redis the write is a no-op and the read is null.
 */

export const HEALTH_WINDOW = 50;
const PREFIX = "ti:health:";
const MAX_ERROR = 200;

export function healthKey(type: string, id: string): string {
  return `${PREFIX}${type}:${id}`;
}

export function toEntry(r: SourceResult, now: number): HealthEntry {
  const entry: HealthEntry = { s: r.status, ms: Math.round(r.durationMs), t: now };
  if (r.error) entry.e = r.error.slice(0, MAX_ERROR);
  return entry;
}

/** One pipeline per lookup: LPUSH + LTRIM for every source that actually ran. */
export async function recordHealth(type: string, results: SourceResult[]): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const ran = results.filter((r) => r.status !== "skipped");
  if (ran.length === 0) return;
  try {
    const now = Date.now();
    const p = redis.pipeline();
    for (const r of ran) {
      const k = healthKey(type, r.source.id);
      p.lpush(k, toEntry(r, now)).ltrim(k, 0, HEALTH_WINDOW - 1);
    }
    await p.exec();
  } catch (err) {
    console.error("[ti] health write failed:", err);
  }
}

export interface HealthGroup {
  type: string;
  sources: TiSource[];
}

export const HEALTH_GROUPS: HealthGroup[] = [
  { type: "ip", sources: ipSources },
  { type: "domain", sources: domainSources },
  { type: "hash", sources: hashSources },
];

export interface HealthBoard {
  rows: SourceHealth[];
  /** Newest recorded run across every source, for the "as of" line. */
  newestAt: number | null;
}

/** Upstash usually returns parsed objects, but tolerate raw JSON strings too. */
function toHealthEntry(raw: unknown): HealthEntry | null {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const e = obj as HealthEntry | null;
  return e && typeof e.s === "string" && typeof e.ms === "number" && typeof e.t === "number" ? e : null;
}

export async function readHealth(groups: HealthGroup[]): Promise<HealthBoard | null> {
  const redis = getRedis();
  if (!redis) return null;
  const pairs = groups.flatMap((g) => g.sources.map((s) => ({ type: g.type, source: s })));
  try {
    const p = redis.pipeline();
    for (const { type, source } of pairs) p.lrange(healthKey(type, source.meta.id), 0, HEALTH_WINDOW - 1);
    const lists = (await p.exec()) as unknown[][];
    const rows = pairs.map(({ type, source }, i) =>
      gradeSource({
        meta: source.meta,
        type,
        enabled: source.isEnabled(),
        entries: (lists[i] ?? []).map(toHealthEntry).filter((e): e is HealthEntry => e !== null),
      }),
    );
    const times = rows.map((r) => r.lastAt).filter((t): t is number => t !== null);
    return { rows: sortHealth(rows), newestAt: times.length ? Math.max(...times) : null };
  } catch (err) {
    console.error("[ti] health read failed:", err);
    return null;
  }
}
