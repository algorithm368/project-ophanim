import { describe, expect, it } from "vitest";
import type { GeoRow } from "../geo";
import { countryCodeOf, summarizeCountries } from "./summary";

/** A located row whose country resolved with the given sources/confidence. */
function row(
  ip: string,
  code: string,
  confidence: "high" | "medium" | "low",
  sources: string[],
  alternatives?: { value: string; sources: string[] }[],
): GeoRow {
  return {
    ip,
    version: 4,
    status: "ok",
    geo: { country: "United States", countryCode: code },
    resolution: {
      country: {
        value: "United States",
        confidence,
        score: 1,
        agreement: 1,
        sources,
        ...(alternatives ? { alternatives } : {}),
      },
      countryCode: code,
      flags: { isHosting: false, isProxy: false, isMobile: false, sources: {} },
      providerCount: sources.length,
    },
  };
}

describe("countryCodeOf", () => {
  it("uses the reconciled code", () => {
    expect(countryCodeOf(row("1.1.1.1", "US", "high", ["ip-api"]))).toBe("US");
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

describe("summarizeCountries", () => {
  it("returns null below two located rows", () => {
    expect(summarizeCountries([row("1.1.1.1", "US", "high", ["ip-api"])])).toBeNull();
  });

  it("returns null when located rows disagree on country", () => {
    const rows = [
      row("1.1.1.1", "US", "high", ["ip-api"]),
      row("8.8.8.8", "AU", "high", ["ip-api"]),
    ];
    expect(summarizeCountries(rows)).toBeNull();
  });

  it("takes the weakest located confidence, not the first or the average", () => {
    const rows = [
      row("1.1.1.1", "US", "high", ["ip-api"]),
      row("8.8.8.8", "US", "low", ["ip-api"]),
    ];
    expect(summarizeCountries(rows)?.confidence).toBe("low");
  });

  it("intersects agreeing providers across rows and labels them", () => {
    const rows = [
      row("1.1.1.1", "US", "high", ["ip-api", "ipinfo"]),
      row("8.8.8.8", "US", "high", ["ip-api", "rdap-ip"]),
    ];
    expect(summarizeCountries(rows)?.agreedBy).toEqual(["ip-api.com"]);
  });

  it("yields an empty intersection when no provider backed every row", () => {
    const rows = [
      row("1.1.1.1", "US", "high", ["ipinfo"]),
      row("8.8.8.8", "US", "high", ["rdap-ip"]),
    ];
    expect(summarizeCountries(rows)?.agreedBy).toEqual([]);
  });

  it("counts contested rows and reports coverage against the full batch", () => {
    const rows: GeoRow[] = [
      row("1.1.1.1", "US", "high", ["ip-api"]),
      row("8.8.8.8", "US", "medium", ["ip-api"], [
        { value: "Australia", sources: ["ipinfo"] },
      ]),
      { ip: "203.0.113.7", version: 4, status: "error", error: "Lookup failed" },
    ];
    const s = summarizeCountries(rows);
    expect(s?.contested).toBe(1);
    expect(s?.located).toBe(2);
    expect(s?.total).toBe(3);
    expect(s?.ips).toEqual(["1.1.1.1", "8.8.8.8"]);
  });
});
