import type {
  Confidence,
  GeoContext,
  GeoResolution,
  ResolvedField,
  SourceResult,
} from "../types";
import {
  canonicalAsn,
  countryKeyIndex,
  countryVoteKey,
  haversineKm,
  normalizeKey,
} from "./geokit";
import {
  authorityFor,
  CITY_CLUSTER_KM,
  COORD_HIGH_KM,
  COORD_MEDIUM_KM,
  CORROBORATION_TARGET,
  getWeight,
  HIGH_SCORE,
  MEDIUM_SCORE,
  type GeoField,
} from "./weights";

export interface GeoInput {
  id: string;
  geo: GeoContext;
}

function tierFromScore(score: number): Confidence {
  if (score >= HIGH_SCORE) return "high";
  if (score >= MEDIUM_SCORE) return "medium";
  return "low";
}

interface WVote {
  key: string;
  value: string;
  ids: string[];
  weight: number;
}

/** Rank weighted votes, derive confidence + score, collect alternatives.
 *  `authorityFor(weightField)` forces high when it backs the winner. */
function finalizeVotes(
  votes: WVote[],
  reporting: number,
  reportingWeight: number,
  weightField: GeoField,
): ResolvedField<string> {
  const authority = authorityFor(weightField);
  // Callers always pass a freshly built array, so the in-place sort is safe.
  votes.sort((a, b) => b.weight - a.weight || b.ids.length - a.ids.length);
  const authoritativeVote = authority
    ? votes.find((v) => v.ids.includes(authority))
    : undefined;
  const winner = authoritativeVote ?? votes[0];
  const agreement = winner.ids.length / reporting;
  const coverage = Math.min(1, reportingWeight / CORROBORATION_TARGET);
  // score stays a weight-ratio measure even when an authority forces the tier
  // high, so consumers can still see how corroborated the winning value was.
  const score = (winner.weight / reportingWeight) * coverage;
  const confidence: Confidence = authoritativeVote ? "high" : tierFromScore(score);
  const alternatives = votes
    .filter((v) => v !== winner)
    .map((v) => ({ value: v.value, sources: v.ids }));
  return {
    value: winner.value,
    confidence,
    score,
    agreement,
    sources: winner.ids,
    ...(alternatives.length ? { alternatives } : {}),
  };
}

/** Weighted plurality vote over a string field. `weightField` selects the
 *  per-provider reliability column; `normalize` controls grouping. */
function tally(
  inputs: GeoInput[],
  field: keyof GeoContext,
  weightField: GeoField,
  normalize: (v: string) => string,
): ResolvedField<string> | undefined {
  const votes = new Map<string, WVote>();
  let reporting = 0;
  let reportingWeight = 0;

  for (const { id, geo } of inputs) {
    const raw = geo[field];
    if (typeof raw !== "string" || raw.trim() === "") continue;
    const key = normalize(raw);
    if (key === "") continue;
    const w = getWeight(id, weightField);
    reporting++;
    reportingWeight += w;
    const existing = votes.get(key);
    if (existing) {
      existing.ids.push(id);
      existing.weight += w;
    } else {
      votes.set(key, { key, value: raw.trim(), ids: [id], weight: w });
    }
  }

  if (reporting === 0 || reportingWeight === 0) return undefined;
  return finalizeVotes([...votes.values()], reporting, reportingWeight, weightField);
}

interface CityCand {
  value: string;
  ids: string[];
  weight: number;
  lat?: number;
  lon?: number;
  coordCount: number;
}

/** City is reconciled with coordinate awareness: candidates whose representative
 *  coordinates fall within CITY_CLUSTER_KM collapse into one, so adjacent place
 *  names corroborate instead of splitting. Falls back to string grouping when a
 *  provider has no coordinates. */
