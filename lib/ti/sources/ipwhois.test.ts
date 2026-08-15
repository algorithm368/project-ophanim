import { afterEach, describe, expect, it, vi } from "vitest";
import { ipWhoIsSource, ipWhoIsToGeo, type IpWhoIsResponse } from "./ipwhois";
import { getJson } from "../http";

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

vi.mock("../http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../http")>();
  return { ...actual, getJson: vi.fn() };
});

// ipwho.is also reports failure in-band, with success:false and a message.
describe("ipWhoIsSource.check failure handling", () => {
  const mockGetJson = vi.mocked(getJson);
  afterEach(() => mockGetJson.mockReset());

  it("surfaces the API's own message when success is false", async () => {
    mockGetJson.mockResolvedValue({
      ok: true,
      status: 200,
      data: { success: false, message: "quota reached" },
    } as Awaited<ReturnType<typeof getJson>>);
    expect(await ipWhoIsSource.check("192.0.2.1", new AbortController().signal)).toEqual({
      status: "error",
      error: "quota reached",
    });
  });

  it("falls back to a generic message when the body is missing", async () => {
    mockGetJson.mockResolvedValue({ ok: true, status: 200, data: undefined } as Awaited<
      ReturnType<typeof getJson>
    >);
    expect(await ipWhoIsSource.check("192.0.2.1", new AbortController().signal)).toEqual({
      status: "error",
      error: "Lookup failed",
    });
  });
});
