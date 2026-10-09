import { aggregateRisk } from "../aggregate";
import { runAll } from "../orchestrate";
import type { SourceResult, Verdict } from "../types";
import { familyOf, pass0Sources } from "./profile";
import type { BulkRow } from "./types";

/** ipsum scores 10 per list, so 30 is "on three or more blocklists". */
export const STRONG_SCORE = 30;

export interface Pass0Summary {
  riskScore: number;
  verdict: Verdict;
  listedBy: string[];
  strong: boolean;
}

const listed = (r: SourceResult) => r.status === "ok" && (r.malicious === true || (r.score ?? 0) > 0);
const strongHit = (r: SourceResult) => r.status === "ok" && (r.malicious === true || (r.score ?? 0) >= STRONG_SCORE);

/** Compact on purpose: a 419k-IP run keeps one of these per IP, not the results. */
export function summarizePass0(results: SourceResult[]): Pass0Summary {
  const { riskScore, verdict } = aggregateRisk(results);
  return {
    riskScore,
    verdict,
    listedBy: results.filter(listed).map((r) => r.source.id),
    strong: results.some(strongHit),
  };
}

/** The feed loaders cache at module level, so after the first IP every call
 *  is an in-memory lookup. */
export async function runPass0(ip: string): Promise<Pass0Summary> {
  return summarizePass0(await runAll(pass0Sources(familyOf("ip", ip)), ip));
}

/** Large runs stop here unless the hit is strong (or weak, with --include-weak).
 *  A row that stops gets no verdict: being absent from four feeds is not clean. */
export function settlePass0(row: BulkRow, s: Pass0Summary, includeWeak: boolean): BulkRow | null {
  const weak = s.listedBy.length > 0;
  if (s.strong || (weak && includeWeak)) return null;
  return {
    ...row,
    state: "feed-only",
    verdict: undefined,
    listedBy: s.listedBy,
    note: weak ? `Weak listing (${s.listedBy.join(", ")}), unchecked` : "Not in feeds, unchecked",
    checkedAt: new Date().toISOString(),
  };
}
