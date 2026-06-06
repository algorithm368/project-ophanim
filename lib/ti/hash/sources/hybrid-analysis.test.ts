import { describe, expect, it } from "vitest";
import { hybridAnalysisScore } from "./hybrid-analysis";

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
