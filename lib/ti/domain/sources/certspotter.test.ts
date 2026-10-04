import { afterEach, describe, it, expect, vi } from "vitest";
import { certSpotterSource, issuerLabel, parseCertspotter } from "./certspotter";
import { getJson } from "../../http";

vi.mock("../../http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../http")>();
  return { ...actual, getJson: vi.fn() };
});


describe("issuerLabel", () => {
  it("prefers the organization, falls back to CN", () => {
    expect(issuerLabel("C=US, O=Let's Encrypt, CN=R3")).toBe("Let's Encrypt");
    expect(issuerLabel("C=US, CN=DigiCert SHA2")).toBe("DigiCert SHA2");
    expect(issuerLabel(undefined)).toBe("Unknown CA");
  });
});

describe("parseCertspotter", () => {
  it("derives subdomains from dns_names (strips wildcards, drops apex, lowercases)", () => {
    const { certificates, subdomains } = parseCertspotter(
      [
        {
          issuer: {
            friendly_name: "Let's Encrypt",
            name: "C=US, O=Let's Encrypt, CN=R3",
          },
          dns_names: [
            "wikipedia.org",
            "*.wikipedia.org",
            "*.m.wikipedia.org",
            "WIKIDATA.org",
          ],
          not_before: "2026-03-19T10:46:10Z",
          not_after: "2026-06-17T10:46:09Z",
        },
      ],
      "wikipedia.org",
    );
    expect(certificates).toHaveLength(1);
    // friendly_name is preferred over the raw DN
    expect(certificates[0].issuer).toBe("Let's Encrypt");
    expect(certificates[0].notAfter).toBe("2026-06-17T10:46:09Z");
    // cross-domain SAN (wikidata.org) excluded; apex + wildcard-apex dropped
    expect(subdomains.sort()).toEqual(["m.wikipedia.org"]);
  });

  it("emits cross-apex SAN domains as shared-cert pivots", () => {
    const { subdomains, sharedDomains } = parseCertspotter(
      [
        {
          issuer: { friendly_name: "Let's Encrypt" },
          dns_names: ["a.example.com", "example.com", "other-site.net"],
        },
      ],
      "example.com",
    );
    expect(subdomains).toEqual(["a.example.com"]);
    expect(sharedDomains).toEqual(["other-site.net"]);
  });

  it("falls back to the issuer DN when friendly_name is absent", () => {
    const { certificates } = parseCertspotter(
      [
        {
          issuer: { name: "C=US, O=Google Trust Services, CN=WR1" },
          dns_names: ["x.example.com"],
          not_after: "2025-01-01T00:00:00Z",
        },
      ],
      "example.com",
    );
    expect(certificates[0].issuer).toBe("Google Trust Services");
  });
});

describe("issuerLabel / parseCertspotter edge cases", () => {
  it("returns the DN itself when it has neither O nor CN", () => {
    expect(issuerLabel("C=US")).toBe("C=US");
  });

  it("skips a bare wildcard and falls back to the first SAN off the apex", () => {
    const { certificates, subdomains } = parseCertspotter(
      [{ dns_names: ["*.", "other.test"] }, {}],
      "a.example",
    );
    expect(subdomains).toEqual([]);
    expect(certificates[0]).toMatchObject({ commonName: "*.", issuer: "Unknown CA" });
    expect(certificates[1].commonName).toBeUndefined();
  });
});

describe("certSpotterSource.check", () => {
  const signal = new AbortController().signal;
  const reply = (data: unknown, status = 200) =>
    vi.mocked(getJson).mockResolvedValue({ ok: status < 400, status, data, text: "" });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(getJson).mockReset();
  });

  it("needs no key, but sends one when configured", async () => {
    expect(certSpotterSource.isEnabled()).toBe(true);
    vi.stubEnv("CERTSPOTTER_API_KEY", "k");
    reply([]);
    await certSpotterSource.check("www.a.example", signal);
    const [url, , headers] = vi.mocked(getJson).mock.calls[0];
    expect(url).toContain("domain=a.example");
    expect(headers).toEqual({ Authorization: "Bearer k" });
  });

  it("summarizes certificates, subdomains and shared-cert domains", async () => {
    vi.stubEnv("CERTSPOTTER_API_KEY", "");
    reply([{ dns_names: ["a.example", "www.a.example", "b.test"] }]);
    const f = await certSpotterSource.check("a.example", signal);
    expect(vi.mocked(getJson).mock.calls[0][2]).toEqual({});
    expect(f.summary).toBe("1 certificate in CT logs, 1 subdomain");
    expect(f.relations).toEqual([{ value: "b.test", type: "domain", relation: "sharedCert" }]);
  });

  it("omits subdomain and relation parts when there are none", async () => {
    reply([{ dns_names: ["not a domain"] }]);
    const f = await certSpotterSource.check("not a domain", signal);
    expect(f.summary).toBe("1 certificate in CT logs");
    expect(f.relations).toBeUndefined();
  });

  it("maps empty, rate-limited, failed and thrown lookups", async () => {
    reply([]);
    expect((await certSpotterSource.check("a.example", signal)).summary).toBe(
      "No certificate-transparency records",
    );
    reply(null, 429);
    expect((await certSpotterSource.check("a.example", signal)).status).toBe("rate_limited");
    reply({ not: "a list" });
    expect((await certSpotterSource.check("a.example", signal)).error).toBe("HTTP 200");
    vi.mocked(getJson).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await certSpotterSource.check("a.example", signal)).status).toBe("timeout");
    vi.mocked(getJson).mockRejectedValue(new Error("boom"));
    expect((await certSpotterSource.check("a.example", signal)).error).toBe("boom");
  });
});
