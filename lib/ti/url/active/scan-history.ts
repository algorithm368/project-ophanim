import type { ScanEngine } from "./engines";
import type { ActiveScanBatch, PastScan } from "./types";

/**
 * How many earlier scans to keep.
 *
 * Enough to answer "was this scanned before, and did the answer change", which
 * is the question the header asks. Beyond that it becomes an evidence archive,
 * which the design rules out.
 */
export const MAX_PREVIOUS = 5;

/**
 * Shrink a finished batch to what a history line needs: when it ran, what it
 * said, and how to reopen the provider's own report.
 *
 * Returns null when nothing in the batch finished. A failed submission is not a
 * past reading, and recording one would render as "scanned before, not
 * malicious", which is a claim no scanner made.
 */
export function summarizeBatch(batch: ActiveScanBatch): PastScan | null {
  const finished = batch.scans.filter((s) => s.status === "done" && s.verdict);
  if (finished.length === 0) return null;

  const engines: ScanEngine[] = [];
  for (const scan of finished) {
    if (!engines.includes(scan.engine)) engines.push(scan.engine);
  }

  return {
    at: batch.submittedAt,
    malicious: finished.some((s) => s.verdict?.malicious === true),
    engines,
    reports: finished
      .filter((s) => s.uuid ?? s.resultUrl)
      .map((s) => ({
        engine: s.engine,
        ...(s.uuid ? { uuid: s.uuid } : {}),
        ...(s.resultUrl ? { resultUrl: s.resultUrl } : {}),
      })),
  };
}

/**
 * Fold the batch being replaced into the new batch's history.
 *
 * A rescan is the only thing that discards a stored scan, so this is where the
 * old reading gets its one chance to survive as a line rather than vanish.
 */
export function rememberBatch(
  replaced: ActiveScanBatch | null,
  next: ActiveScanBatch,
): ActiveScanBatch {
  if (!replaced) return next;
  const summary = summarizeBatch(replaced);
  const carried = [...(summary ? [summary] : []), ...(replaced.previous ?? [])];
  if (carried.length === 0) return next;
  return { ...next, previous: carried.slice(0, MAX_PREVIOUS) };
}

/**
 * The history as one word for the provenance rail: whether this is the first
 * reading, and if not, whether the answer has moved.
 *
 * "Changed" outranks the count, because a site that was flagged and now is not
 * is evidence of a takedown or a cloak rather than of innocence, and that is
 * the reason the history is kept at all. While the current reading is still
 * out there is nothing to compare, so the rail says how many came before.
 */
export function historyLevel(
  previous: PastScan[] | undefined,
  nowMalicious: boolean | undefined,
): string {
  const past = previous ?? [];
  if (past.length === 0) return "First";
  if (nowMalicious === undefined) return `${past.length} before`;
  return past.some((p) => p.malicious !== nowMalicious) ? "Changed" : "Steady";
}
