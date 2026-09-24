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

/**
 * Repeated lines folded into one, with how many times each appeared, in the
 * order each first appeared.
 *
 * For lists read off a page where a repeat is real but not news: a page with
 * three canvases logs the same WebGL warning three times, and printing it three
 * times says less than printing it once with "×3". It also gives every line a
 * unique value, which a list keyed on its text needs.
 */
export function tally(items: string[]): { value: string; times: number }[] {
  const seen = new Map<string, number>();
  for (const item of items) seen.set(item, (seen.get(item) ?? 0) + 1);
  return [...seen].map(([value, times]) => ({ value, times }));
}
