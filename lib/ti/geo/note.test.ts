import { describe, expect, it } from "vitest";
import type { GeoRow } from "../geo";
import type { Confidence, GeoResolution } from "../types";
import { analystNote, analystNoteLines, analystNotes } from "./note";

const noFlags = { isHosting: false, isProxy: false, isMobile: false, sources: {} };

/** An ok row whose resolution is spread over the given fields. */
function okRow(ip: string, res: Partial<GeoResolution>): GeoRow {
  return {
    ip,
    version: 4,
    status: "ok",
    geo: {},
    resolution: { flags: noFlags, providerCount: 2, ...res },
  };
}

function country(
  value: string,
  confidence: Confidence,
  sources: string[],
  alternatives?: { value: string; sources: string[] }[],
) {
  return {
    value,
    confidence,
    score: 1,
    agreement: 1,
    sources,
    ...(alternatives ? { alternatives } : {}),
  };
}

function field(value: string, confidence: Confidence, sources = ["ip-api"]) {
  return { value, confidence, score: 1, agreement: 1, sources };
}

describe("analystNotes location clause", () => {
  it("asserts a high-confidence country and names its providers", () => {
    const rows = [
      okRow("8.8.8.8", {
        country: country("United States", "high", ["ip-api", "ipinfo"]),
        countryCode: "US",
      }),
    ];
    expect(analystNotes(rows)[0]).toBe(
      "8.8.8.8 resolves to United States (US), per ip-api.com and IPinfo.",
    );
  });

  it("hedges the verb below high confidence", () => {
    const rows = [
      okRow("1.1.1.1", { country: country("Australia", "medium", ["ip-api"]), countryCode: "AU" }),
    ];
    expect(analystNotes(rows)[0]).toBe("1.1.1.1 is reported as Australia (AU), per ip-api.com.");
  });

  it("includes a corroborated city with its region", () => {
    const rows = [
      okRow("8.8.8.8", {
        country: country("United States", "high", ["ip-api"]),
        countryCode: "US",
        city: field("Ashburn", "medium"),
        region: field("Virginia", "medium"),
      }),
    ];
    expect(analystNotes(rows)[0]).toContain("resolves to Ashburn, Virginia, United States (US)");
  });

  it("drops a low-confidence city, so it cannot borrow the country's authority", () => {
    const rows = [
      okRow("1.1.1.1", {
        country: country("Australia", "high", ["ip-api"]),
        countryCode: "AU",
        city: field("Sydney", "low"),
        region: field("New South Wales", "low"),
      }),
    ];
    const note = analystNotes(rows)[0];
    expect(note).not.toContain("Sydney");
    expect(note).toContain("resolves to Australia (AU)");
  });

  it("drops a region that has no city", () => {
    const rows = [
      okRow("8.8.8.8", {
        country: country("United States", "high", ["ip-api"]),
        countryCode: "US",
        region: field("Virginia", "high"),
      }),
    ];
    expect(analystNotes(rows)[0]).not.toContain("Virginia");
  });
});

describe("analystNotes dissent clause", () => {
  it("names the dissenting provider and its value", () => {
    const rows = [
      okRow("1.1.1.1", {
        country: country("Australia", "medium", ["ip-api"], [
          { value: "United States", sources: ["ipinfo"] },
        ]),
        countryCode: "AU",
      }),
    ];
    expect(analystNotes(rows)[0]).toBe(
      "1.1.1.1 is reported as Australia (AU), per ip-api.com. " +
        "IPinfo places it in United States instead.",
    );
  });

  it("omits the clause when providers agreed", () => {
    const rows = [
      okRow("8.8.8.8", { country: country("United States", "high", ["ip-api"]), countryCode: "US" }),
    ];
    expect(analystNotes(rows)[0]).not.toContain("instead");
  });
});

