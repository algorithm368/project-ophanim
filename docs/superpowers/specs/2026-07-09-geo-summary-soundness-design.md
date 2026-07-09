# Bulk geo summary soundness, design

Date: 2026-07-09
Status: approved (design)
Topic: Make the same-country callout and the copy-friendly summary in the bulk
geolocation view assert only what the reconciled data supports, extract both into
a pure unit-tested module, and normalize country vote keys so code-only and
name-only providers stop registering as a disagreement.

## Problem

`components/BulkGeoResults.tsx` builds two user-facing artifacts inline, with no
tests: a one-line copy-friendly summary (`copyLineOf`) and a same-country callout
(`sameCountryOf` + `SameCountryCallout`). Both overstate the evidence.

1. **`providerCount` is a `Math.max` across rows** (`BulkGeoResults.tsx:55`).
   `bulkGeolocate` (`lib/ti/geo.ts`) only fans out to RDAP and freeipapi for IPs
   flagged by `selectUncertainIps`, so coverage genuinely differs per address.
   Taking the max advertises the best-covered IP's evidence for the whole batch.
2. **`providerCount` counts providers that returned any geo, not a country.**
   `reconcileGeoInputs` sets `providerCount = inputs.length`
   (`lib/ti/geo/reconcile.ts:335`). Saying "reconciled across 4 geolocation
   providers" about a *country* overstates when only two voted on country.
3. **`"as reported by ip-api.com"` is hardcoded** (`BulkGeoResults.tsx:111`).
   When the single reporting provider was ipinfo, the sentence names the wrong
   source.
4. **Disagreement is invisible.** A non-empty `resolution.country.alternatives`
   means providers contradicted each other on that address, yet the sentence
   still reads "are located in the same country".
5. **Excluded IPs go unmentioned.** Rows without a country are silently filtered
   out, so "Same-country summary" can head a claim covering two of five rows.
6. **`codeOf` can pair a reconciled name with a stale code.**
   `overlayResolution` only writes `geo.countryCode` when the winning vote
   carried a code (`reconcile.ts:361`). For a name-only winner the base ip-api
   code survives, and `resolution?.countryCode ?? geo?.countryCode` then returns
   a *losing* country's code.
7. **The copy line answers "where" but not "what".** It emits `1.1.1.1 (US)`.
   The user learns the country and nothing about the network.
8. **Country votes key on `code || normalizeKey(name)`** in two places,
   `reconcileCountry` (`reconcile.ts:290`) and `countryKey` (`bulk.ts:33`). A
   code-only provider (RDAP: `US`) and a name-only provider (`United States`)
   tally as two candidates, producing a false disagreement, a false `contested`
   count, depressed confidence, and a wasted RDAP lookup via
   `selectUncertainIps`. Latent today because every current provider emits a
   code.

`lib/ti/narrative.ts` is the house precedent for this kind of text: pure,
unit-tested, and carrying the comment *"Keep them honest: the card must never
describe something the data doesn't support."* The bulk view has no equivalent.

## Goals

- Every sentence and every column is backed by the reconciled data, and stays
  true when copied out of context.
- Sentence and copy block derive from one structured summary, so on-screen text
  and copied text cannot drift apart.
- The copy block identifies the network (ASN, ISP), not just the country.
- Pure logic, colocated unit tests, per repo convention.
- Code-only and name-only country votes for the same country tally as one.

## Non-goals

- **No coverage change to `bulkGeolocate`.** RDAP and freeipapi stay adaptive,
  gated by `selectUncertainIps`. Fanning out to every IP was considered and
  rejected: it costs latency and outbound requests against the existing
  `BULK_RDAP_MAX` (25) and `BULK_GEO_FANOUT_MAX` (15) caps.
- **No change to `providerCount`'s meaning** in `GeoResolution`. The new sentence
  stops using it, so redefining it is unnecessary churn.
- No scoring, weight, or authority changes (`lib/ti/geo/weights.ts` untouched).
- The IPv6 bulk-input bug reported alongside this work is tracked separately.

## Design

### 1. `lib/ti/geo/summary.ts`, the shared structure

```ts
/** Country code for a row, or undefined when nothing trustworthy is known. */
export function countryCodeOf(row: GeoRow): string | undefined;

export interface CountrySummary {
  country: string;   // display name of the winning country
  code: string;      // ISO code, uppercase
  ips: string[];     // located IPs, in row order
  located: number;   // ips.length
  total: number;     // rows.length
  confidence: Confidence; // weakest located row, not an average
  agreedBy: string[];     // provider display names, intersected across located rows
  contested: number;      // located rows whose country carried alternatives
}

export function summarizeCountries(rows: GeoRow[]): CountrySummary | null;
```

`countryCodeOf` resolves in order, and is the fix for defect 6:

