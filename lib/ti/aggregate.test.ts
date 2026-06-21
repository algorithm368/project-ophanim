import { describe, expect, it } from "vitest";
import { aggregateRisk, computeStats, verdictFor } from "@/lib/ti/aggregate";
import type { SourceResult, SourceStatus } from "@/lib/ti/types";

function src(opts: {
  status: SourceStatus;
  score?: number;
  malicious?: boolean;
  weight?: number;
  id?: string;
  allowlisted?: boolean;
}): SourceResult {
  return {
    source: {
      id: opts.id ?? "s",
      name: "Source",
      url: "https://example.test",
      category: "reputation",
      requiresKey: false,
      weight: opts.weight ?? 1,
    },
    enabled: true,
    durationMs: 1,
    status: opts.status,
    score: opts.score,
    malicious: opts.malicious,
    allowlisted: opts.allowlisted,
  };
}

describe("verdictFor", () => {
  it("returns unknown when there is no data, regardless of score", () => {
    expect(verdictFor(90, false)).toBe("unknown");
  });

  it.each([
    [0, "clean"],
    [14, "clean"],
    [15, "low"],
    [39, "low"],
    [40, "suspicious"],
    [69, "suspicious"],
    [70, "malicious"],
    [100, "malicious"],
  ])("maps score %i to %s", (score, verdict) => {
    expect(verdictFor(score, true)).toBe(verdict);
  });
});

describe("aggregateRisk", () => {
  it("returns unknown when no source produced a numeric score", () => {
    const r = aggregateRisk([src({ status: "ok" }), src({ status: "skipped" })]);
    expect(r.riskScore).toBe(0);
    expect(r.verdict).toBe("unknown");
  });

  it("scores a single strong, trusted hit as malicious", () => {
    const r = aggregateRisk([src({ status: "ok", score: 80 })]);
    expect(r.riskScore).toBe(80);
    expect(r.verdict).toBe("malicious");
  });

  it("lets the strongest signal lead the weighted average", () => {
    const r = aggregateRisk([
      src({ status: "ok", score: 90, id: "a" }),
      src({ status: "ok", score: 0, id: "b" }),
    ]);
    // 0.6*effectiveMax(90) + 0.4*weightedAvg(45) = 72
    expect(r.riskScore).toBe(72);
    expect(r.verdict).toBe("malicious");
  });

  it("ignores zero-weight sources in scoring", () => {
    const r = aggregateRisk([
      src({ status: "ok", score: 50, weight: 1, id: "a" }),
      src({ status: "ok", score: 100, weight: 0, id: "b" }),
    ]);
    expect(r.riskScore).toBe(50);
    expect(r.verdict).toBe("suspicious");
  });

  it("applies a hard-malicious floor of 75 when a source lists it malicious", () => {
    const r = aggregateRisk([
      src({ status: "ok", score: 10, id: "weak" }),
      src({ status: "ok", malicious: true, id: "blocklist" }),
    ]);
    expect(r.riskScore).toBe(75);
    expect(r.verdict).toBe("malicious");
  });
});

describe("computeStats", () => {
  it("counts each status bucket", () => {
    const stats = computeStats([
      src({ status: "ok", score: 50, id: "a" }), // flagged
      src({ status: "ok", score: 10, id: "b" }), // clean
      src({ status: "ok", malicious: true, id: "c" }), // flagged
      src({ status: "error", id: "d" }),
      src({ status: "timeout", id: "e" }),
      src({ status: "skipped", id: "f" }),
    ]);
    expect(stats).toEqual({
      total: 6,
      queried: 5,
      flagged: 2,
      skipped: 1,
      errored: 2,
      rateLimited: 0,
    });
  });

  it("counts rate-limited sources separately from errors and the query count", () => {
    const stats = computeStats([
      src({ status: "ok", score: 10, id: "a" }),
      src({ status: "rate_limited", id: "b" }),
      src({ status: "error", id: "c" }),
    ]);
    expect(stats.rateLimited).toBe(1);
    // A quota hit is neither a genuine error nor a successful query.
    expect(stats.errored).toBe(1);
    expect(stats.queried).toBe(2);
  });
});

