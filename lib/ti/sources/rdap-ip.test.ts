import { describe, expect, it } from "vitest";
import { rdapIpToGeo, type RdapIpResponse } from "./rdap-ip";

describe("rdapIpToGeo", () => {
  it("maps allocation country and network name", () => {
    const data: RdapIpResponse = {
      country: "CA",
      name: "SHAW-COMMUNICATIONS",
      startAddress: "24.64.0.0",
    };
    expect(rdapIpToGeo(data)).toEqual({
      countryCode: "CA",
      asnOrg: "SHAW-COMMUNICATIONS",
    });
  });

  it("omits country when absent", () => {
    expect(rdapIpToGeo({ name: "EXAMPLE-NET" })).toEqual({
      asnOrg: "EXAMPLE-NET",
    });
  });
});
