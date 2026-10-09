import { getRedis } from "../cache";
import { newRow } from "./engine";
import type { ParsedBulk } from "./parse";
import { readBulkRowAny } from "./row-cache";
import type { BulkRow, BulkRun, RowSummary } from "./types";

const RUN_PREFIX = "ti:bulk:v1:run:";
const RUN_TTL = 7 * 24 * 60 * 60;

export function summarize(row: BulkRow): RowSummary {
  const summary: Partial<BulkRow> = { ...row };
  delete summary.results;
  return summary as RowSummary;
}

export function createRun(owner: string, parsed: ParsedBulk, id: string = crypto.randomUUID(), now: Date = new Date()): { run: BulkRun; rows: BulkRow[] } {
  const rows = parsed.items.map((item, i) => newRow(i, item));
  const run: BulkRun = {
    v: 1, id, owner, createdAt: now.toISOString(),
    rows: rows.map(summarize), invalid: parsed.invalid, duplicates: parsed.duplicates,
  };
  return { run, rows };
}

/** One runner works one chunk at a time, so load, merge and save need no lock.
 *  The record holds summaries only; results live in the row cache. */
export async function saveRun(run: BulkRun): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  try {
    await redis.set(RUN_PREFIX + run.id, run, { ex: RUN_TTL });
    return true;
  } catch (err) {
    console.error("[bulk] run save failed:", err);
    return false;
  }
}

export async function loadRun(id: string, owner: string): Promise<BulkRun | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const run = await redis.get<BulkRun>(RUN_PREFIX + id);
    return run?.owner === owner ? run : null;
  } catch (err) {
    console.error("[bulk] run load failed:", err);
    return null;
  }
}

export function mergeRows(run: BulkRun, rows: BulkRow[]): BulkRun {
  const byId = new Map(rows.map((r) => [r.id, summarize(r)]));
  return { ...run, rows: run.rows.map((r) => byId.get(r.id) ?? r) };
}

/** A summary plus its results. If the row cache has expired, start the row over. */
export async function hydrate(summary: RowSummary): Promise<BulkRow> {
  const cached = await readBulkRowAny(summary.kind, summary.indicator);
  if (cached) return { ...cached, id: summary.id };
  return { ...summary, state: "pending", results: [], pending: [], missing: [] };
}
