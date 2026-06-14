import { describe, expect, it } from "vitest";
import type { Confidence, GeoResolution, ResolvedField } from "@/lib/ti/types";
import { buildVoteTable, providerLabel } from "@/lib/ti/geo/votes";

const FLAGS: GeoResolution["flags"] = {
  isHosting: false,
  isProxy: false,
  isMobile: false,
  sources: {},
};

function rf<T>(value: T, partial: Partial<ResolvedField<T>> = {}): ResolvedField<T> {
  return {
    value,
    confidence: "high" as Confidence,
    score: 1,
    agreement: 1,
    sources: [],
    ...partial,
  };
}

function res(partial: Partial<GeoResolution>): GeoResolution {
  return { flags: FLAGS, providerCount: 0, ...partial };
}

describe("buildVoteTable", () => {
  it("includes a column only for present fields", () => {
    const table = buildVoteTable(res({ country: rf("United States", { sources: ["ip-api"] }) }));
    expect(table).not.toBeNull();
    expect(table!.fields.map((f) => f.key)).toEqual(["country"]);
  });

  it("classifies win, dissent, and absent cells", () => {
    const table = buildVoteTable(
      res({
        country: rf("United States", {
          sources: ["ip-api", "ipinfo"],
          alternatives: [{ value: "Canada", sources: ["ipwhois"] }],
        }),
        asn: rf("AS15169", { sources: ["ip-api"] }),
      }),
    )!;
    const country = table.fields.find((f) => f.key === "country")!;
    expect(country.cells["ip-api"]).toEqual({ status: "win" });
    expect(country.cells["ipinfo"]).toEqual({ status: "win" });
    expect(country.cells["ipwhois"]).toEqual({ status: "dissent", value: "Canada" });
    const asn = table.fields.find((f) => f.key === "asn")!;
    expect(asn.cells["ipinfo"]).toEqual({ status: "absent" });
    expect(asn.cells["ipwhois"]).toEqual({ status: "absent" });
  });

  it("marks coordinates clustered (win) when not low", () => {
    const table = buildVoteTable(
      res({ coordinates: rf({ lat: 1, lon: 2 }, { confidence: "high", sources: ["ip-api", "ipinfo"] }) }),
    )!;
    const coords = table.fields.find((f) => f.key === "coordinates")!;
    expect(coords.winner).toBe("clustered");
    expect(coords.cells["ip-api"].status).toBe("win");
  });

  it("marks coordinates scattered when low", () => {
    const table = buildVoteTable(
      res({ coordinates: rf({ lat: 1, lon: 2 }, { confidence: "low", sources: ["ip-api", "ipinfo"] }) }),
    )!;
    const coords = table.fields.find((f) => f.key === "coordinates")!;
    expect(coords.winner).toBe("scattered");
    expect(coords.cells["ip-api"].status).toBe("scatter");
    expect(coords.backers).toEqual([]);
  });

  it("flags allocation authority for country (rdap-ip) and asn (ripestat)", () => {
    const table = buildVoteTable(
      res({
        country: rf("United States", { sources: ["ip-api", "rdap-ip"] }),
        asn: rf("AS15169", { sources: ["ripestat", "ip-api"] }),
      }),
    )!;
    const country = table.fields.find((f) => f.key === "country")!;
    expect(country.authorityId).toBe("rdap-ip");
    expect(country.cells["rdap-ip"]).toEqual({ status: "win", authority: true });
    expect(country.cells["ip-api"]).toEqual({ status: "win" });
    const asn = table.fields.find((f) => f.key === "asn")!;
    expect(asn.authorityId).toBe("ripestat");
    expect(asn.cells["ripestat"]).toEqual({ status: "win", authority: true });
  });

  it("has no authority when the authority provider is absent", () => {
    const country = buildVoteTable(res({ country: rf("US", { sources: ["ip-api"] }) }))!.fields[0];
    expect(country.authorityId).toBeUndefined();
    expect(country.cells["ip-api"].authority).toBeUndefined();
  });

  it("orders providers by PROVIDER_ORDER, unknowns last", () => {
    const table = buildVoteTable(
      res({
        country: rf("US", {
          sources: ["reverse-dns", "ip-api"],
          alternatives: [{ value: "CA", sources: ["zzz-unknown"] }],
        }),
      }),
    )!;
    expect(table.providers).toEqual(["ip-api", "reverse-dns", "zzz-unknown"]);
  });

  it("returns null when no located field is present", () => {
    expect(buildVoteTable(res({}))).toBeNull();
  });

  it("provides display labels with id fallback", () => {
    expect(providerLabel("ripestat")).toBe("RIPEstat");
    expect(providerLabel("ip-api")).toBe("ip-api");
  });
});
