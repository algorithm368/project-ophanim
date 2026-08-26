import { describe, expect, it } from "vitest";
import { etaBudgetMs, etaLabel, longestTimeout } from "@/lib/ti/eta";

const panel = [
  { id: "fast", timeoutMs: 3_000 },
  { id: "slow", timeoutMs: 12_000 },
  { id: "unstated" }, // no timeoutMs, assumed 8s
];

describe("longestTimeout", () => {
  it("takes the slowest source, since they run in parallel", () => {
    expect(longestTimeout(panel)).toBe(12_000);
  });

  it("assumes 8s for a source whose meta does not say", () => {
    expect(longestTimeout([{ id: "unstated" }])).toBe(8_000);
  });

  it("falls back to a flat guess with nothing to go on", () => {
    expect(longestTimeout([])).toBe(10_000);
  });
});

describe("etaBudgetMs", () => {
  it("is the slowest source still out, not the slowest overall", () => {
    expect(etaBudgetMs(panel, new Set(["slow"]))).toBe(8_000);
  });

  it("only ever shrinks as sources land", () => {
    const seq = [
      etaBudgetMs(panel, new Set()),
      etaBudgetMs(panel, new Set(["fast"])),
      etaBudgetMs(panel, new Set(["fast", "slow"])),
      etaBudgetMs(panel, new Set(["fast", "slow", "unstated"])),
    ];
    for (let i = 1; i < seq.length; i++) {
      expect(seq[i]).toBeLessThanOrEqual(seq[i - 1]);
    }
  });

  it("uses the whole panel before anything has settled", () => {
    expect(etaBudgetMs(panel, new Set())).toBe(12_000);
  });

  it("is zero once every source is in", () => {
    expect(etaBudgetMs(panel, new Set(["fast", "slow", "unstated"]))).toBe(0);
  });

  it("falls back to the flat guess when the panel is not known yet", () => {
    expect(etaBudgetMs([], new Set())).toBe(10_000);
  });
});

describe("etaLabel", () => {
  it("counts down in whole seconds", () => {
    expect(etaLabel(10_400)).toBe("~11s left");
    expect(etaLabel(1)).toBe("~1s left");
  });

  it("switches to minutes past sixty seconds", () => {
    expect(etaLabel(67_000)).toBe("~1:07 left");
    expect(etaLabel(60_000)).toBe("~1:00 left");
  });

  // The estimate is a worst case over timeouts, not a promise. When it runs
  // out the sources are still out, and a negative countdown would be a lie.
  it("says something honest instead of counting into negatives", () => {
    expect(etaLabel(0)).toBe("finishing up");
    expect(etaLabel(-9_000)).toBe("finishing up");
  });
});
