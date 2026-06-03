# Bulk Geolocation Accuracy — Design

**Date:** 2026-06-03
**Status:** Approved (design)
**Topic:** Bring the bulk-geolocation path up to the same multi-provider
reconciliation + confidence standard the single-IP path already has, by reusing
the existing `reconcileGeo` voting logic across multiple bulk providers.

## Problem

The single-IP path reconciles several geo providers (ip-api, ipwho.is,
RDAP/RIR, ipinfo, ipgeolocation) into one answer with per-field confidence
(`reconcileGeo` in `lib/ti/geo/reconcile.ts`). The **bulk path does not**:
`bulkGeolocate` (`lib/ti/geo.ts`) hits a single provider — `ip-api.com /batch` —
with no cross-checking, no confidence signal, and no authoritative tiebreaker.

Consequences:

- The country codes shown in the bulk table and the copy-friendly summary
  (`1.1.1.1 (US), …`) are only as reliable as one free provider.
- The same-country callout asserts a shared country with no confidence hedge.
- Bulk users get materially worse accuracy than single-IP users for the same IP.

Goal: reconcile multiple providers per IP in bulk, surface confidence, and feed
the reconciled country into the copy box and same-country callout — without
regressing latency for large (up to 100-IP) requests, and degrading cleanly when
optional provider keys are absent.

## Goals

- Reconcile 2+ providers per IP in the bulk path using the **same** voting,
  confidence, and country-authority logic as single-IP.
- Spend per-IP provider calls adaptively so a 100-IP request stays fast.
- Surface per-IP country confidence in the bulk table and feed reconciled
  country into the copy summary and same-country callout.
- Degrade with no regression when `IPINFO_TOKEN` is absent (bulk == today's
  ip-api-only behavior, plus the reconciliation scaffolding).

## Non-goals

- Adding a new geo provider type or changing the `TiSource` contract. Bulk reuses
  existing provider adapters / endpoints.
- Reworking risk scoring. Bulk is geo-only; all providers stay context-only.
- Single-IP reconciliation enhancements (coordinate-clustered city, ASN
  authority) — tracked as **Sub-project B**, its own spec.
- Full per-IP fan-out of all providers (ipwho.is, ipgeolocation) for 100 IPs —
  rejected: 300–500 calls, free tiers throttle, timeouts.

## Approach — tiered + adaptive fan-out

Maximize accuracy per request spent rather than fixing a provider count:

1. **ip-api `/batch`** — always (1 call, no key). Baseline, unchanged.
2. **ipinfo `/batch`** — when `IPINFO_TOKEN` is set (1 call). Strong second
   voter, especially ASN / org / privacy flags.
3. **Adaptive RDAP country authority** — RDAP is per-IP and authoritative *only*
   for country, so we never blindly fire 100 calls. Run RDAP **only for IPs
   whose country is uncertain** (fewer than 2 reporting voters, or voters
   disagree on the ISO code), concurrency-capped and cached, with a hard ceiling
   per request so a 100-IP batch cannot explode. RDAP wins country ties, matching
   single-IP behavior (`COUNTRY_AUTHORITY = "rdap-ip"` in `reconcile.ts`).

Rejected alternatives:

- *Pure batch (ip-api + ipinfo only)* — fast but RDAP-less, so it cannot break
  country disagreements where authority matters most.
- *Full per-IP fan-out* — throttles on free tiers at volume (see non-goals).

### Adaptive RDAP selection

- An IP qualifies for RDAP when, after steps 1–2, its country has **< 2 reporting
  voters** OR the reporting voters **disagree** on ISO code.
- Qualifying IPs are prioritized by need (disagreements before single-voter),
  concurrency-capped at `BULK_RDAP_CONCURRENCY` (default 8).
- A hard per-request ceiling `BULK_RDAP_MAX` (default 25) bounds worst-case
  latency. IPs beyond the ceiling are left with their step-1/2 reconciliation and
  whatever confidence that yields (no RDAP boost). This truncation is **logged**
  (count of IPs that qualified but were skipped) — never silently dropped.
