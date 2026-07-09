# Bulk geo analyst note, design

Date: 2026-07-09
Status: approved (design)
Topic: Replace the copy-friendly column block in the bulk geolocation view with
an analyst note: one prose paragraph per address saying where the address is,
what network it sits on, and how well corroborated each of those claims is.

## Problem

`copyBlock` (`lib/ti/geo/summary.ts`) emits aligned columns:

```
8.8.8.8       US  AS15169  Google LLC?
9.9.9.9       US  AS19281  Quad9?
45.33.32.156  US  AS63949  Akamai Technologies, Inc.?

value?  contested or single provider
```

It answers "which country and which network", tersely, and it is a table wearing
a text costume. It cannot say *why* a value is uncertain, it drops facts the bulk
path already fetched (city, region, PTR, coordinates, hosting/proxy/mobile
flags), and its `?` marker reads as a typo when pasted into a ticket.

An analyst pasting into a report wants prose that tells them where an address
comes from and how much to trust it.

## Goals

- One paragraph per address, in row order, readable when pasted anywhere.
- Surface what the bulk path already knows: location, network, PTR, coordinates,
  flags.
- Every claim hedged by *its own* reconciled confidence, and disagreements named.
- Every row in the batch appears, so nothing vanishes silently.
- Pure, colocated unit tests, per repo convention.

## Non-goals

- No new providers, no coverage change to `bulkGeolocate`.
- No change to the same-country summary, which keeps its own Copy button.
- No reconciliation, weight, or scoring changes.
- No generic clause/fact engine. There are five clause shapes with distinct
  grammar; five specific builders are less code than an engine that fights them.

## Design

### 1. Module

New `lib/ti/geo/note.ts`. `summary.ts` is already ~190 lines doing two jobs;
a third and larger one would make it the file that does everything about bulk
geo. The sibling keeps each holdable: `summary.ts` answers "what is true of this
batch", `note.ts` answers "what is true of each address".

```ts
/** One paragraph per address, in row order. */
export function analystNotes(rows: GeoRow[]): string[];

/** The full note, paragraphs joined by a blank line. What the Copy button sends. */
export function analystNote(rows: GeoRow[]): string;
```

`analystNote` is exactly `analystNotes(rows).join("\n\n")`. The component renders
one `<p>` per element of `analystNotes`. Confidence is expressed in words, not a
chip, so there is no mid-sentence React injection and no seam between the
rendered text and the copied text.

Internal clause builders, one per fact shape: `locationClause`, `dissentClause`,
`networkClause`, `ptrClause`, `coordinatesClause`, `flagsClause`.

`providerLabel` and `countryCodeOf` are imported from `summary.ts`, so provider
naming and the stale-code rule live in one place.

**Deleted** from `summary.ts`: `copyBlock`, `marked`, `countryCell`, `asnCell`,
`ispCell`, and the now-unused `canonicalAsn` import if nothing else needs it
(`note.ts` needs it, so it moves there). Deleted from `summary.test.ts`: the
`copyBlock` suite and its `netRow` helper.

### 2. Grammar

```
8.8.8.8 resolves to Ashburn, Virginia, United States (US), per ip-api.com and IPinfo.
Announced by AS15169 (Google LLC). PTR is dns.google, per ip-api.com. Providers
place it near 39.04, -77.49. Flagged as hosting infrastructure.

1.1.1.1 is reported as Australia (AU), per ip-api.com. IPinfo places it in the
United States instead. Announced by AS13335 (Cloudflare, Inc.). Flagged as
hosting infrastructure.

203.0.113.7 could not be geolocated: Lookup failed.
```

**Each fact gets its own sentence, hedged by its own confidence.** One long
sentence hedged by its weakest fact would say "8.8.8.8 *is reported as* the
United States" merely because its *city* was contested, understating a country
we are certain of. So `country.confidence` governs the location verb and nothing
else; `asn.confidence` governs the network clause and nothing else.

