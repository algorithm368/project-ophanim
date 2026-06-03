import type {
  Confidence,
  GeoContext,
  GeoResolution,
  ResolvedField,
  SourceResult,
} from "../types";
import { canonicalAsn, haversineKm, normalizeKey } from "./geokit";

export interface GeoInput {
  id: string;
  geo: GeoContext;
}

interface Vote {
  /** grouping key (normalized) */
  key: string;
  /** display value (original casing of the first contributor) */
  value: string;
  ids: string[];
}

function tally(
  inputs: GeoInput[],
  field: keyof GeoContext,
  normalize: (v: string) => string,
): ResolvedField<string> | undefined {
  const votes = new Map<string, Vote>();
  let reporting = 0;

  for (const { id, geo } of inputs) {
    const raw = geo[field];
    if (typeof raw !== "string" || raw.trim() === "") continue;
    reporting++;
    const key = normalize(raw);
    if (key === "") continue;
    const existing = votes.get(key);
    if (existing) existing.ids.push(id);
    else votes.set(key, { key, value: raw.trim(), ids: [id] });
  }

  if (reporting === 0) return undefined;

  const ranked = [...votes.values()].sort((a, b) => b.ids.length - a.ids.length);
  const winner = ranked[0];
  const top = winner.ids.length;
  const second = ranked.find((v) => v !== winner)?.ids.length ?? 0;
  const agreement = top / reporting;

  let confidence: Confidence;
  if (reporting >= 2 && agreement >= 2 / 3) confidence = "high";
  else if (reporting >= 2 && top > second) confidence = "medium";
  else confidence = "low";

  const alternatives = ranked
    .filter((v) => v !== winner)
    .map((v) => ({ value: v.value, sources: v.ids }));

  return {
    value: winner.value,
    confidence,
    agreement,
    sources: winner.ids,
    ...(alternatives.length ? { alternatives } : {}),
  };
}

const SPREAD_KM = 50;

function reconcileCoordinates(
  inputs: GeoInput[],
): ResolvedField<{ lat: number; lon: number }> | undefined {
  const points = inputs
    .filter((i) => typeof i.geo.lat === "number" && typeof i.geo.lon === "number")
    .map((i) => ({ id: i.id, lat: i.geo.lat as number, lon: i.geo.lon as number }));

  if (points.length === 0) return undefined;

  const centroid = {
    lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
    lon: points.reduce((s, p) => s + p.lon, 0) / points.length,
  };
  const spread = Math.max(...points.map((p) => haversineKm(centroid, p)));

  let confidence: Confidence;
  if (points.length === 1) confidence = "low";
  else if (spread <= SPREAD_KM) confidence = "high";
  else confidence = "low";

  const result: ResolvedField<{ lat: number; lon: number }> = {
    value: centroid,
    confidence,
    agreement: points.length === 1 ? 1 : spread <= SPREAD_KM ? 1 : 0,
    sources: points.map((p) => p.id),
  };
  if (confidence === "low" && points.length > 1) {
    result.alternatives = points.map((p) => ({
      value: { lat: p.lat, lon: p.lon },
      sources: [p.id],
    }));
  }
  return result;
}

function reconcileFlags(inputs: GeoInput[]): GeoResolution["flags"] {
  const flags = {
    isHosting: false,
    isProxy: false,
    isMobile: false,
    sources: {} as Record<string, string[]>,
  };
  const keys = ["isHosting", "isProxy", "isMobile"] as const;
  for (const { id, geo } of inputs) {
    for (const k of keys) {
      if (geo[k] === true) {
        flags[k] = true;
        (flags.sources[k] ??= []).push(id);
      }
    }
  }
  return flags;
}

const COUNTRY_AUTHORITY = "rdap-ip";

/** Country is reconciled separately: votes group by ISO code (so RDAP, which
 *  emits only a code, participates), and RDAP's allocation country breaks ties. */