1. `resolution.countryCode` present, use it;
2. `resolution` present but no `countryCode`, return `undefined`. The base code
   is known-untrustworthy here, so the row drops out of the same-country set
   rather than lying;
3. no `resolution` at all, use `geo.countryCode`, since nothing overrode it.

`summarizeCountries` returns `null` when fewer than two rows have a code, or when
the coded rows do not all share one code. This preserves today's gate.

`confidence` is the weakest located row (the existing `RANK` minimum). A batch
claimed at "high" when one address was a coin flip is the overstatement being
removed.

`agreedBy` is the **intersection** of `resolution.country.sources` across located
rows, mapped through a `PROVIDER_LABEL` table (`ip-api` → `ip-api.com`, `ipinfo`
→ `IPinfo`, `rdap-ip` → `RDAP`, `freeipapi` → `freeipapi`), falling back to the
raw id for anything unlisted so a new provider degrades to a readable id rather
than vanishing. Only the intersection truthfully "agreed" about the batch; a
union would imply more agreement than any single address had.

`contested` counts *rows*, not providers, so the sentence can say "providers
disagreed on 1 address", which a reader can check against the table.

### 2. The same-country sentence

Rendered above the copy block, and copied as plain text by its button. Weak
evidence is stated inside the sentence, never in a separate caveat line that
would be lost on copy.

```
4 of 6 addresses resolved to a country. All 4 are located in the same country,
United States (US), as reported by ip-api.com on all 4 addresses, providers
disagreed on 1 address.
```

Assembly rules:

- Coverage clause is always present: `{located} of {total} addresses resolved to
  a country.`
- Verb follows `confidence`: `are located in` for high, `are likely located in`
  otherwise.
- Attribution follows `agreedBy.length`:
  - `>= 2` → `agreed by {names} on all {located} addresses`
  - `=== 1` → `as reported by {name} on all {located} addresses` (a lone
    provider cannot "agree")
  - `=== 0` → `backed by different providers per address` (no names)
- Contested clause appended only when `contested > 0`:
  `providers disagreed on {n} address(es)`.

House style: commas, no dashes.

The rendered version interleaves a `ConfidenceChip` after the country; the copied
version emits the same words as plain text. Both are built from the same
`CountrySummary`, so they cannot assert different things.

### 3. The copy block

Aligned monospace columns, one address per line. Columns sidestep the
comma-in-ISP-name problem (`Cloudflare, Inc.`) that a CSV line would create.

```
1.1.1.1      US   AS13335  Cloudflare, Inc.
8.8.8.8      US   AS15169  Google LLC
9.9.9.9      US?  AS19281  Quad9
203.0.113.7  ?    ?        ?

value?  contested or single provider
?       no data
```

Rules:

- **No truncation.** Column widths size to the widest actual value. Clipping an
  org name would name a different organization than the data holds, which is the
  exact class of bug being removed. Long IPv6 addresses widen column one.
- **Two distinct markers.** A `?` *suffix* on a value means the value is present
  but its reconciled confidence is not `high`. A *bare* `?` means no data for
  that field.
- **Per-field confidence.** Country, ASN and ISP each take their marker from
  their own `ResolvedField` (`resolution.country`, `.asn`, `.isp`). An address
  may legitimately print `US` beside `AS13335?`.
- **The legend prints only the markers actually used.** A fully high-confidence
  batch carries no legend. The suffix line is keyed by the placeholder `value?`,
  not by an example cell: on real batches the first suffixed cell is often a long
  org name (`Cloudflare, Inc?`), and the two markers must read as distinct rules.
- **The ASN column prints the canonical AS number.** `tally` groups ASN votes by
  `canonicalAsn` but stores the *raw* winning string, so `resolution.asn.value`
  is `"AS13335 Cloudflare, Inc."`. The org tail is stripped: it already has its
  own column, and it destroys the alignment.

ISP column ladder, in order:

1. `resolution.isp` present, print it, marked by its own confidence;
2. else `resolution.asnOrg` present, print it, marked by its confidence;
3. else a resolution exists but neither resolved, print a bare `?`. Do **not**
   fall back to `geo.org`: `org` is a raw provider field that never went through
   reconciliation and carries no confidence, and this column is
   confidence-marked;
4. else no resolution at all, print `geo.isp ?? geo.org` with a `?` suffix, since
   nothing corroborated it.

### 4. Country vote-key normalization

No ISO 3166 name table is added. The mapping is derived from the batch itself, in
`lib/ti/geo/geokit.ts`:

```ts
/** Map normalized country name -> ISO code, learned from inputs carrying both. */
export function countryKeyIndex(
  entries: Iterable<{ code?: string; name?: string }>,
): Map<string, string>;

/** Vote key for one provider's country: its code, else a learned code, else its name. */
export function countryVoteKey(
  geo: { countryCode?: string; country?: string },
  index: Map<string, string>,
): string;
```

