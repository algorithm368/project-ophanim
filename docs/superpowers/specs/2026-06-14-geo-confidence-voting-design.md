# Geo confidence voting card + bento — design

Date: 2026-06-14
Status: proposed (awaiting review)

## Problem

The geo reconciliation layer already computes rich, weighted-vote confidence:
each `ResolvedField` carries a `score`, a `confidence` tier, the provider ids
that `sources` the winning value, and the `alternatives` that dissented. A
blended `overall` (score + tier) sits on `GeoResolution`. None of this is
visible. In `components/CheckResults/profile.tsx` it all collapses into one grey
footer line, "Geo confidence: high, 4 providers, ...", and a couple of inline
"N agree, M disagree" toggles. The analyst cannot see **who voted for what**, so
the confidence reads as an opaque assertion rather than an auditable tally.

This is a **presentation-only** change. No scoring, reconciliation, or source
changes; we render data that already exists.

## Goals

- Surface the per-provider vote, per field, as a transparent **voting card**.
- Make **overall** geo confidence a first-class, visualized element (gauge).
- Lay the geo section out as a deliberate bento: map + detail row on top, the
  full-width confidence/voting card below it.
- Keep it **monochrome** (grayscale only). Hue stays reserved for the risk
  verdict, per the house "military-grade" direction.

## Non-goals

- No backend changes: reconciliation (`lib/ti/geo/reconcile.ts`), weights, and
  sources are untouched. The card is a pure read over `GeoResolution`.
- No provider reliability weight shown in the UI (decided: votes only; the
  weighting stays implicit in the resulting confidence).
- Bulk geo view (`components/BulkGeoResults.tsx`, a separate tool page) is out of
  scope; it keeps its existing tonal `ConfidenceChip`.
- Domain and hash profile cards have no geolocation; untouched.

## Decisions (locked with user)

- **Scope:** overall confidence + per-field depth, with a full voting breakdown.
- **Layout:** map + detail row on top; full-width confidence/voting card below.
- **Voting viz:** responsive, a provider x field matrix on `sm+`, collapsing to
  per-field ballots below `sm`. One transform feeds both.
- **Weights:** votes only, no per-provider weight cue.
- **Color:** monochrome. Agreement is quiet, disagreement is the only thing that
  "speaks," confidence is encoded by fill + word, never hue.
- **Micro-calls:** `RESULT` row at the bottom; the tier word is always shown
  beside the confidence dot.

## Architecture

A pure transform turns the already-reconciled `GeoResolution` into a render-ready
vote table, and a presentational card renders it (responsive matrix / ballots).
Keeping the transform pure and separate keeps it unit-testable with no network
and keeps `profile.tsx` (already large) from growing.

### New / changed units

```
lib/ti/geo/votes.ts                     NEW   buildVoteTable(res) -> VoteTable (pure, client-safe)
lib/ti/geo/votes.test.ts                NEW   classification, authority, coords, ordering, empty
components/CheckResults/confidence.tsx  EDIT  add ConfidenceDot + OverallGauge; retire colored footer chip
components/CheckResults/voting.tsx      NEW   VotingCard: gauge header + matrix (sm+) / ballots (<sm)
components/CheckResults/profile.tsx     EDIT  drop footer + inline Disagreement; render <VotingCard> below the row
```

## 1. The vote-table transform

`lib/ti/geo/votes.ts` is pure and imports only `authorityFor` from `weights.ts`
(constants + a lookup, no server code), so it is safe in a client component.

```ts
import type { Confidence, GeoResolution } from "../types";
import { authorityFor, type GeoField } from "./weights";

export type VoteStatus = "win" | "dissent" | "absent" | "scatter";

export interface VoteCell {
  status: VoteStatus;
  /** the differing value to show when status === "dissent" */
  value?: string;
  /** this provider is the allocation authority and it backed the winner */
  authority?: boolean;
}

export interface VoteColumn {
  key: "country" | "city" | "coordinates" | "asn";
  label: string;               // "COUNTRY" | "CITY" | "COORDS" | "ASN"
  winner: string;              // RESULT-row display value
  confidence: Confidence;
  cells: Record<string, VoteCell>;   // provider id -> cell
  // ballot (narrow) view, derived from the same field:
  backers: string[];                 // provider ids backing the winner
  dissent: { value: string; sources: string[] }[];
  authorityId?: string;              // provider that is authority AND backed winner
}

export interface VoteTable {
  providers: string[];         // row order (union across columns)
  fields: VoteColumn[];
}

export function buildVoteTable(res: GeoResolution): VoteTable | null;
```

