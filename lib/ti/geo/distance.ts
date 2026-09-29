/**
 * Where a bulk batch sits on the globe and how far apart it is: map sites, the
 * spread summary, and distances from an anchor address.
 *
 * Inherits `summary.ts`'s rule: never claim more than the data supports. An IP
 * geolocation is a city at best and a country centroid at worst, so every
 * distance here is between those estimates, and the prose says so whenever a
 * country-level position is involved.
 */
import type { GeoRow } from "../geo";
import { haversineKm } from "./geokit";
import { count } from "@/lib/text";

/** A row's estimated position. `country` precision means no city resolved, so
 *  the coordinates are the provider's stand-in for the whole country. */
export interface GeoPoint {
  lat: number;
  lon: number;
  precision: "city" | "country";
  /** `Frankfurt am Main, Germany`, or the country alone. */
  label: string;
}

export function pointOf(row: GeoRow): GeoPoint | undefined {
  if (row.status !== "ok") return undefined;
  const coords = row.resolution?.coordinates?.value ?? row.geo;
  const lat = coords?.lat;
  const lon = coords?.lon;
  if (typeof lat !== "number" || typeof lon !== "number") return undefined;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  // (0, 0) is the "null island" a provider returns when it has nothing.
  if (lat === 0 && lon === 0) return undefined;
  const city = row.resolution?.city?.value ?? row.geo?.city;
  const country = row.resolution?.country?.value ?? row.geo?.country;
  const label = [city, country].filter(Boolean).join(", ") || "Unknown place";
  return { lat, lon, precision: city ? "city" : "country", label };
}

/** Addresses that share one position, drawn as one dot. */
export interface Site extends GeoPoint {
  key: string;
  ips: string[];
}

/**
 * The batch's positions, one site per distinct place, busiest first. Positions
 * are merged at a tenth of a degree (about 11 km), which is finer than any
 * provider's city estimate, so it only ever merges what is really one place.
 */
export function sitesOf(rows: GeoRow[]): Site[] {
  const sites = new Map<string, Site>();
  for (const row of rows) {
    const p = pointOf(row);
    if (!p) continue;
    const key = `${p.lat.toFixed(1)},${p.lon.toFixed(1)}`;
    const site = sites.get(key);
    if (site) site.ips.push(row.ip);
    else sites.set(key, { ...p, key, ips: [row.ip] });
  }
  return [...sites.values()].sort((a, b) => b.ips.length - a.ips.length);
}

/** Kilometres from `anchor` to every located row, the anchor itself at 0.
 *  Empty when the anchor has no position. */
export function distancesFrom(anchor: string, rows: GeoRow[]): Map<string, number> {
  const out = new Map<string, number>();
  const from = rows.find((r) => r.ip === anchor);
  const origin = from && pointOf(from);
  if (!origin) return out;
  for (const row of rows) {
    const p = pointOf(row);
    if (p) out.set(row.ip, haversineKm(origin, p));
  }
  return out;
}

/** `16,480 km`, or `under 1 km` for two addresses on one site. */
export function formatKm(km: number): string {
  if (km < 1) return "under 1 km";
  return `${Math.round(km).toLocaleString("en-US")} km`;
}

export interface Outlier {
  ip: string;
  label: string;
  km: number;
}

export interface Spread {
  total: number;
  located: number;
  radiusKm: number;
  /** The place with the most addresses within `radiusKm` of it. */
  hub?: { label: string; within: number };
  /** Located addresses beyond `radiusKm` of the hub, farthest first. */
  outliers: Outlier[];
  /** The greatest distance between any two located addresses. */
  maxSpanKm: number;
  /** Located addresses whose position is only country level. */
  approx: number;
}

/** How many located rows lie within `radiusKm` of `site`. */
function withinOf(site: Site, sites: Site[], radiusKm: number): number {
  let n = 0;
  for (const other of sites) {
    if (haversineKm(site, other) <= radiusKm) n += other.ips.length;
  }
  return n;
}

function maxSpan(sites: Site[]): number {
  let max = 0;
  for (let i = 0; i < sites.length; i++) {
    for (let j = i + 1; j < sites.length; j++) {
      max = Math.max(max, haversineKm(sites[i], sites[j]));
    }
  }
  return max;
}

/**
 * The batch's geographic spread: the densest place (the site with the most
 * addresses within `radiusKm`), the addresses that lie outside it, and how far
 * apart the batch reaches. n is capped at 100 upstream, so the pairwise pass is
 * cheap.
 */
export function spreadOf(rows: GeoRow[], radiusKm = 500): Spread {
  const sites = sitesOf(rows);
  const located = sites.reduce((n, s) => n + s.ips.length, 0);
  const approx = sites
    .filter((s) => s.precision === "country")
    .reduce((n, s) => n + s.ips.length, 0);
  const spread: Spread = {
    total: rows.length,
    located,
    radiusKm,
    outliers: [],
    maxSpanKm: maxSpan(sites),
    approx,
  };
  if (!sites.length) return spread;

  let hub = sites[0];
  let best = withinOf(hub, sites, radiusKm);
  for (const site of sites.slice(1)) {
    const within = withinOf(site, sites, radiusKm);
    if (within > best) [hub, best] = [site, within];
  }
  spread.hub = { label: hub.label, within: best };
  for (const site of sites) {
    const km = haversineKm(hub, site);
    if (km <= radiusKm) continue;
    for (const ip of site.ips) spread.outliers.push({ ip, label: site.label, km });
  }
  spread.outliers.sort((a, b) => b.km - a.km);
  return spread;
}

