import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ipGeolocationSource,
  ipGeolocationToGeo,
  type IpGeolocationResponse,
} from "./ipgeolocation";
import { getJson } from "../http";

vi.mock("../http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../http")>();
  return { ...actual, getJson: vi.fn() };
});


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

describe("ipGeolocationSource.check", () => {
  const signal = new AbortController().signal;
  const reply = (data: unknown, ok = true) =>
    vi.mocked(getJson).mockResolvedValue({ ok, status: ok ? 200 : 401, data, text: "" });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(getJson).mockReset();
  });

  it("is skipped without a key", async () => {
    vi.stubEnv("IPGEOLOCATION_API_KEY", "");
    expect(ipGeolocationSource.isEnabled()).toBe(false);
    expect(await ipGeolocationSource.check("1.2.3.4", signal)).toEqual({ status: "skipped" });
  });

  it("returns geo with a place summary", async () => {
    vi.stubEnv("IPGEOLOCATION_API_KEY", "k");
    expect(ipGeolocationSource.isEnabled()).toBe(true);
    reply({ city: "Paris", country_name: "France" });
    const f = await ipGeolocationSource.check("1.2.3.4", signal);
    expect(f.summary).toBe("Paris, France");
    expect(f.geo).toEqual({ city: "Paris", country: "France" });
  });

  it("surfaces the API message, or the HTTP status without one", async () => {
    vi.stubEnv("IPGEOLOCATION_API_KEY", "k");
    reply({ message: "Invalid key" });
    expect((await ipGeolocationSource.check("1.2.3.4", signal)).error).toBe("Invalid key");
    reply(null, false);
    expect((await ipGeolocationSource.check("1.2.3.4", signal)).error).toBe("HTTP 401");
  });

  it("maps timeouts and errors", async () => {
    vi.stubEnv("IPGEOLOCATION_API_KEY", "k");
    vi.mocked(getJson).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await ipGeolocationSource.check("1.2.3.4", signal)).status).toBe("timeout");
    vi.mocked(getJson).mockRejectedValue(new Error("boom"));
    expect((await ipGeolocationSource.check("1.2.3.4", signal)).error).toBe("boom");
  });
});

describe("ipGeolocationToGeo sparse", () => {
  it("returns an empty geo for an empty payload", () => {
    expect(ipGeolocationToGeo({})).toEqual({});
  });
});
