import { describe, expect, it } from "vitest";
import { canonicalAsn, haversineKm, normalizeKey } from "./geokit";

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
