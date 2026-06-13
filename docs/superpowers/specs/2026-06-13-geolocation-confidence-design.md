# Geolocation confidence overhaul — design

Date: 2026-06-13
Status: proposed (awaiting review)

## Problem

The geo reconciliation layer (`lib/ti/geo/reconcile.ts`) decides each location
field by a **plain majority vote with every provider weighted equally**, then
labels the result `high` / `medium` / `low`. This under-serves confidence in four
ways:

1. **No provider reliability.** A vote from `reverse-dns` (a weak city hint)
   counts exactly as much as `ip-api` or `ipinfo`. The only nuance today is one
   hardcoded special-case: RDAP's allocation country forces `high`.
2. **Coarse coverage.** Single-IP lookups draw on up to 8 geo voters, but the
   **bulk** path has only `ip-api` + `ipinfo` + RDAP-for-country, so bulk can
   rarely move past two corroborators.
3. **Blunt granularity.** Coordinates are binary (`high` if ≥2 within 50 km, else
   `low` — no middle tier, and a single precise provider is always `low`). City
   is matched by normalized string only, so adjacent places ("Mountain View" vs
   "Palo Alto", ~15 km apart) read as total disagreement.
4. **No overall signal.** Only per-field chips exist; there is no single
   "how sure are we about where this is" score.

## Goals

- Reflect **per-field provider reliability** in the winner selection and the
  confidence tier.
- Add a **numeric confidence score** (0–1) per field and an **overall** geo
  confidence (numeric + tier).
- Make **city** reconciliation proximity-aware and give **coordinates** a graded
  `medium` tier.
- **Broaden coverage**: one new free no-key voter for single-IP, plus a capped
  fan-out so bulk gains a third independent city/coords voter.
- Surface an **overall geo-confidence badge** with a short "why".

## Non-goals

- No learned / dynamic / Bayesian weighting — weights are a hand-tuned static
  matrix (decided).
- No change to risk scoring or verdict. Geo sources stay `weight: 0` (context).
- Domain and hash pipelines are untouched.
- No paid providers (free-APIs-only constraint).

## Decisions (locked with user)

- **Model:** weighted-vote (keep the `Confidence` enum, add a numeric score).
- **Weights:** hand-tuned static per-field matrix in code.
- **Coverage:** single-IP **and** bulk fan-out.
- **New provider:** `freeipapi.com` — verified to return country, countryCode,
  region, city, lat/lon, asn, asnOrg over plain HTTPS JSON (no key). It returned
  a real city ("Mountain View") and precise coords for 8.8.8.8 in testing.
  `ip.guide` was rejected (null city, country-centroid coordinates).

## Architecture

All reconciliation stays **pure** (no network), so it remains fully unit-tested
via `reconcile.test.ts`. The shared core means **bulk and single-IP both benefit
automatically** from the smarter algorithm; only coverage differs per path.

### New / changed units

```
lib/ti/geo/weights.ts        NEW   PROVIDER_WEIGHTS matrix + getWeight + authority map + tunables
lib/ti/geo/reconcile.ts      EDIT  weighted tally, weighted country/coords, city clustering, overall
lib/ti/geo/bulk.ts           EDIT  capped freeipapi fan-out for uncertain IPs (mirrors RDAP)
lib/ti/geo.ts                EDIT  wire freeipapi fan-out into bulkGeolocate
lib/ti/sources/freeipapi.ts  NEW   single-IP TiSource (id "freeipapi", weight 0)
lib/ti/registry.ts           EDIT  register freeipapiSource
lib/ti/types.ts              EDIT  ResolvedField.score; GeoResolution.overall
components/CheckResults/confidence.tsx  EDIT  OverallConfidence badge
components/CheckResults/profile.tsx     EDIT  render overall badge + why line
lib/ti/geo/reconcile.test.ts EDIT  new cases
lib/ti/sources/freeipapi.test.ts        NEW   transform + isEnabled
```

