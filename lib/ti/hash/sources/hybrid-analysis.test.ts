import { describe, expect, it, beforeEach, vi } from "vitest";
import { haRelatedHashes, hybridAnalysisScore, hybridAnalysisSource } from "./hybrid-analysis";
import * as http from "../../http";

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

describe("hybridAnalysisSource.check", () => {
  beforeEach(() => {
    process.env.HYBRID_ANALYSIS_API_KEY = "test-key";
  });

  it("emits fileNames from last_file_name", async () => {
    vi.spyOn(http, "getJson").mockResolvedValue({
      ok: true,
      status: 200,
      data: { verdict: "malicious", last_file_name: "dropper.exe", sha256: "f".repeat(64) },
    } as never);
    const finding = await hybridAnalysisSource.check("f".repeat(64), new AbortController().signal);
    expect(finding.hashContext?.fileNames).toEqual(["dropper.exe"]);
  });
});
