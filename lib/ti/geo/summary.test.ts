import { describe, expect, it } from "vitest";
import type { GeoRow } from "../geo";
import type { CountrySummary } from "./summary";
import {
  countryCodeOf,
  sameCountrySentence,
  sameCountryText,
  summarizeCountries,
} from "./summary";

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

/** Build a summary directly, so sentence tests don't depend on row plumbing. */
function summary(over: Partial<CountrySummary> = {}): CountrySummary {
  return {
    country: "United States",
    code: "US",
    ips: ["1.1.1.1", "8.8.8.8"],
    located: 2,
    total: 2,
    confidence: "high",
    agreedBy: ["ip-api.com", "IPinfo"],
    contested: 0,
    ...over,
  };
}

describe("sameCountrySentence", () => {
  it("states coverage, the country, and multi-provider agreement", () => {
    expect(sameCountrySentence(summary())).toBe(
      "2 of 2 addresses resolved to a country. All 2 are located in the same country, " +
        "United States (US), agreed by ip-api.com and IPinfo on all 2 addresses.",
    );
  });

  it("hedges the verb below high confidence", () => {
    expect(sameCountrySentence(summary({ confidence: "medium" }))).toContain(
      "All 2 are likely located in the same country",
    );
  });

  it("says reported, not agreed, for a lone provider", () => {
    const s = summary({ agreedBy: ["ip-api.com"] });
    expect(sameCountrySentence(s)).toContain("as reported by ip-api.com on all 2 addresses.");
    expect(sameCountrySentence(s)).not.toContain("agreed by");
  });

  it("names no provider when none backed every address", () => {
    expect(sameCountrySentence(summary({ agreedBy: [] }))).toContain(
      "backed by different providers per address.",
    );
  });

  it("appends the disagreement clause, pluralized", () => {
    expect(sameCountrySentence(summary({ contested: 1 }))).toContain(
      ", providers disagreed on 1 address.",
    );
    expect(sameCountrySentence(summary({ contested: 2 }))).toContain(
      ", providers disagreed on 2 addresses.",
    );
  });

  it("reports partial coverage against the full batch", () => {
    expect(sameCountrySentence(summary({ located: 2, total: 6 }))).toContain(
      "2 of 6 addresses resolved to a country.",
    );
  });

  it("joins three or more providers with commas and a trailing and", () => {
    const s = summary({ agreedBy: ["ip-api.com", "IPinfo", "RDAP"] });
    expect(sameCountrySentence(s)).toContain("agreed by ip-api.com, IPinfo and RDAP");
  });

  it("concatenates back to the rendered parts exactly", () => {
    const s = summary({ contested: 1 });
    const t = sameCountryText(s);
    expect(`${t.lead} ${t.place}${t.tail}`).toBe(sameCountrySentence(s));
    expect(t.place).toBe("United States (US)");
  });
});
