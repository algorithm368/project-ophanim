import { FLAG_THRESHOLD } from "./aggregate";
import type { HistorySnapshot, Verdict } from "./types";

/** What the recorded history says about an indicator, if anything. */
export interface ReputationTrend {
  /** Snapshots on record, including the current one when present. */
  checks: number;
  /** How many of them landed on suspicious or worse. */
  adverse: number;
  /** True when every recorded check agreed with the newest one. */
  steady: boolean;
  /** Verdicts seen, newest first, deduped. */
  seen: Verdict[];
  /** One line, commas not dashes. */
  summary: string;
  /**
   * The same fact as a value under a "History" label, for the verdict card's
   * stat strip.
   *
   * The strip is columns of counts, and a full sentence dropped into one of
   * them reads as prose and breaks the alignment that makes the row scannable.
   * The label supplies the noun, so this carries only the fraction; `summary`
   * is still what the tooltip says.
   */
  short: string;
}

const ADVERSE: Verdict[] = ["suspicious", "malicious"];

/**
 * Read the reputation timeline.
 *
 * Recorded per *fresh* check, so the series is sampled by how often someone
 * happened to look rather than on a schedule. Ten checks in an afternoon and
 * ten over ten months are not the same evidence and this cannot tell them
 * apart, which is why the trend is reported and never fed back into the score:
 * today's score is recorded as history, so scoring history would let a verdict
 * confirm itself.
 *
 * Returns null below two snapshots, since one point is not a trend.
 */
export function reputationTrend(
  history: HistorySnapshot[] | undefined,
): ReputationTrend | null {
  const snapshots = (history ?? []).filter((h) => h?.verdict);
  if (snapshots.length < 2) return null;

  // The route layers history oldest-to-newest.
  const newest = snapshots[snapshots.length - 1];
  const adverse = snapshots.filter((h) => ADVERSE.includes(h.verdict)).length;
  const steady = snapshots.every((h) => h.verdict === newest.verdict);

  const seen: Verdict[] = [];
  for (let i = snapshots.length - 1; i >= 0; i--) {
    if (!seen.includes(snapshots[i].verdict)) seen.push(snapshots[i].verdict);
  }

  const checks = snapshots.length;
  let summary: string;
  let short: string;
  if (steady) {
    summary = `${newest.verdict} on all ${checks} recorded checks`;
    short = `${newest.verdict} ${checks}/${checks}`;
  } else if (adverse === 0) {
    summary = `never flagged across ${checks} recorded checks`;
    short = `flagged 0/${checks}`;
  } else {
    summary = `flagged on ${adverse} of ${checks} recorded checks, verdict has changed`;
    short = `flagged ${adverse}/${checks}, changed`;
  }

  return { checks, adverse, steady, seen, summary, short };
}

/**
 * Whether the newest verdict is a reversal of what came before.
 *
 * A first-time listing and a standing one call for different responses, and the
 * card cannot say which without this.
 */
export function isNewlyFlagged(
  history: HistorySnapshot[] | undefined,
  current: Verdict,
): boolean {
  const snapshots = history ?? [];
  if (snapshots.length < 2 || !ADVERSE.includes(current)) return false;
  const earlier = snapshots.slice(0, -1);
  return earlier.every(
    (h) => !ADVERSE.includes(h.verdict) && h.riskScore < FLAG_THRESHOLD,
  );
}
