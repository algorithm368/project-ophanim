import { afterEach, describe, expect, it, vi } from "vitest";
import { ipRelationsFromVt, virusTotalSource, vtScore } from "./virustotal";
import { getJson } from "../http";
import { withLane } from "../keys";
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

describe("virusTotalSource.check — remaining paths", () => {
  const signal = new AbortController().signal;
  const reply = (data: unknown, status = 200) =>
    vi.mocked(getJson).mockResolvedValue({ ok: status < 400, status, data, text: "" });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(getJson).mockReset();
  });

  it("is skipped without a key", async () => {
    vi.stubEnv("VIRUSTOTAL_API_KEY", "");
    expect(virusTotalSource.isEnabled()).toBe(false);
    expect(await virusTotalSource.check("1.2.3.4", signal)).toEqual({ status: "skipped" });
  });

  it("reads the certificate, suspicious count and hosted domains", async () => {
    vi.stubEnv("VIRUSTOTAL_API_KEY", "k");
    expect(virusTotalSource.isEnabled()).toBe(true);
    reply({
      data: {
        attributes: {
          last_analysis_stats: { malicious: 1, suspicious: 2, harmless: 3, undetected: 4, timeout: 1 },
          tags: ["cdn"],
          last_https_certificate: {
            subject: { CN: "a.example" },
            issuer: { CN: "Example CA" },
            validity: { not_after: "2027-01-01" },
          },
        },
        relationships: {
          resolutions: { data: [{ id: "1.2.3.4a.example", type: "resolution" }] },
        },
      },
    });
    const f = await virusTotalSource.check("1.2.3.4", signal);
    expect(f.summary).toBe("1/11 vendors flagged malicious, 2 suspicious");
    expect(f.categories).toEqual(["cdn"]);
    expect(f.details).toMatchObject({
      harmlessVendors: 3,
      certificate: { subject: "a.example", issuer: "Example CA", notAfter: "2027-01-01" },
    });
    expect(f.relations?.[0]).toMatchObject({ value: "a.example", relation: "hosted" });
  });

  it("prefers the issuer organization and tolerates empty stats", async () => {
    vi.stubEnv("VIRUSTOTAL_API_KEY", "k");
    reply({ data: { attributes: { last_https_certificate: { issuer: { O: "Org" } } } } });
    const f = await virusTotalSource.check("1.2.3.4", signal);
    expect(f.summary).toBe("0/0 vendors flagged malicious");
    expect(f.categories).toEqual([]);
    expect(f.relations).toBeUndefined();
    expect(f.details).toMatchObject({ harmlessVendors: 0, certificate: { issuer: "Org" } });
    reply({ data: { attributes: { last_analysis_stats: {} } } });
    expect((await virusTotalSource.check("1.2.3.4", signal)).details).toMatchObject({
      certificate: undefined,
    });
  });

  it("surfaces API errors, timeouts and thrown errors", async () => {
    vi.stubEnv("VIRUSTOTAL_API_KEY", "k");
    reply({ error: { message: "Quota exceeded" } }, 429);
    expect((await virusTotalSource.check("1.2.3.4", signal)).error).toBe("Quota exceeded");
    reply(null, 500);
    expect((await virusTotalSource.check("1.2.3.4", signal)).error).toBe("HTTP 500");
    vi.mocked(getJson).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await virusTotalSource.check("1.2.3.4", signal)).status).toBe("timeout");
    vi.mocked(getJson).mockRejectedValue(new Error("boom"));
    expect((await virusTotalSource.check("1.2.3.4", signal)).error).toBe("boom");
  });
});

describe("virusTotalSource — per-lane key", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(getJson).mockReset();
  });

  it("uses the bulk key inside the bulk lane", async () => {
    vi.stubEnv("VIRUSTOTAL_API_KEY", "shared");
    vi.stubEnv("VIRUSTOTAL_API_KEY_BULK", "own");
    vi.mocked(getJson).mockResolvedValue({ ok: false, status: 500, data: {}, text: "" });
    await withLane("bulk", () => virusTotalSource.check("1.2.3.4", new AbortController().signal));
    expect(vi.mocked(getJson).mock.calls[0][2]).toEqual({ "x-apikey": "own" });
  });

  it("enables on a bulk-only key in the bulk lane, not in /check's", async () => {
    vi.stubEnv("VIRUSTOTAL_API_KEY", "");
    vi.stubEnv("VIRUSTOTAL_API_KEY_BULK", "own");
    expect(virusTotalSource.isEnabled()).toBe(false);
    expect(await withLane("bulk", async () => virusTotalSource.isEnabled())).toBe(true);
  });
});
