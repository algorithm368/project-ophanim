import { afterEach, describe, expect, it, beforeEach, vi } from "vitest";
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

describe("hybridAnalysisSource.check — remaining paths", () => {
  const signal = new AbortController().signal;
  const H = "f".repeat(64);
  const reply = (data: unknown, status = 200) =>
    vi.spyOn(http, "getJson").mockResolvedValue({ ok: status < 400, status, data, text: "" } as never);
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("is skipped without a key", async () => {
    vi.stubEnv("HYBRID_ANALYSIS_API_KEY", "");
    expect(hybridAnalysisSource.isEnabled()).toBe(false);
    expect(await hybridAnalysisSource.check(H, signal)).toEqual({ status: "skipped" });
  });

  it("reports family, threat score, behavior and related hashes", async () => {
    vi.stubEnv("HYBRID_ANALYSIS_API_KEY", "k");
    expect(hybridAnalysisSource.isEnabled()).toBe(true);
    reply({
      verdict: "suspicious",
      threat_score: 60,
      vx_family: " Agent ",
      type_short: ["peexe", "64bit"],
      size: 10,
      analysis_start_time: "2026-01-01",
      signatures: [{ name: "Injects" }],
      mitre_attcks: [{ attck_id: "t1055" }],
      related_children_hashes: ["c".repeat(64)],
    });
    const f = await hybridAnalysisSource.check(H, signal);
    expect(f).toMatchObject({
      score: 60,
      categories: ["Agent"],
      lastSeen: "2026-01-01",
      summary: "Sandbox verdict: suspicious (Agent), threat score 60/100",
      hashContext: {
        fileType: "peexe, 64bit",
        fileSize: 10,
        capabilities: [{ label: "Injects", mitre: undefined }],
        mitreTechniques: [{ id: "T1055", name: undefined, tactic: undefined }],
      },
    });
    expect(f.relations).toHaveLength(1);
  });

  it("leaves optional parts out of a bare overview", async () => {
    vi.stubEnv("HYBRID_ANALYSIS_API_KEY", "k");
    reply({ whitelisted: null, type: "  ", size: null });
    const f = await hybridAnalysisSource.check(H, signal);
    expect(f.summary).toBe("Sandbox verdict: unknown");
    expect(f.allowlisted).toBe(false);
    expect(f.relations).toBeUndefined();
    expect(f.hashContext).toMatchObject({
      fileType: undefined,
      fileSize: undefined,
      fileNames: undefined,
      capabilities: undefined,
      mitreTechniques: undefined,
    });
    expect(f.details).toMatchObject({ whitelisted: undefined });
  });

  it("maps 404, errors and timeouts", async () => {
    vi.stubEnv("HYBRID_ANALYSIS_API_KEY", "k");
    reply(null, 404);
    expect((await hybridAnalysisSource.check(H, signal)).summary).toBe(
      "No sandbox report for this file",
    );
    vi.restoreAllMocks();
    reply({ message: "invalid key" }, 401);
    expect((await hybridAnalysisSource.check(H, signal)).error).toBe("invalid key");
    vi.restoreAllMocks();
    reply(null, 500);
    expect((await hybridAnalysisSource.check(H, signal)).error).toBe("HTTP 500");
    vi.restoreAllMocks();
    vi.spyOn(http, "getJson").mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await hybridAnalysisSource.check(H, signal)).status).toBe("timeout");
    vi.restoreAllMocks();
    vi.spyOn(http, "getJson").mockRejectedValue(new Error("boom"));
    expect((await hybridAnalysisSource.check(H, signal)).error).toBe("boom");
  });
});

describe("hybrid-analysis helpers — edge cases", () => {
  it("floors a suspicious verdict with no threat score", () => {
    expect(hybridAnalysisScore("suspicious", undefined, false)).toBe(45);
  });

  it("skips nameless and duplicate signatures and techniques", () => {
    expect(
      haCapabilities({
        signatures: [null, { name: "" }, { name: "A", attck_id: ["t1"] }, { name: "a" }],
      } as never),
    ).toEqual([{ label: "A", mitre: ["T1"] }]);
    expect(
      haMitre({
        mitre_attcks: [null, {}, { attck_id: "T1", technique: "Tech", tactic: "Tac" }, { attck_id: "t1" }],
      } as never),
    ).toEqual([{ id: "T1", name: "Tech", tactic: "Tac" }]);
  });
});
