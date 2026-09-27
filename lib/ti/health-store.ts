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

/** One pipeline: LPUSH + LTRIM per entry, each list capped at the window.
 *  Shared with the scan engines' health (url/active/engine-health.ts). */
export async function pushHealth(items: { key: string; entry: HealthEntry }[]): Promise<void> {
  const redis = getRedis();
  if (!redis || items.length === 0) return;
  try {
    const p = redis.pipeline();
    for (const { key, entry } of items) p.lpush(key, entry).ltrim(key, 0, HEALTH_WINDOW - 1);
    await p.exec();
  } catch (err) {
    console.error("[ti] health write failed:", err);
  }
}

/** One pipeline per lookup, for every source that actually ran. */
export async function recordHealth(type: string, results: SourceResult[]): Promise<void> {
  const now = Date.now();
  await pushHealth(
    results
      .filter((r) => r.status !== "skipped")
      .map((r) => ({ key: healthKey(type, r.source.id), entry: toEntry(r, now) })),
  );
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

/** Each key's entries, newest first, in one pipeline; null when Redis is off
 *  or the read failed. */
export async function readEntries(keys: string[]): Promise<HealthEntry[][] | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const p = redis.pipeline();
    for (const k of keys) p.lrange(k, 0, HEALTH_WINDOW - 1);
    const lists = (await p.exec()) as unknown[][];
    return keys.map((_, i) =>
      (lists[i] ?? []).map(toHealthEntry).filter((e): e is HealthEntry => e !== null),
    );
  } catch (err) {
    console.error("[ti] health read failed:", err);
    return null;
  }
}

/** The newest run across rows, for the rail's "as of" line. */
export function newestOf(rows: SourceHealth[]): number | null {
  const times = rows.map((r) => r.lastAt).filter((t): t is number => t !== null);
  return times.length ? Math.max(...times) : null;
}

export async function readHealth(groups: HealthGroup[]): Promise<HealthBoard | null> {
  const pairs = groups.flatMap((g) => g.sources.map((s) => ({ type: g.type, source: s })));
  const lists = await readEntries(pairs.map(({ type, source }) => healthKey(type, source.meta.id)));
  if (!lists) return null;
  const rows = pairs.map(({ type, source }, i) =>
    gradeSource({ meta: source.meta, type, enabled: source.isEnabled(), entries: lists[i] }),
  );
  return { rows: sortHealth(rows), newestAt: newestOf(rows) };
}
