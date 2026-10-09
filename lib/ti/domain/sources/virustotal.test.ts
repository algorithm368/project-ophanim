import { afterEach, describe, expect, it, vi } from "vitest";
import {
  domainRelationsFromVt,
  normalizeCategories,
  virusTotalDomainSource,
  vtCertificate,
  vtDnsContext,
  vtScore,
} from "./virustotal";
import { getJson } from "../../http";
import { withLane } from "../../keys";
import type { VtRelationships } from "../../vt-relationships";

vi.mock("../../http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../http")>();
  return { ...actual, getJson: vi.fn() };
});

type GetJsonResult = Awaited<ReturnType<typeof getJson>>;

function vtDomainResponse(stats: Record<string, number>): GetJsonResult {
  return {
    ok: true,
    status: 200,
    data: { data: { attributes: { last_analysis_stats: stats } } },
  } as GetJsonResult;
}

describe("vtCertificate", () => {
  it("normalizes the cert and splits SANs into subdomains + shared domains", () => {
    const { certificate, subdomains, sharedDomains } = vtCertificate(
      {
        subject: { CN: "example.com" },
        issuer: { O: "Let's Encrypt", CN: "R3" },
        validity: { not_before: "2026-01-01 00:00:00", not_after: "2026-04-01 00:00:00" },
        extensions: {
          subject_alternative_name: [
            "example.com",
            "www.example.com",
            "cdn.partner.net",
          ],
        },
      },
      "example.com",
    );
    expect(certificate).toEqual({
      issuer: "Let's Encrypt",
      commonName: "example.com",
      sans: ["example.com", "www.example.com", "cdn.partner.net"],
      firstSeen: "2026-01-01T00:00:00.000Z",
      notAfter: "2026-04-01T00:00:00.000Z",
    });
    expect(subdomains).toEqual(["www.example.com"]);
    expect(sharedDomains).toEqual(["partner.net"]);
  });

  it("returns an empty result when no cert is present", () => {
    expect(vtCertificate(undefined, "example.com")).toEqual({
      subdomains: [],
      sharedDomains: [],
    });
  });
});

describe("vtDnsContext", () => {
  it("maps DNS records to the domain-context rows the profile renders", () => {
    expect(
      vtDnsContext([
        { type: "A", value: "1.2.3.4" },
        { type: "A", value: "1.2.3.4" }, // dup
        { type: "AAAA", value: "2001:db8::1" },
        { type: "MX", value: "mail.example.com" },
        { type: "NS", value: "NS1.EXAMPLE.COM" },
        { type: "CAA", flag: 0, tag: "issue", value: "letsencrypt.org" },
        { type: "SOA", value: "ns1.example.com hostmaster ..." },
      ]),
    ).toEqual({
      resolvedIps: ["1.2.3.4"],
      ipv6: ["2001:db8::1"],
      mx: ["mail.example.com"],
      nameservers: ["ns1.example.com"],
      caa: ['0 issue "letsencrypt.org"'],
      soa: "ns1.example.com hostmaster ...",
    });
  });

  it("is an empty object when there are no records", () => {
    expect(vtDnsContext(undefined)).toEqual({});
  });
});

describe("vtScore (domain)", () => {
  it("weights malicious 10x and suspicious 3x, capped at 100", () => {
    expect(vtScore(0, 0)).toBe(0);
    expect(vtScore(2, 1)).toBe(23);
    expect(vtScore(20, 0)).toBe(100);
  });
});

describe("domainRelationsFromVt", () => {
  it("recovers resolved IPs from resolution ids + adds communicating samples", () => {
    const rels: VtRelationships = {
      resolutions: {
        data: [{ type: "resolution", id: "93.184.216.34example.com" }],
      },
      communicating_files: { data: [{ type: "file", id: "def456" }] },
    };
    expect(domainRelationsFromVt("example.com", rels)).toEqual([
      { value: "93.184.216.34", type: "ip", relation: "resolved" },
      { value: "def456", type: "hash", relation: "communicating" },
    ]);
  });

  it("is empty when there are no relationships", () => {
    expect(domainRelationsFromVt("example.com", undefined)).toEqual([]);
  });
});

