import { describe, expect, it, vi } from "vitest";
import { fetchFreeIpApiGeo, fetchRdapCountries, selectUncertainIps, transposeByIp } from "./bulk";
import { getJson } from "../http";

vi.mock("../http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../http")>();
  return { ...actual, getJson: vi.fn() };
});

describe("transposeByIp", () => {
  it("collects each provider's GeoContext per IP, skipping gaps", () => {
    const perIp = transposeByIp(
      ["1.1.1.1", "8.8.8.8"],
      [
        { id: "ip-api", byIp: new Map([["1.1.1.1", { countryCode: "US" }], ["8.8.8.8", { countryCode: "US" }]]) },
        { id: "ipinfo", byIp: new Map([["1.1.1.1", { countryCode: "AU" }]]) },
      ],
    );
    expect(perIp.get("1.1.1.1")).toEqual([
      { id: "ip-api", geo: { countryCode: "US" } },
      { id: "ipinfo", geo: { countryCode: "AU" } },
    ]);
    expect(perIp.get("8.8.8.8")).toEqual([{ id: "ip-api", geo: { countryCode: "US" } }]);
  });
});

describe("selectUncertainIps", () => {
  it("flags disagreements and single-voter IPs, skips confident agreement", () => {
    const perIp = new Map([
      ["d", [{ id: "a", geo: { countryCode: "US" } }, { id: "b", geo: { countryCode: "AU" } }]],
      ["s", [{ id: "a", geo: { countryCode: "US" } }]],
      ["c", [{ id: "a", geo: { countryCode: "US" } }, { id: "b", geo: { countryCode: "US" } }]],
      ["z", [{ id: "a", geo: { city: "Nowhere" } }]],
    ]);
    const picked = selectUncertainIps(perIp, Infinity);
    expect(picked).toContain("d");
    expect(picked).toContain("s");
    expect(picked).toContain("z");
    expect(picked).not.toContain("c");
    expect(picked[0]).toBe("d");
  });

  it("enforces the max ceiling", () => {
    const perIp = new Map([
      ["a", [{ id: "x", geo: { countryCode: "US" } }]],
      ["b", [{ id: "x", geo: { countryCode: "US" } }]],
      ["c", [{ id: "x", geo: { countryCode: "US" } }]],
    ]);
    expect(selectUncertainIps(perIp, 2)).toHaveLength(2);
  });
});

describe("fetchRdapCountries", () => {
  it("propagates an abort/timeout instead of swallowing it", async () => {
    const abortErr = new DOMException("The operation was aborted", "AbortError");
    vi.mocked(getJson).mockRejectedValue(abortErr);
    await expect(
      fetchRdapCountries(["1.1.1.1"], new AbortController().signal, 2),
    ).rejects.toBe(abortErr);
  });

  it("degrades to an empty map on a real network error", async () => {
    vi.mocked(getJson).mockRejectedValue(new Error("ECONNRESET"));
    const out = await fetchRdapCountries(["1.1.1.1"], new AbortController().signal, 2);
    expect(out.size).toBe(0);
  });
});

describe("fetchFreeIpApiGeo", () => {
  it("maps freeipapi responses to GeoContext by IP", async () => {
    vi.mocked(getJson).mockResolvedValue({
      ok: true,
      data: {
        countryCode: "US",
        countryName: "United States",
        cityName: "Ashburn",
        latitude: 39.0,
        longitude: -77.5,
        asn: "14618",
        asnOrganization: "Amazon",
      },
    } as never);
    const out = await fetchFreeIpApiGeo(["1.2.3.4"], new AbortController().signal, 2);
    expect(out.get("1.2.3.4")?.city).toBe("Ashburn");
    expect(out.get("1.2.3.4")?.asn).toBe("AS14618");
  });

  it("propagates an abort/timeout instead of swallowing it", async () => {
    const abortErr = new DOMException("The operation was aborted", "AbortError");
    vi.mocked(getJson).mockRejectedValue(abortErr);
    await expect(
      fetchFreeIpApiGeo(["1.1.1.1"], new AbortController().signal, 2),
    ).rejects.toBe(abortErr);
  });

  it("degrades to an empty map on a real network error", async () => {
    vi.mocked(getJson).mockRejectedValue(new Error("ECONNRESET"));
    const out = await fetchFreeIpApiGeo(["1.1.1.1"], new AbortController().signal, 2);
    expect(out.size).toBe(0);
  });
});
