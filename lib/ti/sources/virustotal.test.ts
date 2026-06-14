import { afterEach, describe, expect, it, vi } from "vitest";
import { ipRelationsFromVt, virusTotalSource, vtScore } from "./virustotal";
import { getJson } from "../http";
import type { VtRelationships } from "../vt-relationships";

vi.mock("../http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../http")>();
  return { ...actual, getJson: vi.fn() };
});

type GetJsonResult = Awaited<ReturnType<typeof getJson>>;

function vtIpResponse(stats: Record<string, number>): GetJsonResult {
  return {
    ok: true,
    status: 200,
    data: { data: { attributes: { last_analysis_stats: stats } } },
  } as GetJsonResult;
}

describe("vtScore (IP)", () => {
  it("weights malicious 10x and suspicious 3x, capped at 100", () => {
    expect(vtScore(0, 0)).toBe(0);
    expect(vtScore(2, 1)).toBe(23);
    expect(vtScore(20, 0)).toBe(100);
  });
});

describe("ipRelationsFromVt", () => {
  it("recovers hosted domains from resolution ids + adds communicating samples", () => {
    const rels: VtRelationships = {
      resolutions: {
        data: [
          { type: "resolution", id: "8.8.8.8dns.google" },
          { type: "resolution", id: "8.8.8.8google-public-dns-a.google.com" },
        ],
      },
      communicating_files: { data: [{ type: "file", id: "abc123" }] },
    };
    expect(ipRelationsFromVt("8.8.8.8", rels)).toEqual([
      { value: "dns.google", type: "domain", relation: "hosted" },
      {
        value: "google-public-dns-a.google.com",
        type: "domain",
        relation: "hosted",
      },
      { value: "abc123", type: "hash", relation: "communicating" },
    ]);
  });

  it("is empty when there are no relationships", () => {
    expect(ipRelationsFromVt("8.8.8.8", undefined)).toEqual([]);
  });
});

// The P1.1 fix lives in the wiring (`malicious: vtDefinitive(...)`), not just
// the helper — pin it at the check() level so a revert to an absolute engine
// count fails here.
describe("virusTotalSource.check — definitive-flag wiring (P1.1)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(getJson).mockReset();
  });

  it("does not hard-flag a small vendor minority (4/91)", async () => {
    vi.stubEnv("VIRUSTOTAL_API_KEY", "test-key");
    vi.mocked(getJson).mockResolvedValue(
      vtIpResponse({ malicious: 4, harmless: 70, undetected: 17 }),
    );
    const f = await virusTotalSource.check(
      "50.16.16.211",
      new AbortController().signal,
    );
    expect(f.status).toBe("ok");
    expect(f.malicious).toBe(false);
    // The tally still scores (4×10) — it just can't floor the aggregate.
    expect(f.score).toBe(40);
  });

  it("hard-flags a broad vendor consensus", async () => {
    vi.stubEnv("VIRUSTOTAL_API_KEY", "test-key");
    vi.mocked(getJson).mockResolvedValue(
      vtIpResponse({ malicious: 30, harmless: 50, undetected: 11 }),
    );
    const f = await virusTotalSource.check(
      "203.0.113.7",
      new AbortController().signal,
    );
    expect(f.malicious).toBe(true);
  });
});
