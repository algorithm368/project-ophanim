import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bulkRdapMax,
  fetchFreeIpApiGeo,
  fetchRdapCountries,
  selectUncertainIps,
  transposeByIp,
} from "./bulk";
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

  it("does not flag a code-only and name-only vote for the same country", () => {
    const perIp = new Map([
      [
        "a",
        [
          { id: "rdap-ip", geo: { countryCode: "US" } },
          { id: "freeipapi", geo: { country: "United States" } },
        ],
      ],
    ]);
    expect(selectUncertainIps(perIp, Infinity)).not.toContain("a");
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

// intEnv backs all four of these knobs and is the line the Number.NaN fix
// touched, so the fallback path needs to be exercised, not just the happy one.
describe("bulk limits from the environment", () => {
  const KEY = "BULK_RDAP_MAX";
  const original = process.env[KEY];
  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it("reads a valid override", () => {
    process.env[KEY] = "7";
    expect(bulkRdapMax()).toBe(7);
  });

  it("falls back when unset, non-numeric or negative", () => {
    delete process.env[KEY];
    expect(bulkRdapMax()).toBe(25);
    process.env[KEY] = "not-a-number";
    expect(bulkRdapMax()).toBe(25);
    process.env[KEY] = "-3";
    expect(bulkRdapMax()).toBe(25);
  });

  it("accepts zero as a real value rather than a fallback", () => {
    process.env[KEY] = "0";
    expect(bulkRdapMax()).toBe(0);
  });
});

describe("fetchRdapCountries / fetchFreeIpApiGeo — answers", () => {
  const signal = new AbortController().signal;
  afterEach(() => vi.mocked(getJson).mockReset());

  it("does nothing for no IPs", async () => {
    expect((await fetchRdapCountries([], signal, 2)).size).toBe(0);
    expect((await fetchFreeIpApiGeo([], signal, 2)).size).toBe(0);
    expect(getJson).not.toHaveBeenCalled();
  });

  it("keeps an RDAP allocation only when it names a country", async () => {
    vi.mocked(getJson).mockImplementation(async (url: string) => {
      if (url.endsWith("1.1.1.1")) return { ok: true, status: 200, text: "", data: { country: "AU" } };
      if (url.endsWith("2.2.2.2")) return { ok: true, status: 200, text: "", data: { name: "NET" } };
      return { ok: false, status: 404, text: "", data: null };
    });
    const out = await fetchRdapCountries(["1.1.1.1", "2.2.2.2", "3.3.3.3"], signal, 2);
    expect([...out.keys()]).toEqual(["1.1.1.1"]);
  });

  it("drops a freeipapi answer that names no country", async () => {
    vi.mocked(getJson).mockImplementation(async (url: string) =>
      url.endsWith("1.1.1.1")
        ? { ok: true, status: 200, text: "", data: { countryName: "Australia" } }
        : { ok: true, status: 200, text: "", data: { cityName: "Nowhere" } },
    );
    const out = await fetchFreeIpApiGeo(["1.1.1.1", "2.2.2.2"], signal, 2);
    expect([...out.keys()]).toEqual(["1.1.1.1"]);
    vi.mocked(getJson).mockResolvedValue({ ok: false, status: 500, text: "", data: null });
    expect((await fetchFreeIpApiGeo(["1.1.1.1"], signal, 1)).size).toBe(0);
  });
});
