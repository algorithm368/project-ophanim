import { getCachedResultFor, getRedis } from "../cache";
import type { SourceResult, Verdict } from "../types";
import type { BulkKind, BulkRow } from "./types";

const DAY = 24 * 60 * 60;
const WEEK = 7 * DAY;
const ROW_PREFIX = "ti:bulk:v1:row:";

const isBad = (v: Verdict) => v === "suspicious" || v === "malicious";

/** A listing can expire within a day, so a bad verdict is re-asked sooner. */
export function isFresh(verdict: Verdict, checkedAt: string, now: Date = new Date()): boolean {
  const ageSeconds = (now.getTime() - Date.parse(checkedAt)) / 1000;
  return ageSeconds <= (isBad(verdict) ? DAY : WEEK);
}

export interface SharedHit {
  results: SourceResult[];
  riskScore: number;
  verdict: Verdict;
  checkedAt: string;
}

/** A /check result ran the whole registry, so a fresh one finishes a row free. */
export async function readSharedFull(kind: BulkKind, indicator: string, now: Date = new Date()): Promise<SharedHit | null> {
  const hit = await getCachedResultFor(kind, indicator);
  if (!hit || !isFresh(hit.verdict, hit.checkedAt, now)) return null;
  return { results: hit.sources, riskScore: hit.riskScore, verdict: hit.verdict, checkedAt: hit.checkedAt };
}

const rowKey = (kind: BulkKind, indicator: string) => `${ROW_PREFIX}${kind}:${indicator}`;

export async function readBulkRowAny(kind: BulkKind, indicator: string): Promise<BulkRow | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    return (await redis.get<BulkRow>(rowKey(kind, indicator))) ?? null;
  } catch (err) {
    console.error("[bulk] row cache read failed:", err);
    return null;
  }
}

export async function readBulkRow(kind: BulkKind, indicator: string, now: Date = new Date()): Promise<BulkRow | null> {
  const row = await readBulkRowAny(kind, indicator);
  if (!row?.verdict || !row.checkedAt) return null;
  return isFresh(row.verdict, row.checkedAt, now) ? row : null;
}

function rowTtl(row: BulkRow): number {
  if (row.state !== "full") return DAY;
  return row.verdict && isBad(row.verdict) ? DAY : WEEK;
}

/** Bulk's own cache. It never writes /check's keys: a bulk row lacks the
 *  context sources that /check renders. */
export async function writeBulkRow(row: BulkRow): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(rowKey(row.kind, row.indicator), row, { ex: rowTtl(row) });
  } catch (err) {
    console.error("[bulk] row cache write failed:", err);
  }
}
