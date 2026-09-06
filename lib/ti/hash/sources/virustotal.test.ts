import { afterEach, describe, expect, it, vi } from "vitest";
import {
  importedDllsFromVt,
  isoFromEpoch,
  primarySigner,
  sandboxVerdictFromVt,
  vtFileScore,
  virusTotalHashSource,
} from "./virustotal";
import { getJson } from "../../http";

vi.mock("../../http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../http")>();
  return { ...actual, getJson: vi.fn() };
});

type GetJsonResult = Awaited<ReturnType<typeof getJson>>;

function vtFileResponse(stats: Record<string, number>): GetJsonResult {
  return {
    ok: true,
    status: 200,
    data: { data: { attributes: { last_analysis_stats: stats } } },
  } as GetJsonResult;
}

describe("vtFileScore (hash)", () => {
  it("weights malicious 8x and suspicious 3x, capped at 100", () => {
    expect(vtFileScore(0, 0)).toBe(0);
    expect(vtFileScore(3, 2)).toBe(30);
    expect(vtFileScore(20, 0)).toBe(100);
  });
});

describe("importedDllsFromVt", () => {
  it("bases, dedupes, sums function counts, and ranks capability DLLs first", () => {
    expect(
      importedDllsFromVt([
        { library_name: "KERNEL32.dll", imported_functions: Array(125) },
        { library_name: "C:\\x\\ws2_32.dll", imported_functions: Array(21) },
        { library_name: "ws2_32.dll", imported_functions: Array(4) },
        { library_name: "weird_custom.dll", imported_functions: ["a"] },
      ]),
    ).toEqual([
      { name: "ws2_32.dll", count: 25 }, // capability DLL, merged 21+4, ranked first
      { name: "kernel32.dll", count: 125 }, // common boilerplate
      { name: "weird_custom.dll", count: 1 }, // unknown, last
    ]);
  });

  it("returns [] for non-PE files (no import list)", () => {
    expect(importedDllsFromVt(undefined)).toEqual([]);
  });

  it("caps the number of DLLs returned", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      library_name: `lib${i}.dll`,
      imported_functions: [String(i)],
    }));
    expect(importedDllsFromVt(many, 14)).toHaveLength(14);
  });
});

describe("primarySigner", () => {
  it("takes the leaf certificate off a ';'-joined signer chain", () => {
    expect(
      primarySigner(
        "Wispr AI, Inc.; Microsoft ID Verified CS EOC CA 04; Microsoft Identity Verification Root Certificate Authority 2020",
      ),
    ).toBe("Wispr AI, Inc.");
  });

  it("returns undefined for empty or missing input", () => {
    expect(primarySigner(undefined)).toBeUndefined();
    expect(primarySigner("")).toBeUndefined();
  });
});

describe("sandboxVerdictFromVt", () => {
  it("reports harmless only when every sandbox agrees", () => {
    expect(
      sandboxVerdictFromVt({ Zenbox: { category: "harmless", confidence: 98 } }),
    ).toEqual({ sandboxes: ["Zenbox"], confidence: 98 });
  });

  it("withholds the claim on any dissent, or with nothing to detonate", () => {
    expect(
      sandboxVerdictFromVt({
        Zenbox: { category: "harmless" },
        "Yomi Hunter": { category: "malicious" },
      }),
    ).toBeUndefined();
    expect(sandboxVerdictFromVt(undefined)).toBeUndefined();
    expect(sandboxVerdictFromVt({})).toBeUndefined();
  });
});

describe("isoFromEpoch", () => {
  it("converts unix seconds to an ISO string", () => {
    expect(isoFromEpoch(1700000000)).toBe("2023-11-14T22:13:20.000Z");
  });

  it("returns undefined for 0 / missing timestamps", () => {
    expect(isoFromEpoch(0)).toBeUndefined();
    expect(isoFromEpoch(undefined)).toBeUndefined();
  });
});

// Pin the P1.1 wiring at the check() level: the SOC-reported FP was a 3/69
// file hard-flagged and floored at 75; that exact tally must stay soft.
describe("virusTotalHashSource.check — definitive-flag wiring (P1.1)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(getJson).mockReset();
  });

  it("does not hard-flag a 3/69-engine minority", async () => {
    vi.stubEnv("VIRUSTOTAL_API_KEY", "test-key");
    vi.mocked(getJson).mockResolvedValue(
      vtFileResponse({ malicious: 3, harmless: 60, undetected: 6 }),
    );
    const f = await virusTotalHashSource.check(
      "a".repeat(64),
      new AbortController().signal,
    );
    expect(f.status).toBe("ok");
    expect(f.malicious).toBe(false);
    expect(f.score).toBe(24); // 3×8 — still contributes to the blend
  });

  it("hard-flags a broad engine consensus (EICAR-like 63/66)", async () => {
    vi.stubEnv("VIRUSTOTAL_API_KEY", "test-key");
    vi.mocked(getJson).mockResolvedValue(
      vtFileResponse({ malicious: 63, harmless: 3 }),
    );
    const f = await virusTotalHashSource.check(
      "b".repeat(64),
      new AbortController().signal,
    );
    expect(f.malicious).toBe(true);
  });

  it("promotes the engine tally into hashContext.detectionRatio", async () => {
    vi.stubEnv("VIRUSTOTAL_API_KEY", "test-key");
    vi.mocked(getJson).mockResolvedValue(
      vtFileResponse({ malicious: 48, suspicious: 3, harmless: 20 }),
    );
    const f = await virusTotalHashSource.check(
      "c".repeat(64),
      new AbortController().signal,
    );
    expect(f.hashContext?.detectionRatio).toEqual({ malicious: 48, total: 71 });
  });

  it("promotes a verified signature and unanimous harmless sandbox verdict", async () => {
    vi.stubEnv("VIRUSTOTAL_API_KEY", "test-key");
    vi.mocked(getJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        data: {
          attributes: {
            last_analysis_stats: { undetected: 59, timeout: 6, failure: 5, "type-unsupported": 5 },
            signature_info: { verified: "Signed", signers: "Wispr AI, Inc.; Microsoft ID Verified CS EOC CA 04" },
            sandbox_verdicts: { Zenbox: { category: "harmless", confidence: 98 } },
            times_submitted: 1,
          },
        },
      },
    } as GetJsonResult);
    const f = await virusTotalHashSource.check(
      "d".repeat(64),
      new AbortController().signal,
    );
    expect(f.hashContext?.signed).toBe(true);
    expect(f.hashContext?.signer).toBe("Wispr AI, Inc.");
    expect(f.hashContext?.sandboxVerdict).toEqual({ sandboxes: ["Zenbox"], confidence: 98 });
    expect(f.hashContext?.timesSubmitted).toBe(1);
  });

  it("does not claim a signature when the file is merely unsigned with PE version metadata", async () => {
    vi.stubEnv("VIRUSTOTAL_API_KEY", "test-key");
    vi.mocked(getJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        data: {
          attributes: {
            last_analysis_stats: { malicious: 58, undetected: 12, failure: 1, "type-unsupported": 4 },
            // PE version-resource fields with no `verified` — not a checked signature.
            signature_info: { description: "nProtect KeyCrypt Program Database DLL" },
          },
        },
      },
    } as GetJsonResult);
    const f = await virusTotalHashSource.check(
      "e".repeat(64),
      new AbortController().signal,
    );
    expect(f.hashContext?.signed).toBeUndefined();
    expect(f.hashContext?.signer).toBeUndefined();
  });
});
