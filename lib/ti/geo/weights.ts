export type GeoField = "country" | "region" | "city" | "coords" | "asn" | "isp";

/** Per-field reliability, 0-1. Unlisted providers/fields use DEFAULT_WEIGHT. */
const PROVIDER_WEIGHTS: Record<string, Partial<Record<GeoField, number>>> = {
  "rdap-ip": { country: 1.0, asn: 0.7 },
  ripestat: { country: 0.8, asn: 1.0, isp: 0.3 },
  "ip-api": { country: 0.85, region: 0.85, city: 0.85, coords: 0.85, asn: 0.8, isp: 0.85 },
  ipinfo: { country: 0.85, region: 0.8, city: 0.85, coords: 0.85, asn: 0.85, isp: 0.8 },
  ipgeolocation: { country: 0.8, region: 0.8, city: 0.8, coords: 0.8, asn: 0.75, isp: 0.8 },
  ipwhois: { country: 0.7, region: 0.7, city: 0.7, coords: 0.7, asn: 0.7, isp: 0.7 },
  freeipapi: { country: 0.65, region: 0.65, city: 0.7, coords: 0.65, asn: 0.65, isp: 0.5 },
  abuseipdb: { country: 0.6, isp: 0.5 },
  "reverse-dns": { country: 0.3, region: 0.2, city: 0.2 },
};

const DEFAULT_WEIGHT = 0.5;

export function getWeight(id: string, field: GeoField): number {
  return PROVIDER_WEIGHTS[id]?.[field] ?? DEFAULT_WEIGHT;
}

/** Provider that is allocation-authoritative for a field (forces high when it
 *  backs the winning value). Subsumes the old COUNTRY_AUTHORITY constant. */
const AUTHORITY: Partial<Record<GeoField, string>> = {
  country: "rdap-ip",
  asn: "ripestat",
};

export function authorityFor(field: GeoField): string | undefined {
  return AUTHORITY[field];
}

// Tunables (exported so tests pin them).
export const CORROBORATION_TARGET = 1.5; // summed weight that counts as fully corroborated
export const HIGH_SCORE = 0.66;
export const MEDIUM_SCORE = 0.45;
export const CITY_CLUSTER_KM = 25; // merge same-area cities into one candidate
export const COORD_HIGH_KM = 25; // multi-point spread bands
export const COORD_MEDIUM_KM = 75;