function reconcileCity(inputs: GeoInput[]): ResolvedField<string> | undefined {
  const byKey = new Map<string, CityCand>();
  let reporting = 0;
  let reportingWeight = 0;

  for (const { id, geo } of inputs) {
    const raw = geo.city;
    if (typeof raw !== "string" || raw.trim() === "") continue;
    const key = normalizeKey(raw);
    if (key === "") continue;
    const w = getWeight(id, "city");
    reporting++;
    reportingWeight += w;
    const hasCoord = typeof geo.lat === "number" && typeof geo.lon === "number";
    let c = byKey.get(key);
    if (!c) {
      c = { value: raw.trim(), ids: [], weight: 0, coordCount: 0 };
      byKey.set(key, c);
    }
    c.ids.push(id);
    c.weight += w;
    if (hasCoord) {
      const n = c.coordCount;
      c.lat = ((c.lat ?? 0) * n + (geo.lat as number)) / (n + 1);
      c.lon = ((c.lon ?? 0) * n + (geo.lon as number)) / (n + 1);
      c.coordCount = n + 1;
    }
  }

  if (reporting === 0 || reportingWeight === 0) return undefined;

  const merged: CityCand[] = [];
  for (const cand of byKey.values()) {
    const near =
      cand.coordCount > 0
        ? merged.find(
            (m) =>
              m.coordCount > 0 &&
              haversineKm(
                { lat: m.lat as number, lon: m.lon as number },
                { lat: cand.lat as number, lon: cand.lon as number },
              ) <= CITY_CLUSTER_KM,
          )
        : undefined;
    if (near) {
      const total = near.coordCount + cand.coordCount;
      if (cand.weight > near.weight) near.value = cand.value;
      near.lat =
        ((near.lat as number) * near.coordCount +
          (cand.lat as number) * cand.coordCount) /
        total;
      near.lon =
        ((near.lon as number) * near.coordCount +
          (cand.lon as number) * cand.coordCount) /
        total;
      near.ids = [...near.ids, ...cand.ids];
      near.weight += cand.weight;
      near.coordCount = total;
    } else {
      merged.push({ ...cand });
    }
  }

  return finalizeVotes(
    merged.map((c) => ({ key: c.value, value: c.value, ids: c.ids, weight: c.weight })),
    reporting,
    reportingWeight,
    "city",
  );
}

