/**
 * The bulk geolocation table as data: what kind of network each address sits
 * on, how the rows sort and filter, which networks the batch spans, and the
 * exported records. Rendered by `components/BulkGeoResults/`, kept pure here so
 * the sort order and the export columns are tested rather than eyeballed.
 */
import type { GeoRow } from "../geo";
import { canonicalAsn } from "./geokit";
import { countryCodeOf } from "./summary";

/** The network kinds ip-api flags. Its `proxy` flag covers proxies, VPNs and
 *  Tor exits without telling them apart, hence the combined label. */
export type NetType = "hosting" | "proxy/VPN" | "mobile";

/** A filter chip: one of the network kinds, or the rows with no answer. */
export type RowFilter = NetType | "no data";

export const ROW_FILTERS: readonly RowFilter[] = [
  "hosting",
  "proxy/VPN",
  "mobile",
  "no data",
];

export function netTypesOf(row: GeoRow): NetType[] {
  const g = row.geo;
  if (row.status !== "ok" || !g) return [];
  const types: NetType[] = [];
  if (g.isHosting) types.push("hosting");
  if (g.isProxy) types.push("proxy/VPN");
  if (g.isMobile) types.push("mobile");
  return types;
}

function matchesFilter(row: GeoRow, filter: RowFilter): boolean {
  if (filter === "no data") return row.status !== "ok";
  return netTypesOf(row).includes(filter);
}

/** How many rows each chip would keep, for the counts on the chips. */
export function filterCounts(rows: GeoRow[]): Record<RowFilter, number> {
  const out = { hosting: 0, "proxy/VPN": 0, mobile: 0, "no data": 0 };
  for (const row of rows) {
    for (const f of ROW_FILTERS) if (matchesFilter(row, f)) out[f]++;
  }
  return out;
}

/** Everything the text filter searches, lowercased. */
function haystack(row: GeoRow): string {
  const g = row.geo;
  return [
    row.ip,
    g?.country,
    countryCodeOf(row),
    g?.region,
    g?.city,
    g?.asn,
    canonicalAsn(g?.asn),
    g?.asnOrg,
    g?.isp,
    g?.org,
    g?.reverse,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * Rows matching the text (every whitespace-separated term, anywhere in the
 * row) and, when chips are on, at least one chip. Chips are OR'd: "hosting or
 * proxy/VPN" is the question an analyst asks, "both" almost never is.
 */
export function filterRows(
  rows: GeoRow[],
  text: string,
  chips: ReadonlySet<RowFilter>,
): GeoRow[] {
  const terms = text.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    if (chips.size && ![...chips].some((f) => matchesFilter(row, f))) {
      return false;
    }
    if (!terms.length) return true;
    const hay = haystack(row);
    return terms.every((t) => hay.includes(t));
  });
}

/** An address as a list of numbers that sorts it numerically: v4 before v6,
 *  then octet by octet (or hextet by hextet). String order puts 10.0.0.9 after
 *  10.0.0.10, which no analyst means. */
export function ipSortKey(ip: string): number[] {
  if (!ip.includes(":")) return [4, ...ip.split(".").map(Number)];
  const [head, tail = ""] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = ip.includes("::") && tail ? tail.split(":") : [];
  const fill = new Array<string>(8 - left.length - right.length).fill("0");
  const parts = ip.includes("::") ? [...left, ...fill, ...right] : left;
  return [6, ...parts.map((h) => Number.parseInt(h, 16))];
}

function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Numeric address order, for `Array.sort`. */
export const compareIps = (a: string, b: string): number =>
  compareKeys(ipSortKey(a), ipSortKey(b));

export type SortKey = "input" | "ip" | "country" | "asn" | "org" | "distance";
export type SortDir = "asc" | "desc";

const asnNumber = (row: GeoRow): number =>
  Number(canonicalAsn(row.geo?.asn).slice(2)) || Number.POSITIVE_INFINITY;

const orgOf = (row: GeoRow): string =>
  row.geo?.isp ?? row.geo?.org ?? row.geo?.asnOrg ?? "";

/** Text comparison that always sends the empty value last, whichever way. */
function compareText(a: string, b: string, sign: number): number {
  if (!a || !b) return Number(!a) - Number(!b);
  return sign * a.localeCompare(b);
}

function compareNumber(a: number, b: number, sign: number): number {
  const fa = Number.isFinite(a);
  const fb = Number.isFinite(b);
  if (!fa || !fb) return Number(!fa) - Number(!fb);
  return sign * (a - b);
}

/**
 * Rows sorted by `key`. Missing values sink to the bottom in both directions,
 * so reversing a column never puts twenty "no data" rows on top. Ties keep the
 * pasted order, and "input" is that order.
 */
