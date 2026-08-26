/**
 * How much longer a lookup can take, and how to say it.
 *
 * The sources run in parallel, so the slowest one still outstanding bounds the
 * finish: the estimate is a worst case, not an average. Because the set of
 * outstanding sources only ever shrinks, the estimate only ever shrinks with
 * it, which is the property that keeps a countdown from ticking upward.
 *
 * Lives in `lib/` rather than beside the component because it is arithmetic
 * over source metadata with no DOM in it, and because that is where the tests
 * are.
 */

/** What a source is assumed to allow itself when its meta does not say. */
const ASSUMED_TIMEOUT_MS = 8_000;

/** What to say before any source has reported. Nothing is known then, and a
 *  panel that answers in this range makes it a defensible guess. */
const UNKNOWN_ETA_MS = 10_000;

/** The little of a source's meta this needs. Structural on purpose, so a test
 *  can hand it two fields instead of a whole `SourceMeta`. */
export interface TimedSource {
  id: string;
  timeoutMs?: number;
}

/** Worst-case wait across a set of sources: the longest timeout among them. */
export function longestTimeout(sources: readonly TimedSource[]): number {
  if (sources.length === 0) return UNKNOWN_ETA_MS;
  return Math.max(...sources.map((s) => s.timeoutMs ?? ASSUMED_TIMEOUT_MS));
}

/**
 * Worst-case wait left, given who has already answered.
 *
 * Falls back to the whole panel while nothing has settled, since "the slowest
 * of none" is not an estimate of anything. Once every source is in, the budget
 * is zero: there is nothing left to wait for.
 */
export function etaBudgetMs(
  sources: readonly TimedSource[],
  settledIds: ReadonlySet<string>,
): number {
  const outstanding = sources.filter((s) => !settledIds.has(s.id));
  if (sources.length > 0 && outstanding.length === 0) return 0;
  return longestTimeout(outstanding.length > 0 ? outstanding : sources);
}

/**
 * The countdown, as a reader should see it.
 *
 * An estimate that has run out says so rather than counting into negatives:
 * the sources are still out, the guess was simply wrong, and pretending
 * otherwise is the one thing a wait indicator must not do.
 */
export function etaLabel(remainingMs: number): string {
  const seconds = Math.ceil(remainingMs / 1000);
  if (seconds <= 0) return "finishing up";
  if (seconds < 60) return `~${seconds}s left`;
  const mins = Math.floor(seconds / 60);
  return `~${mins}:${String(seconds % 60).padStart(2, "0")} left`;
}