describe("normalizeCategories", () => {
  it("aliases vendor labels and orders by descriptive priority", () => {
    expect(
      normalizeCategories({
        a: "searchengines",
        b: "Information Technology (alphaMountain.ai)",
      }),
    ).toEqual(["Search engines", "Information technology"]);
  });

  it("merges near-identical labels into one chip", () => {
    expect(
      normalizeCategories({ a: "searchengines", b: "Search Engines and Portals" }),
    ).toEqual(["Search engines"]);
  });

  // VT can append more than one vendor annotation. Pinned because the strip is
  // a loop now rather than one lazy regex, and a single pass would leave the
  // outer one behind.
  it("strips every trailing vendor annotation, not just the last", () => {
    expect(
      normalizeCategories({ a: "Business (Forcepoint) (BitDefender)" }),
    ).toEqual(["Business"]);
  });

  it("capitalizes unknown labels and drops blanks", () => {
    expect(normalizeCategories({ a: "weather" })).toEqual(["Weather"]);
    expect(normalizeCategories({ a: "", b: "  " })).toEqual([]);
    expect(normalizeCategories({})).toEqual([]);
  });
});

// Pin the P1.1 wiring at the check() level so a revert to an absolute
// engine-count flag fails here.
describe("virusTotalDomainSource.check — definitive-flag wiring (P1.1)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(getJson).mockReset();
  });

  it("does not hard-flag a small vendor minority (4/91)", async () => {
    vi.stubEnv("VIRUSTOTAL_API_KEY", "test-key");
    vi.mocked(getJson).mockResolvedValue(
      vtDomainResponse({ malicious: 4, harmless: 70, undetected: 17 }),
    );
    const f = await virusTotalDomainSource.check(
      "example.com",
      new AbortController().signal,
    );
    expect(f.status).toBe("ok");
    expect(f.malicious).toBe(false);
    expect(f.score).toBe(40);
  });

  it("hard-flags a broad vendor consensus", async () => {
    vi.stubEnv("VIRUSTOTAL_API_KEY", "test-key");
    vi.mocked(getJson).mockResolvedValue(
      vtDomainResponse({ malicious: 12, harmless: 70, undetected: 9 }),
    );
    const f = await virusTotalDomainSource.check(
      "evil.example",
      new AbortController().signal,
    );
    expect(f.malicious).toBe(true);
  });
});

describe("virustotal domain helpers — edge cases", () => {
  it("normalizes a sparse certificate", () => {
    expect(
      vtCertificate(
        { subject: {}, issuer: { CN: "CA" }, validity: { not_before: "garbage" } },
        "a.example",
      ).certificate,
    ).toEqual({ issuer: "CA", commonName: undefined, sans: [], firstSeen: undefined, notAfter: undefined });
    expect(vtCertificate({}, "a.example").certificate?.issuer).toBe("Unknown CA");
  });

  it("defaults CAA flag and tag, and keeps CNAME and TXT", () => {
    expect(
      vtDnsContext([
        { type: "CAA", value: "letsencrypt.org" },
        { type: "CNAME", value: "b.example" },
        { type: "TXT", value: "v=spf1 -all" },
      ]),
    ).toEqual({
      caa: ['0 issue "letsencrypt.org"'],
      cname: ["b.example"],
      txt: ["v=spf1 -all"],
    });
  });

  it("orders equal-priority labels by count, then alphabetically", () => {
    expect(normalizeCategories({ a: "Zebra", b: "Zebra", c: "Apple", d: "Mango" })).toEqual([
      "Zebra",
      "Apple",
      "Mango",
    ]);
  });

  it("leaves a closing paren with no opener alone", () => {
    expect(normalizeCategories({ a: "weird)" })).toEqual(["Weird)"]);
  });
});

