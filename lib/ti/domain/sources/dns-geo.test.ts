import { afterEach, describe, expect, it, vi } from "vitest";
import { dnsGeoSource } from "./dns-geo";
import { dohQuery } from "../../dns/doh";
import { ipApiSource } from "../../sources/ipapi";
import { freeIpApiSource } from "../../sources/freeipapi";

vi.mock("../../dns/doh", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../dns/doh")>();
  return { ...actual, dohQuery: vi.fn() };
});

// Only ip-api and freeipapi are exercised for a normal geolocation; the other
// three are mocked disabled so a test only has to stub the providers it
// actually cares about.
vi.mock("../../sources/ipwhois", () => ({
  ipWhoIsSource: { meta: { id: "ipwhois" }, isEnabled: () => false, check: vi.fn() },
}));
vi.mock("../../sources/ipinfo", () => ({
  ipInfoSource: { meta: { id: "ipinfo" }, isEnabled: () => false, check: vi.fn() },
}));
vi.mock("../../sources/ipgeolocation", () => ({
  ipGeolocationSource: { meta: { id: "ipgeolocation" }, isEnabled: () => false, check: vi.fn() },
}));
vi.mock("../../sources/ipapi", () => ({
  ipApiSource: { meta: { id: "ip-api" }, isEnabled: () => true, check: vi.fn() },
}));
vi.mock("../../sources/freeipapi", () => ({
  freeIpApiSource: { meta: { id: "freeipapi" }, isEnabled: () => true, check: vi.fn() },
}));

const SIGNAL = new AbortController().signal;

/** Cloudflare/Google/AdGuard each answer the same single A record, so
 *  ipConsensus resolves to one consensus IP with no split. */
function mockUnanimousA(ip: string) {
  vi.mocked(dohQuery).mockResolvedValue({
    Status: 0,
    Answer: [{ type: 1, data: ip }],
  });
}

function mockGeo(source: { check: unknown }, geo: Record<string, unknown> | undefined) {
  vi.mocked(source.check as (ip: string, signal: AbortSignal) => Promise<unknown>).mockResolvedValue(
    geo ? { status: "ok", geo } : { status: "error", error: "boom" },
  );
}

describe("dnsGeoSource.check", () => {
  afterEach(() => {
    vi.mocked(dohQuery).mockReset();
    vi.mocked(ipApiSource.check).mockReset();
    vi.mocked(freeIpApiSource.check).mockReset();
  });

  it("pins the domain's origin from the consensus A record's geo", async () => {
    mockUnanimousA("142.250.4.101");
    mockGeo(ipApiSource, { country: "Singapore", countryCode: "SG", city: "Singapore" });
    mockGeo(freeIpApiSource, { country: "Singapore", countryCode: "SG", city: "Singapore" });

    const f = await dnsGeoSource.check("google.com", SIGNAL);
    expect(f.status).toBe("ok");
    expect(f.geoResolution?.country?.value).toBe("Singapore");
    expect(f.geoResolution?.countryCode).toBe("SG");
    expect(f.geoResolution?.country?.sources).toEqual(["142.250.4.101"]);
    expect(f.summary).toContain("Singapore");
    // IP confidence and Geo confidence must read the same consensus so the two
    // cards can never contradict each other: it comes from this one check(),
    // not from dnsSource's own separately-fetched resolverConsensus.
    expect(f.domainContext?.originResolverConsensus?.consensusIps).toEqual([
      "142.250.4.101",
    ]);
    expect(f.domainContext?.resolverConsensus).toBeUndefined();
  });

  it("reports no geoResolution when no resolver answers at all", async () => {
    vi.mocked(dohQuery).mockRejectedValue(new Error("network down"));
    const f = await dnsGeoSource.check("unreachable.example", SIGNAL);
    expect(f.status).toBe("ok");
    expect(f.geoResolution).toBeUndefined();
    expect(f.summary).toContain("No consensus");
    expect(f.domainContext?.originResolverConsensus?.respondingResolvers).toBe(0);
  });

  it("reports no geoResolution when every geo provider fails for the consensus IP", async () => {
    mockUnanimousA("142.250.4.101");
    mockGeo(ipApiSource, undefined);
    mockGeo(freeIpApiSource, undefined);

    const f = await dnsGeoSource.check("google.com", SIGNAL);
    expect(f.status).toBe("ok");
    expect(f.geoResolution).toBeUndefined();
    expect(f.summary).toContain("No provider located");
  });

  it("reports timeout rather than a false 'no consensus' when the signal aborts mid-flight", async () => {
    const controller = new AbortController();
    controller.abort();
    // Every resolver call fails the same way an aborted fetch would; without
    // the explicit aborted check this would read as a genuine empty result.
    vi.mocked(dohQuery).mockRejectedValue(
      new DOMException("The operation was aborted.", "TimeoutError"),
    );
    const f = await dnsGeoSource.check("slow.example", controller.signal);
    expect(f.status).toBe("timeout");
  });
});
