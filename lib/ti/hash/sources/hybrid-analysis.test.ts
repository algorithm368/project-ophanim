import { describe, expect, it } from "vitest";
import { haRelatedHashes, hybridAnalysisScore } from "./hybrid-analysis";

describe("haRelatedHashes", () => {
  it("maps parents to 'parent' and children to 'drops', excluding self + dups", () => {
    expect(
      haRelatedHashes(["P1", "SELF", "p1"], ["C1", "C2"], "self"),
    ).toEqual([
      { value: "p1", type: "hash", relation: "parent" },
      { value: "c1", type: "hash", relation: "drops" },
      { value: "c2", type: "hash", relation: "drops" },
    ]);
  });

  it("handles null/missing arrays and caps each side", () => {
    expect(haRelatedHashes(null, undefined, "x")).toEqual([]);
    const many = Array.from({ length: 9 }, (_, i) => `h${i}`);
    expect(haRelatedHashes(many, [], "x")).toHaveLength(6);
  });
});

describe("hybridAnalysisScore", () => {
  it("floors malicious at 75 and suspicious at 45", () => {
    expect(hybridAnalysisScore("malicious", 10, false)).toBe(75);
    expect(hybridAnalysisScore("malicious", 90, false)).toBe(90);
    expect(hybridAnalysisScore("suspicious", 30, false)).toBe(45);
    expect(hybridAnalysisScore("suspicious", 60, false)).toBe(60);
  });

  it("zeroes whitelisted files regardless of verdict/score", () => {
    expect(hybridAnalysisScore("malicious", 90, true)).toBe(0);
    expect(hybridAnalysisScore("whitelisted", 90, false)).toBe(0);
  });

  it("passes the raw threat score through for other verdicts", () => {
    expect(hybridAnalysisScore("unknown", 33, false)).toBe(33);
    expect(hybridAnalysisScore("unknown", undefined, null)).toBe(0);
  });
});
