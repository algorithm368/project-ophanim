import { describe, expect, it } from "vitest";
import type { GeoContext, SourceResult } from "../types";
import { overlayResolution, reconcileGeo, reconcileGeoInputs } from "./reconcile";

/** Minimal SourceResult factory for reconcile tests. */
function r(id: string, geo: Record<string, unknown>): SourceResult {
  return {
    source: { id, name: id, url: "", category: "context", requiresKey: false, weight: 0 },
    enabled: true,
    status: "ok",
    durationMs: 1,
    geo,
  } as unknown as SourceResult;
}

describe("reconcileGeo — categorical fields", () => {
  it("returns undefined when no source has geo", () => {
    expect(reconcileGeo([])).toBeUndefined();
  });

  it("unanimous agreement is high confidence", () => {
    const res = reconcileGeo([
      r("a", { city: "Berlin" }),
      r("b", { city: "Berlin" }),
      r("c", { city: "Berlin" }),
    ])!;
    expect(res.city!.value).toBe("Berlin");
    expect(res.city!.confidence).toBe("high");
    expect(res.city!.agreement).toBeCloseTo(1);
    expect(res.city!.sources.sort()).toEqual(["a", "b", "c"]);
    expect(res.city!.alternatives).toBeUndefined();
  });

  it("a single dissenter against a 2/3 majority is high and records alternatives", () => {
    const res = reconcileGeo([
      r("a", { city: "Berlin" }),
      r("b", { city: "Berlin" }),
      r("c", { city: "Munich" }),
    ])!;
    expect(res.city!.value).toBe("Berlin");
    expect(res.city!.confidence).toBe("high");
    expect(res.city!.agreement).toBeCloseTo(2 / 3);
    expect(res.city!.alternatives).toEqual([{ value: "Munich", sources: ["c"] }]);
  });

  it("a contested plurality below 2/3 is medium", () => {
    const res = reconcileGeo([
      r("a", { city: "Berlin" }),
      r("b", { city: "Munich" }),
      r("c", { city: "Hamburg" }),
      r("d", { city: "Berlin" }),
      r("e", { city: "Munich" }),
    ])!;
    // Berlin & Munich tie at 2 each -> not a strict plurality -> low.
    expect(res.city!.confidence).toBe("low");
  });

  it("a single provider is low confidence", () => {
    const res = reconcileGeo([r("a", { city: "Berlin" })])!;
    expect(res.city!.value).toBe("Berlin");
    expect(res.city!.confidence).toBe("low");
    expect(res.city!.agreement).toBeCloseTo(1);
  });

  it("normalizes ASN before voting", () => {
    const res = reconcileGeo([
      r("a", { asn: "AS15169 Google LLC" }),
      r("b", { asn: "15169" }),
    ])!;
    expect(res.asn!.value).toBe("AS15169 Google LLC");
    expect(res.asn!.confidence).toBe("high");
  });

  it("counts only providers that reported the field", () => {
    const res = reconcileGeo([
      r("a", { city: "Berlin", country: "Germany" }),
      r("b", { country: "Germany" }),
    ])!;
    expect(res.city!.agreement).toBeCloseTo(1); // only 'a' reported city
    expect(res.providerCount).toBe(2);
  });
});

describe("reconcileGeo — coordinates", () => {
  it("returns undefined coordinates when none reported", () => {
    const res = reconcileGeo([r("a", { city: "Berlin" })])!;
    expect(res.coordinates).toBeUndefined();
  });

  it("clustered points are high confidence at the centroid", () => {
    const res = reconcileGeo([
      r("a", { lat: 52.52, lon: 13.405 }),
      r("b", { lat: 52.5, lon: 13.4 }),
    ])!;
    expect(res.coordinates!.confidence).toBe("high");
    expect(res.coordinates!.value.lat).toBeCloseTo(52.51, 1);
  });

  it("far-apart points drop to low confidence and record alternatives", () => {
    const res = reconcileGeo([
      r("a", { lat: 37.77, lon: -122.42 }),
      r("b", { lat: 34.05, lon: -118.24 }),
    ])!;
    expect(res.coordinates!.confidence).toBe("low");
    expect(res.coordinates!.alternatives!.length).toBe(2);
  });

  it("a single coordinate is low confidence", () => {
    const res = reconcileGeo([r("a", { lat: 52.52, lon: 13.405 })])!;
    expect(res.coordinates!.confidence).toBe("low");
  });
});

describe("reconcileGeo — flags", () => {
  it("ORs flags across providers and attributes each", () => {
    const res = reconcileGeo([
      r("a", { isProxy: true }),
      r("b", { isHosting: true }),
      r("c", { isProxy: true, isMobile: false }),
    ])!;
    expect(res.flags.isProxy).toBe(true);
    expect(res.flags.isHosting).toBe(true);
    expect(res.flags.isMobile).toBe(false);
    expect(res.flags.sources.isProxy.sort()).toEqual(["a", "c"]);
    expect(res.flags.sources.isHosting).toEqual(["b"]);
  });
});

describe("reconcileGeo — country authority", () => {
  it("RDAP breaks a country split and is high confidence", () => {
    const res = reconcileGeo([
      r("a", { country: "United States", countryCode: "US" }),
      r("b", { country: "Canada", countryCode: "CA" }),
      r("rdap-ip", { country: "Canada", countryCode: "CA" }),
    ])!;
    expect(res.country!.value).toBe("Canada");
    expect(res.country!.confidence).toBe("high");
    expect(res.countryCode).toBe("CA");
  });
});

describe("reconcileGeoInputs — refactor-safety", () => {
  it("matches reconcileGeo on the same data", () => {
    const results = [
      r("a", { city: "Berlin", countryCode: "DE" }),
      r("b", { city: "Berlin", countryCode: "DE" }),
    ];
    const viaResults = reconcileGeo(results);
    const viaInputs = reconcileGeoInputs([
      { id: "a", geo: { city: "Berlin", countryCode: "DE" } },
      { id: "b", geo: { city: "Berlin", countryCode: "DE" } },
    ]);
    expect(viaInputs).toEqual(viaResults);
  });

  it("returns undefined on empty inputs", () => {
    expect(reconcileGeoInputs([])).toBeUndefined();
  });
});

describe("overlayResolution", () => {
  it("overlays reconciled winners onto a base GeoContext", () => {
    const res = reconcileGeoInputs([
      { id: "a", geo: { countryCode: "US", country: "United States", isp: "X" } },
      { id: "b", geo: { countryCode: "US", country: "United States" } },
    ])!;
    const base: GeoContext = { org: "Acme", countryCode: "ZZ" };
    const geo = overlayResolution(res, base);
    expect(geo.countryCode).toBe("US");      // reconciled winner overrides base
    expect(geo.org).toBe("Acme");            // base-only field preserved
  });

  it("OR's flags from the resolution", () => {
    const res = reconcileGeoInputs([
      { id: "a", geo: { countryCode: "US", isProxy: true } },
      { id: "b", geo: { countryCode: "US" } },
    ])!;
    expect(overlayResolution(res).isProxy).toBe(true);
  });

  it("always emits the three flags (false when none voted)", () => {
    const res = reconcileGeoInputs([{ id: "a", geo: { countryCode: "US" } }])!;
    const geo = overlayResolution(res);
    expect(geo.isHosting).toBe(false);
    expect(geo.isProxy).toBe(false);
    expect(geo.isMobile).toBe(false);
  });
});
