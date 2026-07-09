/**
 * Pure summaries of a bulk geolocation batch, rendered by
 * `components/BulkGeoResults.tsx` and copied verbatim by its Copy buttons.
 *
 * Sibling of `lib/ti/narrative.ts`, and it inherits that file's rule: keep them
 * honest, the summary must never describe something the data doesn't support.
 * Every claim here is traceable to a reconciled field.
 */
import type { Confidence } from "../types";
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
