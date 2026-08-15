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
  COUNTRY_MISMATCH_WEIGHT,
  getWeight,
  HIGH_SCORE,
  MEDIUM_SCORE,
  type GeoField,
} from "./weights";

export interface GeoInput {
  id: string;
  geo: GeoContext;
}

/** Per-provider multiplier applied on top of the static reliability weight.
 *  Used to discount providers that already lost the country vote. */
type Scale = (id: string) => number;

const NO_SCALE: Scale = () => 1;

function tierFromScore(score: number): Confidence {
  if (score >= HIGH_SCORE) return "high";
  if (score >= MEDIUM_SCORE) return "medium";
  return "low";
}

interface WVote {
  key: string;
  value: string;
  ids: string[];
  /** ranking weight: reliability x any coherence discount. Picks the winner. */
  weight: number;
  /** undiscounted reliability weight. Scores the winner. */
  raw: number;
}

/** Rank weighted votes, derive confidence + score, collect alternatives.
 *  `authorityFor(weightField)` forces high when it backs the winner.
 *
 *  Ranking uses the discounted weight, scoring uses the raw one: a coherence
 *  discount is a reason to prefer one value over another, not evidence that more
 *  providers backed it. Scoring off the discounted weight would report a 2-vs-2
 *  split as near-unanimous. */
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
  const score = (winner.raw / reportingWeight) * coverage;
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
  scale: Scale = NO_SCALE,
): ResolvedField<string> | undefined {
  const votes = new Map<string, WVote>();
  let reporting = 0;
  let reportingWeight = 0;

  for (const { id, geo } of inputs) {
    const raw = geo[field];
    if (typeof raw !== "string" || raw.trim() === "") continue;
    const key = normalize(raw);
    if (key === "") continue;
    const rawWeight = getWeight(id, weightField);
    const w = rawWeight * scale(id);
    reporting++;
    reportingWeight += rawWeight;
    const existing = votes.get(key);
    if (existing) {
      existing.ids.push(id);
      existing.weight += w;
      existing.raw += rawWeight;
    } else {
      votes.set(key, {
        key,
        value: raw.trim(),
        ids: [id],
        weight: w,
        raw: rawWeight,
      });
    }
  }

  if (reporting === 0 || reportingWeight === 0) return undefined;
  return finalizeVotes([...votes.values()], reporting, reportingWeight, weightField);
}

interface CityCand {
  value: string;
  ids: string[];
  /** ranking weight (coherence-discounted) */
  weight: number;
  /** undiscounted weight, used for the reported score */
  raw: number;
  lat?: number;
  lon?: number;
  coordCount: number;
}

/** City is reconciled with coordinate awareness: candidates whose representative
 *  coordinates fall within CITY_CLUSTER_KM collapse into one, so adjacent place
 *  names corroborate instead of splitting. Falls back to string grouping when a
 *  provider has no coordinates. */
function reconcileCity(
  inputs: GeoInput[],
  scale: Scale = NO_SCALE,
): ResolvedField<string> | undefined {
  const byKey = new Map<string, CityCand>();
  let reporting = 0;
  let reportingWeight = 0;

  for (const { id, geo } of inputs) {
    const raw = geo.city;
    if (typeof raw !== "string" || raw.trim() === "") continue;
    const key = normalizeKey(raw);
    if (key === "") continue;
    const rawWeight = getWeight(id, "city");
    const w = rawWeight * scale(id);
    reporting++;
    reportingWeight += rawWeight;
    const hasCoord = typeof geo.lat === "number" && typeof geo.lon === "number";
    let c = byKey.get(key);
    if (!c) {
      c = { value: raw.trim(), ids: [], weight: 0, raw: 0, coordCount: 0 };
      byKey.set(key, c);
    }
    c.ids.push(id);
    c.weight += w;
    c.raw += rawWeight;
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
      near.raw += cand.raw;
      near.coordCount = total;
    } else {
      merged.push({ ...cand });
    }
  }

  return finalizeVotes(
    merged.map((c) => ({
      key: c.value,
      value: c.value,
      ids: c.ids,
      weight: c.weight,
      raw: c.raw,
    })),
    reporting,
    reportingWeight,
    "city",
  );
}

interface CoordPoint {
  id: string;
  lat: number;
  lon: number;
  /** ranking weight (coherence-discounted) */
  w: number;
  /** undiscounted weight, used for the reported score and the centroid */
  raw: number;
}

interface CoordCluster {
  ids: string[];
  weight: number;
  raw: number;
  /** weighted centroid of the member points */
  lat: number;
  lon: number;
  points: CoordPoint[];
}

/** Group points into proximity clusters (same rule the city vote uses), so
 *  providers pointing at the same place corroborate instead of each standing
 *  alone. Single-link: a point joins the first cluster it is within range of. */
function clusterPoints(points: CoordPoint[]): CoordCluster[] {
  const clusters: CoordCluster[] = [];
  for (const p of points) {
    const near = clusters.find(
      (c) => haversineKm({ lat: c.lat, lon: c.lon }, p) <= CITY_CLUSTER_KM,
    );
    if (near) {
      // The centroid is placed by raw reliability, so a coherence discount moves
      // which cluster wins, never where the winning cluster sits.
      const total = near.raw + p.raw;
      near.lat = (near.lat * near.raw + p.lat * p.raw) / total;
      near.lon = (near.lon * near.raw + p.lon * p.raw) / total;
      near.raw = total;
      near.weight += p.w;
      near.ids.push(p.id);
      near.points.push(p);
    } else {
      clusters.push({
        ids: [p.id],
        weight: p.w,
        raw: p.raw,
        lat: p.lat,
        lon: p.lon,
        points: [p],
      });
    }
  }
  return clusters;
}

