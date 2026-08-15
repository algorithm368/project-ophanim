import { afterEach, describe, expect, it, vi } from "vitest";
import { ipApiSource, ipApiToGeo, type IpApiResponse } from "./ipapi";
import { getJson } from "../http";

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

vi.mock("../http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../http")>();
  return { ...actual, getJson: vi.fn() };
});

// The failure branch: ip-api answers 200 with {"status":"fail"} rather than an
// HTTP error, so this guard is the only thing standing between a failed lookup
// and a GeoContext full of undefined.
describe("ipApiSource.check failure handling", () => {
  const mockGetJson = vi.mocked(getJson);
  afterEach(() => mockGetJson.mockReset());

  it("surfaces the API's own message when status is not success", async () => {
    mockGetJson.mockResolvedValue({
      ok: true,
      status: 200,
      data: { status: "fail", message: "reserved range" },
    } as Awaited<ReturnType<typeof getJson>>);
    expect(await ipApiSource.check("192.0.2.1", new AbortController().signal)).toEqual({
      status: "error",
      error: "reserved range",
    });
  });

  it("falls back to a generic message when the body is missing", async () => {
    mockGetJson.mockResolvedValue({ ok: true, status: 200, data: undefined } as Awaited<
      ReturnType<typeof getJson>
    >);
    expect(await ipApiSource.check("192.0.2.1", new AbortController().signal)).toEqual({
      status: "error",
      error: "Lookup failed",
    });
  });
});