- RDAP responses are cached by IP for the request's lifetime (and reuse any
  existing cache layer if present) so repeated IPs cost one call.

Both knobs read from `process.env` with the documented defaults; absent/invalid
values fall back to the defaults.

## Architecture

### Reusable reconciliation core

`lib/ti/geo/reconcile.ts` currently exposes `reconcileGeo(results:
SourceResult[])`, which maps results to an internal `GeoInput[]` before voting.
Extract the pure core and keep the existing entry point as a thin adapter:

```ts
// pure core — votes over already-extracted inputs
export function reconcileGeoInputs(inputs: GeoInput[]): GeoResolution | undefined;

// unchanged signature for existing single-IP callers
export function reconcileGeo(results: SourceResult[]): GeoResolution | undefined {
  const inputs = results
    .filter((r) => r.status === "ok" && r.geo)
    .map((r) => ({ id: r.source.id, geo: r.geo as GeoContext }));
  return reconcileGeoInputs(inputs);
}
```

`GeoInput` (`{ id: string; geo: GeoContext }`) is promoted to an exported type.
No behavior change for single-IP: it calls the same code, just one indirection
deeper. A refactor-safety test asserts identical output on shared fixtures.

### Bulk orchestrator

`bulkGeolocate` (`lib/ti/geo.ts`) becomes a small orchestrator; helpers live in a
new focused `lib/ti/geo/bulk.ts`:

1. `ip-api /batch` — existing `postJson` call, unchanged.
2. `ipinfo /batch` — when `IPINFO_TOKEN`: new `bulkIpinfo(ips, signal)` helper in
   `lib/ti/sources/ipinfo.ts` using ipinfo's batch endpoint
   (`POST https://ipinfo.io/batch?token=…` with the list of IPs), mapping each
   entry through the existing ipinfo→`GeoContext` mapper. Failure (or no token)
   degrades to "this voter didn't report" — never fails the request.
3. **Transpose** provider results into `Map<ip, GeoInput[]>` (a pure
   `transposeByIp` helper): for each requested IP, collect the `GeoContext`s that
   each provider returned for it, tagged with the provider id.
4. **Adaptive RDAP pass** (`selectUncertainIps` + capped concurrent fetch): add
   `rdap-ip` `GeoInput`s for qualifying IPs.
5. Per IP, call `reconcileGeoInputs` → `GeoResolution`; build the enriched
   `GeoRow`.

`mapBatchResults` stays for the ip-api shaping; the transpose/reconcile step
consumes its `GeoContext`s alongside the other providers'.

### Data flow

```
ips ─┬─ ip-api /batch ──────────────► [GeoContext per ip]
     └─ ipinfo /batch (if token) ────► [GeoContext per ip]
                                            │
                            transposeByIp ──┤
                                            ▼
                                 Map<ip, GeoInput[]>
                                            │
                 selectUncertainIps ──► RDAP (capped) ──► add GeoInputs
                                            │
                          reconcileGeoInputs(per ip)
                                            ▼
                                   GeoRow { geo, resolution }
```

## Data model

`GeoRow` (`lib/ti/geo.ts`) keeps its existing shape and gains one optional field:

```ts
export interface GeoRow {
  ip: string;
  version: 4 | 6;
  status: "ok" | "error";
  geo?: GeoContext;            // flattened winners — retained for compatibility
  resolution?: GeoResolution;  // confidence, alternatives, providerCount
  error?: string;
}
```

- `geo` continues to hold the flattened winning values, so the existing table
  cells, `placeOf`, and `flagUrl` usage keep working unchanged.
- `resolution` carries the per-field confidence and `providerCount`.
- The **copy summary** and **same-country callout** switch from `geo.countryCode`
  to `resolution.countryCode` (reconciled, authority-backed) when present,
  falling back to `geo.countryCode` when `resolution` is absent (e.g.
  single-provider degrade). The same-country callout adds a low-confidence hedge
  ("… likely the same country …") when the reconciled country confidence is low
  for any contributing IP.

