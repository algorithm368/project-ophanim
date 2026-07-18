import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  haCapabilities,
  haMitre,
  haRelatedHashes,
  hybridAnalysisScore,
  hybridAnalysisSource,
} from "./hybrid-analysis";
import * as http from "../../http";

describe("haRelatedHashes", () => {
  it("maps parents to 'parent' and children to 'drops', excluding self + dups", () => {
    expect(
      haRelatedHashes(["P1", "SELF", "p1"], ["C1", "C2"], "self"),
    ).toEqual([
      { value: "p1", type: "hash", relation: "parent", sources: ["hybrid-analysis"], tier: "observed" },
      { value: "c1", type: "hash", relation: "drops", sources: ["hybrid-analysis"], tier: "observed" },
      { value: "c2", type: "hash", relation: "drops", sources: ["hybrid-analysis"], tier: "observed" },
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

describe("haCapabilities / haMitre", () => {
  const data = {
    signatures: [
      { name: "Contacts a randomly generated domain", attck_id: ["T1568"] },
      { name: "Writes to startup", attck_id: ["T1547"] },
    ],
    mitre_attcks: [
      { technique: "Application Layer Protocol", attck_id: "T1071", tactic: "Command and Control" },
      { technique: "Ingress Tool Transfer", attck_id: "T1105", tactic: "Command and Control" },
    ],
  };

  it("maps behavioral signatures to capabilities with their technique ids", () => {
    expect(haCapabilities(data)).toEqual([
      { label: "Contacts a randomly generated domain", mitre: ["T1568"] },
      { label: "Writes to startup", mitre: ["T1547"] },
    ]);
  });

  it("maps mitre_attcks entries to techniques with names and tactics", () => {
    expect(haMitre(data)).toEqual([
      { id: "T1071", name: "Application Layer Protocol", tactic: "Command and Control" },
      { id: "T1105", name: "Ingress Tool Transfer", tactic: "Command and Control" },
    ]);
  });

  it("returns empty arrays when the overview omits behavior data", () => {
    expect(haCapabilities({})).toEqual([]);
    expect(haMitre({})).toEqual([]);
  });
});