function reconcileCoordinates(
  inputs: GeoInput[],
): ResolvedField<{ lat: number; lon: number }> | undefined {
  const points = inputs
    .filter((i) => typeof i.geo.lat === "number" && typeof i.geo.lon === "number")
    .map((i) => ({
      id: i.id,
      lat: i.geo.lat as number,
      lon: i.geo.lon as number,
      w: getWeight(i.id, "coords"),
    }));

  if (points.length === 0) return undefined;

  const totalW = points.reduce((s, p) => s + p.w, 0) || points.length;
  const centroid = {
    lat: points.reduce((s, p) => s + p.lat * p.w, 0) / totalW,
    lon: points.reduce((s, p) => s + p.lon * p.w, 0) / totalW,
  };
  const coverage = Math.min(1, totalW / CORROBORATION_TARGET);

  let confidence: Confidence;
  let agreement: number;
  if (points.length === 1) {
    confidence = points[0].w >= 0.7 ? "medium" : "low";
    agreement = 1;
  } else {
    const spread = Math.max(...points.map((p) => haversineKm(centroid, p)));
    if (spread <= COORD_HIGH_KM) {
      confidence = "high";
      agreement = 1;
    } else if (spread <= COORD_MEDIUM_KM) {
      confidence = "medium";
      agreement = 0.6;
    } else {
      confidence = "low";
      agreement = 0.2;
    }
  }

  const result: ResolvedField<{ lat: number; lon: number }> = {
    value: centroid,
    confidence,
    score: agreement * coverage,
    agreement,
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

/** Country votes group by ISO code (so RDAP, which emits only a code,
 *  participates), and RDAP's allocation country is authoritative. */
function reconcileCountry(inputs: GeoInput[]): {
  field?: ResolvedField<string>;
  code?: string;
} {
  interface CVote {
    code: string;
    name: string;
    ids: string[];
    weight: number;
  }
  const votes = new Map<string, CVote>();
  let reporting = 0;
  let reportingWeight = 0;

  // Keyed through a batch-derived index so a code-only provider (RDAP: "US")
  // and a name-only provider ("United States") join one vote instead of
  // splitting into a false disagreement.
  const index = countryKeyIndex(
    inputs.map(({ geo }) => ({ code: geo.countryCode, name: geo.country })),
  );

  for (const { id, geo } of inputs) {
    const code = geo.countryCode?.trim().toUpperCase() ?? "";
    const name = geo.country?.trim() ?? "";
    const key = countryVoteKey(geo, index);
    if (!key) continue;
    const w = getWeight(id, "country");
    reporting++;
    reportingWeight += w;
    const existing = votes.get(key);
    if (existing) {
      existing.ids.push(id);
      existing.weight += w;
      if (!existing.name && name) existing.name = name;
      if (!existing.code && code) existing.code = code;
    } else {
      votes.set(key, { code, name, ids: [id], weight: w });
    }
  }

  if (reporting === 0 || reportingWeight === 0) return {};

  const authority = authorityFor("country");
  const ranked = [...votes.values()].sort(
    (a, b) => b.weight - a.weight || b.ids.length - a.ids.length,
  );
  const authoritativeVote = authority
    ? ranked.find((v) => v.ids.includes(authority))
    : undefined;
  const winner = authoritativeVote ?? ranked[0];
  const agreement = winner.ids.length / reporting;
  const coverage = Math.min(1, reportingWeight / CORROBORATION_TARGET);
  const score = (winner.weight / reportingWeight) * coverage;
  const confidence: Confidence = authoritativeVote ? "high" : tierFromScore(score);
  const alternatives = ranked
    .filter((v) => v !== winner)
    .map((v) => ({ value: v.name || v.code, sources: v.ids }));

  const field: ResolvedField<string> = {
    value: winner.name || winner.code,
    confidence,
    score,
    agreement,
    sources: winner.ids,
    ...(alternatives.length ? { alternatives } : {}),
  };
  return { field, code: winner.code || undefined };
}

/** Blend the located fields into one overall confidence, importance-weighted
 *  over the fields that are present. */
function computeOverall(res: GeoResolution): GeoResolution["overall"] {
  const parts: [number, number | undefined][] = [
    [0.3, res.country?.score],
    [0.3, res.city?.score],
    [0.25, res.coordinates?.score],
    [0.15, res.asn?.score],
  ];
  let num = 0;
  let den = 0;
  for (const [w, s] of parts) {
    if (s !== undefined) {
      num += w * s;
      den += w;
    }
  }
  if (den === 0) return undefined;
  const score = num / den;
  return { score, confidence: tierFromScore(score) };
}

/** Pure reconciliation core: votes over already-extracted provider inputs. */
export function reconcileGeoInputs(
  inputs: GeoInput[],
): GeoResolution | undefined {
  if (inputs.length === 0) return undefined;

  const country = reconcileCountry(inputs);
  const resolution: GeoResolution = {
    country: country.field,
    countryCode: country.code,
    region: tally(inputs, "region", "region", normalizeKey),
    city: reconcileCity(inputs),
    asn: tally(inputs, "asn", "asn", canonicalAsn),
    asnOrg: tally(inputs, "asnOrg", "asn", normalizeKey),
    isp: tally(inputs, "isp", "isp", normalizeKey),
    coordinates: reconcileCoordinates(inputs),
    flags: reconcileFlags(inputs),
    providerCount: inputs.length,
  };
  resolution.overall = computeOverall(resolution);
  return resolution;
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

/** Project a GeoResolution onto a base GeoContext (the legacy flat view used by
 *  the OG image, history, and bulk geo). Present reconciled winners overlay the
 *  base; absent winners leave the base value intact (so provider-only fields
 *  like `org`, and `reverse`/`fcrdns` passed in via `base`, survive). Flags are
 *  written explicitly from the resolution (already OR'd across providers). */
export function overlayResolution(
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
  geo.isHosting = res.flags.isHosting;
  geo.isProxy = res.flags.isProxy;
  geo.isMobile = res.flags.isMobile;
  return geo;
}