describe("analystNotes unlocated rows", () => {
  it("states the lookup error", () => {
    const rows: GeoRow[] = [
      { ip: "203.0.113.7", version: 4, status: "error", error: "Lookup failed" },
    ];
    expect(analystNotes(rows)[0]).toBe("203.0.113.7 could not be geolocated: Lookup failed.");
  });

  it("defaults the reason when the row carries no error", () => {
    const rows: GeoRow[] = [{ ip: "203.0.113.7", version: 4, status: "error" }];
    expect(analystNotes(rows)[0]).toBe("203.0.113.7 could not be geolocated: Lookup failed.");
  });

  it("says so when an ok row resolved no country", () => {
    const rows = [okRow("203.0.113.7", {})];
    expect(analystNotes(rows)[0]).toBe("203.0.113.7 returned no country data.");
  });
});

describe("analystNoteLines", () => {
  it("prefixes each address with a bullet", () => {
    const rows = [
      okRow("8.8.8.8", { country: country("United States", "high", ["ip-api"]), countryCode: "US" }),
    ];
    expect(analystNoteLines(rows)).toEqual([
      "- 8.8.8.8 resolves to United States (US), per ip-api.com.",
    ]);
  });

  it("bullets an unlocated address too, so the list has no gaps", () => {
    const rows: GeoRow[] = [{ ip: "203.0.113.7", version: 4, status: "error" }];
    expect(analystNoteLines(rows)).toEqual([
      "- 203.0.113.7 could not be geolocated: Lookup failed.",
    ]);
  });
});

describe("analystNote", () => {
  it("emits one bulleted line per row, newline joined", () => {
    const rows: GeoRow[] = [
      okRow("8.8.8.8", { country: country("United States", "high", ["ip-api"]), countryCode: "US" }),
      { ip: "203.0.113.7", version: 4, status: "error", error: "Lookup failed" },
    ];
    expect(analystNotes(rows)).toHaveLength(2);
    expect(analystNote(rows)).toBe(
      "- 8.8.8.8 resolves to United States (US), per ip-api.com.\n" +
        "- 203.0.113.7 could not be geolocated: Lookup failed.",
    );
  });

  it("is exactly the rendered lines, joined", () => {
    const rows = [
      okRow("8.8.8.8", { country: country("United States", "high", ["ip-api"]), countryCode: "US" }),
      okRow("1.1.1.1", { country: country("Australia", "high", ["ip-api"]), countryCode: "AU" }),
    ];
    expect(analystNote(rows)).toBe(analystNoteLines(rows).join("\n"));
  });

  it("returns nothing for an empty batch", () => {
    expect(analystNotes([])).toEqual([]);
    expect(analystNoteLines([])).toEqual([]);
    expect(analystNote([])).toBe("");
  });
});

describe("analystNotes network clause", () => {
  it("canonicalizes the AS number, so the org appears exactly once", () => {
    const rows = [
      okRow("1.1.1.1", {
        country: country("Australia", "high", ["ip-api"]),
        countryCode: "AU",
        asn: field("AS13335 Cloudflare, Inc.", "high"),
        asnOrg: field("Cloudflare, Inc.", "high"),
      }),
    ];
    expect(analystNotes(rows)[0]).toContain("Announced by AS13335 (Cloudflare, Inc.).");
    expect(analystNotes(rows)[0]).not.toContain("AS13335 Cloudflare, Inc. (");
  });

  it("falls back from asnOrg to isp", () => {
    const rows = [
      okRow("9.9.9.9", {
        country: country("United States", "high", ["ip-api"]),
        countryCode: "US",
        asn: field("AS19281", "high"),
        isp: field("Quad9", "high"),
      }),
    ];
    expect(analystNotes(rows)[0]).toContain("Announced by AS19281 (Quad9).");
  });

  it("never prints the unreconciled org field", () => {
    const row: GeoRow = {
      ip: "1.1.1.1",
      version: 4,
      status: "ok",
      geo: { org: "Some Org" },
      resolution: {
        country: country("United States", "high", ["ip-api"]),
        countryCode: "US",
        asn: field("AS13335", "high"),
        flags: noFlags,
        providerCount: 1,
      },
    };
    expect(analystNotes([row])[0]).not.toContain("Some Org");
  });

  it("marks a single-sourced ASN", () => {
    const rows = [
      okRow("9.9.9.9", {
        country: country("United States", "high", ["ip-api"]),
        countryCode: "US",
        asn: field("AS19281", "low"),
        isp: field("Quad9", "high"),
      }),
    ];
    expect(analystNotes(rows)[0]).toContain("Announced by AS19281 (Quad9), single-sourced.");
  });

  it("omits the clause with no ASN", () => {
    const rows = [
      okRow("9.9.9.9", { country: country("United States", "high", ["ip-api"]), countryCode: "US" }),
    ];
    expect(analystNotes(rows)[0]).not.toContain("Announced by");
  });
});

