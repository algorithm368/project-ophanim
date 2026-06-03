import { describe, expect, it } from "vitest";
import { ipInfoToGeo, type IpInfoResponse } from "./ipinfo";

describe("ipInfoToGeo", () => {
  it("parses loc and org into GeoContext fields", () => {
    const data: IpInfoResponse = {
      city: "Mountain View",
      region: "California",
      country: "US",
      loc: "37.4056,-122.0775",
      org: "AS15169 Google LLC",
      hostname: "dns.google",
    };
    expect(ipInfoToGeo(data)).toEqual({
      city: "Mountain View",
      region: "California",
      countryCode: "US",
      lat: 37.4056,
      lon: -122.0775,
      asn: "AS15169",
      asnOrg: "Google LLC",
      reverse: "dns.google",
    });
  });

  it("tolerates a missing loc", () => {
    expect(ipInfoToGeo({ country: "US", org: "AS15169 Google LLC" })).toEqual({
      countryCode: "US",
      asn: "AS15169",
      asnOrg: "Google LLC",
    });
  });
});
