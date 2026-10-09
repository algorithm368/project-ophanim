import { hasOwnKey } from "../keys";
import { runAll, runSource } from "../orchestrate";
import type { SourceResult } from "../types";
import { classify } from "./classify";
import type { BulkItem } from "./parse";
import { familyOf, pass1Sources, pass2Ids, sourceById } from "./profile";
import { isMeteredKeyEnv, isQuotaHit, markExhausted, msToNextMinute, reserveBulk, type Reservation } from "./quota";
import { readBulkRow, readSharedFull, writeBulkRow } from "./row-cache";
import type { Bucket, BulkRow, MeteredId, MeteredKeyEnv, RowSummary } from "./types";

export function newRow(id: number, item: BulkItem): BulkRow {
  const { internal, ...rest } = item;
  const row: BulkRow = { id, ...rest, state: "pending", results: [], pending: [], missing: [] };
  return internal ? { ...row, state: "internal", note: "Internal name, not sent to any source" } : row;
}

/** A row cached under an older profile may still be queued for a source bulk
 *  no longer asks. Drop those, so the estimate never names them. */
function withCurrentProfile(row: BulkRow): BulkRow {
  if (row.state !== "pass1" || !row.bucket) return row;
  const asked = new Set(pass2Ids(row.kind, row.bucket));
  const pending = row.pending.filter((id) => asked.has(id));
  if (pending.length === row.pending.length) return row;
  return { ...row, pending, state: pending.length === 0 ? "full" : "pass1" };
}

/** Pass 1, cheapest first: /check's cache, bulk's cache, then the unmetered
 *  profile. Callers wrap a chunk in one withRequestMemo and withLane("bulk"). */
export async function runPass1(row: BulkRow, now: Date = new Date()): Promise<BulkRow> {
  if (row.state === "internal") return row;
  const shared = await readSharedFull(row.kind, row.indicator, now);
  if (shared) {
    const { bucket } = classify(shared.results);
    return { ...row, ...shared, bucket, state: "cached", pending: [], missing: [] };
  }
  const cached = await readBulkRow(row.kind, row.indicator, now);
  if (cached) return withCurrentProfile({ ...cached, id: row.id, note: row.note ?? cached.note });

  const results = await runAll(pass1Sources(row.kind, familyOf(row.kind, row.indicator)), row.indicator);
  const c = classify(results);
  const pending = pass2Ids(row.kind, c.bucket);
  const next: BulkRow = {
    ...row,
    results,
    bucket: c.bucket,
    riskScore: c.riskScore,
    verdict: c.verdict,
    pending,
    missing: [],
    state: pending.length === 0 ? "full" : "pass1",
    note: c.vouchedBy ? `Not escalated, vouched by ${c.vouchedBy}` : row.note,
    checkedAt: now.toISOString(),
  };
  await writeBulkRow(next);
  return next;
}

const BUCKET_RANK: Record<Bucket, number> = { B: 0, C: 1, A: 2, D: 3 };

export function escalationQueue<T extends RowSummary>(rows: T[]): T[] {
  return rows
    .filter((r) => r.state === "pass1" && r.pending.length > 0)
    .sort((a, b) => BUCKET_RANK[a.bucket ?? "D"] - BUCKET_RANK[b.bucket ?? "D"] || a.id - b.id);
}

export function estimate(rows: RowSummary[]): Partial<Record<MeteredId, number>> {
  const out: Partial<Record<MeteredId, number>> = {};
  for (const row of escalationQueue(rows)) {
    for (const id of row.pending) out[id] = (out[id] ?? 0) + 1;
  }
  return out;
}

export function estimateTotal(e: Partial<Record<MeteredId, number>>): number {
  return Object.values(e).reduce((sum, n) => sum + (n ?? 0), 0);
}

function reasonFor(reservation: Exclude<Reservation, "ok" | "minute">, keyEnv: MeteredKeyEnv): string {
  if (reservation === "nokey") return "No API key";
  if (reservation === "unavailable") return "No quota ledger, Redis not configured";
  return hasOwnKey(keyEnv, "bulk") ? "Bulk key quota reached" : "Bulk quota reached";
}

function skipped(row: BulkRow, id: MeteredId, summary: string): SourceResult {
  const meta = sourceById(row.kind, id)?.meta ?? { id, name: id, url: "", category: "reputation" as const, requiresKey: true, weight: 0 };
  return { source: meta, enabled: true, status: "skipped", summary, durationMs: 0 };
}

/** Ask one metered source. Null means: wait for the next minute. */
async function askOne(row: BulkRow, id: MeteredId, now: Date): Promise<{ result: SourceResult; missed: boolean } | null> {
  const source = sourceById(row.kind, id);
  const keyEnv = source?.meta.keyEnv;
  if (!source || !isMeteredKeyEnv(keyEnv)) return { result: skipped(row, id, "No API key"), missed: true };
  const reservation = await reserveBulk(keyEnv, now);
  if (reservation === "minute") return null;
  if (reservation !== "ok") return { result: skipped(row, id, reasonFor(reservation, keyEnv)), missed: true };
  const result = await runSource(source, row.indicator);
  const hit = isQuotaHit(result);
  if (hit) await markExhausted(keyEnv, "bulk", now);
  return { result, missed: hit };
}

/** Pass 2 for one row, resumable: progress is in `pending` and written to the
 *  row cache at every stop, so the next call carries on where this one ended. */
export async function runPass2(row: BulkRow, now: Date = new Date()): Promise<{ row: BulkRow; waitMs?: number }> {
  const next: BulkRow = { ...row, results: [...row.results], pending: [...row.pending], missing: [...row.missing] };
  while (next.pending.length > 0) {
    const asked = await askOne(next, next.pending[0], now);
    if (!asked) {
      await writeBulkRow(next);
      return { row: next, waitMs: msToNextMinute(now) };
    }
    const id = next.pending.shift() as MeteredId;
    next.results.push(asked.result);
    if (asked.missed) next.missing.push(id);
  }
  const c = classify(next.results);
  const done: BulkRow = {
    ...next,
    riskScore: c.riskScore,
    verdict: c.verdict,
    state: next.missing.length > 0 ? "partial" : "full",
    checkedAt: now.toISOString(),
  };
  await writeBulkRow(done);
  return { row: done };
}