Two passes. First, every input carrying both a code and a name teaches the index
that `"united states" → "US"`. The index is additionally seeded, for each
observed code, with the `Intl.DisplayNames` canonical English name, so a
name-only provider matches even when no coded provider spelled the name out.
Second, a name-only input looks itself up: found, it joins that code's vote; not
found, it keys on its own normalized name and remains a separate candidate.

Remaining gap, accepted deliberately: a spelling variant that neither a coded
provider nor `Intl` produced (a provider emitting `Russian Federation` when the
others said `Russia`, with no `RU` anywhere) still splits the vote. With no code
present in the data, merging two different strings would be a guess, and guessing
is what this work removes.

Both call sites adopt it:

- `reconcileCountry` (`reconcile.ts`) for the tally itself, removing false
  `alternatives` and false depressed confidence;
- `countryKey` (`bulk.ts`) so `selectUncertainIps` stops flagging the false
  disagreement, which also stops it spending an RDAP lookup on a non-problem.

### 5. Component changes

`BulkGeoResults.tsx` renders from the module and holds no assembly logic.
`CopyableList` and `SameCountryCallout` keep their existing shells (label, Copy
button via `useCopied`, selectable box) and their current styling.

### 6. Defect to fix mapping

| # | Defect | Fixed by |
|---|--------|----------|
| 1 | `Math.max` on `providerCount` | Sentence stops using `providerCount`; attribution comes from the `agreedBy` intersection, confidence from the weakest row |
| 2 | `providerCount` counts any-geo providers | Same as above; `providerCount` keeps its meaning and loses this consumer |
| 3 | Hardcoded `ip-api.com` | Attribution rules in §2, names come from `country.sources` |
| 4 | Disagreement invisible | `contested` in `CountrySummary`, surfaced by the contested clause |
| 5 | Excluded IPs unmentioned | Mandatory coverage clause, `{located} of {total}` |
| 6 | Stale code paired with reconciled name | `countryCodeOf` ladder in §1 |
| 7 | Copy line omits the network | ASN and ISP columns in §3 |
| 8 | Code-only vs name-only vote split | `countryVoteKey` in §4, adopted by both call sites |

## Data flow

```
bulkGeolocate ──► GeoRow[] (geo + resolution)
                    │
                    ├─► summarizeCountries() ──► CountrySummary | null
                    │        ├─► sentence text (plain, for copy)
                    │        └─► sentence parts (for render + ConfidenceChip)
                    │
                    └─► copyBlock() ──► aligned columns + legend
```

## Error handling

- `summarizeCountries` returns `null` rather than throwing on any degenerate
  input (empty rows, all-error rows, fewer than two located, mixed countries).
  The callout does not render.
- `countryCodeOf` returns `undefined` rather than guessing.
- `Intl.DisplayNames` is wrapped: an unsupported locale or an invalid code yields
  no seed entry rather than throwing. The index is still usable.
- Rows with `status === "error"` count toward `total` and never toward `located`.

## Testing

New `lib/ti/geo/summary.test.ts` (pure, no network, `@/` alias). The assertions
are the deliverable, so sentence and block builders get exact-string tests:

- `countryCodeOf` across all three branches, with the stale-code case pinned: a
  name-only winner yields `undefined`, not the base code. Regression test for
  defect 6.
- `summarizeCountries` returns `null` below two located rows, and when located
  rows disagree on country.
- `confidence` takes the weakest located row, not the average or the first.
- `agreedBy` intersects: `{ip-api, ipinfo}` ∩ `{ip-api, rdap-ip}` → `[ip-api.com]`,
  and the sentence reads `as reported by` (singular), not `agreed by`.
- Empty intersection → `backed by different providers per address`, no names.
- `contested > 0` appends the disagreement clause; `contested === 0` omits it.
- Coverage: four located of six total says so.
- Copy block: columns size to the widest value with nothing clipped; the legend
  prints only markers in use; a fully high-confidence batch has no legend; the
  ISP ladder walks all four rungs.

Extended in existing files:

- `geokit.test.ts`: a code-only vote and a name-only vote merge into one
  candidate; an unlearnable name stays separate; `Intl.DisplayNames` seeding
  covers the case where no provider paired the code with a name.
- `reconcile.test.ts`: RDAP `US` plus a name-only `United States` tally as a
  single vote, yielding no `alternatives` and no depressed confidence. Existing
  tests pass untouched.
- `bulk.test.ts`: `selectUncertainIps` no longer flags that pair as a
  disagreement.

Verification: `npm test` and `npm run lint` both pass, then the rendered block
and sentence are checked in the browser against a real mixed batch (one clean
address, one contested, one unlocatable), since tests alone do not prove the
column alignment or the chip placement.
