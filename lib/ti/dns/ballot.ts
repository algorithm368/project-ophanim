import type { Confidence, ResolverConsensus } from "../types";
import type { VoteCell } from "../geo/votes";
import { byCodeUnit } from "../sort";

/** Order-insensitive form of an answer set, matching consensus.ts's own
 *  canonicalization so a resolver's set compares equal to the winner
 *  regardless of the order either happened to list the IPs in. */
const canon = (ips: string[]): string => [...ips].sort(byCodeUnit).join(",");

export interface ResolverBallot {
  winner: string;
  confidence: Confidence;
  cells: Record<string, VoteCell>;
  dissent: { value: string; sources: string[] }[];
}

/**
 * One column's worth of ballot data for the resolver consensus: which
 * resolver backed the winning A record, which reported something else, and
 * which never answered. Mirrors lib/ti/geo/votes.ts's VoteColumn shape
 * closely enough to share its rendering, without coupling this DNS-specific
 * concept into the geo module.
 */
export function buildResolverBallot(consensus: ResolverConsensus): ResolverBallot | null {
  // perResolver is undefined on a ResolverConsensus cached from before this
  // field existed; the Redis cache holds old shapes until their TTL expires,
  // so this is a real state to render through rather than a can't-happen.
  if (consensus.respondingResolvers === 0 || !consensus.perResolver?.length) {
    return null;
  }

  const winnerKey = canon(consensus.consensusIps);
  const cells: Record<string, VoteCell> = {};
  const dissentSources = new Map<string, string[]>();

  for (const { resolver, ips } of consensus.perResolver) {
    if (ips === null) {
      cells[resolver] = { status: "absent" };
      continue;
    }
    if (canon(ips) === winnerKey) {
      cells[resolver] = { status: "win" };
      continue;
    }
    const value = ips.length ? ips.join(", ") : "no answer";
    cells[resolver] = { status: "dissent", value };
    dissentSources.set(value, [...(dissentSources.get(value) ?? []), resolver]);
  }

  return {
    winner: consensus.consensusIps.join(", "),
    confidence: consensus.bucket,
    cells,
    dissent: [...dissentSources.entries()].map(([value, sources]) => ({ value, sources })),
  };
}
