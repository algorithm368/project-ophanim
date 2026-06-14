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