const OUTLIERS_NAMED = 5;

function outlierList(outliers: Outlier[]): string {
  const named = outliers
    .slice(0, OUTLIERS_NAMED)
    .map((o) => `${o.ip} in ${o.label} (${formatKm(o.km)})`);
  const rest = outliers.length - named.length;
  if (rest > 0) named.push(`${rest} more`);
  return named.join("; ");
}

function approxSentence(approx: number): string {
  if (!approx) return "";
  const [verb, them] = approx === 1 ? ["is", "it"] : ["are", "them"];
  return ` ${count(approx, "position")} ${verb} only country level, so distances to ${them} are approximate.`;
}

/**
 * The spread as one short paragraph. Leads with where the batch clusters, then
 * names the outliers and how far out they sit, then how far the batch reaches.
 */
export function spreadNote(s: Spread): string {
  if (!s.hub) return "";
  if (s.located === 1) {
    return `Only 1 of ${s.total} addresses could be placed, in ${s.hub.label}.`;
  }
  const radius = formatKm(s.radiusKm);
  const span = ` They reach up to ${formatKm(s.maxSpanKm)} apart.`;
  const tail = approxSentence(s.approx);
  if (s.hub.within === 1) {
    return `The ${s.located} located addresses are dispersed, no two within ${radius} of each other.${span}${tail}`;
  }
  if (!s.outliers.length) {
    const who =
      s.located === s.total
        ? `All ${s.located} addresses`
        : `All ${s.located} located addresses`;
    return `${who} sit within ${radius} of ${s.hub.label}, at most ${formatKm(s.maxSpanKm)} apart.${tail}`;
  }
  const head = `${s.hub.within} of ${s.located} located addresses sit within ${radius} of ${s.hub.label}.`;
  const outs = `${s.outliers.length === 1 ? "The outlier" : "Outliers, farthest first"}: ${outlierList(s.outliers)}.`;
  return `${head} ${outs}${span}${tail}`;
}

/** The anchor's reading: where it is, the nearest and farthest other address. */
export function anchorNote(
  anchor: string,
  rows: GeoRow[],
  distances: ReadonlyMap<string, number>,
): string {
  const origin = rows.find((r) => r.ip === anchor);
  const point = origin && pointOf(origin);
  if (!point) return `${anchor} has no position, so there is nothing to measure from.`;
  const others = rows
    .filter((r) => r.ip !== anchor && distances.has(r.ip))
    .map((r) => ({ ip: r.ip, km: distances.get(r.ip) as number, p: pointOf(r) as GeoPoint }))
    .sort((a, b) => a.km - b.km);
  const head = `Measuring from ${anchor} in ${point.label}.`;
  if (!others.length) return `${head} No other address has a position.`;
  const near = others[0];
  const far = others.at(-1) as (typeof others)[number];
  const nearText = `Nearest is ${near.ip} in ${near.p.label}, ${formatKm(near.km)}`;
  if (others.length === 1) return `${head} ${nearText}.`;
  return `${head} ${nearText}. Farthest is ${far.ip} in ${far.p.label}, ${formatKm(far.km)}.`;
}

/** Distance bands for the anchor readout, in kilometres (upper bounds). */
const BANDS: readonly [number, string][] = [
  [500, "under 500 km"],
  [2000, "500 to 2,000 km"],
  [5000, "2,000 to 5,000 km"],
  [Number.POSITIVE_INFINITY, "over 5,000 km"],
];

export interface DistanceBand {
  label: string;
  count: number;
}

/** How the other located addresses fall by distance from the anchor. The
 *  anchor itself is left out: it is where the measuring starts, not a result. */
export function distanceBands(
  anchor: string,
  distances: ReadonlyMap<string, number>,
): DistanceBand[] {
  const counts = BANDS.map(() => 0);
  for (const [ip, km] of distances) {
    if (ip === anchor) continue;
    counts[BANDS.findIndex(([max]) => km < max)]++;
  }
  return BANDS.map(([, label], i) => ({ label, count: counts[i] }));
}

/** The median distance from the anchor to the other located addresses, or
 *  undefined when there are none. */
export function medianKm(
  anchor: string,
  distances: ReadonlyMap<string, number>,
): number | undefined {
  const kms = [...distances]
    .filter(([ip]) => ip !== anchor)
    .map(([, km]) => km)
    .sort((a, b) => a - b);
  if (!kms.length) return undefined;
  const mid = Math.floor(kms.length / 2);
  return kms.length % 2 ? kms[mid] : (kms[mid - 1] + kms[mid]) / 2;
}
