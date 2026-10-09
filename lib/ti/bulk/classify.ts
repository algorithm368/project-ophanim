import { aggregateRisk } from "../aggregate";
import type { SourceResult, Verdict } from "../types";
import { sourceWeight } from "../weight";
import type { Bucket } from "./types";

export interface Classified {
  bucket: Bucket;
  riskScore: number;
  verdict: Verdict;
  vouchedBy?: string;
}

const isOk = (r: SourceResult) => r.status === "ok";

/** Tranco's bulk-lane parent match (Task 16). It is bucketing only: it is not
 *  `allowlisted`, so it never reaches aggregateRisk's floor gate. */
function parentOf(r: SourceResult): string | undefined {
  const pv = r.details?.parentVouch as { parent?: unknown } | undefined;
  return typeof pv?.parent === "string" ? pv.parent : undefined;
}

function voucherOf(results: SourceResult[]): string | undefined {
  for (const r of results) {
    if (!isOk(r)) continue;
    if (r.allowlisted === true) return r.source.id;
    const parent = parentOf(r);
    if (parent) return `${r.source.id}, via ${parent}`;
  }
  return undefined;
}

/** Mirrors aggregate.ts's FLOOR_MIN_WEIGHT: authoritative enough to pin alone. */
const FLOOR_MIN_WEIGHT = 0.7;

/** Whether aggregateRisk's floor gate admits these listings: one authoritative
 *  listing, or a quorum of two weaker ones. */
function hardListed(results: SourceResult[]): boolean {
  const weights = results
    .filter((r) => isOk(r) && r.malicious === true)
    .map((r) => sourceWeight(r.source))
    .filter((w) => w > 0);
  return weights.length >= 2 || weights.some((w) => w >= FLOOR_MIN_WEIGHT);
}

/** Order matters: a floor beats a vouch, and a vouch only counts with no
 *  malicious listing.
 *
 *  `floorApplied` alone is not "hard-listed": aggregateRisk sets it only when
 *  the floor raised the score, so a listing whose blend already clears the
 *  floor (Feodo at 100 beside one quiet source blends to 87) would fall to B.
 *  Bucket A is the gate admitting the listing, unless vouches held it off. */
export function classify(results: SourceResult[]): Classified {
  const { riskScore, verdict, breakdown } = aggregateRisk(results);
  const base = { riskScore, verdict };
  const floored = hardListed(results) && !breakdown.allowlistSuppressed;
  if (breakdown.floorApplied || floored) return { ...base, bucket: "A" };

  const listed = results.some((r) => isOk(r) && r.malicious === true);
  const vouchedBy = voucherOf(results);
  if (vouchedBy && !listed) return { ...base, bucket: "D", vouchedBy };

  const quiet = verdict === "clean" || verdict === "unknown";
  const settled = !breakdown.borderline && !breakdown.uncorroborated;
  return { ...base, bucket: quiet && settled ? "C" : "B" };
}