## 1. Reliability weighting

New `lib/ti/geo/weights.ts`:

```ts
export type GeoField = "country" | "region" | "city" | "coords" | "asn" | "isp";

// Per-field reliability, 0–1. Unlisted providers fall back to DEFAULT_WEIGHT.
const PROVIDER_WEIGHTS: Record<string, Partial<Record<GeoField, number>>> = {
  "rdap-ip":      { country: 1.0, asn: 0.7 },          // RIR allocation authority
  "ripestat":     { country: 0.8, asn: 1.0, isp: 0.3 },// RIR routing authority
  "ip-api":       { country: .85, region: .85, city: .85, coords: .85, asn: .8,  isp: .85 },
  "ipinfo":       { country: .85, region: .8,  city: .85, coords: .85, asn: .85, isp: .8  },
  "ipgeolocation":{ country: .8,  region: .8,  city: .8,  coords: .8,  asn: .75, isp: .8  },
  "ipwhois":      { country: .7,  region: .7,  city: .7,  coords: .7,  asn: .7,  isp: .7  },
  "freeipapi":    { country: .65, region: .65, city: .7,  coords: .65, asn: .65, isp: .5  },
  "abuseipdb":    { country: .6,  isp: .5 },
  "reverse-dns":  { country: .3,  region: .2, city: .2 },
};
const DEFAULT_WEIGHT = 0.5;

export function getWeight(id: string, field: GeoField): number {
  return PROVIDER_WEIGHTS[id]?.[field] ?? DEFAULT_WEIGHT;
}

// Provider that is allocation-authoritative for a field (forces high when it
// backs the winner). Subsumes the old COUNTRY_AUTHORITY constant.
const AUTHORITY: Partial<Record<GeoField, string>> = {
  country: "rdap-ip",
  asn: "ripestat",
};
export function authorityFor(field: GeoField): string | undefined {
  return AUTHORITY[field];
}

// Tunables (exported for tests).
export const CORROBORATION_TARGET = 1.5; // summed weight that counts as "fully corroborated"
export const HIGH_SCORE = 0.66;
export const MEDIUM_SCORE = 0.45;
export const CITY_CLUSTER_KM = 25;       // merge same-area cities into one candidate
export const COORD_HIGH_KM = 25;         // multi-point spread bands
export const COORD_MEDIUM_KM = 75;
```

`tally()` and `reconcileCountry()` change from counting ids to **summing
weights**:

- For each candidate value, `weight = Σ getWeight(id, field)` over its backers.
- `reportingWeight = Σ getWeight(id, field)` over all providers that reported.
- Winner = max candidate weight (tie-break: more backers, then first seen).
- `weightedAgreement = winnerWeight / reportingWeight`.
- `coverage = min(1, reportingWeight / CORROBORATION_TARGET)`.
- `score = weightedAgreement * coverage` (0–1).
- Tier:
  - authority provider backs winner → `high`
  - else `score ≥ HIGH_SCORE` → `high`
  - else `score ≥ MEDIUM_SCORE` → `medium`
  - else `low`

This deletes the `COUNTRY_AUTHORITY` special-case; country uses the same
machinery with `authorityFor("country")`. `agreement` (existing field) keeps its
current meaning (winner backers / reporting count) for the disagreement UI;
`score` is the new weighted measure that drives the tier.

Worked examples (validate in tests):

| scenario | winnerW | reportW | wAgree | cover | score | tier |
|---|---|---|---|---|---|---|
| ipinfo alone (city) | .85 | .85 | 1.0 | .57 | .57 | medium |
| ip-api + ipinfo agree (city) | 1.70 | 1.70 | 1.0 | 1.0 | 1.0 | high |
| ip-api vs ipwhois split (city) | .85 | 1.55 | .55 | 1.0 | .55 | medium |
| reverse-dns alone (city) | .2 | .2 | 1.0 | .13 | .13 | low |
| rdap country (authority) | — | — | — | — | — | high |
| ripestat asn (authority) | — | — | — | — | — | high |

