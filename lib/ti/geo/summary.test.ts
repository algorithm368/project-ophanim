import { describe, expect, it } from "vitest";
import type { GeoRow } from "../geo";
import type { Confidence } from "../types";
import type { CountrySummary } from "./summary";
import {
  copyBlock,
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

/** A row with independent per-field confidences. */
function netRow(
  ip: string,
  opts: {
    country?: [string, Confidence];
    asn?: [string, Confidence];
    isp?: [string, Confidence];
    asnOrg?: [string, Confidence];
  },
): GeoRow {
  const field = (v?: [string, Confidence]) =>
    v ? { value: v[0], confidence: v[1], score: 1, agreement: 1, sources: ["ip-api"] } : undefined;
  return {
    ip,
    version: 4,
    status: "ok",
    geo: {},
    resolution: {
      country: field(opts.country),
      countryCode: opts.country?.[0],
      asn: field(opts.asn),
      asnOrg: field(opts.asnOrg),
      isp: field(opts.isp),
      flags: { isHosting: false, isProxy: false, isMobile: false, sources: {} },
      providerCount: 2,
    },
  };
}

describe("copyBlock", () => {
  it("aligns columns to the widest value and clips nothing", () => {
    const block = copyBlock([
      netRow("1.1.1.1", { country: ["US", "high"], asn: ["AS13335", "high"], isp: ["Cloudflare, Inc.", "high"] }),
      netRow("203.0.113.254", { country: ["US", "high"], asn: ["AS15169", "high"], isp: ["Google LLC", "high"] }),
    ]);
    expect(block).toBe(
      "1.1.1.1        US  AS13335  Cloudflare, Inc.\n" +
        "203.0.113.254  US  AS15169  Google LLC",
    );
  });

  it("omits the legend when every field is high confidence", () => {
    const block = copyBlock([netRow("1.1.1.1", { country: ["US", "high"], asn: ["AS13335", "high"], isp: ["Cloudflare, Inc.", "high"] })]);
    expect(block).not.toContain("no data");
    expect(block).not.toContain("contested");
  });

  it("suffixes fields below high confidence, per field", () => {
    const block = copyBlock([netRow("9.9.9.9", { country: ["US", "high"], asn: ["AS19281", "medium"], isp: ["Quad9", "high"] })]);
    expect(block).toContain("9.9.9.9  US  AS19281?  Quad9");
    expect(block).toContain("value?  contested or single provider");
  });

  it("prints the canonical AS number, dropping the org tail the vote kept", () => {
    const block = copyBlock([
      netRow("1.1.1.1", { asn: ["AS13335 Cloudflare, Inc.", "high"], isp: ["Cloudflare", "high"] }),
    ]);
    expect(block).toContain("AS13335  Cloudflare");
    expect(block).not.toContain("AS13335 Cloudflare, Inc.  Cloudflare");
  });

  it("prints a bare ? and its legend for an error row", () => {
    const rows: GeoRow[] = [
      netRow("1.1.1.1", { country: ["US", "high"], asn: ["AS13335", "high"], isp: ["Cloudflare, Inc.", "high"] }),
      { ip: "203.0.113.7", version: 4, status: "error", error: "Lookup failed" },
    ];
    const block = copyBlock(rows);
    expect(block).toContain("203.0.113.7  ?   ?        ?");
    expect(block).toContain("?       no data");
  });

  it("walks the ISP ladder: isp, then asnOrg, then a bare ?", () => {
    expect(copyBlock([netRow("1.1.1.1", { asnOrg: ["Cloudflare", "high"] })])).toContain("Cloudflare");
    expect(copyBlock([netRow("1.1.1.1", {})])).toContain("1.1.1.1  ?  ?  ?");
  });

  it("never promotes the unreconciled org field into the confidence-marked column", () => {
    const r: GeoRow = {
      ip: "1.1.1.1",
      version: 4,
      status: "ok",
      geo: { org: "Some Org" },
      resolution: {
        flags: { isHosting: false, isProxy: false, isMobile: false, sources: {} },
        providerCount: 1,
      },
    };
    expect(copyBlock([r])).not.toContain("Some Org");
  });

  it("suffixes raw geo values when nothing reconciled at all", () => {
    const r: GeoRow = {
      ip: "1.1.1.1",
      version: 4,
      status: "ok",
      geo: { countryCode: "US", asn: "AS13335", org: "Cloudflare" },
    };
    expect(copyBlock([r])).toContain("1.1.1.1  US?  AS13335?  Cloudflare?");
  });
});
