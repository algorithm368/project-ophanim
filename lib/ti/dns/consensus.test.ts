import { describe, it, expect } from "vitest";
import { ipConsensus, type ResolverVote } from "@/lib/ti/dns/consensus";

const vote = (resolver: string, ips: string[] | null): ResolverVote => ({
  resolver,
  ips,
});

describe("ipConsensus", () => {
  it("reports high confidence when every responder agrees", () => {
    const c = ipConsensus([
      vote("cloudflare", ["1.2.3.4"]),
      vote("google", ["1.2.3.4"]),
      vote("adguard", ["1.2.3.4"]),
    ]);
    expect(c.consensusIps).toEqual(["1.2.3.4"]);
    expect(c.agreeCount).toBe(3);
    expect(c.respondingResolvers).toBe(3);
    expect(c.confidence).toBe(1);
    expect(c.bucket).toBe("high");
    expect(c.perResolver).toEqual([
      vote("cloudflare", ["1.2.3.4"]),
      vote("google", ["1.2.3.4"]),
      vote("adguard", ["1.2.3.4"]),
    ]);
  });

  it("is order-insensitive when comparing answer sets", () => {
    const c = ipConsensus([
      vote("cloudflare", ["1.1.1.1", "2.2.2.2"]),
      vote("google", ["2.2.2.2", "1.1.1.1"]),
    ]);
    expect(c.bucket).toBe("high");
    expect(c.agreeCount).toBe(2);
  });

  it("reports medium for a strict majority", () => {
    const c = ipConsensus([
      vote("cloudflare", ["1.2.3.4"]),
      vote("google", ["1.2.3.4"]),
      vote("adguard", ["1.2.3.4"]),
      vote("dns0", ["9.9.9.9"]),
    ]);
    expect(c.consensusIps).toEqual(["1.2.3.4"]);
    expect(c.agreeCount).toBe(3);
    expect(c.bucket).toBe("medium");
  });

  it("reports low for a three-way split with no majority", () => {
    const c = ipConsensus([
      vote("cloudflare", ["1.1.1.1"]),
      vote("google", ["2.2.2.2"]),
      vote("adguard", ["3.3.3.3"]),
    ]);
    expect(c.bucket).toBe("low");
    expect(c.agreeCount).toBe(1);
    expect(c.variants).toHaveLength(3);
  });

  it("excludes non-responders from the denominator, not lowering confidence", () => {
    const c = ipConsensus([
      vote("cloudflare", ["1.2.3.4"]),
      vote("google", ["1.2.3.4"]),
      vote("adguard", null),
    ]);
    expect(c.respondingResolvers).toBe(2);
    expect(c.totalResolvers).toBe(3);
    expect(c.confidence).toBe(1);
    expect(c.bucket).toBe("high");
  });

  it("treats partial CDN overlap as separate variants", () => {
    const c = ipConsensus([
      vote("cloudflare", ["1.1.1.1", "2.2.2.2"]),
      vote("google", ["2.2.2.2", "3.3.3.3"]),
    ]);
    expect(c.variants).toHaveLength(2);
    expect(c.bucket).toBe("low");
  });

  it("treats a single responder as high confidence", () => {
    const c = ipConsensus([vote("cloudflare", ["1.2.3.4"])]);
    expect(c.bucket).toBe("high");
    expect(c.confidence).toBe(1);
    expect(c.consensusIps).toEqual(["1.2.3.4"]);
  });

  it("returns an empty consensus when nobody responds", () => {
    const c = ipConsensus([vote("cloudflare", null), vote("google", null)]);
    expect(c.respondingResolvers).toBe(0);
    expect(c.consensusIps).toEqual([]);
    expect(c.confidence).toBe(1);
    expect(c.bucket).toBe("high");
    expect(c.perResolver).toEqual([vote("cloudflare", null), vote("google", null)]);
  });

  it("breaks ties deterministically by smallest canonical set", () => {
    const c = ipConsensus([
      vote("a", ["9.9.9.9"]),
      vote("b", ["1.1.1.1"]),
    ]);
    // Tie (1 each): the lexicographically smallest canon ("1.1.1.1") wins.
    expect(c.consensusIps).toEqual(["1.1.1.1"]);
  });
});