/**
 * Coordinates are voted, not averaged. Points cluster by proximity, the clusters
 * are ranked by summed provider weight, and the winning cluster's centroid is
 * the answer; losing clusters become alternatives.
 *
 * Averaging every point (the previous behaviour) reports a location no provider
 * claimed as soon as they disagree, and the error grows with the disagreement.
 * On 2606:4700:4700::1111 — two providers on Montreal, two on San Francisco —
 * the mean landed in rural Nebraska, ~1,500 km from either, while the city vote
 * next to it on the page said Montreal. IPv6 hits this constantly: geo DBs have
 * far thinner v6 coverage, so they fall back to the allocation's registered
 * address and scatter across continents.
 */
function reconcileCoordinates(
  inputs: GeoInput[],
  scale: Scale = NO_SCALE,
): ResolvedField<{ lat: number; lon: number }> | undefined {
  const points: CoordPoint[] = inputs
    .filter((i) => typeof i.geo.lat === "number" && typeof i.geo.lon === "number")
    .map((i) => {
      const raw = getWeight(i.id, "coords");
      return {
        id: i.id,
        lat: i.geo.lat as number,
        lon: i.geo.lon as number,
        w: raw * scale(i.id),
        raw,
      };
    });

  if (points.length === 0) return undefined;

  const reportingWeight = points.reduce((s, p) => s + p.raw, 0) || points.length;
  const coverage = Math.min(1, reportingWeight / CORROBORATION_TARGET);

  if (points.length === 1) {
    const [only] = points;
    return {
      value: { lat: only.lat, lon: only.lon },
      confidence: only.raw >= 0.7 ? "medium" : "low",
      score: coverage,
      agreement: 1,
      sources: [only.id],
    };
  }

  const clusters = clusterPoints(points);
  // Callers always pass a freshly built array, so the in-place sort is safe.
  clusters.sort((a, b) => b.weight - a.weight || b.ids.length - a.ids.length);
  const [winner, ...losers] = clusters;

  const centroid = { lat: winner.lat, lon: winner.lon };
  const score = (winner.raw / reportingWeight) * coverage;
  const agreement = winner.ids.length / points.length;

  // The tier follows the vote share, then the winning cluster's own spread caps
  // it: a cluster can chain wider than CITY_CLUSTER_KM, and a loosely held
  // agreement is not a precise one.
  const spread = Math.max(...winner.points.map((p) => haversineKm(centroid, p)));
  let confidence = tierFromScore(score);
  if (spread > COORD_MEDIUM_KM) confidence = "low";
  else if (spread > COORD_HIGH_KM && confidence === "high") confidence = "medium";

  return {
    value: centroid,
    confidence,
    score,
    agreement,
    sources: winner.ids,
    ...(losers.length
      ? {
          alternatives: losers.map((c) => ({
            value: { lat: c.lat, lon: c.lon },
            sources: c.ids,
          })),
        }
      : {}),
  };
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
        flags.sources[k] ??= [];
        flags.sources[k].push(id);
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
  /** providers that named a different country than the winner */
  dissenters: Set<string>;
  /** the winner outweighs the runner-up, rather than winning a coin-flip tie */
  decisive: boolean;
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

  if (reporting === 0 || reportingWeight === 0)
    return { dissenters: new Set(), decisive: false };

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
  const losers = ranked.filter((v) => v !== winner);
  const alternatives = losers.map((v) => ({
    value: v.name || v.code,
    sources: v.ids,
  }));

  const field: ResolvedField<string> = {
    value: winner.name || winner.code,
    confidence,
    score,
    agreement,
    sources: winner.ids,
    ...(alternatives.length ? { alternatives } : {}),
  };
  return {
    field,
    code: winner.code || undefined,
    dissenters: new Set(losers.flatMap((v) => v.ids)),
    decisive: losers.length === 0 || winner.weight > losers[0].weight,
  };
}

/**
 * Discount the finer-grained location votes of providers that already lost the
 * country vote, so region/city/coordinates cannot settle on a place outside the
 * country the rest of the providers agreed on.
 *
 * Without this the fields vote independently and can contradict each other:
 * 2606:4700:4700::1111 resolved to country "United States" (4 providers) while
 * region and city read "Quebec" / "Montreal", because the two providers holding
 * Canada happened to carry slightly more city weight. The map pin, the OG image
 * and the history entry all inherited that impossible pair.
 *
 * Skipped when the country vote was a tie: the winner is then arbitrary, and
 * propagating an arbitrary choice into three more fields would be a coin flip
 * dressed up as a correction.
 */
function countryCoherence(country: {
  dissenters: Set<string>;
  decisive: boolean;
}): Scale {
  if (!country.decisive || country.dissenters.size === 0) return NO_SCALE;
  return (id) => (country.dissenters.has(id) ? COUNTRY_MISMATCH_WEIGHT : 1);
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
  // Country is settled first; the fields that sit *inside* a country are then
  // voted with the losers discounted. ASN/ISP are not geographic containments
  // (an AS spans countries), so they vote unscaled.
  const coherent = countryCoherence(country);
  const resolution: GeoResolution = {
    country: country.field,
    countryCode: country.code,
    region: tally(inputs, "region", "region", normalizeKey, coherent),
    city: reconcileCity(inputs, coherent),
    asn: tally(inputs, "asn", "asn", canonicalAsn),
    asnOrg: tally(inputs, "asnOrg", "asn", normalizeKey),
    isp: tally(inputs, "isp", "isp", normalizeKey),
    coordinates: reconcileCoordinates(inputs, coherent),
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
