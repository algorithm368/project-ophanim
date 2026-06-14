# Bulk aggregate geo-confidence box — design

Date: 2026-06-14
Status: approved (design)
Topic: Add an aggregate geo-confidence box to the bulk geolocation results that
summarizes, at a glance, how confidently the whole batch was located, with a
headline rate, a four-bucket distribution bar, and a provenance line.

## Problem

The bulk path (`bulkGeolocate` in `lib/ti/geo.ts`, rendered by
`components/BulkGeoResults.tsx`) already reconciles each IP across multiple
providers and stores a per-row `resolution.overall: { score, confidence }`
(computed by `reconcileGeoInputs` in `lib/ti/geo/reconcile.ts`). But the bulk UI
never surfaces that signal in aggregate. A user pasting a list of IPs sees:

- per-row country confidence chips,
- a copy-friendly one-line summary,
- a same-country callout (only when every located IP shares one country).

There is no single answer to "how confidently did we locate this whole batch?".
The single-IP card got an overall geo-confidence badge (`OverallConfidence` +
`geoConfidenceReason` in `components/CheckResults/confidence.tsx`); the bulk view
has no equivalent. The recent geolocation-confidence work explicitly left this
out of scope ("Bulk UI needs no change ... switching bulk overall confidence to
`resolution.overall` ... is out of scope").

## Goals

- Show one aggregate confidence summary at the top of the bulk results.
- Lead with a **rate** (the share of the batch that was confidently located),
  since that is what "confidence rate" asks for.
- Keep the spread honest: a four-bucket distribution (high, medium, low, no
  data), not just a single green number.
- Reuse the existing confidence palette and primitives, no new design language.
- Keep all aggregation logic pure and unit-tested, per repo convention.

## Non-goals

- No backend or coverage changes. `resolution.overall` already exists on every
  ok row; this feature only reads it.
- No new geo providers, no cap/threshold retuning, no risk-score impact.
- No per-row UI changes (the existing country chip, copy summary, and
  same-country callout are untouched).
- No CSV/JSON export, sorting, or filtering (separate concerns).

## Decisions (locked with user)

- **Layout:** rate-forward. A headline rate plus a labeled four-bucket
  distribution bar plus a provenance line. (Chosen over a single tier badge and
  over compact count chips.)
- **Aggregation basis:** per-row `resolution.overall.confidence` (the blend of
  country/city/coords/asn), not country-only. The box is about location
  confidence as a whole; the table's country column and copy summary remain
  country-based as before.
- **Rate definition:** "confidently located" = at least medium, so
  `rate = (high + medium) / total`.

## Architecture

A pure aggregation helper feeds a presentational component. No data flows back
into reconciliation or scoring.

```
GeoRow[] ──summarizeBatchConfidence──▶ BatchConfidence ──▶ <BatchConfidence/>  (top of BulkGeoResults)
   (already carries resolution.overall per ok row)
```

### New / changed units

```
lib/ti/geo/batch-summary.ts        NEW   summarizeBatchConfidence(rows) → BatchConfidence | null
lib/ti/geo/batch-summary.test.ts   NEW   bucketing, rate math, gating, provider union
components/CheckResults/confidence.tsx  EDIT  new <BatchConfidence/> component (beside OverallConfidence)
components/BulkGeoResults.tsx       EDIT  render <BatchConfidence/> as the first CardContent child
```

## 1. Aggregation helper (pure)

New `lib/ti/geo/batch-summary.ts`:

```ts
import type { GeoRow } from "../geo";

export interface BatchConfidence {
  /** All rows in the batch (located plus no-data). */
  total: number;
  /** One bucket per row; sums to total. */
  counts: { high: number; medium: number; low: number; nodata: number };
  /** (high + medium) / total, 0..1. "Confidently located" = at least medium. */
  confidentRate: number;
  /** Distinct provider ids that contributed to any resolved field, sorted. */
  providers: string[];
}

export function summarizeBatchConfidence(rows: GeoRow[]): BatchConfidence | null;
```

Behavior:

- **Bucketing**, one row → exactly one bucket:
  - `status === "ok"` with `resolution?.overall` → `high` / `medium` / `low`
    from `resolution.overall.confidence`.
  - otherwise (`status === "error"`, or an ok row with no `overall`) → `nodata`.
    (In practice every ok row has `overall` because ip-api supplies
    country/city/coords/asn, but the helper handles its absence defensively.)
- **Rate:** `confidentRate = (counts.high + counts.medium) / total`.
- **Providers:** union of provider ids across each row's resolved fields. Source
  the ids from each row's `resolution` field `sources` arrays
  (`country`, `region`, `city`, `asn`, `asnOrg`, `isp`, `coordinates`, plus
  `flags.sources`). Collect into a `Set`, return sorted. This reflects the
  providers that actually contributed across the batch (which varies, since
  uncertain IPs additionally pull RDAP and freeipapi).
- **Gating:** return `null` when `total < 2`. A single-row bulk render (a lone
  IPv6) shows no box; its per-row chip already conveys confidence.

Pure, no network, no React. Fully unit-tested.

## 2. UI component

New `BatchConfidence` in `components/CheckResults/confidence.tsx`, beside
`OverallConfidence`, reusing the existing `TONE` map (emerald = high, amber =
medium, muted = low) plus a faint track for "no data". Monochrome and flat per
the house design direction; system fonts, no `font-hand`, no sketch shadow. The
headline number stays neutral foreground (color lives only in the bar segments,
consistent with `ConfidenceChip`).

Props: `{ summary: BatchConfidence }`.

Rendered structure (counts and proportions from `summary`):

```
Batch geo confidence

  80%  confidently located
  12 of 15 addresses high or medium

  high      ████████████░░░░  9
  medium    ████░░░░░░░░░░░░  3
  low       ███░░░░░░░░░░░░░  2
  no data   █░░░░░░░░░░░░░░░  1

  reconciled across ip-api, ipinfo, RDAP, freeipapi
```

Details:

- Headline rate is `Math.round(confidentRate * 100)` with a `%`, then a plain
  count line "N of M addresses high or medium".
- Each bucket is a labeled row: label, a proportional bar
  (`count / total` width), and the count. Bars use the bucket's tone; zero-count
  buckets may be omitted to reduce noise (decided at build time, default: show
  all four so the layout is stable).
- The provenance line maps provider ids to display labels via a small local
  `id → label` map (`ip-api` → "ip-api", `ipinfo` → "ipinfo", `rdap-ip` →
  "RDAP", `freeipapi` → "freeipapi", etc.), joined with commas (house style: no
  dashes, no " - " separators). Unknown ids fall back to the raw id.
- Accessible: bars are decorative; the counts and labels carry the meaning.

## 3. Wiring

`components/BulkGeoResults.tsx`:

- Compute `const summary = summarizeBatchConfidence(rows);` near the top of the
  component.
- Render `{summary && <BatchConfidence summary={summary} />}` as the **first**
  child inside `CardContent`, above `CopyableList` and `SameCountryCallout`.
- No other change to the file; the table, copy summary, and same-country callout
  are untouched.

## Data flow

```
rows: GeoRow[]
  │  (each ok row already has resolution.overall from reconcileGeoInputs)
  ├─ summarizeBatchConfidence ─▶ BatchConfidence { total, counts, confidentRate, providers }
  │                                   │
  └───────────────────────────────────┴─▶ <BatchConfidence/>  (top of the results card)
```

## Testing

`lib/ti/geo/batch-summary.test.ts` (pure, no network):

- mixed batch buckets correctly by `resolution.overall.confidence` (high /
  medium / low);
- `status: "error"` rows land in `nodata`; an ok row missing `overall` also
  lands in `nodata`;
- `confidentRate = (high + medium) / total` for a representative batch;
- all-error batch → `confidentRate === 0`, `counts.nodata === total`;
- `total < 2` → returns `null` (gating);
- `providers` is the sorted distinct union of ids across rows' field `sources`
  (including only providers that actually contributed);
- counts always sum to `total`.

No component test is required (no logic in the view); the helper carries the
behavior.

## Verification

1. `npm test` and `npm run lint` pass.
2. `npm run dev`, paste a mixed batch of known IPs (some that reconcile cleanly,
   some sparse) and confirm: the box renders at the top, the rate matches the
   bucket counts, the bar proportions look right, the provenance line lists the
   providers that fired, and a single-IPv6 bulk render shows no box.
3. Confirm the rest of the bulk card (copy summary, same-country callout, table)
   is unchanged.

## Risks & mitigations

- **`overall` occasionally absent on an ok row.** The helper buckets such a row
  as `nodata` rather than crashing; documented above. Rare in practice.
- **Provider union cost.** Linear over rows × fields, trivial for the 100-IP
  ceiling. No memoization needed.
- **House-style drift.** The current `BulkGeoResults.tsx` still carries some
  `font-hand` / `sketch-shadow` from before the monochrome-formal redesign; the
  new box deliberately uses the formal monochrome treatment (matching the
  single-IP `OverallConfidence`) and does not add new sketch styling.

## Out of scope (future)

- Switching the same-country callout or copy summary to the aggregate signal.
- Sorting / filtering / export of the bulk table.
- A per-row overall chip (today the row shows a country chip only).
