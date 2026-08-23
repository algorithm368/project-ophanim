/**
 * How long ago, in as few characters as possible.
 *
 * The verdict card's meta row used to spell a check time out in full
 * ("8/21/2026, 7:54:16 AM"), which is thirty characters answering a question
 * nobody asks that precisely. What an analyst reads off that line is whether
 * the result is fresh, and "2m ago" answers it. The exact stamp is still one
 * hover away, so nothing is lost.
 *
 * Units are terse and unpluralised on purpose: this renders in a mono line
 * beside a detector tally, and "2m" lines up where "2 minutes" wraps.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * `relativeTime(checkedAt, Date.now())` → "just now", "2m ago", "3h ago",
 * "5d ago", "2mo ago", "1y ago".
 *
 * `now` is a parameter rather than read inside so the function is pure and
 * testable, and so a caller re-rendering on a timer passes its own clock.
 * A stamp in the future (clock skew between the server that wrote it and the
 * browser reading it) reads as "just now" rather than as a negative age.
 */
export function relativeTime(when: string | number | Date, now: number): string {
  const ms = new Date(when).getTime();
  if (Number.isNaN(ms)) return "unknown";

  const age = now - ms;
  if (age < MINUTE) return "just now";
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m ago`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h ago`;
  if (age < MONTH) return `${Math.floor(age / DAY)}d ago`;
  if (age < YEAR) return `${Math.floor(age / MONTH)}mo ago`;
  return `${Math.floor(age / YEAR)}y ago`;
}
