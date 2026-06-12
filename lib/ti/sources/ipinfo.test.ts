import { describe, expect, it } from "vitest";
import {
  ipInfoLiteToGeo,
  ipInfoToGeo,
  mapIpInfoBatch,
  type IpInfoResponse,
} from "./ipinfo";

describe("ipInfoLiteToGeo", () => {
  it("maps the Lite ASN + country fields to GeoContext", () => {
    expect(
      ipInfoLiteToGeo({
        ip: "8.8.8.8",
        asn: "AS15169",
        as_name: "Google LLC",
        as_domain: "google.com",
        country_code: "US",
        country: "United States",
      }),
    ).toEqual({
      countryCode: "US",
      country: "United States",
      asn: "AS15169",
      asnOrg: "Google LLC",
    });
  });

  it("tolerates a sparse response", () => {
    expect(ipInfoLiteToGeo({ country_code: "DE" })).toEqual({ countryCode: "DE" });
  });
});

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

describe("mapIpInfoBatch", () => {
  it("maps object entries by IP and skips missing/bogon/string entries", () => {
    const out = mapIpInfoBatch(["8.8.8.8", "1.1.1.1", "10.0.0.1", "9.9.9.9"], {
      "8.8.8.8": { city: "Mountain View", country: "US", org: "AS15169 Google LLC" },
      "1.1.1.1": "1.1.1.1", // ipinfo can echo a string for some entries
      "10.0.0.1": { bogon: true },
      // 9.9.9.9 absent entirely
    });
    expect(out.get("8.8.8.8")).toEqual({
      city: "Mountain View",
      countryCode: "US",
      asn: "AS15169",
      asnOrg: "Google LLC",
    });
    expect(out.has("1.1.1.1")).toBe(false);
    expect(out.has("10.0.0.1")).toBe(false);
    expect(out.has("9.9.9.9")).toBe(false);
  });
});
