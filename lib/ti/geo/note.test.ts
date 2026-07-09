import { describe, expect, it } from "vitest";
import type { GeoRow } from "../geo";
import type { Confidence, GeoResolution } from "../types";
import { analystNote, analystNotes } from "./note";

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

describe("analystNote", () => {
  it("emits one paragraph per row, blank-line joined", () => {
    const rows: GeoRow[] = [
      okRow("8.8.8.8", { country: country("United States", "high", ["ip-api"]), countryCode: "US" }),
      { ip: "203.0.113.7", version: 4, status: "error", error: "Lookup failed" },
    ];
    expect(analystNotes(rows)).toHaveLength(2);
    expect(analystNote(rows)).toBe(
      "8.8.8.8 resolves to United States (US), per ip-api.com.\n\n" +
        "203.0.113.7 could not be geolocated: Lookup failed.",
    );
  });

  it("returns nothing for an empty batch", () => {
    expect(analystNotes([])).toEqual([]);
    expect(analystNote([])).toBe("");
  });
});
