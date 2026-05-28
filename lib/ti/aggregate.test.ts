import { describe, expect, it } from "vitest";
import { aggregateRisk, computeStats, verdictFor } from "@/lib/ti/aggregate";
import type { SourceResult, SourceStatus } from "@/lib/ti/types";

function src(opts: {
  status: SourceStatus;
  score?: number;
  malicious?: boolean;
  weight?: number;
  id?: string;
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
    expect(r).toEqual({ riskScore: 0, verdict: "unknown" });
  });

  it("scores a single strong, trusted hit as malicious", () => {
    expect(aggregateRisk([src({ status: "ok", score: 80 })])).toEqual({
      riskScore: 80,
      verdict: "malicious",
    });
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
    });
  });
});
