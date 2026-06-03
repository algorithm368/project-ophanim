import { describe, expect, it } from "vitest";
import { ipWhoIsToGeo, type IpWhoIsResponse } from "./ipwhois";

describe("ipWhoIsToGeo", () => {
  it("maps an ipwho.is success payload to GeoContext", () => {
    const data: IpWhoIsResponse = {
      success: true,
      country: "Germany",
      country_code: "DE",
      region: "Berlin",
      city: "Berlin",
      latitude: 52.52,
      longitude: 13.405,
      connection: { asn: 3320, org: "Deutsche Telekom AG", isp: "Telekom" },
    };
    expect(ipWhoIsToGeo(data)).toEqual({
      country: "Germany",
      countryCode: "DE",
      region: "Berlin",
      city: "Berlin",
      lat: 52.52,
      lon: 13.405,
      asn: "AS3320",
      asnOrg: "Deutsche Telekom AG",
      isp: "Telekom",
    });
  });
});
