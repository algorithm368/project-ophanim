import { describe, expect, it } from "vitest";
import type { ResolverConsensus } from "@/lib/ti/types";
import { resolverConfidenceReason } from "./confidence";

function consensus(over: Partial<ResolverConsensus>): ResolverConsensus {
  return {
    respondingResolvers: 0,
    totalResolvers: 0,
    consensusIps: [],
    agreeCount: 0,
    confidence: 0,
    bucket: "low",
    variants: [],
    perResolver: [],
    ...over,
  };
}

describe("resolverConfidenceReason", () => {
  it("reads as full agreement when every queried resolver responded", () => {
    expect(
      resolverConfidenceReason(
        consensus({ respondingResolvers: 5, totalResolvers: 5, agreeCount: 5 }),
      ),
    ).toBe("5 of 5 resolvers agree on the resolved IP(s)");
  });

  it("names how many resolvers stayed silent rather than hiding them in the ratio", () => {
    expect(
      resolverConfidenceReason(
        consensus({ respondingResolvers: 1, totalResolvers: 5, agreeCount: 1 }),
      ),
    ).toBe("1 of 1 resolvers agree on the resolved IP(s) (4 resolvers did not respond)");
  });

  it("still notes silent resolvers on a split vote", () => {
    expect(
      resolverConfidenceReason(
        consensus({ respondingResolvers: 3, totalResolvers: 4, agreeCount: 2 }),
      ),
    ).toBe("Resolvers split, 2 of 3 agree on the resolved IP(s) (1 resolver did not respond)");
  });

  it("reports no resolver answered when none responded", () => {
    expect(
      resolverConfidenceReason(consensus({ respondingResolvers: 0, totalResolvers: 5 })),
    ).toBe("No resolver answered.");
  });
});