Rules:

- **Columns** are the present fields among `country`, `city`, `coordinates`,
  `asn` (the four that drive `overall`). Absent fields drop their column.
- **Cell classification** per (provider, field):
  - in `field.sources` -> `win`
  - else in some `alternatives[i].sources` -> `dissent` with that alt's `value`
  - else -> `absent`
- **Coordinates** are special, because reconcile only records per-point
  dissent when the cluster is `low`:
  - `coordinates.sources` lists every provider that supplied a point.
  - confidence is `high`/`medium` (clustered): every reporter -> `win`.
  - confidence is `low` (scattered): every reporter -> `scatter` (rendered `.`),
    since no single agreed point exists. We deliberately do **not** invent a
    per-provider km figure; raw per-provider points are not stored.
  - `winner` display is `"clustered"` (high/medium) or `"scattered"` (low).
- **Authority:** `authorityFor(fieldToGeoField(key))` -> `rdap-ip` for country,
  `ripestat` for asn (none for city/coords). When that provider is in
  `field.sources`, its cell gets `authority: true` and the column records
  `authorityId`.
- **Row order:** union of all reporting providers across columns, sorted by a
  fixed `PROVIDER_ORDER` (`ip-api`, `ipinfo`, `ipgeolocation`, `ipwhois`,
  `freeipapi`, `rdap-ip`, `ripestat`, `abuseipdb`, `reverse-dns`), unknowns
  appended in first-seen order.
- Returns `null` when no field column is present (nothing to show).

A `PROVIDER_LABEL` map gives display names (`rdap-ip` stays `rdap-ip`,
`ripestat` -> `RIPEstat`, `abuseipdb` -> `AbuseIPDB`, `reverse-dns` ->
`reverse DNS`); falls back to the id.

## 2. Monochrome confidence primitives

In `components/CheckResults/confidence.tsx`:

- **`ConfidenceDot`** — a 16-viewBox SVG using `currentColor`:
  - `high`: filled disc.
  - `medium`: half-disc fill over a ring.
  - `low`: ring only.
  Color: `text-foreground` for high/medium, `text-muted-foreground` for low.
  Always rendered next to the tier word, so grayscale is never ambiguous.
- **`OverallGauge`** — reuses `ScoreRing` (already monochrome-capable) with
  `stroke="stroke-foreground"`, `value = round(overall.score * 100)`, the number
  centered, tier word beneath.
- The colored `OverallConfidence` footer chip is **removed** (its job moves into
  the card header). `geoConfidenceReason(res)` is **kept** and reused in the
  header line.
- `ConfidenceChip` and `Disagreement` stay exported (Bulk view still imports
  `ConfidenceChip`); `Disagreement` simply stops being used by `profile.tsx`.

## 3. The voting card

`components/CheckResults/voting.tsx` exports `VotingCard({ res })`. Container
matches `BentoCell`: `rounded-xl border border-foreground/10 bg-muted/30 p-4`.

**Header:** `OverallGauge` on the left, then `GEO CONFIDENCE` (mono caps) with
the tier word and `geoConfidenceReason(res)` beneath. Rendered only when
`res.overall` exists.

**Wide (`hidden sm:block`) — the tally sheet**, a semantic `<table>`:

```
PROVIDER         COUNTRY    CITY         COORDS     ASN
----------------------------------------------------------
ip-api              v          v            v         v
ipinfo              v          v            v         v
ipgeolocation       v       Palo Alto       .         v
freeipapi           v          v            v         v
rdap-ip             v *        -            -         -
==========================================================
RESULT          United St.  Mtn View    clustered  AS15169
                * HIGH      * HIGH      ( MED      * HIGH
----------------------------------------------------------
* allocation authority, RDAP country, RIPEstat ASN
```

- `<thead>`: provider column left-aligned; field columns centered; labels
  `font-mono text-[11px] uppercase tracking-wider text-muted-foreground`; a
  `border-b border-foreground/10` rule beneath.
- `<tbody>`: `divide-y divide-foreground/[0.06]`, `hover:bg-foreground/[0.03]`;
  provider labels `font-mono text-[12px] text-foreground/65`.
- `<tfoot>` `RESULT` row: `border-t border-foreground/15 bg-muted/40`; each cell
  is the `winner` value (`font-medium text-foreground`, truncate) over
  `ConfidenceDot` + tier word.
- Authority footnote in `text-[11px] text-muted-foreground`, shown only if any
  column has an `authorityId`.

**Cell rendering language (monochrome):**

