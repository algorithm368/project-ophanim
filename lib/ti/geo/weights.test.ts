import { describe, expect, it } from "vitest";
import { authorityFor, getWeight } from "./weights";

describe("getWeight", () => {
  it("returns the per-field weight for a known provider", () => {
    expect(getWeight("rdap-ip", "country")).toBe(1.0);
    expect(getWeight("ripestat", "asn")).toBe(1.0);
    expect(getWeight("reverse-dns", "city")).toBe(0.2);
  });

  it("falls back to the default weight for unknown providers or fields", () => {
    expect(getWeight("nope", "city")).toBe(0.5);
    expect(getWeight("rdap-ip", "city")).toBe(0.5); // rdap has no city entry
  });
});

describe("authorityFor", () => {
  it("names the allocation-authoritative provider per field", () => {
    // Country is decided by weighted plurality, not a forced authority: RDAP's
    // allocation country can diverge from the geolocation consensus.
    expect(authorityFor("country")).toBeUndefined();
    expect(authorityFor("asn")).toBe("ripestat");
    expect(authorityFor("city")).toBeUndefined();
  });
});
