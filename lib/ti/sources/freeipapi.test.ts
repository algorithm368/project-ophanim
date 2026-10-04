import { afterEach, describe, expect, it, vi } from "vitest";
import { freeIpApiSource, freeIpApiToGeo, type FreeIpApiResponse } from "./freeipapi";
import { getJson } from "../http";

vi.mock("../http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../http")>();
  return { ...actual, getJson: vi.fn() };
});

describe("freeIpApiToGeo", () => {
  it("maps a freeipapi payload to GeoContext", () => {
    const data: FreeIpApiResponse = {
      countryName: "United States",
      countryCode: "US",
      regionName: "California",
      cityName: "Mountain View",
      latitude: 37.422,
      longitude: -122.085,
      asn: "15169",
      asnOrganization: "Google LLC",
      isProxy: false,
    };
    expect(freeIpApiToGeo(data)).toEqual({
      country: "United States",
      countryCode: "US",
      region: "California",
      city: "Mountain View",
      lat: 37.422,
      lon: -122.085,
      asn: "AS15169",
      asnOrg: "Google LLC",
      isProxy: undefined,
    });
  });

  it("leaves every field undefined for an empty payload", () => {
    expect(Object.values(freeIpApiToGeo({})).every((v) => v === undefined)).toBe(true);
  });

  it("drops null-island coordinates", () => {
    const geo = freeIpApiToGeo({ countryCode: "US", latitude: 0, longitude: 0 });
    expect(geo.lat).toBeUndefined();
    expect(geo.lon).toBeUndefined();
  });

  it("maps isProxy: true to geo.isProxy: true", () => {
    expect(freeIpApiToGeo({ countryCode: "US", isProxy: true }).isProxy).toBe(true);
  });
});

describe("freeIpApiSource.check", () => {
  const signal = new AbortController().signal;
  const reply = (data: unknown, ok = true) =>
    vi.mocked(getJson).mockResolvedValue({ ok, status: ok ? 200 : 500, data, text: "" });
  afterEach(() => vi.mocked(getJson).mockReset());

  it("needs no key", () => expect(freeIpApiSource.isEnabled()).toBe(true));

  it("returns geo context with a place summary", async () => {
    reply({ countryName: "Germany", countryCode: "DE", cityName: "Berlin" });
    const f = await freeIpApiSource.check("1.2.3.4", signal);
    expect(f.status).toBe("ok");
    expect(f.summary).toBe("Berlin, Germany");
    expect(f.geo?.countryCode).toBe("DE");
  });

  it("leaves the summary empty when no place name is known", async () => {
    reply({ countryCode: "DE" });
    expect((await freeIpApiSource.check("1.2.3.4", signal)).summary).toBeUndefined();
  });

  it("fails on HTTP errors, empty bodies, and answers without a country", async () => {
    for (const [data, ok] of [
      [{ countryCode: "DE" }, false],
      [null, true],
      [{ cityName: "Nowhere" }, true],
    ] as const) {
      reply(data, ok);
      expect(await freeIpApiSource.check("1.2.3.4", signal)).toEqual({
        status: "error",
        error: "Lookup failed",
      });
    }
  });

  it("maps timeouts and errors", async () => {
    vi.mocked(getJson).mockRejectedValue(new DOMException("t", "AbortError"));
    expect((await freeIpApiSource.check("1.2.3.4", signal)).status).toBe("timeout");
    vi.mocked(getJson).mockRejectedValue(new Error("boom"));
    expect((await freeIpApiSource.check("1.2.3.4", signal)).error).toBe("boom");
  });
});
