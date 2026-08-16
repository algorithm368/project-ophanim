/**
 * Pure summaries of a bulk geolocation batch, rendered by
 * `components/BulkGeoResults.tsx` and copied verbatim by its Copy button.
 *
 * Sibling of `lib/ti/narrative.ts`, and it inherits that file's rule: keep them
 * honest, the summary must never describe something the data doesn't support.
 * Every claim here is traceable to a reconciled field.
 */
import type { GeoRow } from "../geo";
import { canonicalAsn } from "./geokit";
import { count } from "@/lib/text";

/**
 * Country code for a row, or undefined when nothing trustworthy is known.
 *
 * When a resolution exists but produced no code, the winning vote was name-only
 * and `overlayResolution` left the *base* provider's code in `geo.countryCode`.
 * That code can name a country the vote rejected, so we refuse it rather than
 * pair a reconciled name with a losing code.
 */
export function countryCodeOf(row: GeoRow): string | undefined {
  if (row.status !== "ok") return undefined;
  if (row.resolution) return row.resolution.countryCode?.toUpperCase();
  return row.geo?.countryCode?.toUpperCase();
}

/** Join with commas and a trailing "and": `a, b and c` (or `a and b`). */
function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** City, region for a row, reconciled value preferred, or undefined when unknown. */
function placeOf(row: GeoRow): string | undefined {
  const res = row.resolution;
  const city = res?.city?.value ?? row.geo?.city;
  const region = res?.region?.value ?? row.geo?.region;
  return [city, region].filter(Boolean).join(", ") || undefined;
}

/** The announcing network as `AS15169 (Google LLC)`, the number alone when the
 *  org is unknown, or undefined when no ASN reconciled. Mirrors the geo table:
 *  the raw ASN string carries an org tail, so strip it to the number and let the
 *  org stand in its own parenthetical. */
function networkOf(row: GeoRow): string | undefined {
  const res = row.resolution;
  if (!res?.asn) return undefined;
  const number = canonicalAsn(res.asn.value) || res.asn.value;
  const org = res.asnOrg?.value ?? res.isp?.value;
  return org ? `${number} (${org})` : number;
}

/** `8.8.8.8 in Ashburn, Virginia, announced by AS15169 (Google LLC)`. Each clause
 *  is dropped when its data is missing, down to the bare address. */
function addressDetail(row: GeoRow): string {
  const place = placeOf(row);
  const network = networkOf(row);
  let text = row.ip;
  if (place) text += ` in ${place}`;
  if (network) text += `, announced by ${network}`;
  return text;
}

interface CountryRows {
  country: string;
  code: string;
  rows: GeoRow[];
}

/** Split a batch into located countries (most-populous first, then alphabetical)
 *  and the addresses that carried no trustworthy country. */
function groupRows(rows: GeoRow[]): { located: CountryRows[]; unlocated: GeoRow[] } {
  const byCode = new Map<string, CountryRows>();
  const unlocated: GeoRow[] = [];
  for (const row of rows) {
    const code = countryCodeOf(row);
    if (!code) {
      unlocated.push(row);
      continue;
    }
    let group = byCode.get(code);
    if (!group) {
      group = {
        country: row.resolution?.country?.value ?? row.geo?.country ?? code,
        code,
        rows: [],
      };
      byCode.set(code, group);
    }
    group.rows.push(row);
  }
  const located = [...byCode.values()].sort(
    (a, b) => b.rows.length - a.rows.length || a.country.localeCompare(b.country),
  );
  return { located, unlocated };
}

/**
 * A detailed, report-style prose summary of where the batch resolved: a lead
 * sentence on coverage, one sentence per country naming each address and the
 * city it resolved to, then a closing sentence for anything that could not be
 * located. The single source the component renders and the Copy button sends.
 */
export function originReport(rows: GeoRow[]): string {
  if (!rows.length) return "";
  const { located, unlocated } = groupRows(rows);
  const total = rows.length;

  if (located.length === 0) {
    return `None of the ${total} ${total === 1 ? "address" : "addresses"} could be geolocated.`;
  }

  const locatedCount = total - unlocated.length;
  const countryWord = located.length === 1 ? "country" : "countries";
  const sentences: string[] = [
    locatedCount === total
      ? `All ${count(total, "address", "addresses")} geolocated to ${located.length} ${countryWord}.`
      : `${locatedCount} of ${total} addresses geolocated to ${located.length} ${countryWord}.`,
  ];

  for (const group of located) {
    const n = group.rows.length;
    // Semicolons, not "and": each address clause carries its own commas.
    const list = group.rows.map(addressDetail).join("; ");
    sentences.push(
      `${group.country} (${group.code}) accounts for ${n} ${n === 1 ? "address" : "addresses"}: ${list}.`,
    );
  }

  if (unlocated.length) {
    const k = unlocated.length;
    sentences.push(
      `${k} ${k === 1 ? "address" : "addresses"} could not be geolocated: ${joinAnd(unlocated.map((r) => r.ip))}.`,
    );
  }

  return sentences.join(" ");
}

/**
 * A short note affirming that every located address shares one country, or null
 * when fewer than two addresses located or they span more than one country.
 * When some addresses could not be located, the claim is scoped to the located
 * ones so it never asserts a country for an address that has none.
 */
export function sameCountryNote(rows: GeoRow[]): string | null {
  const located = rows.filter((r) => countryCodeOf(r) !== undefined);
  if (located.length < 2) return null;
  const code = countryCodeOf(located[0]) as string;
  if (!located.every((r) => countryCodeOf(r) === code)) return null;
  const first = located[0];
  const country = first.resolution?.country?.value ?? first.geo?.country ?? code;
  const scope =
    located.length === rows.length
      ? `All ${rows.length} addresses`
      : `All ${located.length} located addresses`;
  return `${scope} resolve to the same country, ${country} (${code}).`;
}
