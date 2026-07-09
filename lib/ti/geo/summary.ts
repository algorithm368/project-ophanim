/**
 * Pure summaries of a bulk geolocation batch, rendered by
 * `components/BulkGeoResults.tsx` and copied verbatim by its Copy buttons.
 *
 * Sibling of `lib/ti/narrative.ts`, and it inherits that file's rule: keep them
 * honest, the summary must never describe something the data doesn't support.
 * Every claim here is traceable to a reconciled field.
 */
import type { Confidence, ResolvedField } from "../types";
import type { GeoRow } from "../geo";

/** Provider ids as users should read them. Unlisted ids pass through, so a new
 *  provider degrades to a readable id rather than vanishing from attribution. */
const PROVIDER_LABEL: Record<string, string> = {
  "ip-api": "ip-api.com",
  ipinfo: "IPinfo",
  "rdap-ip": "RDAP",
  freeipapi: "freeipapi",
  ripestat: "RIPEstat",
  ipgeolocation: "ipgeolocation.io",
  ipwhois: "ipwhois.io",
};

export function providerLabel(id: string): string {
  return PROVIDER_LABEL[id] ?? id;
}

const RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

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

export interface CountrySummary {
  country: string;
  code: string;
  ips: string[];
  located: number;
  total: number;
  /** weakest located row, so the batch is never claimed stronger than its floor. */
  confidence: Confidence;
  /** display names of providers that backed the winner on *every* located row. */
  agreedBy: string[];
  /** located rows whose country vote carried dissenting alternatives. */
  contested: number;
}

/** Null unless at least two rows located to one shared country. */
export function summarizeCountries(rows: GeoRow[]): CountrySummary | null {
  const located = rows.filter((r) => countryCodeOf(r) !== undefined);
  if (located.length < 2) return null;
  const code = countryCodeOf(located[0]) as string;
  if (!located.every((r) => countryCodeOf(r) === code)) return null;

  let confidence: Confidence = "high";
  let contested = 0;
  let agreed: string[] | null = null;

  for (const r of located) {
    const country = r.resolution?.country;
    const rowConfidence = country?.confidence ?? "low";
    if (RANK[rowConfidence] < RANK[confidence]) confidence = rowConfidence;
    if (country?.alternatives?.length) contested++;
    const sources = country?.sources ?? [];
    agreed =
      agreed === null ? [...sources] : agreed.filter((id) => sources.includes(id));
  }

  const first = located[0];
  return {
    country: first.resolution?.country?.value ?? first.geo?.country ?? code,
    code,
    ips: located.map((r) => r.ip),
    located: located.length,
    total: rows.length,
    confidence,
    agreedBy: (agreed ?? []).map(providerLabel),
    contested,
  };
}

/** Join with commas and a trailing "and": `a, b and c` (or `a and b`). */
function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** How the winning country was backed, phrased so a lone provider never "agrees". */
function attribution(s: CountrySummary): string {
  if (s.agreedBy.length === 0) return "backed by different providers per address";
  const verb = s.agreedBy.length >= 2 ? "agreed by" : "as reported by";
  return `${verb} ${joinAnd(s.agreedBy)} on all ${s.located} addresses`;
}

/** The sentence split at the point where the rendered version inserts a chip. */
export interface SameCountryText {
  lead: string;
  place: string;
  tail: string;
}

export function sameCountryText(s: CountrySummary): SameCountryText {
  const verb = s.confidence === "high" ? "are located in" : "are likely located in";
  const contested =
    s.contested > 0
      ? `, providers disagreed on ${s.contested} ${s.contested === 1 ? "address" : "addresses"}`
      : "";
  return {
    lead:
      `${s.located} of ${s.total} addresses resolved to a country. ` +
      `All ${s.located} ${verb} the same country,`,
    place: `${s.country} (${s.code})`,
    tail: `, ${attribution(s)}${contested}.`,
  };
}

/** Plain-text form, used by the Copy button. Identical wording to the render. */
export function sameCountrySentence(s: CountrySummary): string {
  const { lead, place, tail } = sameCountryText(s);
  return `${lead} ${place}${tail}`;
}

/** A resolved value, suffixed with "?" unless providers agreed on it. */
function marked(field: ResolvedField<string>): string {
  return field.confidence === "high" ? field.value : `${field.value}?`;
}

function countryCell(row: GeoRow): string {
  const code = countryCodeOf(row);
  if (!code) return "?";
  const field = row.resolution?.country;
  if (!field) return `${code}?`;
  return field.confidence === "high" ? code : `${code}?`;
}

function asnCell(row: GeoRow): string {
  const res = row.resolution;
  if (res) return res.asn ? marked(res.asn) : "?";
  const raw = row.geo?.asn;
  return raw ? `${raw}?` : "?";
}

/** isp, then asnOrg, then a bare ?. `geo.org` never enters this column: it is a
 *  raw provider field that never went through reconciliation, and this column's
 *  legend promises confidence marking. */
function ispCell(row: GeoRow): string {
  const res = row.resolution;
  if (res) {
    if (res.isp) return marked(res.isp);
    if (res.asnOrg) return marked(res.asnOrg);
    return "?";
  }
  const raw = row.geo?.isp ?? row.geo?.org;
  return raw ? `${raw}?` : "?";
}

/**
 * Aligned monospace columns: IP, country, ASN, ISP. Columns rather than a
 * comma-separated line because ISP names contain commas ("Cloudflare, Inc.").
 * Widths size to content, so nothing is ever clipped into a different name.
 */
export function copyBlock(rows: GeoRow[]): string {
  if (rows.length === 0) return "";
  const cells = rows.map((r) => [r.ip, countryCell(r), asnCell(r), ispCell(r)]);
  const widths = [0, 1, 2].map((col) =>
    Math.max(...cells.map((row) => row[col].length)),
  );
  const lines = cells.map((row) =>
    `${row[0].padEnd(widths[0])}  ${row[1].padEnd(widths[1])}  ${row[2].padEnd(widths[2])}  ${row[3]}`.trimEnd(),
  );

  const suffixed = cells.flat().find((c) => c.length > 1 && c.endsWith("?"));
  const hasBare = cells.flat().some((c) => c === "?");
  const legend: string[] = [];
  if (suffixed) legend.push(`${suffixed}  contested or single provider`);
  if (hasBare) legend.push("?    no data");

  return legend.length ? `${lines.join("\n")}\n\n${legend.join("\n")}` : lines.join("\n");
}
