import { describe, expect, it } from "vitest";
import {
  HIGH_AT,
  MEDIUM_AT,
  levelFor,
  scoreConfidence,
} from "@/lib/ti/confidence";
import type { SourceResult, SourceStatus } from "@/lib/ti/types";

function src(opts: {
  status: SourceStatus;
  score?: number;
  weight?: number;
  id?: string;
  enabled?: boolean;
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
    enabled: opts.enabled ?? true,
    durationMs: 1,
    status: opts.status,
    score: opts.score,
  };
}

/** n sources all answering with the same score. */
function chorus(n: number, score: number, weight = 1): SourceResult[] {
  return Array.from({ length: n }, (_, i) =>
    src({ status: "ok", score, weight, id: `s${i}` }),
  );
}

describe("levelFor", () => {
  it.each([
    [1, "high"],
    [HIGH_AT, "high"],
    [HIGH_AT - 0.001, "medium"],
    [MEDIUM_AT, "medium"],
    [MEDIUM_AT - 0.001, "low"],
    [0, "low"],
  ])("maps %f to %s", (score, level) => {
    expect(levelFor(score)).toBe(level);
  });
});

describe("scoreConfidence", () => {
  it("returns null when no scoring source is in the pool", () => {
    expect(scoreConfidence({ sources: [] })).toBeNull();
    // Context-only adapters cannot corroborate anything.
    expect(
      scoreConfidence({
        sources: [src({ status: "ok", score: 0, weight: 0 })],
      }),
    ).toBeNull();
  });

  it("rates a unanimously clean result high", () => {
    const c = scoreConfidence({ sources: chorus(8, 0) });
    expect(c?.coverage).toBe(1);
    expect(c?.agreement).toBe(1);
    expect(c?.level).toBe("high");
  });

  it("rates a unanimously malicious result high, exactly as it rates a clean one", () => {
    // The regression test for the formula this replaced, which measured the
    // level of the scores rather than their spread and so scored a unanimous
    // clean result at 0.01.
    const bad = scoreConfidence({ sources: chorus(8, 95) });
    const good = scoreConfidence({ sources: chorus(8, 0) });
    expect(bad?.level).toBe("high");
    expect(bad?.score).toBeCloseTo(good!.score, 10);
  });

  it("drops one loud source against a quiet majority to medium", () => {
    // The shape behind a floor-pinned "malicious 75": one detector shouting,
    // the rest reporting nothing.
    const c = scoreConfidence({
      sources: [src({ status: "ok", score: 100, id: "loud" }), ...chorus(11, 0)],
    });
    expect(c?.coverage).toBe(1);
    expect(c?.agreement).toBeLessThan(0.7);
    expect(c?.level).toBe("medium");
  });

  it("costs more to lose a heavy source than a light one", () => {
    const heavy = scoreConfidence({
      sources: [
        src({ status: "timeout", weight: 1, id: "gone" }),
        ...chorus(3, 0, 0.2),
      ],
    });
    const light = scoreConfidence({
      sources: [
        src({ status: "timeout", weight: 0.2, id: "gone" }),
        ...chorus(3, 0, 0.2),
        src({ status: "ok", score: 0, weight: 0.8, id: "extra" }),
      ],
    });
    expect(heavy!.coverage).toBeLessThan(light!.coverage);
  });

  it("keeps a source that cannot answer for this indicator in the denominator", () => {
    // The IPv6 shape: four detectors answer, nine are IPv4-only. Perfect
    // agreement among the four must not buy back the missing coverage.
    const c = scoreConfidence({
      sources: [
        ...chorus(4, 0),
        ...Array.from({ length: 9 }, (_, i) =>
          src({ status: "skipped", enabled: true, id: `v4only${i}` }),
        ),
      ],
    });
    expect(c?.agreement).toBe(1);
    expect(c?.coverage).toBeCloseTo(4 / 13, 5);
    expect(c?.level).toBe("low");
    expect(c?.reason).toContain("9 cannot answer for this indicator");
  });

  it("drops a source skipped for a missing key out of the denominator", () => {
    // A missing key is a fact about the deployment, not the indicator, so it
    // must not move confidence at all.
    const withKeys = scoreConfidence({ sources: chorus(4, 0) });
    const withoutKeys = scoreConfidence({
      sources: [
        ...chorus(4, 0),
        ...Array.from({ length: 9 }, (_, i) =>
          src({ status: "skipped", enabled: false, id: `nokey${i}` }),
        ),
      ],
    });
    expect(withoutKeys?.score).toBe(withKeys?.score);
    expect(withoutKeys?.reason).toBe(withKeys?.reason);
  });

  it("counts an error against coverage but a re-check could recover it", () => {
    const c = scoreConfidence({
      sources: [...chorus(3, 0), src({ status: "error", id: "broken" })],
    });
    expect(c?.coverage).toBeCloseTo(3 / 4, 5);
    expect(c?.reason).toContain("3 of 4 detectors responded");
  });

  it("treats a rate limit as missing evidence too", () => {
    const c = scoreConfidence({
      sources: [...chorus(3, 0), src({ status: "rate_limited", id: "quota" })],
    });
    expect(c?.coverage).toBeCloseTo(3 / 4, 5);
  });

  it("ignores a responding source that returned no score when measuring agreement", () => {
    // "No record of this indicator" is not a vote for zero.
    const c = scoreConfidence({
      sources: [...chorus(3, 40), src({ status: "ok", id: "silent" })],
    });
    expect(c?.agreement).toBe(1);
  });

  it("forces high confidence when a benign override fired", () => {
    // EICAR: the engines that flag it are not disagreeing about a live question.
    const sources = [
      src({ status: "ok", score: 90, id: "av" }),
      ...chorus(3, 0),
    ];
    const measured = scoreConfidence({ sources });
    expect(measured?.level).not.toBe("high");

    const overridden = scoreConfidence({
      sources,
      scoreBreakdown: {
        effectiveMax: 0,
        weightedAvg: 0,
        floorApplied: false,
        borderline: false,
        allowlistSuppressed: false,
        benignOverride: "eicar-test-file",
      },
    });
    expect(overridden?.level).toBe("high");
    expect(overridden?.score).toBe(1);
    expect(overridden?.reason).toBe("known benign sample, identified by hash");
  });

  it("words the reason by how far apart the sources sat", () => {
    expect(scoreConfidence({ sources: chorus(4, 0) })?.reason).toContain(
      "sources agree",
    );
    expect(
      scoreConfidence({
        sources: [src({ status: "ok", score: 100, id: "a" }), ...chorus(3, 0)],
      })?.reason,
    ).toContain("sources disagree sharply");
  });
});