export function sortRows(
  rows: GeoRow[],
  key: SortKey,
  dir: SortDir,
  distances?: ReadonlyMap<string, number>,
): GeoRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const order = new Map(rows.map((r, i) => [r.ip, i]));
  const cmp = (a: GeoRow, b: GeoRow): number => {
    switch (key) {
      case "ip":
        return sign * compareIps(a.ip, b.ip);
      case "country":
        return compareText(a.geo?.country ?? "", b.geo?.country ?? "", sign);
      case "asn":
        return compareNumber(asnNumber(a), asnNumber(b), sign);
      case "org":
        return compareText(orgOf(a), orgOf(b), sign);
      case "distance":
        return compareNumber(
          distances?.get(a.ip) ?? Number.NaN,
          distances?.get(b.ip) ?? Number.NaN,
          sign,
        );
      default:
        return sign * ((order.get(a.ip) ?? 0) - (order.get(b.ip) ?? 0));
    }
  };
  return [...rows].sort(
    (a, b) => cmp(a, b) || (order.get(a.ip) ?? 0) - (order.get(b.ip) ?? 0),
  );
}

/** One announcing network in the batch. */
export interface NetworkGroup {
  /** `AS15169`, or "" for the addresses no provider tied to a network. */
  asn: string;
  org: string;
  ips: string[];
  /** ISO codes the network's addresses resolved to, most common first. */
  countries: string[];
  types: NetType[];
}

/**
 * The batch grouped by ASN, busiest network first, the unattributed addresses
 * last. The org is whichever name the network's first row carried, because
 * providers spell one org several ways and picking one is better than listing
 * three.
 */
export function networksOf(rows: GeoRow[]): NetworkGroup[] {
  const groups = new Map<string, NetworkGroup & { tally: Map<string, number> }>();
  for (const row of rows) {
    const asn = row.status === "ok" ? canonicalAsn(row.geo?.asn) : "";
    let g = groups.get(asn);
    if (!g) {
      g = { asn, org: "", ips: [], countries: [], types: [], tally: new Map() };
      groups.set(asn, g);
    }
    g.org ||= row.geo?.asnOrg ?? orgOf(row);
    g.ips.push(row.ip);
    const code = countryCodeOf(row);
    if (code) g.tally.set(code, (g.tally.get(code) ?? 0) + 1);
    for (const t of netTypesOf(row)) if (!g.types.includes(t)) g.types.push(t);
  }
  return [...groups.values()]
    .map(({ tally, ...g }) => ({
      ...g,
      countries: [...tally].sort((a, b) => b[1] - a[1]).map(([c]) => c),
    }))
    .sort(
      (a, b) =>
        Number(!a.asn) - Number(!b.asn) ||
        b.ips.length - a.ips.length ||
        asnKey(a.asn) - asnKey(b.asn),
    );
}

const asnKey = (asn: string): number => Number(asn.slice(2)) || 0;

/** One exported row. Flat and string-or-number valued, so CSV and JSON carry
 *  exactly the same fields. */
export type ExportRecord = Record<string, string | number | boolean | null>;

export function exportRecords(
  rows: GeoRow[],
  distances?: ReadonlyMap<string, number>,
): ExportRecord[] {
  return rows.map((row) => {
    const g = row.status === "ok" ? row.geo : undefined;
    const record: ExportRecord = {
      ip: row.ip,
      version: row.version,
      status: row.status,
      country: g?.country ?? null,
      country_code: countryCodeOf(row) ?? null,
      region: g?.region ?? null,
      city: g?.city ?? null,
      lat: g?.lat ?? null,
      lon: g?.lon ?? null,
      asn: canonicalAsn(g?.asn) || null,
      org: g ? orgOf(row) || null : null,
      reverse_dns: g?.reverse || null,
      hosting: g?.isHosting ?? null,
      proxy_vpn: g?.isProxy ?? null,
      mobile: g?.isMobile ?? null,
      confidence: row.resolution?.overall?.confidence ?? null,
    };
    if (distances) {
      const km = distances.get(row.ip);
      record.distance_km = km === undefined ? null : Math.round(km);
    }
    return record;
  });
}

function csvCell(value: ExportRecord[string]): string {
  if (value === null) return "";
  const s = String(value);
  // Quote anything that would break a cell, and neutralise a leading formula
  // character, since an ISP name is attacker-controlled text and this file is
  // opened in spreadsheets. Only strings: a negative coordinate is a number,
  // and prefixing it would turn every western or southern lat/lon into text.
  const safe = typeof value === "string" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function toCsv(records: ExportRecord[]): string {
  if (!records.length) return "";
  const cols = Object.keys(records[0]);
  const lines = [cols.join(",")];
  for (const r of records) lines.push(cols.map((c) => csvCell(r[c])).join(","));
  return `${lines.join("\n")}\n`;
}
