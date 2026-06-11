import { describe, it, expect } from "vitest";
import { issuerLabel, parseCertspotter } from "./certspotter";

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
