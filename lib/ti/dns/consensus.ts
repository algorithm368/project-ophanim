import { byCodeUnit } from "../sort";
import type { ResolverConsensus } from "../types";

export interface ResolverVote {
  resolver: string;
  /** A-record IP set, or null when the resolver did not respond. */
  ips: string[] | null;
}

/** Canonical, order-insensitive form of an answer set. */
const canon = (ips: string[]): string =>
  [...ips].sort(byCodeUnit).join(",");

/**
 * Fold per-resolver A-record answer sets into a consensus. Non-responders
 * (ips === null) are dropped before tallying. The plurality answer set wins;
 * ties break by smallest canonical form so output is deterministic.
 */
export function ipConsensus(votes: ResolverVote[]): ResolverConsensus {
  const totalResolvers = votes.length;
  const responders = votes.filter(
    (v): v is { resolver: string; ips: string[] } => v.ips !== null,
  );
  const respondingResolvers = responders.length;

  if (respondingResolvers === 0) {
    return {
      respondingResolvers: 0,
      totalResolvers,
      consensusIps: [],
      agreeCount: 0,
      confidence: 1,
      bucket: "high",
      variants: [],
    };
  }

  const byCanon = new Map<string, { ips: string[]; count: number }>();
  for (const r of responders) {
    const key = canon(r.ips);
    const existing = byCanon.get(key);
    if (existing) existing.count += 1;
    else byCanon.set(key, { ips: r.ips, count: 1 });
  }

  // Most common first; ties broken by smallest canonical key for determinism.
  const variants = [...byCanon.entries()]
    .sort((a, b) => b[1].count - a[1].count || byCodeUnit(a[0], b[0]))
    .map(([, v]) => v);

  const winner = variants[0];
  const agreeCount = winner.count;
  const confidence = agreeCount / respondingResolvers;

  let bucket: "high" | "medium" | "low";
  if (agreeCount === respondingResolvers) bucket = "high";
  else if (agreeCount > respondingResolvers / 2) bucket = "medium";
  else bucket = "low";

  return {
    respondingResolvers,
    totalResolvers,
    consensusIps: winner.ips,
    agreeCount,
    confidence,
    bucket,
    variants,
  };
}
