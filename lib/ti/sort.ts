/**
 * Compare two strings by UTF-16 code unit, which is the ordering a bare
 * `Array.prototype.sort()` already applies to strings.
 *
 * Passing this explicitly is what typescript:S2871 asks for, but the fix that
 * rule suggests, `String.localeCompare`, would be the wrong one at every call
 * site in this codebase. localeCompare orders by the runtime's ICU locale, so
 * the same input can come back in a different order on a different machine,
 * and every caller here needs the result to be stable:
 *
 *   - `dns/consensus.ts` joins the sorted set into a canonical string used as a
 *     tally key and as a deterministic tiebreak.
 *   - `deep.ts` and `research/sources/crtsh.ts` sort subdomains before slicing
 *     to a cap, so the ordering decides which ones survive.
 *   - the threatfox adapters sort ISO-8601 timestamps and take the last one.
 *     Code-unit order is chronological order for that format; a locale
 *     collator makes no such promise.
 *
 * Written as an early return rather than a nested ternary so it does not trade
 * one Sonar finding for another (typescript:S3358).
 */
export function byCodeUnit(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}
