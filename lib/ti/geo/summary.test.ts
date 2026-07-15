import { describe, expect, it } from "vitest";
import type { GeoRow } from "../geo";
import type { ResolvedField } from "../types";
import { countryCodeOf, originReport, sameCountryNote } from "./summary";

/** A located row whose country, city/region, and network can each be set. */
function named(
  ip: string,
  name: string,
  code: string,
  extra?: { city?: string; region?: string; asn?: string; org?: string },
): GeoRow {
  const field = (value: string): ResolvedField<string> => ({
    value,
    confidence: "high",
    score: 1,
    agreement: 1,
    sources: ["ip-api"],
  });
  return {
    ip,
    version: 4,
    status: "ok",
    geo: { country: name, countryCode: code, city: extra?.city, region: extra?.region },
    resolution: {
      country: field(name),
      countryCode: code,
      ...(extra?.city ? { city: field(extra.city) } : {}),
      ...(extra?.region ? { region: field(extra.region) } : {}),
      ...(extra?.asn ? { asn: field(extra.asn) } : {}),
      ...(extra?.org ? { asnOrg: field(extra.org) } : {}),
      flags: { isHosting: false, isProxy: false, isMobile: false, sources: {} },
      providerCount: 1,
    },
  };
}

describe("countryCodeOf", () => {
  it("uses the reconciled code", () => {
    expect(countryCodeOf(named("1.1.1.1", "United States", "US"))).toBe("US");
  });

  it("returns undefined when a resolution won on name only, ignoring the stale base code", () => {
    const r: GeoRow = {
      ip: "1.1.1.1",
      version: 4,
      status: "ok",
      geo: { country: "United States", countryCode: "AU" },
      resolution: {
        country: {
          value: "United States",
          confidence: "low",
          score: 0.4,
          agreement: 1,
          sources: ["freeipapi"],
        },
        flags: { isHosting: false, isProxy: false, isMobile: false, sources: {} },
        providerCount: 1,
      },
    };
    expect(countryCodeOf(r)).toBeUndefined();
  });

  it("falls back to the raw code when nothing reconciled", () => {
    const r: GeoRow = {
      ip: "1.1.1.1",
      version: 4,
      status: "ok",
      geo: { countryCode: "us" },
    };
    expect(countryCodeOf(r)).toBe("US");
  });

  it("returns undefined for an error row", () => {
    const r: GeoRow = {
      ip: "1.1.1.1",
      version: 4,
      status: "error",
      error: "Lookup failed",
    };
    expect(countryCodeOf(r)).toBeUndefined();
  });
});

describe("originReport", () => {
  it("leads with coverage, then a sentence per country naming address, city, and network", () => {
    const report = originReport([
      named("8.8.8.8", "United States", "US", {
        city: "Ashburn",
        region: "Virginia",
        asn: "AS15169 Google LLC",
        org: "Google LLC",
      }),
      named("9.9.9.9", "United States", "US", {
        city: "Berkeley",
        region: "California",
        asn: "AS19281",
        org: "Quad9",
      }),
      named("78.46.0.1", "Germany", "DE", {
        city: "Nuremberg",
        region: "Bavaria",
        asn: "AS24940 Hetzner Online GmbH",
        org: "Hetzner Online GmbH",
      }),
    ]);
    expect(report).toBe(
      "All 3 addresses geolocated to 2 countries. " +
        "United States (US) accounts for 2 addresses: 8.8.8.8 in Ashburn, Virginia, announced by AS15169 (Google LLC); " +
        "9.9.9.9 in Berkeley, California, announced by AS19281 (Quad9). " +
        "Germany (DE) accounts for 1 address: 78.46.0.1 in Nuremberg, Bavaria, announced by AS24940 (Hetzner Online GmbH).",
    );
  });

  it("uses the ASN number alone when the org is unknown", () => {
    const report = originReport([
      named("1.1.1.1", "Australia", "AU", { city: "Sydney", asn: "AS13335" }),
    ]);
    expect(report).toContain("1.1.1.1 in Sydney, announced by AS13335.");
  });

  it("orders countries by count desc, then name", () => {
    const report = originReport([
      named("1.1.1.1", "Germany", "DE"),
      named("2.2.2.2", "Australia", "AU"),
      named("3.3.3.3", "United States", "US"),
      named("4.4.4.4", "United States", "US"),
    ]);
    const order = ["United States (US)", "Australia (AU)", "Germany (DE)"].map((c) =>
      report.indexOf(c),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("omits the city when no place is known", () => {
    const report = originReport([named("1.1.1.1", "Australia", "AU")]);
    expect(report).toBe(
      "All 1 address geolocated to 1 country. Australia (AU) accounts for 1 address: 1.1.1.1.",
    );
  });

  it("reports partial coverage and closes with the unlocated addresses", () => {
    const report = originReport([
      named("8.8.8.8", "United States", "US", { city: "Ashburn" }),
      { ip: "203.0.113.7", version: 4, status: "error", error: "Lookup failed" },
    ]);
    expect(report).toContain("1 of 2 addresses geolocated to 1 country.");
    expect(report).toContain("1 address could not be geolocated: 203.0.113.7.");
  });

  it("says nothing located when no address resolves", () => {
    const report = originReport([
      { ip: "203.0.113.7", version: 4, status: "error", error: "Lookup failed" },
      { ip: "203.0.113.8", version: 4, status: "error", error: "Lookup failed" },
    ]);
    expect(report).toBe("None of the 2 addresses could be geolocated.");
  });

  it("returns an empty string for no rows", () => {
    expect(originReport([])).toBe("");
  });
});

describe("sameCountryNote", () => {
  it("affirms one country when every located address matches", () => {
    expect(
      sameCountryNote([
        named("8.8.8.8", "United States", "US"),
        named("9.9.9.9", "United States", "US"),
      ]),
    ).toBe("All 2 addresses resolve to the same country, United States (US).");
  });

  it("returns null when the batch spans more than one country", () => {
    expect(
      sameCountryNote([
        named("8.8.8.8", "United States", "US"),
        named("9.9.9.9", "Germany", "DE"),
      ]),
    ).toBeNull();
  });

  it("returns null below two located addresses", () => {
    expect(sameCountryNote([named("8.8.8.8", "United States", "US")])).toBeNull();
  });

  it("scopes the claim to located addresses when some had no data", () => {
    expect(
      sameCountryNote([
        named("8.8.8.8", "United States", "US"),
        named("9.9.9.9", "United States", "US"),
        { ip: "203.0.113.7", version: 4, status: "error", error: "Lookup failed" },
      ]),
    ).toBe("All 2 located addresses resolve to the same country, United States (US).");
  });
});
