import { describe, expect, it } from "vitest";
import { ipApiToGeo, type IpApiResponse } from "./ipapi";

describe("ipApiToGeo", () => {
  it("maps an ip-api success payload to GeoContext", () => {
    const data: IpApiResponse = {
      status: "success",
      country: "United States",
      countryCode: "US",
      regionName: "California",
      city: "Mountain View",
      lat: 37.4,
      lon: -122.07,
      isp: "Google LLC",
      org: "Google Public DNS",
      as: "AS15169 Google LLC",
      asname: "GOOGLE",
      reverse: "dns.google",
      hosting: true,
      proxy: false,
      mobile: false,
    };
    expect(ipApiToGeo(data)).toEqual({
      country: "United States",
      countryCode: "US",
      region: "California",
      city: "Mountain View",
      lat: 37.4,
      lon: -122.07,
      asn: "AS15169 Google LLC",
      asnOrg: "GOOGLE",
      isp: "Google LLC",
      org: "Google Public DNS",
      reverse: "dns.google",
      isHosting: true,
      isProxy: false,
      isMobile: false,
    });
  });
});
