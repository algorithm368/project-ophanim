import { describe, expect, it } from "vitest";
import type { GeoRow } from "../geo";
import type { GeoContext } from "../types";
import {
  compareIps,
  exportRecords,
  filterCounts,
  filterRows,
  ipSortKey,
  netTypesOf,
  networksOf,
  sortRows,
  toCsv,
} from "./table";

const ok = (ip: string, geo: GeoContext): GeoRow => ({
  ip,
  version: ip.includes(":") ? 6 : 4,
  status: "ok",
  geo,
});
const err = (ip: string): GeoRow => ({ ip, version: 4, status: "error", error: "x" });

const google = ok("8.8.8.8", {
  country: "United States",
  countryCode: "US",
  city: "Ashburn",
  asn: "AS15169 Google LLC",
  asnOrg: "Google LLC",
  isp: "Google LLC",
  reverse: "dns.google",
  isHosting: true,
});
const vpn = ok("10.0.0.10", {
  country: "Germany",
  countryCode: "DE",
  city: "Frankfurt",
  asn: "AS9009 M247",
  isp: "M247 Europe",
  isProxy: true,
  isHosting: true,
});
const phone = ok("10.0.0.9", {
  country: "Germany",
  countryCode: "DE",
  asn: "AS3320 Deutsche Telekom",
  isp: "Deutsche Telekom",
  isMobile: true,
});
const dead = err("1.2.3.4");
const rows = [google, vpn, phone, dead];

describe("netTypesOf", () => {
  it("lists every flag the row carries, none for an error row", () => {
    expect(netTypesOf(vpn)).toEqual(["hosting", "proxy/VPN"]);
    expect(netTypesOf(phone)).toEqual(["mobile"]);
    expect(netTypesOf(dead)).toEqual([]);
  });
});

describe("filterRows", () => {
  it("matches every term anywhere in the row", () => {
    expect(filterRows(rows, "germany telekom", new Set())).toEqual([phone]);
    expect(filterRows(rows, "dns.google", new Set())).toEqual([google]);
    expect(filterRows(rows, "as9009", new Set())).toEqual([vpn]);
  });

  it("ORs the chips together", () => {
    const hits = filterRows(rows, "", new Set(["mobile", "no data"] as const));
    expect(hits).toEqual([phone, dead]);
  });

  it("combines chips with text", () => {
    expect(filterRows(rows, "google", new Set(["proxy/VPN"] as const))).toEqual([]);
  });

  it("counts each chip", () => {
    expect(filterCounts(rows)).toEqual({
      hosting: 2,
      "proxy/VPN": 1,
      mobile: 1,
      "no data": 1,
    });
  });
});

describe("ipSortKey", () => {
  it("orders v4 numerically, then v6", () => {
    const sorted = ["10.0.0.10", "2001:db8::1", "10.0.0.9", "9.9.9.9"].sort(compareIps);
    expect(sorted).toEqual(["9.9.9.9", "10.0.0.9", "10.0.0.10", "2001:db8::1"]);
  });

  it("expands :: to the right number of zero hextets", () => {
    expect(ipSortKey("2001:db8::1")).toEqual([6, 0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]);
    expect(ipSortKey("::1")).toEqual([6, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(ipSortKey("fe80::")).toEqual([6, 0xfe80, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe("sortRows", () => {
  it("keeps the pasted order for input", () => {
    expect(sortRows(rows, "input", "asc")).toEqual(rows);
    expect(sortRows(rows, "input", "desc")).toEqual([...rows].reverse());
  });

  it("sorts IPs numerically", () => {
    expect(sortRows(rows, "ip", "asc").map((r) => r.ip)).toEqual([
      "1.2.3.4",
      "8.8.8.8",
      "10.0.0.9",
      "10.0.0.10",
    ]);
  });

  it("sinks missing values in both directions", () => {
    expect(sortRows(rows, "asn", "asc").map((r) => r.ip)).toEqual([
      "10.0.0.9",
      "10.0.0.10",
      "8.8.8.8",
      "1.2.3.4",
    ]);
    expect(sortRows(rows, "asn", "desc").at(-1)).toBe(dead);
    expect(sortRows(rows, "country", "desc").at(-1)).toBe(dead);
    expect(sortRows(rows, "org", "asc").map((r) => r.ip)).toEqual([
      "10.0.0.9",
      "8.8.8.8",
      "10.0.0.10",
      "1.2.3.4",
    ]);
  });

  it("sorts by distance, rows without one last", () => {
    const d = new Map([
      ["8.8.8.8", 6000],
      ["10.0.0.10", 0],
      ["10.0.0.9", 20],
    ]);
    expect(sortRows(rows, "distance", "asc", d).map((r) => r.ip)).toEqual([
      "10.0.0.10",
      "10.0.0.9",
      "8.8.8.8",
      "1.2.3.4",
    ]);
    expect(sortRows(rows, "distance", "desc", d)[0]).toBe(google);
  });
});

describe("networksOf", () => {
  it("groups by ASN, busiest first, unattributed last", () => {
    const second = ok("8.8.4.4", { ...google.geo, countryCode: "US" });
    const nets = networksOf([dead, vpn, google, second, phone]);
    expect(nets.map((n) => [n.asn, n.ips.length])).toEqual([
      ["AS15169", 2],
      ["AS3320", 1],
      ["AS9009", 1],
      ["", 1],
    ]);
    expect(nets[0]).toMatchObject({
      org: "Google LLC",
      countries: ["US"],
      types: ["hosting"],
    });
  });
});

describe("export", () => {
  it("builds flat records with the distance only when measuring", () => {
    const [plain] = exportRecords([google]);
    expect(plain).toMatchObject({
      ip: "8.8.8.8",
      asn: "AS15169",
      org: "Google LLC",
      reverse_dns: "dns.google",
      hosting: true,
    });
    expect(plain).not.toHaveProperty("distance_km");
    const [measured, none] = exportRecords([google, dead], new Map([["8.8.8.8", 12.6]]));
    expect(measured.distance_km).toBe(13);
    expect(none).toMatchObject({ status: "error", country: null, distance_km: null });
  });

  it("escapes CSV cells and defuses formulas", () => {
    const tricky = ok("5.5.5.5", { isp: '=HYPERLINK("x"), Inc' });
    const csv = toCsv(exportRecords([tricky]));
    const [header, line] = csv.trimEnd().split("\n");
    expect(header.startsWith("ip,version,status,")).toBe(true);
    expect(line).toContain(`"'=HYPERLINK(""x""), Inc"`);
    expect(toCsv([])).toBe("");
  });
});