describe("virusTotalDomainSource.check — remaining paths", () => {
  const signal = new AbortController().signal;
  const reply = (data: unknown, status = 200) =>
    vi.mocked(getJson).mockResolvedValue({ ok: status < 400, status, data, text: "" });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(getJson).mockReset();
  });

  it("is skipped without a key", async () => {
    vi.stubEnv("VIRUSTOTAL_API_KEY", "");
    expect(virusTotalDomainSource.isEnabled()).toBe(false);
    expect(await virusTotalDomainSource.check("a.example", signal)).toEqual({ status: "skipped" });
  });

  it("assembles certificate, subdomains and shared-cert relations", async () => {
    vi.stubEnv("VIRUSTOTAL_API_KEY", "k");
    expect(virusTotalDomainSource.isEnabled()).toBe(true);
    reply({
      data: {
        attributes: {
          last_analysis_stats: { malicious: 1, suspicious: 1, harmless: 1, undetected: 1, timeout: 1 },
          categories: { v: "news" },
          last_https_certificate: {
            issuer: { O: "Org" },
            extensions: { subject_alternative_name: ["a.example", "www.a.example", "b.test"] },
          },
        },
      },
    });
    const f = await virusTotalDomainSource.check("a.example", signal);
    expect(f.summary).toBe("1/5 vendors flagged malicious, 1 suspicious");
    expect(f.subdomains).toEqual(["www.a.example"]);
    expect(f.certificates).toHaveLength(1);
    expect(f.relations).toEqual([{ value: "b.test", type: "domain", relation: "sharedCert" }]);
    expect(f.domainContext?.categories).toEqual(["News & media"]);
  });

  it("leaves optional parts out of a bare answer", async () => {
    vi.stubEnv("VIRUSTOTAL_API_KEY", "k");
    reply({ data: { attributes: {} } });
    const f = await virusTotalDomainSource.check("a.example", signal);
    expect(f.summary).toBe("0/0 vendors flagged malicious");
    expect(f.certificates).toBeUndefined();
    expect(f.subdomains).toBeUndefined();
    expect(f.relations).toBeUndefined();
    expect(f.details).toMatchObject({ harmlessVendors: 0 });
    reply({ data: { attributes: { last_analysis_stats: {} } } });
    expect((await virusTotalDomainSource.check("a.example", signal)).status).toBe("ok");
  });

  it("maps errors and timeouts", async () => {
    vi.stubEnv("VIRUSTOTAL_API_KEY", "k");
    reply({ error: { message: "Not found" } }, 404);
    expect((await virusTotalDomainSource.check("a.example", signal)).error).toBe("Not found");
    reply(null, 500);
    expect((await virusTotalDomainSource.check("a.example", signal)).error).toBe("HTTP 500");
    vi.mocked(getJson).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await virusTotalDomainSource.check("a.example", signal)).status).toBe("timeout");
    vi.mocked(getJson).mockRejectedValue(new Error("boom"));
    expect((await virusTotalDomainSource.check("a.example", signal)).error).toBe("boom");
  });
});

describe("virusTotalDomainSource — per-lane key", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(getJson).mockReset();
  });

  it("uses the bulk key inside the bulk lane", async () => {
    vi.stubEnv("VIRUSTOTAL_API_KEY", "shared");
    vi.stubEnv("VIRUSTOTAL_API_KEY_BULK", "own");
    vi.mocked(getJson).mockResolvedValue({ ok: false, status: 500, data: {}, text: "" });
    await withLane("bulk", () => virusTotalDomainSource.check("example.com", new AbortController().signal));
    expect(vi.mocked(getJson).mock.calls[0][2]).toEqual({ "x-apikey": "own" });
  });

  it("enables on a bulk-only key in the bulk lane, not in /check's", async () => {
    vi.stubEnv("VIRUSTOTAL_API_KEY", "");
    vi.stubEnv("VIRUSTOTAL_API_KEY_BULK", "own");
    expect(virusTotalDomainSource.isEnabled()).toBe(false);
    expect(await withLane("bulk", async () => virusTotalDomainSource.isEnabled())).toBe(true);
  });
});
