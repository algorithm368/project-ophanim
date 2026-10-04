import { describe, expect, it } from "vitest";
import {
  canonicalAsn,
  countryKeyIndex,
  countryVoteKey,
  haversineKm,
  normalizeKey,
} from "./geokit";

describe("normalizeKey", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    expect(normalizeKey("  Mountain   View ")).toBe("mountain view");
  });
  it("returns empty string for nullish", () => {
    expect(normalizeKey(undefined)).toBe("");
    expect(normalizeKey("")).toBe("");
  });
});

describe("canonicalAsn", () => {
  it("extracts the AS number, dropping the org tail", () => {
    expect(canonicalAsn("AS15169 Google LLC")).toBe("AS15169");
  });
  it("normalizes a bare number", () => {
    expect(canonicalAsn("15169")).toBe("AS15169");
  });
  it("returns empty string when no number present", () => {
    expect(canonicalAsn("Google")).toBe("");
  });
});

describe("haversineKm", () => {
  it("is ~0 for identical points", () => {
    expect(haversineKm({ lat: 37.4, lon: -122 }, { lat: 37.4, lon: -122 })).toBeCloseTo(0, 5);
  });
  it("computes a known distance (SF -> LA ~559km)", () => {
    const d = haversineKm({ lat: 37.7749, lon: -122.4194 }, { lat: 34.0522, lon: -118.2437 });
    expect(d).toBeGreaterThan(540);
    expect(d).toBeLessThan(580);
  });
});

describe("countryKeyIndex", () => {
  it("learns name -> code from an entry carrying both", () => {
    const index = countryKeyIndex([{ code: "AU", name: "Australia" }]);
    expect(index.get("australia")).toBe("AU");
  });

  it("seeds the canonical English name for a code-only entry", () => {
    const index = countryKeyIndex([{ code: "US" }]);
    expect(index.get("united states")).toBe("US");
  });

  it("ignores entries with no code", () => {
    const index = countryKeyIndex([{ name: "Atlantis" }]);
    expect(index.size).toBe(0);
  });
});

describe("countryVoteKey", () => {
  it("prefers the provider's own code, uppercased", () => {
    const index = new Map<string, string>();
    expect(countryVoteKey({ countryCode: "us", country: "Anything" }, index)).toBe("US");
  });

  it("maps a name-only vote onto a learned code", () => {
    const index = countryKeyIndex([{ code: "US", name: "United States" }]);
    expect(countryVoteKey({ country: "united  states" }, index)).toBe("US");
  });

  it("keys an unlearnable name on itself, so it stays a separate candidate", () => {
    const index = countryKeyIndex([{ code: "US", name: "United States" }]);
    expect(countryVoteKey({ country: "Atlantis" }, index)).toBe("atlantis");
  });

  it("returns empty string when neither code nor name is present", () => {
    expect(countryVoteKey({}, new Map())).toBe("");
  });
});

describe("countryKeyIndex — codes the runtime cannot name", () => {
  it("learns nothing from an unassigned or malformed code", () => {
    expect([...countryKeyIndex([{ code: "AA" }]).keys()]).toEqual([]);
    expect([...countryKeyIndex([{ code: "1" }]).keys()]).toEqual([]);
  });
});
