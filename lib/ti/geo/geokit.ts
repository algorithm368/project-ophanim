/** Normalize a string for grouping: trim, collapse whitespace, lowercase. */
export function normalizeKey(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Canonical "AS####" form, dropping any org tail. "" when no number found. */
export function canonicalAsn(value: string | undefined): string {
  const m = (value ?? "").match(/(\d+)/);
  return m ? `AS${m[1]}` : "";
}

export interface LatLon {
  lat: number;
  lon: number;
}

/** Great-circle distance between two points, in kilometres. */
export function haversineKm(a: LatLon, b: LatLon): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
