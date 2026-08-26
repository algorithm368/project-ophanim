/**
 * How long to wait before asking the scan route again.
 *
 * The interval widens with the age of the scan rather than with the number of
 * polls taken, because what changes is how likely another target is to have
 * landed, not how many times we have asked. Most targets finish early, so a
 * tight interval late is paid for and wasted; a flat six seconds meant a
 * target that finished at second one went unseen until second six.
 */

/** Under this, targets are landing steadily. */
const YOUNG_MS = 10_000;
/** A scan takes roughly this long, so past it there is little left to catch. */
const EXPECTED_MS = 30_000;

export function pollIntervalFor(ageMs: number): number {
  if (ageMs < YOUNG_MS) return 1500;
  if (ageMs < EXPECTED_MS) return 3000;
  return 6000;
}