| Clause | Rule |
|---|---|
| Location verb | `resolves to` when `country.confidence === "high"`, else `is reported as` |
| City | included only when `city.confidence !== "low"`; a lone provider's guess must not borrow the country's authority |
| Region | only ever accompanies a city, as `city, region`. A region without a city is dropped: "Virginia, United States" adds nothing a reader cannot infer, and a region carries its own separate confidence we would then be hiding |
| Attribution | names `country.sources` for *this address* (not the batch intersection the same-country sentence uses) |
| Dissent | when `country.alternatives` is non-empty: `IPinfo places it in the United States instead.` |
| Network | `Announced by AS15169 (Google LLC).` AS number canonicalized via `canonicalAsn`, because `tally` stores the raw winner with an org tail. Org is `asnOrg ?? isp`, never `geo.org`. When `asn.confidence === "low"`, append `, single-sourced` |
| PTR | `PTR is dns.google, per ip-api.com.` Always attributed, never asserted flatly, because `geo.reverse` never went through a vote. Omitted when absent |
| Coordinates | `Providers place it near 39.04, -77.49.` Two decimals (~1.1 km). Omitted when `coordinates.confidence === "low"`, since low means the points were over `COORD_MEDIUM_KM` (75 km) apart and their centroid is meaningless |
| Flags | `Flagged as hosting infrastructure, a proxy or VPN exit and a mobile network.` Only the true ones, comma-and joined via the same `joinAnd` the provider list uses, so no Oxford comma. Omitted when none |
| Unlocated | `{ip} could not be geolocated: {error}.` for `status === "error"`; `{ip} returned no country data.` for an ok row with no resolved country |

Full-precision coordinates are deliberately not printed. `reconcileCoordinates`
averages city-level guesses; rendering `39.043800, -77.487400` would assert
sub-metre knowledge of something accurate to tens of kilometres.

House style throughout: commas, no dashes.

### 3. Component

`components/BulkGeoResults.tsx`: `CopyableList` is replaced by `AnalystNote`,
keeping the same shell (label, Copy button via `useCopied`, selectable box). The
label becomes "Analyst note". The box renders `<p>` per paragraph rather than a
`<pre>`, so it wraps naturally; the `whitespace-pre` and `max-h-48` rules added
for column alignment are dropped. `SameCountryCallout` is untouched.

## Data flow

```
bulkGeolocate ──► GeoRow[] (geo + resolution)
                    ├─► summarizeCountries() ──► same-country sentence  (unchanged)
                    └─► analystNotes() ──► string[] ──► <p> each
                                        └─► join("\n\n") ──► Copy button
```

## Error handling

Every branch degrades to saying less, never to guessing or throwing.

- `analystNotes([])` returns `[]`; the component already early-returns on an
  empty batch.
- `status === "error"` yields one sentence naming the error, defaulting the
  reason to `Lookup failed` when `row.error` is absent.
- `status === "ok"` with no resolved country yields `returned no country data.`,
  rather than reaching into `geo` for a code `countryCodeOf` has ruled untrusted.
- A resolution with no `asn`, no `reverse`, no usable coordinates and no flags
  yields a one-sentence paragraph. Clauses are omitted, never emitted empty.
- The coordinates clause requires `Number.isFinite` on both components before
  calling `toFixed(2)`, so a `NaN` centroid renders no clause instead of `NaN`.
- `analystNotes(rows).length === rows.length` always. No address vanishes.

## Testing

New `lib/ti/geo/note.test.ts`, pure, no network, `@/` alias. Exact-string
assertions, because the sentences are the deliverable.

- Location verb flips on `country.confidence`: `resolves to` at high,
  `is reported as` at medium and at low.
- A low-confidence city is dropped from the location clause; a medium one kept.
- Dissent names the dissenting provider and value; absent when no alternatives.
- Network canonicalizes the AS number: `"AS13335 Cloudflare, Inc."` renders
  `Announced by AS13335 (Cloudflare, Inc.)`, org appearing exactly once.
- Network falls back `asnOrg → isp`, and never prints `geo.org`.
- `asn.confidence === "low"` appends `, single-sourced`.
- PTR is always attributed, and omitted when `geo.reverse` is absent.
- Coordinates round to two decimals; the clause vanishes at low confidence; a
  non-finite centroid emits no clause.
- Flags render only the true ones, comma-and joined for one, two, and three.
- An error row yields the one-sentence form, with and without `row.error`.
- An ok row with no country yields `returned no country data.`
- `analystNote` joins with a blank line, and `analystNotes(rows).length ===
  rows.length` on a mixed batch.

Verification: `npm test` and `npm run lint` pass, then the same live batch in the
browser. Tests cannot prove that four sentences per address across a ten-address
batch is readable rather than a wall of text. If it reads as a wall, say so
rather than declare victory.
