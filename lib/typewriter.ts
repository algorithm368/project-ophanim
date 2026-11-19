/**
 * How a value is typed into its slot on the result page.
 *
 * Pure, so the pace can be tested without a clock. The component that types
 * (`Typed` in `components/CheckResults/live.tsx`) owns the timer and nothing
 * else.
 */

/** One step of the typing clock. */
export const TICK_MS = 24;

/** No value takes more steps than this, so every value is in within about a
 *  second however long it is: a word types a letter at a time, a paragraph a
 *  few letters at a time. A paragraph typed at a word's pace would still be
 *  typing long after the page had finished. */
export const MAX_STEPS = 40;

/** How many characters each step adds, for a value of this length. */
export function typingStep(length: number): number {
  return Math.max(1, Math.ceil(length / MAX_STEPS));
}

/** How long a value of this length takes to type in, start to end. */
export function typingDuration(length: number): number {
  return Math.ceil(length / typingStep(length)) * TICK_MS;
}

/**
 * Where typing of `next` starts when the slot currently shows `shown`.
 *
 * A value that changes on screen keeps the run it shares with the new one and
 * types only the rest: a city that gains its region reads as the region being
 * added, not as the whole place being rewritten. Nothing shown yet means
 * typing from the start.
 */
export function typingFrom(shown: string | undefined, next: string): number {
  if (shown === undefined) return 0;
  const n = Math.min(shown.length, next.length);
  let i = 0;
  while (i < n && shown[i] === next[i]) i++;
  return i;
}
