import { describe, expect, it } from "vitest";
import type { AnyCheckResult, GeoResolution, ResolvedField } from "@/lib/ti/types";
import { railPlace } from "@/lib/ti/geo/rail-place";

function rf<T>(value: T): ResolvedField<T> {
  return { value, confidence: "high", score: 1, agreement: 1, sources: [] };
}

function res(partial: Partial<GeoResolution>): GeoResolution {
  return {
    flags: { isHosting: false, isProxy: false, isMobile: false, sources: {} },
    providerCount: 1,
    ...partial,
  };
}

const ip = (r: object) => ({ ip: "80.183.142.206", sources: [], ...r }) as unknown as AnyCheckResult;
const domain = (r: object) => ({ domain: "github.com", sources: [], ...r }) as unknown as AnyCheckResult;

describe("railPlace", () => {
  it("has nothing for a file", () => {
    expect(railPlace({ hash: "84c8", sources: [] } as unknown as AnyCheckResult)).toBeNull();
  });

  it("takes the reconciled point, with the city and code as its label", () => {
    const place = railPlace(
      ip({
        geoResolution: res({
          coordinates: rf({ lat: 46.4, lon: 13.02 }),
          city: rf("Tolmezzo"),
          countryCode: "IT",
        }),
      }),
    );
    expect(place).toEqual({ lat: 46.4, lon: 13.02, countryCode: "IT", label: "Tolmezzo, IT" });
  });

  it("falls back to an address's raw context when nothing was reconciled", () => {
    const place = railPlace(
      ip({ geo: { lat: 37.4, lon: -122.08, city: "Mountain View", countryCode: "US" } }),
    );
    expect(place).toEqual({
      lat: 37.4,
      lon: -122.08,
      countryCode: "US",
      label: "Mountain View, US",
    });
  });

  it("ignores a raw context with only half a point", () => {
    expect(railPlace(ip({ geo: { lat: 37.4 } }))).toBeNull();
  });

  it("places a domain with only a country by its code", () => {
    const place = railPlace(domain({ geoResolution: res({ countryCode: "SG", city: rf("Singapore") }) }));
    expect(place).toEqual({ countryCode: "SG", label: "Singapore, SG" });
  });

  it("leaves the label off when there is neither city nor country", () => {
    const place = railPlace(ip({ geoResolution: res({ coordinates: rf({ lat: 1, lon: 2 }) }) }));
    expect(place).toEqual({ lat: 1, lon: 2, countryCode: undefined, label: undefined });
  });

  it("has nothing when no provider placed it", () => {
    expect(railPlace(domain({}))).toBeNull();
    expect(railPlace(ip({ geo: {} }))).toBeNull();
  });
});
