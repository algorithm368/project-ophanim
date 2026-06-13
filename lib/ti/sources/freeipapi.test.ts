import { describe, expect, it } from "vitest";
import { freeIpApiToGeo, type FreeIpApiResponse } from "./freeipapi";

describe("freeIpApiToGeo", () => {
  it("maps a freeipapi payload to GeoContext", () => {
    const data: FreeIpApiResponse = {
      countryName: "United States",
      countryCode: "US",
      regionName: "California",
      cityName: "Mountain View",
      latitude: 37.422,
      longitude: -122.085,
      asn: "15169",
      asnOrganization: "Google LLC",
      isProxy: false,
    };
    expect(freeIpApiToGeo(data)).toEqual({
      country: "United States",
      countryCode: "US",
      region: "California",
      city: "Mountain View",
      lat: 37.422,
      lon: -122.085,
      asn: "AS15169",
      asnOrg: "Google LLC",
      isProxy: undefined,
    });
  });

  it("drops null-island coordinates", () => {
    const geo = freeIpApiToGeo({ countryCode: "US", latitude: 0, longitude: 0 });
    expect(geo.lat).toBeUndefined();
    expect(geo.lon).toBeUndefined();
  });

  it("maps isProxy: true to geo.isProxy: true", () => {
    expect(freeIpApiToGeo({ countryCode: "US", isProxy: true }).isProxy).toBe(true);
  });
});
