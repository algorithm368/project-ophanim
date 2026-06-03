import { describe, expect, it } from "vitest";
import { ipGeolocationToGeo, type IpGeolocationResponse } from "./ipgeolocation";

describe("ipGeolocationToGeo", () => {
  it("maps fields and parses string coordinates", () => {
    const data: IpGeolocationResponse = {
      country_name: "United States",
      country_code2: "US",
      state_prov: "California",
      city: "Mountain View",
      latitude: "37.40599",
      longitude: "-122.07840",
      isp: "Google LLC",
      organization: "Google LLC",
      asn: "AS15169",
    };
    expect(ipGeolocationToGeo(data)).toEqual({
      country: "United States",
      countryCode: "US",
      region: "California",
      city: "Mountain View",
      lat: 37.40599,
      lon: -122.0784,
      isp: "Google LLC",
      asnOrg: "Google LLC",
      asn: "AS15169",
    });
  });
});