## 2. Graded confidence + overall score

Types (`lib/ti/types.ts`):

```ts
export interface ResolvedField<T> {
  value: T;
  confidence: Confidence;   // unchanged enum
  agreement: number;        // unchanged (count-based, drives "N agree · M disagree")
  score: number;            // NEW: weighted 0–1 used to derive the tier
  sources: string[];
  alternatives?: { value: T; sources: string[] }[];
}

export interface GeoResolution {
  // …existing fields…
  overall?: { score: number; confidence: Confidence }; // NEW
}
```

`overall` is a weighted blend of the located fields, importance-weighted over
**present** fields and renormalized:

```
importance = { country: .30, city: .30, coordinates: .25, asn: .15 }
overall.score = Σ(importance[f] * field[f].score) / Σ(importance[f] present)
overall.confidence = tierFromScore(overall.score)   // HIGH_SCORE / MEDIUM_SCORE
```

If no located field is present, `overall` is omitted.

## 3. Granularity

**Coordinates** (`reconcileCoordinates`): weight points by `getWeight(id,
"coords")`; centroid is the weighted mean.

- single point: `confidence = weight ≥ 0.7 ? medium : low`; `score =
  coverage(weight)`.
- multiple: `spread ≤ 25 km → high`, `≤ 75 km → medium`, else `low`. `score =
  agreementFromSpread * coverage`, where `agreementFromSpread` is `1 / 0.6 / 0.2`
  for the three bands. (Replaces the binary 50 km cutoff.)

**City** (`tally` for city, made proximity-aware): build string-keyed candidates
as today, but attach a representative coord per candidate (mean of its backers'
coords). Merge two candidates when both carry coords within `CITY_CLUSTER_KM`
(25 km): union their ids, keep the higher-weight display value, recompute the
representative coord. Candidates lacking coords stay string-keyed. Then run the
weighted tally over the merged clusters. This makes "Mountain View" and
"Palo Alto" corroborate instead of contradict.

## 4. Coverage

**Single-IP** — new adapter `lib/ti/sources/freeipapi.ts` mirroring
`ipwhois.ts`: `id "freeipapi"`, `category "context"`, `requiresKey: false`,
`weight: 0`, `isEnabled: () => true`. Maps the freeipapi JSON
(`countryName`/`countryCode`/`regionName`/`cityName`/`latitude`/`longitude`/
`asn`/`asnOrganization`) to `GeoContext`. Uses `getJson` with the **default**
fetch mode (NOT `no-cors`) — freeipapi issues a redirect, which undici follows
fine under default mode (the `no-cors` redirect hang documented in `http.ts`
only affects ipwho.is). Registered in `lib/ti/registry.ts`. It joins the
single-IP voting pool automatically via `reconcileGeo`.

**Bulk** — add a capped per-IP fan-out to freeipapi for **uncertain** IPs,
exactly mirroring the existing RDAP pattern in `bulk.ts`/`geo.ts`:

- New `fetchFreeIpApiGeo(ips, signal, concurrency)` in `bulk.ts` using the same
  `mapLimit` helper; returns `Map<ip, GeoContext>`; degrades silently on error,
  propagates abort/timeout (same as `fetchRdapCountries`).
- New env caps: `BULK_GEO_FANOUT_MAX` (default 15) and
  `BULK_GEO_FANOUT_CONCURRENCY` (default 8). Over-cap IPs are `console.warn`-ed
  (no silent truncation), same as the RDAP cap.
- In `bulkGeolocate`, after computing `perIp`, select uncertain IPs
  (`selectUncertainIps`), run the freeipapi fan-out under its cap, and push
  `{ id: "freeipapi", geo }` into each IP's inputs before `reconcileGeoInputs`.
  Bulk thus reaches `high` city/coords confidence when freeipapi corroborates
  ip-api/ipinfo.