| State | Render | Token |
|---|---|---|
| `win` | check glyph (lucide `Check`) | `size-3.5 text-foreground/75` |
| `dissent` | the differing `value` as text | `text-[12px] text-muted-foreground` |
| `scatter` (coords low) | mid dot `.` | `text-foreground/40` |
| `absent` | en-dash | `text-foreground/25` |
| `authority` | `Star` after the check | `size-3 text-foreground/55` |
| confidence | `ConfidenceDot` + word | `currentColor` (see 2) |

Rationale: in a column that is mostly checks, the lone cell showing "Palo Alto"
*is* the disagreement signal. Agreement recedes (a light check), disagreement
reads as content. No hue needed.

**Narrow (`sm:hidden`) — per-field ballots**, same data:

```
COUNTRY                                    * HIGH
United States
backed   ip-api . ipinfo . freeipapi . rdap-ip *

CITY                                       * HIGH
Mountain View
backed   ip-api . ipinfo . freeipapi
differs  Palo Alto, ipgeolocation
```

Each ballot: field label + `ConfidenceDot` + tier on the header row; `winner`
value; a `backed` line of `backers` (authority marked with `Star`); a `differs`
line per `dissent` entry. Coordinates show `clustered`/`scattered` as the value
and skip the dissent lines.

## 4. Layout integration

`components/CheckResults/profile.tsx`, `ProfileCard` (IP) only:

- The identity strip (flag, country, city, type chip) and the map + detail row
  are unchanged, except the inline `Disagreement` calls on country and ASN are
  removed (the card now owns disagreement).
- The detail cells become purely descriptive (network identity, reverse DNS,
  FCrDNS, coordinates) with no confidence affordances.
- Replace the footer block (lines ~271-276, `OverallConfidence` +
  `geoConfidenceReason`) with, full-width below the map/detail row:

```tsx
{res && <VotingCard res={res} />}
```

`VotingCard` no-ops (renders nothing) when `buildVoteTable(res)` returns `null`,
so a result with no reconciled geo collapses cleanly.

## Data flow

```
sources[].geo --reconcileGeo--> GeoResolution (fields: sources/alternatives, overall)
                                     |
                                     +-- buildVoteTable(res) --> VoteTable
                                                                    |
                                          VotingCard: OverallGauge + matrix (sm+) / ballots (<sm)
```

No new server work; `GeoResolution` already rides on `CheckResult.geoResolution`.

## Testing

`lib/ti/geo/votes.test.ts` (pure):

- columns include only present fields; absent field -> no column;
- cell classification: backer -> `win`; dissenter -> `dissent` with its value;
  non-reporter -> `absent`;
- coordinates: high/medium -> all reporters `win`, winner `clustered`; low ->
  all reporters `scatter`, winner `scattered`;
- authority: `rdap-ip` backing country and `ripestat` backing asn set
  `authority`/`authorityId`; a non-authority winner does not;
- provider row order follows `PROVIDER_ORDER`, unknown id appended;
- empty / no-geo resolution -> `null`.

Component behavior is exercised manually (no DOM test harness in repo).

## Verification

1. `npm test` and `npm run lint` pass.
2. `npm run dev`, check `8.8.8.8` (no keys needed): 4+ voters, country `high`,
   gauge renders, matrix shows the per-provider tally, `RESULT` row anchored,
   authority star on `rdap-ip` country.
3. Check a low-corroboration IP (single voter): one matrix row, low tier, card
   still renders sensibly.
4. Resize across the `sm` breakpoint: matrix <-> ballots swap; verify on a
   narrow viewport the ballots read cleanly.
5. Confirm OG image / history still render (they use the flat `overlayResolution`
   view, untouched).

## Risks & mitigations

- **Coords granularity.** Per-provider points are not stored, so we show
  `clustered`/`scattered` and `win`/`scatter`, not a fabricated distance. Honest
  by construction; documented above.
- **Matrix width on small/odd viewports.** The `sm` ballot fallback removes the
  matrix entirely below the breakpoint, so there is no horizontal-scroll cliff.
  Long city values truncate in `RESULT` and dissent cells.
- **`profile.tsx` size.** The card lives in its own `voting.tsx`; net new logic
  added to `profile.tsx` is one element.
- **Monochrome ambiguity.** Three confidence levels in grayscale are
  disambiguated by always pairing the dot with the tier word.

## Out of scope (future)

- Switching the bulk geo view to the monochrome dot / voting treatment.
- Showing per-provider reliability weight.
- A region column / region proximity in the matrix.
