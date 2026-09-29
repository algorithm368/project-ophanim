import { describe, expect, it } from "vitest";
import type { GeoRow } from "../geo";
import type { GeoContext } from "../types";
import {
  anchorNote,
  distanceBands,
  medianKm,
  distancesFrom,
  formatKm,
  pointOf,
  sitesOf,
  spreadNote,
  spreadOf,
} from "./distance";

const at = (ip: string, geo: GeoContext): GeoRow => ({
  ip,
  version: 4,
  status: "ok",
  geo,
});

const FRA = { lat: 50.11, lon: 8.68, city: "Frankfurt", country: "Germany" };
const AMS = { lat: 52.37, lon: 4.9, city: "Amsterdam", country: "Netherlands" };
const SYD = { lat: -33.87, lon: 151.21, city: "Sydney", country: "Australia" };
const US = { lat: 37.75, lon: -97.82, country: "United States" };

const f1 = at("1.1.1.1", FRA);
const f2 = at("1.1.1.2", FRA);
const a1 = at("2.2.2.2", AMS);
const s1 = at("3.3.3.3", SYD);
const u1 = at("4.4.4.4", US);
const dead: GeoRow = { ip: "5.5.5.5", version: 4, status: "error" };

describe("pointOf", () => {
  it("reads city precision when a city resolved, country otherwise", () => {
    expect(pointOf(f1)).toMatchObject({ precision: "city", label: "Frankfurt, Germany" });
    expect(pointOf(u1)).toMatchObject({ precision: "country", label: "United States" });
  });

  it("prefers the reconciled coordinates", () => {
    const row: GeoRow = {
      ...f1,
      resolution: {
        coordinates: { value: { lat: 1, lon: 2 }, confidence: "high", score: 1, agreement: 1, sources: [] },
        flags: {},
        providerCount: 2,
      } as unknown as GeoRow["resolution"],
    };
    expect(pointOf(row)).toMatchObject({ lat: 1, lon: 2 });
  });

  it("refuses errors, missing coordinates and null island", () => {
    expect(pointOf(dead)).toBeUndefined();
    expect(pointOf(at("6.6.6.6", { country: "X" }))).toBeUndefined();
    expect(pointOf(at("6.6.6.6", { lat: 0, lon: 0 }))).toBeUndefined();
  });
});

describe("sitesOf", () => {
  it("merges one place into one site, busiest first", () => {
    const sites = sitesOf([a1, f1, f2, dead]);
    expect(sites.map((s) => s.ips)).toEqual([["1.1.1.1", "1.1.1.2"], ["2.2.2.2"]]);
  });
});

describe("distancesFrom", () => {
  it("measures every located row, the anchor at zero", () => {
    const d = distancesFrom("1.1.1.1", [f1, a1, s1, dead]);
    expect(d.get("1.1.1.1")).toBe(0);
    expect(d.get("2.2.2.2")).toBeGreaterThan(350);
    expect(d.get("2.2.2.2")).toBeLessThan(400);
    expect(d.has("5.5.5.5")).toBe(false);
  });

  it("is empty for an anchor with no position", () => {
    expect(distancesFrom("5.5.5.5", [f1, dead]).size).toBe(0);
  });
});

describe("formatKm", () => {
  it("groups thousands and names a shared site", () => {
    expect(formatKm(16480.4)).toBe("16,480 km");
    expect(formatKm(0.2)).toBe("under 1 km");
  });
});

describe("spreadOf / spreadNote", () => {
  it("finds the cluster and names the outlier", () => {
    const s = spreadOf([f1, f2, a1, s1, dead]);
    expect(s).toMatchObject({ total: 5, located: 4, approx: 0 });
    expect(s.hub).toEqual({ label: "Frankfurt, Germany", within: 3 });
    expect(s.outliers.map((o) => o.ip)).toEqual(["3.3.3.3"]);
    const note = spreadNote(s);
    expect(note).toMatch(/^3 of 4 located addresses sit within 500 km of Frankfurt, Germany\./);
    expect(note).toContain("The outlier: 3.3.3.3 in Sydney, Australia (16,");
  });

  it("says when everything is close", () => {
    expect(spreadNote(spreadOf([f1, f2, a1]))).toMatch(
      /^All 3 addresses sit within 500 km of Frankfurt, Germany, at most 3\d\d km apart\.$/,
    );
    expect(spreadNote(spreadOf([f1, a1, dead]))).toMatch(/^All 2 located addresses sit/);
  });

  it("says when nothing is close, and flags country-level positions", () => {
    const note = spreadNote(spreadOf([f1, s1, u1]));
    expect(note).toMatch(/^The 3 located addresses are dispersed/);
    expect(note).toContain("1 position is only country level, so distances to it are approximate.");
  });

  it("handles one or no located address", () => {
    expect(spreadNote(spreadOf([dead]))).toBe("");
    expect(spreadNote(spreadOf([f1, dead]))).toBe(
      "Only 1 of 2 addresses could be placed, in Frankfurt, Germany.",
    );
  });

  it("names five outliers then counts the rest", () => {
    const far = Array.from({ length: 7 }, (_, i) => at(`9.9.9.${i}`, SYD));
    const s = spreadOf([f1, f2, at("1.1.1.3", FRA), ...far]);
    expect(s.hub?.label).toBe("Sydney, Australia"); // the larger cluster wins
    expect(s.outliers).toHaveLength(3);
    const s2 = spreadOf([...Array.from({ length: 8 }, (_, i) => at(`1.0.0.${i}`, FRA)), ...far]);
    expect(spreadNote(s2)).toContain("; 2 more.");
  });
});

describe("anchorNote", () => {
  it("names the nearest and farthest", () => {
    const all = [f1, a1, s1];
    const note = anchorNote("1.1.1.1", all, distancesFrom("1.1.1.1", all));
    expect(note).toMatch(/^Measuring from 1\.1\.1\.1 in Frankfurt, Germany\. Nearest is 2\.2\.2\.2/);
    expect(note).toContain("Farthest is 3.3.3.3 in Sydney, Australia");
  });

  it("covers the degenerate cases", () => {
    expect(anchorNote("5.5.5.5", [dead], new Map())).toContain("nothing to measure from");
    expect(anchorNote("1.1.1.1", [f1], distancesFrom("1.1.1.1", [f1]))).toContain(
      "No other address has a position.",
    );
    const pair = [f1, a1];
    expect(anchorNote("1.1.1.1", pair, distancesFrom("1.1.1.1", pair))).not.toContain("Farthest");
  });
});

describe("distanceBands / medianKm", () => {
  const d = new Map([
    ["anchor", 0],
    ["a", 100],
    ["b", 499.9],
    ["c", 500],
    ["d", 4999],
    ["e", 16000],
  ]);

  it("bands the others, leaving the anchor out", () => {
    expect(distanceBands("anchor", d).map((b) => b.count)).toEqual([2, 1, 1, 1]);
  });

  it("takes the median of the others", () => {
    expect(medianKm("anchor", d)).toBe(500);
    expect(medianKm("anchor", new Map([["anchor", 0], ["a", 10], ["b", 30]]))).toBe(20);
    expect(medianKm("anchor", new Map([["anchor", 0]]))).toBeUndefined();
  });
});
