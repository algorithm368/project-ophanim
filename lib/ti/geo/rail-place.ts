import { type AnyCheckResult, type GeoContext, isDomainResult, isHashResult } from "../types";

/**
 * Where the rail's globe points.
 *
 * Kept apart from the globe itself so the page can decide whether to draw one
 * without loading the atlas: this file is all a result page imports, and the
 * drawing comes in on demand.
 */
export interface RailPlace {
  /** A provider's point, when any gave one. Set together or not at all. */
  lat?: number;
  lon?: number;
  /** ISO alpha-2, which places the globe when there is no point. */
  countryCode?: string;
  /** "City, CC", for the caption. */
  label?: string;
}

/** Null for a file, which has no place, and for a lookup no provider placed. */
export function railPlace(result: AnyCheckResult): RailPlace | null {
  if (isHashResult(result)) return null;
  const r = result.geoResolution;
  // A domain's location is reconciled for the address it resolved to and
  // arrives only as a resolution; an address also carries the raw context.
  const g = isDomainResult(result) ? undefined : result.geo;
  const point = r?.coordinates?.value ?? pointOf(g);
  const countryCode = r?.countryCode ?? g?.countryCode;
  if (!point && !countryCode) return null;
  const label = [r?.city?.value ?? g?.city, countryCode].filter(Boolean).join(", ");
  return { ...point, countryCode, label: label || undefined };
}

function pointOf(g: GeoContext | undefined): { lat: number; lon: number } | undefined {
  if (g?.lat === undefined || g.lon === undefined) return undefined;
  return { lat: g.lat, lon: g.lon };
}
