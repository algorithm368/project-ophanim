/**
 * The analyst note: one prose paragraph per address in a bulk geolocation
 * batch, saying where it is, what network it announces from, and how well
 * corroborated each claim is.
 *
 * Sibling of `summary.ts`, which answers "what is true of this whole batch".
 * Same rule applies: never describe something the data doesn't support. Each
 * fact is hedged by its OWN reconciled confidence, never by the weakest fact
 * sharing its sentence.
 */
import type { GeoRow } from "../geo";
import type { GeoFlags } from "../types";
import { canonicalAsn } from "./geokit";
import { countryCodeOf, providerLabel } from "./summary";

/** Join with commas and a trailing "and": `a, b and c` (or `a and b`). */
function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function labelled(ids: string[]): string {
  return joinAnd(ids.map(providerLabel));
}

/**
 * `{ip} resolves to Ashburn, Virginia, United States (US), per ip-api.com.`
 *
 * The verb hedges on the country's confidence alone. A low-confidence city is
 * one provider's guess, so it is dropped rather than allowed to sit beside a
 * country we trust. A region never appears without a city.
 */
function locationClause(row: GeoRow): string | undefined {
  const res = row.resolution;
  const code = countryCodeOf(row);
  if (!res?.country || !code) return undefined;

  const verb = res.country.confidence === "high" ? "resolves to" : "is reported as";
  const parts: string[] = [];
  if (res.city && res.city.confidence !== "low") {
    parts.push(res.city.value);
    if (res.region) parts.push(res.region.value);
  }
  parts.push(`${res.country.value} (${code})`);
  return `${row.ip} ${verb} ${parts.join(", ")}, per ${labelled(res.country.sources)}.`;
}

/** `IPinfo places it in United States instead.` */
function dissentClause(row: GeoRow): string | undefined {
  const alternatives = row.resolution?.country?.alternatives;
  if (!alternatives?.length) return undefined;
  const first = alternatives[0];
  return `${labelled(first.sources)} places it in ${first.value} instead.`;
}

/** `Announced by AS13335 (Cloudflare, Inc.).`
 *
 *  `tally` groups ASN votes by canonicalAsn but stores the raw winning string,
 *  which carries an org tail. Strip it: the org has its own parenthetical.
 *  `geo.org` is never used, it never went through reconciliation. */
function networkClause(row: GeoRow): string | undefined {
  const res = row.resolution;
  if (!res?.asn) return undefined;
  const number = canonicalAsn(res.asn.value) || res.asn.value;
  const org = res.asnOrg?.value ?? res.isp?.value;
  const named = org ? `${number} (${org})` : number;
  const hedge = res.asn.confidence === "low" ? ", single-sourced" : "";
  return `Announced by ${named}${hedge}.`;
}

/** `PTR is dns.google, per ip-api.com.` Attributed, never asserted: `geo.reverse`
 *  comes from ip-api alone and never went through a vote. */
function ptrClause(row: GeoRow): string | undefined {
  const reverse = row.geo?.reverse;
  if (!reverse) return undefined;
  return `PTR is ${reverse}, per ${providerLabel("ip-api")}.`;
}

/** `Providers place it near 39.04, -77.49.`
 *
 *  Two decimals (~1.1 km): the centroid averages city-level guesses, so more
 *  precision would assert knowledge we don't have. Omitted at low confidence,
 *  where the provider points were over COORD_MEDIUM_KM apart. */
function coordinatesClause(row: GeoRow): string | undefined {
  const coords = row.resolution?.coordinates;
  if (!coords || coords.confidence === "low") return undefined;
  const { lat, lon } = coords.value;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  return `Providers place it near ${lat.toFixed(2)}, ${lon.toFixed(2)}.`;
}

const FLAG_LABEL: [keyof Pick<GeoFlags, "isHosting" | "isProxy" | "isMobile">, string][] = [
  ["isHosting", "hosting infrastructure"],
  ["isProxy", "a proxy or VPN exit"],
  ["isMobile", "a mobile network"],
];

/** `Flagged as hosting infrastructure, a proxy or VPN exit and a mobile network.` */
function flagsClause(row: GeoRow): string | undefined {
  const flags = row.resolution?.flags;
  if (!flags) return undefined;
  const set = FLAG_LABEL.filter(([key]) => flags[key]).map(([, label]) => label);
  if (!set.length) return undefined;
  return `Flagged as ${joinAnd(set)}.`;
}

/** One paragraph per address, in row order. */
export function analystNotes(rows: GeoRow[]): string[] {
  return rows.map((row) => {
    if (row.status === "error") {
      return `${row.ip} could not be geolocated: ${row.error ?? "Lookup failed"}.`;
    }
    const location = locationClause(row);
    if (!location) return `${row.ip} returned no country data.`;
    return [
      location,
      dissentClause(row),
      networkClause(row),
      ptrClause(row),
      coordinatesClause(row),
      flagsClause(row),
    ]
      .filter(Boolean)
      .join(" ");
  });
}

/** The full note, paragraphs joined by a blank line. What the Copy button sends. */
export function analystNote(rows: GeoRow[]): string {
  return analystNotes(rows).join("\n\n");
}
