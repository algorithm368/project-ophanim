import { afterEach, describe, expect, it, vi } from "vitest";
import { bulkGeolocate } from "./geo";
import { postJson } from "./http";
import { bulkIpInfo } from "./sources/ipinfo";
import { fetchFreeIpApiGeo, fetchRdapCountries } from "./geo/bulk";
import { parseIP, type ParsedIP } from "@/lib/ip";

vi.mock("./http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./http")>();
  return { ...actual, postJson: vi.fn() };
});
vi.mock("./sources/ipinfo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sources/ipinfo")>();
  return { ...actual, bulkIpInfo: vi.fn() };
});
vi.mock("./geo/bulk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./geo/bulk")>();
  return { ...actual, fetchRdapCountries: vi.fn(), fetchFreeIpApiGeo: vi.fn() };
});

const ip = (s: string) => parseIP(s) as ParsedIP;
const signal = new AbortController().signal;

describe("bulkGeolocate, end to end over stubbed providers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.mocked(postJson).mockReset();
    vi.mocked(bulkIpInfo).mockReset();
    vi.mocked(fetchRdapCountries).mockReset();
    vi.mocked(fetchFreeIpApiGeo).mockReset();
  });

  it("returns nothing for nothing", async () => {
    expect(await bulkGeolocate([], signal)).toEqual([]);
    expect(postJson).not.toHaveBeenCalled();
  });

  it("reconciles agreeing providers and brings in RDAP and freeipapi for a split", async () => {
    vi.mocked(postJson).mockResolvedValue({
      ok: true,
      status: 200,
      text: "",
      data: [
        { status: "success", country: "Germany", countryCode: "DE" },
        { status: "success", country: "France", countryCode: "FR" },
      ],
    });
    vi.mocked(bulkIpInfo).mockResolvedValue(
      new Map([
        ["1.1.1.1", { countryCode: "DE" }],
        ["2.2.2.2", { countryCode: "US" }],
      ]),
    );
    vi.mocked(fetchRdapCountries).mockResolvedValue(new Map([["2.2.2.2", { countryCode: "FR" }]]));
    vi.mocked(fetchFreeIpApiGeo).mockResolvedValue(
      new Map([["2.2.2.2", { countryCode: "FR", country: "France" }]]),
    );
    const rows = await bulkGeolocate([ip("1.1.1.1"), ip("2.2.2.2")], signal);
    expect(rows.map((r) => [r.ip, r.status, r.geo?.countryCode])).toEqual([
      ["1.1.1.1", "ok", "DE"],
      ["2.2.2.2", "ok", "FR"],
    ]);
    expect(vi.mocked(fetchRdapCountries).mock.calls[0][0]).toEqual(["2.2.2.2"]);
  });

  it("keeps the error row when nothing resolved, and warns about capped fan-outs", async () => {
    vi.stubEnv("BULK_RDAP_MAX", "0");
    vi.stubEnv("BULK_GEO_FANOUT_MAX", "0");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(postJson).mockResolvedValue({ ok: false, status: 503, text: "", data: null });
    vi.mocked(bulkIpInfo).mockResolvedValue(new Map([["3.3.3.3", { countryCode: "JP" }]]));
    vi.mocked(fetchRdapCountries).mockResolvedValue(new Map());
    vi.mocked(fetchFreeIpApiGeo).mockResolvedValue(new Map());
    const rows = await bulkGeolocate([ip("3.3.3.3"), ip("4.4.4.4")], signal);
    expect(rows[1]).toMatchObject({ ip: "4.4.4.4", status: "error", error: "Lookup failed" });
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
