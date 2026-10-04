import { afterEach, describe, expect, it, vi } from "vitest";
import { getJson, postJson } from "../http";
import {
  bulkIpInfo,
  ipInfoSource,
  ipInfoLiteToGeo,
  ipInfoToGeo,
  mapIpInfoBatch,
  type IpInfoResponse,
} from "./ipinfo";

vi.mock("../http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../http")>();
  return { ...actual, getJson: vi.fn(), postJson: vi.fn() };
});

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

describe("bulkIpInfo", () => {
  const signal = new AbortController().signal;
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(postJson).mockReset();
  });

  it("returns nothing without a token or without IPs", async () => {
    vi.stubEnv("IPINFO_TOKEN", "");
    expect((await bulkIpInfo(["1.1.1.1"], signal)).size).toBe(0);
    vi.stubEnv("IPINFO_TOKEN", "t");
    expect((await bulkIpInfo([], signal)).size).toBe(0);
    expect(postJson).not.toHaveBeenCalled();
  });

  it("maps a batch answer", async () => {
    vi.stubEnv("IPINFO_TOKEN", "t");
    vi.mocked(postJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: { "1.1.1.1": { country: "AU" } },
      text: "",
    });
    expect((await bulkIpInfo(["1.1.1.1"], signal)).get("1.1.1.1")).toEqual({
      countryCode: "AU",
    });
  });

  it("degrades to empty on a failed call or a real error, but rethrows timeouts", async () => {
    vi.stubEnv("IPINFO_TOKEN", "t");
    vi.mocked(postJson).mockResolvedValue({ ok: false, status: 429, data: null, text: "" });
    expect((await bulkIpInfo(["1.1.1.1"], signal)).size).toBe(0);
    vi.mocked(postJson).mockRejectedValue(new Error("boom"));
    expect((await bulkIpInfo(["1.1.1.1"], signal)).size).toBe(0);
    vi.mocked(postJson).mockRejectedValue(new DOMException("t", "TimeoutError"));
    await expect(bulkIpInfo(["1.1.1.1"], signal)).rejects.toThrow("t");
  });
});

describe("ipInfoSource.check", () => {
  const signal = new AbortController().signal;
  const reply = (data: unknown, ok = true) =>
    vi.mocked(getJson).mockResolvedValue({ ok, status: ok ? 200 : 403, data, text: "" });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(getJson).mockReset();
  });

  it("is skipped without a token", async () => {
    vi.stubEnv("IPINFO_TOKEN", "");
    expect(ipInfoSource.isEnabled()).toBe(false);
    expect(await ipInfoSource.check("1.1.1.1", signal)).toEqual({ status: "skipped" });
  });

  it("summarizes the network and country", async () => {
    vi.stubEnv("IPINFO_TOKEN", "t");
    expect(ipInfoSource.isEnabled()).toBe(true);
    reply({ asn: "AS13335", as_name: "Cloudflare", country: "Australia" });
    const f = await ipInfoSource.check("1.1.1.1", signal);
    expect(f.summary).toBe("Cloudflare · Australia");
    expect(f.geo?.asn).toBe("AS13335");
  });

  it("errors on a bogon or failed call, and maps thrown errors", async () => {
    vi.stubEnv("IPINFO_TOKEN", "t");
    reply({ bogon: true });
    expect((await ipInfoSource.check("10.0.0.1", signal)).error).toBe("HTTP 200");
    reply(null, false);
    expect((await ipInfoSource.check("1.1.1.1", signal)).error).toBe("HTTP 403");
    vi.mocked(getJson).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await ipInfoSource.check("1.1.1.1", signal)).status).toBe("timeout");
    vi.mocked(getJson).mockRejectedValue(new Error("boom"));
    expect((await ipInfoSource.check("1.1.1.1", signal)).error).toBe("boom");
  });
});

describe("ipInfoToGeo edge cases", () => {
  it("drops an unparseable loc and keeps an org without an ASN prefix whole", () => {
    expect(ipInfoToGeo({ loc: "north,east", org: "Some Org" })).toEqual({ asnOrg: "Some Org" });
    expect(ipInfoToGeo({})).toEqual({});
  });
});
