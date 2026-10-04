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

  it("returns rate_limited (not error) when PeeringDB HTTP call fails with rate limit", async () => {
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
    expect(f.status).toBe("rate_limited");
  });
});

describe("peeringDbSource edge paths", () => {
  beforeEach(() => vi.restoreAllMocks());
  const ok = (data: unknown, status = 200) =>
    ({ ok: status < 400, status, data, text: "" }) as never;
  const run = (...replies: unknown[]) => {
    const getJson = vi.spyOn(http, "getJson");
    for (const r of replies) getJson.mockResolvedValueOnce(r as never);
    return peeringDbSource.check("1.1.1.1", AbortSignal.timeout(1000));
  };

  it("needs no key", () => expect(peeringDbSource.isEnabled()).toBe(true));

  it("accepts numeric and object-shaped ASN entries", async () => {
    const getJson = vi.spyOn(http, "getJson");
    getJson.mockResolvedValueOnce(ok({ data: { asns: [{ asn: 64500 }] } }));
    getJson.mockResolvedValueOnce(ok({ data: [{ name: "Example" }] }));
    expect((await peeringDbSource.check("1.1.1.1", AbortSignal.timeout(1000))).summary).toBe(
      "Example",
    );
    expect(getJson.mock.calls[1][0]).toContain("asn=64500");
    getJson.mockResolvedValueOnce(ok({ data: { asns: [64501] } }));
    getJson.mockResolvedValueOnce(ok({ data: [{}] }));
    const f = await peeringDbSource.check("1.1.1.1", AbortSignal.timeout(1000));
    expect(f.summary).toBe("PeeringDB record");
    expect(f.details).toEqual({ networkClass: undefined, peeringName: undefined, trafficLevel: undefined });
  });

  it("finds no ASN in unusable RIPE answers", async () => {
    for (const ripe of [
      ok(null, 500),
      ok({}),
      ok({ data: { asns: [] } }),
      ok({ data: { asns: [{ asn: null }] } }),
      ok({ data: { asns: [{ name: "x" }] } }),
      ok({ data: { asns: [null] } }),
    ]) {
      vi.restoreAllMocks();
      expect((await run(ripe)).summary).toBe("No ASN to look up");
    }
  });

  it("reports an unregistered ASN and a failed PeeringDB call", async () => {
    expect((await run(ok({ data: { asns: ["1"] } }), ok({ data: [] }))).summary).toBe(
      "Not registered in PeeringDB",
    );
    vi.restoreAllMocks();
    expect((await run(ok({ data: { asns: ["1"] } }), ok(null, 500))).error).toBe("HTTP 500");
  });

  it("maps a timeout", async () => {
    vi.spyOn(http, "getJson").mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await peeringDbSource.check("1.1.1.1", AbortSignal.timeout(1000))).status).toBe(
      "timeout",
    );
  });
});