function reconcileCountry(inputs: GeoInput[]): {
  field?: ResolvedField<string>;
  code?: string;
} {
  interface CVote {
    code: string;
    name: string;
    ids: string[];
  }
  const votes = new Map<string, CVote>();
  let reporting = 0;

  for (const { id, geo } of inputs) {
    const code = geo.countryCode?.trim().toUpperCase() ?? "";
    const name = geo.country?.trim() ?? "";
    if (!code && !name) continue;
    reporting++;
    const key = code || normalizeKey(name);
    const existing = votes.get(key);
    if (existing) {
      existing.ids.push(id);
      if (!existing.name && name) existing.name = name;
      if (!existing.code && code) existing.code = code;
    } else {
      votes.set(key, { code, name, ids: [id] });
    }
  }

  if (reporting === 0) return {};

  const ranked = [...votes.values()].sort((a, b) => b.ids.length - a.ids.length);
  const authoritative = ranked.find((v) => v.ids.includes(COUNTRY_AUTHORITY));
  const winner = authoritative ?? ranked[0];
  const top = winner.ids.length;
  const second = ranked.find((v) => v !== winner)?.ids.length ?? 0;
  const agreement = top / reporting;

  let confidence: Confidence;
  if (authoritative) confidence = "high";
  else if (reporting >= 2 && agreement >= 2 / 3) confidence = "high";
  else if (reporting >= 2 && top > second) confidence = "medium";
  else confidence = "low";

  const alternatives = ranked
    .filter((v) => v !== winner)
    .map((v) => ({ value: v.name || v.code, sources: v.ids }));

  const field: ResolvedField<string> = {
    value: winner.name || winner.code,
    confidence,
    agreement,
    sources: winner.ids,
    ...(alternatives.length ? { alternatives } : {}),
  };
  return { field, code: winner.code || undefined };
}

/** Pure reconciliation core: votes over already-extracted provider inputs. */
export function reconcileGeoInputs(
  inputs: GeoInput[],
): GeoResolution | undefined {
  if (inputs.length === 0) return undefined;

  const country = reconcileCountry(inputs);

  return {
    country: country.field,
    countryCode: country.code,
    region: tally(inputs, "region", normalizeKey),
    city: tally(inputs, "city", normalizeKey),
    asn: tally(inputs, "asn", canonicalAsn),
    asnOrg: tally(inputs, "asnOrg", normalizeKey),
    isp: tally(inputs, "isp", normalizeKey),
    coordinates: reconcileCoordinates(inputs),
    flags: reconcileFlags(inputs),
    providerCount: inputs.length,
  };
}

/** Thin adapter for single-IP callers that hold full SourceResults. */
export function reconcileGeo(
  results: SourceResult[],
): GeoResolution | undefined {
  const inputs: GeoInput[] = results
    .filter((res) => res.status === "ok" && res.geo)
    .map((res) => ({ id: res.source.id, geo: res.geo as GeoContext }));
  return reconcileGeoInputs(inputs);
}

/** Overlay reconciled winning values onto a base GeoContext (compatibility
 *  view). Base-only fields (e.g. org, ip-api flags) are preserved. */
export function flattenResolution(
  res: GeoResolution,
  base: GeoContext = {},
): GeoContext {
  const geo: GeoContext = { ...base };
  if (res.country) geo.country = res.country.value;
  if (res.countryCode) geo.countryCode = res.countryCode;
  if (res.region) geo.region = res.region.value;
  if (res.city) geo.city = res.city.value;
  if (res.asn) geo.asn = res.asn.value;
  if (res.asnOrg) geo.asnOrg = res.asnOrg.value;
  if (res.isp) geo.isp = res.isp.value;
  if (res.coordinates) {
    geo.lat = res.coordinates.value.lat;
    geo.lon = res.coordinates.value.lon;
  }
  if (res.flags.isHosting) geo.isHosting = true;
  if (res.flags.isProxy) geo.isProxy = true;
  if (res.flags.isMobile) geo.isMobile = true;
  return geo;
}
