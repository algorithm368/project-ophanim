import { describe, it, expect, vi, beforeEach } from "vitest";
import { peeringDbSource } from "@/lib/ti/sources/peeringdb";
import * as http from "@/lib/ti/http";

describe("peeringDbSource", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("resolves ASN then maps PeeringDB info_type to a network class", async () => {
    const getJson = vi.spyOn(http, "getJson");
    getJson.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { data: { asns: ["13335"] } },
      text: "",
    } as never); // RIPE network-info
    getJson.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { data: [{ name: "Cloudflare", info_type: "Content", info_traffic: "100+ Tbps" }] },
      text: "",
    } as never); // PeeringDB

    const f = await peeringDbSource.check("1.1.1.1", AbortSignal.timeout(1000));
    expect(f.status).toBe("ok");
    expect(f.details?.networkClass).toBe("Content");
    expect(f.details?.peeringName).toBe("Cloudflare");
    expect(f.details?.trafficLevel).toBe("100+ Tbps");
  });

  it("degrades to ok-with-no-details when the ASN cannot be resolved", async () => {
    vi.spyOn(http, "getJson").mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { data: { asns: [] } },
      text: "",
    } as never);

    const f = await peeringDbSource.check("192.0.2.1", AbortSignal.timeout(1000));
    expect(f.status).toBe("ok");
    expect(f.details?.networkClass).toBeUndefined();
  });

  it("returns an error finding (not a throw) on network failure", async () => {
    vi.spyOn(http, "getJson").mockRejectedValueOnce(new Error("boom"));

    const f = await peeringDbSource.check("1.1.1.1", AbortSignal.timeout(1000));
    expect(f.status).toBe("error");
  });

  it("returns error when PeeringDB HTTP call fails with rate limit", async () => {
    const getJson = vi.spyOn(http, "getJson");
    getJson.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { data: { asns: ["13335"] } },
      text: "",
    } as never); // RIPE network-info
    getJson.mockResolvedValueOnce({
      ok: false,
      status: 429,
      data: undefined,
      text: "",
    } as never); // PeeringDB rate limit

    const f = await peeringDbSource.check("1.1.1.1", AbortSignal.timeout(1000));
    expect(f.status).toBe("error");
    expect(f.error).toBe("HTTP 429");
  });
});
