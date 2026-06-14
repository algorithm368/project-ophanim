/**
 * Whether a multi-engine AV tally (VirusTotal, MetaDefender) is strong enough
 * to count as a *definitive* malicious listing.
 *
 * A SourceFinding's `malicious: true` feeds aggregateRisk()'s hard floor (the
 * score is held at 75+), so it must mean "this source alone justifies a
 * malicious verdict" — not merely "some engines complained". 1-4 engines out
 * of a ~70-90 panel is classic heuristic false-positive territory
 * (single-vendor signatures, stale URL-scanner verdicts), so require both an
 * absolute engine count and a minimum share of the panel. Weaker tallies
 * still contribute their score to the weighted blend — they just can't floor
 * the aggregate on their own.
 */
export function vtDefinitive(
  maliciousEngines: number,
  totalEngines: number,
): boolean {
  return (
    maliciousEngines >= 5 &&
    maliciousEngines / Math.max(totalEngines, 1) >= 0.05
  );
}
