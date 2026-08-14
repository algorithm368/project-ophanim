/** Normalize a string for grouping: trim, collapse whitespace, lowercase. */
export function normalizeKey(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Canonical "AS####" form, dropping any org tail. "" when no number found. */
export function canonicalAsn(value: string | undefined): string {
  const m = /(\d+)/.exec(value ?? "");
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

/** One provider's country claim, as fed to the vote-key index. */
export interface CountryVote {
  code?: string;
  name?: string;
}

let regionNames: Intl.DisplayNames | undefined;

/** Canonical English name for an ISO alpha-2 code, or undefined when the
 *  runtime cannot name it (unsupported locale, invalid code). */
function canonicalCountryName(code: string): string | undefined {
  try {
    regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
    const name = regionNames.of(code);
    return name && name !== code ? name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Learn a normalized-name -> ISO-code map from the batch itself, so a code-only
 * provider (RDAP: "US") and a name-only provider ("United States") tally as one
 * country instead of registering a false disagreement. Two sources of truth:
 * inputs that carry both fields, then the canonical English name of every code
 * observed. No ISO table is bundled.
 */
export function countryKeyIndex(
  entries: Iterable<CountryVote>,
): Map<string, string> {
  const index = new Map<string, string>();
  const codes = new Set<string>();
  for (const entry of entries) {
    const code = entry.code?.trim().toUpperCase();
    if (!code) continue;
    codes.add(code);
    const name = normalizeKey(entry.name);
    if (name && !index.has(name)) index.set(name, code);
  }
  for (const code of codes) {
    const canonical = normalizeKey(canonicalCountryName(code));
    if (canonical && !index.has(canonical)) index.set(canonical, code);
  }
  return index;
}

/** Vote key for one provider's country: its own code, else a code learned from
 *  the batch, else its normalized name (which keeps it a separate candidate,
 *  because nothing in the data proves it is the same country). "" when silent. */
export function countryVoteKey(
  geo: { countryCode?: string; country?: string },
  index: Map<string, string>,
): string {
  const code = geo.countryCode?.trim().toUpperCase();
  if (code) return code;
  const name = normalizeKey(geo.country);
  if (!name) return "";
  return index.get(name) ?? name;
}
