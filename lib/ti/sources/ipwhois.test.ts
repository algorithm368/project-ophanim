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

describe("ipWhoIsSource.check success", () => {
  const signal = new AbortController().signal;
  afterEach(() => vi.mocked(getJson).mockReset());

  it("needs no key", () => expect(ipWhoIsSource.isEnabled()).toBe(true));

  it("returns geo with a place summary", async () => {
    vi.mocked(getJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: { success: true, city: "Lyon", country: "France" },
      text: "",
    });
    const f = await ipWhoIsSource.check("1.2.3.4", signal);
    expect(f.status).toBe("ok");
    expect(f.summary).toBe("Lyon, France");
  });

  it("maps timeouts and errors", async () => {
    vi.mocked(getJson).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await ipWhoIsSource.check("1.2.3.4", signal)).status).toBe("timeout");
    vi.mocked(getJson).mockRejectedValue(new Error("boom"));
    expect((await ipWhoIsSource.check("1.2.3.4", signal)).error).toBe("boom");
  });
});
