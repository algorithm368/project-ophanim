/**
 * Counted nouns, in one place.
 *
 * Almost every summary this app writes is "how many of a thing", and written
 * inline that is a ternary inside a template literal inside whatever built the
 * sentence. Three copies of the same helper had already grown in `narrative.ts`,
 * `ip-dossier.ts` and the scan report; this is that helper, once, so a summary
 * never reads "1 domains" and the pluralisation is not re-derived per source
 * adapter.
 */

/** The noun agreeing with `n`. Pass `plural` when adding an "s" is wrong,
 *  e.g. `pluralize(n, "country", "countries")`. */
export function pluralize(n: number, noun: string, plural = `${noun}s`): string {
  return n === 1 ? noun : plural;
}

/** "1 domain" / "3 domains": the number and the noun that agrees with it. */
export function count(n: number, noun: string, plural = `${noun}s`): string {
  return `${n} ${pluralize(n, noun, plural)}`;
}