## 5. Display

`components/CheckResults/confidence.tsx` — new `OverallConfidence` badge: a
slightly larger chip reusing the `TONE` map, label "Geo confidence: high/medium/
low", with a `title` explaining the blend.

`components/CheckResults/profile.tsx` — replace the bare "Reconciled from N geo
providers." line (line ~271) with the overall badge plus a one-line "why", e.g.:

> **Geo confidence: high** · 4 providers, 3 agree on country, coords within 12 km

A small pure helper `geoConfidenceReason(res: GeoResolution): string` (colocated
in `narrative.ts` or `confidence.tsx`) builds the sentence (commas, no dashes,
per house style). Per-field `ConfidenceChip`/`Disagreement` are unchanged.

Bulk UI (`BulkGeoResults.tsx`) needs no change — its per-row confidence already
reads `resolution.country.confidence`, which now reflects the better algorithm.
(Optionally it can switch to `resolution.overall`, but that is out of scope.)

## Data flow

```
sources[].geo  ──reconcileGeo──▶ GeoResolution{ fields+score, overall }
   (single IP, assemble.ts)        │
                                   ├─ overlayResolution ─▶ flat GeoContext (OG, history, map)
                                   └─ ProfileCard: per-field chips + OverallConfidence badge

ip-api/ipinfo/RDAP/freeipapi (bulk) ─transposeByIp─▶ perIp ─reconcileGeoInputs─▶ GeoRow.resolution
```

## Testing

`reconcile.test.ts` (new cases):
- weighted winner beats count-majority when weights differ;
- `rdap-ip` country and `ripestat` asn authority force `high`;
- single strong provider → `medium`, single weak provider → `low`;
- coordinates: single precise → `medium`; multi within 25 km → `high`; 26–75 km →
  `medium`; >75 km → `low`;
- city proximity: two differently-named-but-near cities cluster and corroborate;
- `overall` blend across present fields; omitted when nothing located;
- every `ResolvedField` carries a numeric `score`.

`weights.test.ts`: `getWeight` fallback to `DEFAULT_WEIGHT`; `authorityFor`.

`freeipapi.test.ts`: JSON→GeoContext transform from a fixture; `isEnabled`.

`bulk` is covered indirectly (pure transpose/select already tested); add a case
that a pushed freeipapi input lifts a previously single-voter row's confidence.

## Verification

1. `npm test` and `npm run lint` pass.
2. Real pipeline (no keys needed): `npm run dev`, check `8.8.8.8` (single) — badge
   renders, freeipapi appears among providers, country `high`; check a small bulk
   set — confirm a row gains confidence from the fan-out.
3. Confirm OG image / history still render (overlayResolution flat view
   unaffected by the additive `score`/`overall` fields).

## Risks & mitigations

- **freeipapi rate limit (~60/min unauth).** Bulk fan-out is hard-capped
  (`BULK_GEO_FANOUT_MAX` default 15) + concurrency-capped + silent-degrade, so a
  large bulk request never depends on it. Single-IP is one request.
- **freeipapi redirect.** Use default fetch mode (not `no-cors`); undici follows
  the redirect. Adapter catches errors → `error`/`timeout`, never throws.
- **`ResolvedField.score` is newly required.** It is computed in every
  reconcile path; the only consumers (`profile.tsx`, `BulkGeoResults.tsx`,
  `confidence.tsx`) read `confidence`/`alternatives`, so adding `score` is
  backward-safe. Update the test fixtures that build `ResolvedField` literals.
- **Threshold retuning shifts expectations.** Existing `reconcile.test.ts`
  assertions are updated alongside; constants are exported so tests pin them.

## Out of scope (future)

- Switching bulk overall confidence to `resolution.overall`.
- Persisting per-provider agreement stats to inform weights over time.
- Region-level proximity clustering (only city gets it here).
