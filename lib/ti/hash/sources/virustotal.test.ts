import { afterEach, describe, expect, it, vi } from "vitest";
import { isoFromEpoch, vtFileScore, virusTotalHashSource } from "./virustotal";
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
});
