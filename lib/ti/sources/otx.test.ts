import { afterEach, describe, expect, it, vi } from "vitest";
import { OTX_SCORE_CAP, otxIndicatorType, otxScore, otxSource } from "./otx";
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
  it("is 0 with no pulses, then ramps from a 15 base", () => {
    expect(otxScore(0)).toBe(0);
    expect(otxScore(1)).toBe(20);
    expect(otxScore(3)).toBe(30);
  });

  it("caps well below the level one source can carry a band with", () => {
    // Microsoft and OpenDNS each sit in 50 pulses. Saturating at 100 made both
    // of them suspicious on OTX alone.
    expect(otxScore(50)).toBe(OTX_SCORE_CAP);
    expect(otxScore(100)).toBe(OTX_SCORE_CAP);
    expect(OTX_SCORE_CAP).toBeLessThan(70);
  });

  it("crosses FLAG_THRESHOLD at five pulses, so it still flags", () => {
    expect(otxScore(4)).toBeLessThan(FLAG_THRESHOLD);
    expect(otxScore(5)).toBeGreaterThanOrEqual(FLAG_THRESHOLD);
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
    // Fifty pulses is the shape major infrastructure has, so the score is
    // capped rather than saturated at 100.
    expect(f.score).toBe(OTX_SCORE_CAP);
    expect(f.malicious).toBeUndefined();
  });
});

describe("otxIndicatorType", () => {
  it("selects the IPv4 indicator namespace for a v4 address", () => {
    expect(otxIndicatorType("8.8.8.8")).toBe("IPv4");
  });

  it("selects the IPv6 indicator namespace for a v6 address", () => {
    expect(otxIndicatorType("2001:4860:4860::8888")).toBe("IPv6");
    expect(otxIndicatorType("::1")).toBe("IPv6");
  });
});
