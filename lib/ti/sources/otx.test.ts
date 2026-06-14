import { afterEach, describe, expect, it, vi } from "vitest";
import { otxScore, otxSource } from "./otx";
import { FLAG_THRESHOLD } from "../aggregate";
import { getJson } from "../http";

vi.mock("../http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../http")>();
  return { ...actual, getJson: vi.fn() };
});

vi.mock("../otx-malware", () => ({
  fetchOtxMalwareRelations: vi.fn(async () => []),
}));

describe("otxScore (IP)", () => {
  it("is 0 with no pulses, then ramps from a 25 base", () => {
    expect(otxScore(0)).toBe(0);
    expect(otxScore(1)).toBe(35);
    expect(otxScore(3)).toBe(55);
  });

  it("caps at 100", () => {
    expect(otxScore(100)).toBe(100);
  });

  it("crosses FLAG_THRESHOLD at two pulses — the compensation for the removed hard flag", () => {
    expect(otxScore(2)).toBeGreaterThanOrEqual(FLAG_THRESHOLD);
  });
});

// Pulses are community-authored references, not curated listings: the finding
// must never carry `malicious: true`, or aggregateRisk()'s 75 floor turns
// three arbitrary pulses into an "almost certainly malicious" verdict (P1.1).
describe("otxSource.check — no hard-malicious flag from pulses (P1.1)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(getJson).mockReset();
  });

  it("scores pulse-heavy IPs without setting the malicious flag", async () => {
    vi.stubEnv("OTX_API_KEY", "test-key");
    vi.mocked(getJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: { pulse_info: { count: 50, pulses: [] } },
    } as Awaited<ReturnType<typeof getJson>>);
    const f = await otxSource.check("50.16.16.211", new AbortController().signal);
    expect(f.status).toBe("ok");
    expect(f.score).toBe(100);
    expect(f.malicious).toBeUndefined();
  });
});