describe("aggregateRisk — gated two-tier floor (B1)", () => {
  it("pins a single high-weight malicious listing to a 75 floor", () => {
    // Blend already below 75: malicious source carries no score of its own.
    const r = aggregateRisk([
      src({ status: "ok", score: 10, id: "weak", weight: 1 }),
      src({ status: "ok", malicious: true, score: 60, id: "vt", weight: 1 }),
    ]);
    expect(r.riskScore).toBe(75);
    expect(r.verdict).toBe("malicious");
    expect(r.breakdown.floorApplied).toBe(true);
    expect(r.breakdown.flooredBy).toBe("vt");
    expect(r.breakdown.floorValue).toBe(75);
  });

  it("does NOT floor a single low-weight malicious listing", () => {
    const r = aggregateRisk([
      src({ status: "ok", score: 30, malicious: true, id: "tor", weight: 0.4 }),
    ]);
    expect(r.breakdown.floorApplied).toBe(false);
    expect(r.verdict).toBe("low"); // stands on the weighted blend, not 75
  });

  it("raises two agreeing weak listings to a 50 quorum floor", () => {
    const r = aggregateRisk([
      src({ status: "ok", score: 30, malicious: true, id: "tor", weight: 0.4 }),
      src({ status: "ok", score: 40, malicious: true, id: "dnsbl", weight: 0.5 }),
    ]);
    expect(r.riskScore).toBe(50);
    expect(r.verdict).toBe("suspicious");
    expect(r.breakdown.floorValue).toBe(50);
    expect(r.breakdown.flooredBy).toBe("dnsbl"); // strongest of the weak set
  });

  it("lets an allowlist suppress a quorum floor", () => {
    const r = aggregateRisk([
      src({ status: "ok", score: 30, malicious: true, id: "tor", weight: 0.4 }),
      src({ status: "ok", score: 40, malicious: true, id: "dnsbl", weight: 0.5 }),
      src({ status: "ok", score: 0, allowlisted: true, id: "maltiverse", weight: 0.7 }),
    ]);
    expect(r.breakdown.allowlistSuppressed).toBe(true);
    expect(r.breakdown.floorApplied).toBe(false);
    expect(r.verdict).toBe("low"); // 50 floor withheld
  });

  it("lets a high-weight detection beat the allowlist", () => {
    const r = aggregateRisk([
      src({ status: "ok", score: 60, malicious: true, id: "vt", weight: 1 }),
      src({ status: "ok", score: 0, allowlisted: true, id: "maltiverse", weight: 0.7 }),
    ]);
    expect(r.breakdown.allowlistSuppressed).toBe(false);
    expect(r.breakdown.floorApplied).toBe(true);
    expect(r.breakdown.floorValue).toBe(75);
    expect(r.verdict).toBe("malicious");
  });

  it("flags a score near a cutoff as borderline", () => {
    // 0.6*90 + 0.4*45 = 72, two points above the 70 cutoff.
    const near = aggregateRisk([
      src({ status: "ok", score: 90, id: "a" }),
      src({ status: "ok", score: 0, id: "b" }),
    ]);
    expect(near.riskScore).toBe(72);
    expect(near.breakdown.borderline).toBe(true);
    // 0.6*60 + 0.4*60 = 60, ten points from the nearest cutoff.
    const far = aggregateRisk([
      src({ status: "ok", score: 60, id: "a" }),
      src({ status: "ok", score: 60, id: "b" }),
    ]);
    expect(far.riskScore).toBe(60);
    expect(far.breakdown.borderline).toBe(false);
  });

  it("populates the breakdown intermediates", () => {
    const r = aggregateRisk([
      src({ status: "ok", score: 80, id: "vt", weight: 1 }),
      src({ status: "ok", score: 90, id: "ipsum", weight: 0.3 }),
    ]);
    // vt effective 80 beats ipsum effective 27 -> vt dominant.
    expect(r.breakdown.dominantSourceId).toBe("vt");
    expect(r.breakdown.effectiveMax).toBe(80);
  });
});
