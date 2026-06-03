import type {
  Confidence,
  GeoContext,
  GeoResolution,
  ResolvedField,
  SourceResult,
} from "../types";
import { canonicalAsn, normalizeKey } from "./geokit";

interface GeoInput {
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

export function reconcileGeo(results: SourceResult[]): GeoResolution | undefined {
  const inputs: GeoInput[] = results
    .filter((res) => res.status === "ok" && res.geo)
    .map((res) => ({ id: res.source.id, geo: res.geo as GeoContext }));

  if (inputs.length === 0) return undefined;

  return {
    country: undefined, // filled in Task 4 (reconcileCountry)
    countryCode: undefined, // filled in Task 4
    region: tally(inputs, "region", normalizeKey),
    city: tally(inputs, "city", normalizeKey),
    asn: tally(inputs, "asn", canonicalAsn),
    asnOrg: tally(inputs, "asnOrg", normalizeKey),
    isp: tally(inputs, "isp", normalizeKey),
    coordinates: undefined, // filled in Task 4
    flags: { isHosting: false, isProxy: false, isMobile: false, sources: {} }, // Task 4
    providerCount: inputs.length,
  };
}
