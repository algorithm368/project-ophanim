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
    expect(etaBudgetMs(panel, ["slow"])).toBe(8_000);
  });

  it("only ever shrinks as sources land", () => {
    const seq = [
      etaBudgetMs(panel, []),
      etaBudgetMs(panel, ["fast"]),
      etaBudgetMs(panel, ["fast", "slow"]),
      etaBudgetMs(panel, ["fast", "slow", "unstated"]),
    ];
    for (let i = 1; i < seq.length; i++) {
      expect(seq[i]).toBeLessThanOrEqual(seq[i - 1]);
    }
  });

  it("uses the whole panel before anything has settled", () => {
    expect(etaBudgetMs(panel, [])).toBe(12_000);
  });

  it("is zero once every source is in", () => {
    expect(etaBudgetMs(panel, ["fast", "slow", "unstated"])).toBe(0);
  });

  it("falls back to the flat guess when the panel is not known yet", () => {
    expect(etaBudgetMs([], [])).toBe(10_000);
  });

  // #48: a URL check's panel repeats a handful of ids across layers. One
  // layer's copy landing must not retire the other layer's still-outstanding
  // copy of the same id.
  it("does not let one layer's settled id retire another layer's copy", () => {
    const duplicated = [
      { id: "virustotal", timeoutMs: 3_000 },
      { id: "virustotal", timeoutMs: 3_000 },
      { id: "slow", timeoutMs: 12_000 },
    ];
    // Only one of the two "virustotal" entries has actually settled.
    expect(etaBudgetMs(duplicated, ["virustotal"])).toBe(12_000);
    expect(etaBudgetMs(duplicated, ["virustotal", "virustotal"])).toBe(
      12_000,
    );
    expect(
      etaBudgetMs(duplicated, ["virustotal", "virustotal", "slow"]),
    ).toBe(0);
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