No changes to `GeoResolution` / `ResolvedField` / `GeoContext` themselves — they
already exist from the single-IP work.

## UI surfacing

`components/BulkGeoResults.tsx`, reusing existing sketch-styled primitives — no
new design language:

- **Country cell** gains a small **confidence chip/dot** (green = high, amber =
  medium, gray = low) driven by `row.resolution?.country?.confidence`, mirroring
  the single-IP card's chip. A `title`/tooltip notes "n providers" and, on
  disagreement, the dissenting value(s).
- Rows reconciled from a single provider (no token, RDAP skipped) simply show a
  gray/low chip — accurate, not alarming.
- Copy summary and same-country callout consume the reconciled country as above.

## Error handling

Per repo convention, every added network step catches and degrades:

- ipinfo batch failure / timeout / missing token → that voter is absent; ip-api
  still drives the row.
- Individual RDAP failures drop that IP's authority boost; the IP keeps its
  step-1/2 reconciliation.
- A total ip-api failure behaves as today (the existing `postJson` error path).
- RDAP ceiling truncation is logged, not silent.

## Testing & verification

Pure Vitest, colocated, no network:

- **`reconcile.test.ts`** — add a refactor-safety case: `reconcileGeoInputs`
  produces output identical to today's `reconcileGeo` on existing fixtures.
- **`bulk.test.ts`** (new) —
  - `transposeByIp`: provider rows (including gaps / out-of-order) → correct
    per-IP `GeoInput[]`.
  - `selectUncertainIps`: picks single-voter and disagreement IPs, skips
    confident ones, enforces `BULK_RDAP_MAX`, prioritizes disagreements.
  - end-to-end (mocked fetch): two batch providers + adaptive RDAP →
    `GeoRow.resolution` with expected confidence; no-token path yields
    single-provider rows without error.
- **`ipinfo.test.ts`** — batch payload → `GeoContext[]` mapping, plus
  error/timeout fallback.

**Manual / E2E** (per CLAUDE.md): exercise bulk with a no-key environment
(ip-api + adaptive RDAP only) against a known set of IPs spanning multiple
countries; verify confidence chips and the copy/same-country outputs. UI checked
via `npm run dev` + `scripts/shot.mjs`. `npm test` and `npm run lint` must both
pass before completion.

## Implementation sequencing

1. **Reconcile core extraction** — `reconcileGeoInputs` + `GeoInput` export +
   refactor-safety test. (No behavior change; safe to ship alone.)
2. **Bulk providers + orchestration** — ipinfo batch helper, `transposeByIp`,
   adaptive RDAP, `bulkGeolocate` rewrite, `GeoRow.resolution`. (Bulk gains
   accuracy; UI still reads `geo` so it keeps working.)
3. **Bulk UI** — confidence chip on the Country cell; copy summary +
   same-country callout read reconciled country with low-confidence hedge.

## Files touched

- `lib/ti/geo/reconcile.ts` (+ `.test.ts`) — extract `reconcileGeoInputs`, export
  `GeoInput`.
- `lib/ti/geo.ts` — `GeoRow.resolution`; `bulkGeolocate` orchestrator.
- `lib/ti/geo/bulk.ts` (+ `bulk.test.ts`) — `transposeByIp`, `selectUncertainIps`,
  adaptive RDAP fetch.
- `lib/ti/sources/ipinfo.ts` (+ `.test.ts`) — `bulkIpinfo` batch helper.
- `components/BulkGeoResults.tsx` — confidence chip; reconciled country in copy
  summary + same-country callout.

## Follow-up — Sub-project B (separate spec)

Single-IP reconciliation enhancements: coordinate-clustered city selection
(dominant lat/lon cluster instead of exact string match) and provider tiering as
a tiebreaker (RDAP authoritative for ASN; paid providers outrank free on
ASN/org). Its own spec → plan cycle after this ships.
