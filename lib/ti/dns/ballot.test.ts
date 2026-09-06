import { describe, expect, it } from "vitest";
import { ipConsensus, type ResolverVote } from "./consensus";
import { buildResolverBallot } from "./ballot";

const vote = (resolver: string, ips: string[] | null): ResolverVote => ({
  resolver,
  ips,
});

describe("buildResolverBallot", () => {
  it("returns null when no resolver answered", () => {
    const consensus = ipConsensus([vote("cloudflare", null), vote("google", null)]);
    expect(buildResolverBallot(consensus)).toBeNull();
  });

  it("returns null rather than throwing on a cache entry from before perResolver existed", () => {
    const consensus = ipConsensus([vote("cloudflare", ["1.2.3.4"])]);
    // @ts-expect-error simulating a pre-migration cached shape
    delete consensus.perResolver;
    expect(buildResolverBallot(consensus)).toBeNull();
  });

  it("marks every resolver a winner when all agree", () => {
    const consensus = ipConsensus([
      vote("cloudflare", ["1.2.3.4"]),
      vote("google", ["1.2.3.4"]),
      vote("adguard", ["1.2.3.4"]),
    ]);
    const ballot = buildResolverBallot(consensus)!;
    expect(ballot.winner).toBe("1.2.3.4");
    expect(ballot.confidence).toBe("high");
    expect(ballot.cells.cloudflare).toEqual({ status: "win" });
    expect(ballot.cells.google).toEqual({ status: "win" });
    expect(ballot.cells.adguard).toEqual({ status: "win" });
    expect(ballot.dissent).toEqual([]);
  });

  it("is order-insensitive when matching a resolver's set against the winner", () => {
    const consensus = ipConsensus([
      vote("cloudflare", ["1.1.1.1", "2.2.2.2"]),
      vote("google", ["2.2.2.2", "1.1.1.1"]),
    ]);
    const ballot = buildResolverBallot(consensus)!;
    expect(ballot.cells.cloudflare.status).toBe("win");
    expect(ballot.cells.google.status).toBe("win");
  });

  it("records a dissenting resolver's own answer, grouped by value", () => {
    const consensus = ipConsensus([
      vote("cloudflare", ["1.2.3.4"]),
      vote("google", ["1.2.3.4"]),
      vote("adguard", ["9.9.9.9"]),
    ]);
    const ballot = buildResolverBallot(consensus)!;
    expect(ballot.winner).toBe("1.2.3.4");
    expect(ballot.cells.adguard).toEqual({ status: "dissent", value: "9.9.9.9" });
    expect(ballot.dissent).toEqual([{ value: "9.9.9.9", sources: ["adguard"] }]);
  });

  it("marks a non-responder absent rather than dissenting", () => {
    const consensus = ipConsensus([
      vote("cloudflare", ["1.2.3.4"]),
      vote("google", ["1.2.3.4"]),
      vote("adguard", null),
    ]);
    const ballot = buildResolverBallot(consensus)!;
    expect(ballot.cells.adguard).toEqual({ status: "absent" });
  });

  it("reports an empty-set answer as its own dissenting value", () => {
    const consensus = ipConsensus([
      vote("cloudflare", ["1.2.3.4"]),
      vote("google", ["1.2.3.4"]),
      vote("adguard", []),
    ]);
    const ballot = buildResolverBallot(consensus)!;
    expect(ballot.cells.adguard).toEqual({ status: "dissent", value: "no answer" });
  });
});