describe("analystNotes PTR clause", () => {
  it("always attributes the PTR, because it never went through a vote", () => {
    const row: GeoRow = {
      ip: "8.8.8.8",
      version: 4,
      status: "ok",
      geo: { reverse: "dns.google" },
      resolution: {
        country: country("United States", "high", ["ip-api"]),
        countryCode: "US",
        flags: noFlags,
        providerCount: 1,
      },
    };
    expect(analystNotes([row])[0]).toContain("PTR is dns.google, per ip-api.com.");
  });

  it("omits the clause when there is no PTR", () => {
    const rows = [
      okRow("8.8.8.8", { country: country("United States", "high", ["ip-api"]), countryCode: "US" }),
    ];
    expect(analystNotes(rows)[0]).not.toContain("PTR");
  });
});

describe("analystNotes coordinates clause", () => {
  it("rounds to two decimals and hedges the verb", () => {
    const rows = [
      okRow("8.8.8.8", {
        country: country("United States", "high", ["ip-api"]),
        countryCode: "US",
        coordinates: {
          value: { lat: 39.0438, lon: -77.4874 },
          confidence: "high",
          score: 1,
          agreement: 1,
          sources: ["ip-api"],
        },
      }),
    ];
    expect(analystNotes(rows)[0]).toContain("Providers place it near 39.04, -77.49.");
  });

  it("omits the clause at low confidence, where the centroid is meaningless", () => {
    const rows = [
      okRow("8.8.8.8", {
        country: country("United States", "high", ["ip-api"]),
        countryCode: "US",
        coordinates: {
          value: { lat: 39.0438, lon: -77.4874 },
          confidence: "low",
          score: 0.2,
          agreement: 0.2,
          sources: ["ip-api", "ipinfo"],
        },
      }),
    ];
    expect(analystNotes(rows)[0]).not.toContain("place it near");
  });

  it("omits the clause for a non-finite centroid", () => {
    const rows = [
      okRow("8.8.8.8", {
        country: country("United States", "high", ["ip-api"]),
        countryCode: "US",
        coordinates: {
          value: { lat: Number.NaN, lon: 0 },
          confidence: "high",
          score: 1,
          agreement: 1,
          sources: ["ip-api"],
        },
      }),
    ];
    expect(analystNotes(rows)[0]).not.toContain("place it near");
  });
});

describe("analystNotes flags clause", () => {
  it("names one flag", () => {
    const rows = [
      okRow("8.8.8.8", {
        country: country("United States", "high", ["ip-api"]),
        countryCode: "US",
        flags: { isHosting: true, isProxy: false, isMobile: false, sources: {} },
      }),
    ];
    expect(analystNotes(rows)[0]).toContain("Flagged as hosting infrastructure.");
  });

  it("joins three flags with commas and a trailing and", () => {
    const rows = [
      okRow("8.8.8.8", {
        country: country("United States", "high", ["ip-api"]),
        countryCode: "US",
        flags: { isHosting: true, isProxy: true, isMobile: true, sources: {} },
      }),
    ];
    expect(analystNotes(rows)[0]).toContain(
      "Flagged as hosting infrastructure, a proxy or VPN exit and a mobile network.",
    );
  });

  it("omits the clause when no flag is set", () => {
    const rows = [
      okRow("8.8.8.8", { country: country("United States", "high", ["ip-api"]), countryCode: "US" }),
    ];
    expect(analystNotes(rows)[0]).not.toContain("Flagged");
  });
});
