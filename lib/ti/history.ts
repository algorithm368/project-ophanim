import { getRedis } from "./cache";
import type { HistorySnapshot } from "./types";

const PREFIX = "ti:hist:";
const MAX_SNAPSHOTS = 30;
// Skip a new point when the latest is identical and recent, so repeatedly
// re-fetching the same indicator doesn't flood the timeline.
const DEDUPE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function key(kind: string, value: string): string {
  return `${PREFIX}${kind}:${value}`;
}

/** Upstash usually returns parsed objects, but tolerate raw JSON strings too. */
function toSnapshot(raw: unknown): HistorySnapshot | null {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (
    obj &&
    typeof obj === "object" &&
    typeof (obj as HistorySnapshot).riskScore === "number" &&
    typeof (obj as HistorySnapshot).checkedAt === "string"
  ) {
    return obj as HistorySnapshot;
  }
  return null;
}

/** Returns snapshots oldest-to-newest (the list is stored newest-first). */
export async function getHistory(
  kind: string,
  value: string,
): Promise<HistorySnapshot[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const raw = await redis.lrange(key(kind, value), 0, MAX_SNAPSHOTS - 1);
    return raw
      .map(toSnapshot)
      .filter((s): s is HistorySnapshot => s !== null)
      .reverse();
  } catch (err) {
    console.error("[ti] history read failed:", err);
    return [];
  }
}

/** Append a snapshot for a freshly computed result (skips near-duplicates). */
export async function recordHistory(
  kind: string,
  value: string,
  snapshot: HistorySnapshot,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    const k = key(kind, value);
    const latest = toSnapshot(await redis.lindex(k, 0));
    if (
      latest &&
      latest.riskScore === snapshot.riskScore &&
      latest.verdict === snapshot.verdict &&
      Date.now() - Date.parse(latest.checkedAt) < DEDUPE_WINDOW_MS
    ) {
      return;
    }
    await redis.lpush(k, snapshot);
    await redis.ltrim(k, 0, MAX_SNAPSHOTS - 1);
  } catch (err) {
    console.error("[ti] history write failed:", err);
  }
}
