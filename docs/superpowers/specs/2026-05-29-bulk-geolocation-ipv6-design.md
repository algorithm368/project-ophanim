# Bulk geolocation + IPv6 validation — design

**Date:** 2026-05-29
**Status:** Approved (pending spec review)

## Overview

Add a **bulk geolocation** path to the home checker: paste two or more IP
addresses (IPv4 **or** IPv6) and get a geolocation/ASN table for each, in one
request. Along the way, **improve IP validation** by adding a real IPv6 parser
with RFC-correct scope detection, so IPv6 input is finally recognized instead of
being silently rejected.

Bulk lookups are **geolocation-only** — country, region, city, lat/lon, ASN,
ISP/org, and proxy/hosting/mobile flags. No threat-intel risk scoring runs in
bulk (the full TI pipeline is single-indicator and IPv4-only). The existing
single-indicator experience is unchanged.

## Goals

- Accept and correctly validate IPv6 addresses (canonicalized, scope-aware).
- Let a user geolocate many IPs at once from the existing home input.
- Tighten IP validation generally (one shared `parseIP` / `extractIps`).

## Non-goals (explicitly out of scope)

- IPv6 in the full TI pipeline (most sources are IPv4-only).
- CSV/JSON export, a map view, or per-row threat scoring.
- Permalinks for bulk results (the single-IOC `/check/[ioc]` permalink is
  untouched).
- Caching/history for geo lookups (lightweight, one batch request).

## Behavior / routing rules

The home checker decides what to do from the raw input:

1. `ips = extractIps(query)` — valid, **routable**, deduped, capped at 100.
2. **Bulk geolocation** when `ips.length >= 2`, **or** `ips.length === 1` and
   that single IP is IPv6.
3. Otherwise the **existing single-indicator full check** runs (IPv4 / domain /
   hash) — completely unchanged.

Consequences worth stating explicitly:

- A single **routable IPv4** → full TI check (as today).
- A single **routable IPv6** → bulk table with one row (the full pipeline can't
  score it; a note explains TI scoring is IPv4-only).
- A single **reserved/private IP** (v4 or v6) → falls through to the existing
  "this address can't be checked" input message (it is dropped by `extractIps`,
  so it is not treated as bulk).
- A single domain / hash → full check (as today).
- Messy paste (duplicates, private/reserved IPs, non-IP tokens) → **silently
  reduced** to the valid routable unique IPs; only those appear in the table.
  Nothing beyond the 100-IP cap is processed.

## Architecture & file changes

### 1. `lib/ip.ts` — IPv6 + unified parsing

Existing `parseIPv4` / `ParsedIPv4` stay as-is (its leading-zero normalization
is intentional and covered by tests). Additions:

- `ParsedIPv4` and `ParsedIPv6` each gain a `version: 4 | 6` discriminant
  (additive; existing tests unaffected).
- **`parseIPv6(input): ParsedIPv6 | null`**
  - Validates structure: 2–8 hextets, at most one `::`, each hextet 1–4 hex
    digits, optional trailing embedded IPv4 (`::ffff:1.2.3.4`).
  - **Canonicalizes to RFC 5952**: expand to 8 hextets, lowercase, strip leading
    zeros per hextet, compress the longest run (≥2) of zero hextets to `::`
    (leftmost on ties). This canonical string is used for display **and** dedupe.
  - Detects non-routable scope and sets `scopeNote`:
    | Range | scopeNote |
    | --- | --- |
    | `::1/128` | Loopback (RFC 4291) |
    | `::/128` | Unspecified address (RFC 4291) |
    | `fe80::/10` | Link-local (RFC 4291) |
    | `fc00::/7` | Unique local (RFC 4193) — `isPrivate` |
    | `2001:db8::/32` | Documentation (RFC 3849) |
    | `ff00::/8` | Multicast (RFC 4291) |
    | `::ffff:0:0/96` | IPv4-mapped (RFC 4291) |
  - `isPrivate` for ULA (`fc00::/7`); `isReserved` for the rest above.
- **`parseIP(input): ParsedIPv4 | ParsedIPv6 | null`** — try v4, then v6.
- **`extractIps(input: string): (ParsedIPv4 | ParsedIPv6)[]`**
  - Split on `[\s,;]+`, refang each token (reuse `refangIOC`), `parseIP` each.
  - Keep only IPs that are **not** `isPrivate`/`isReserved`.
  - Dedupe by canonical `ip` string.
  - Cap at **100** (silently drop the remainder).
  - The single pure helper shared by the client (routing/count) and `/api/geo`.

### 2. `lib/ioc.ts` — IPv6-aware detection

`detectIOC` recognizes IPv6 as `"ip"` (swap `parseIPv4` for `parseIP` in the
ip branch; ordering vs. hash/domain is unaffected because IPv6 contains colons
which neither hash nor domain accept).

### 3. `lib/ti/geo.ts` — bulk geolocation (new)

```ts
export interface GeoRow {
  ip: string;                 // canonical
  version: 4 | 6;
  status: "ok" | "error";
  geo?: GeoContext;           // reused from lib/ti/types.ts
  error?: string;
}

export async function bulkGeolocate(
  ips: (ParsedIPv4 | ParsedIPv6)[],
  signal: AbortSignal,
): Promise<GeoRow[]>;
```

- One `postJson` to ip-api's batch endpoint:
  `http://ip-api.com/batch?fields=<fields>` with a JSON array of IP strings.
  Reuse the field list / mapping already in `sources/ipapi.ts` (factor a small
  `ipApiToGeo(data)` mapper shared by both, or duplicate the mapping if sharing
  is awkward — implementer's call, keep it DRY where clean).
- ip-api echoes `query` and returns `status: "success" | "fail"` per entry. Map
  success → `{ status: "ok", geo }`; fail → `{ status: "error", error }`.
- Preserve input order; results are keyed back to the requested IPs by `query`.
- All 100 fit in a single batch request, so no chunking is needed.

### 4. `app/api/geo/route.ts` — bulk endpoint (new)

- `runtime = "nodejs"`, `dynamic = "force-dynamic"`.
- `POST { ips: string }` (raw pasted text). `extractIps(ips)`:
  - empty result → `400 { error: "No valid, routable IP addresses found" }`.
- Run `bulkGeolocate(ips, AbortSignal.timeout(8000))` (8s; one batch call).
- Return `Response.json({ results: GeoRow[] })`. Upstream throw → `502`.
- Plain JSON only (no NDJSON streaming — it's one fast batch call).

### 5. UI — `components/Checker.tsx` + `components/BulkGeoResults.tsx` (new)

`Checker.tsx`:
- Compute the routing decision (section "Behavior / routing rules") from the
  current query using `extractIps` / `parseIP`.
- New bulk branch in `runCheck`: POST `/api/geo`, store `GeoRow[]`, render
  `<BulkGeoResults>` instead of `<CheckResults>`.
- Bulk loading state: a lightweight "Looking up N addresses…" spinner (the
  per-source `SearchProgress` is for the streaming full check and is **not**
  reused here).
- "Detected …" hint reflects bulk: e.g. *"Detected 5 IP addresses — bulk
  geolocation"* / *"Detected an IPv6 address"*.
- No URL push for bulk results (single-IOC permalink behavior unchanged).
- The single-line `<Input>` is kept; pasted multi-line lists collapse to
  spaces, which `extractIps`' whitespace split handles.

`BulkGeoResults.tsx`:
- Static table (no sorting/export), styled to match the existing sketch
  aesthetic (dashed borders, `font-hand` headers).
- Columns: **IP · Ver (v4/v6) · Country (flag emoji + name) · City/Region ·
  ASN · ISP/Org · Flags** (proxy / hosting / mobile badges).
- Country flag from `countryCode` (2-letter → regional-indicator emoji helper).
- Rows with `status: "error"` still render, showing the IP and an "unknown"
  geo cell.

### 6. Error handling

- `/api/geo`: empty extraction → 400 (surfaced via the existing `ErrorState`
  input-error UI); upstream failure → 502; per-IP failures become error rows.
- Client transport failure → existing request-error UI / retry.

## Testing (all pure, no network)

- `lib/ip.test.ts` (extend):
  - IPv6 parse: compressed (`::1`, `fe80::1`), fully expanded, mixed-case,
    embedded IPv4 (`::ffff:192.168.0.1`), `::`.
  - Canonicalization to RFC 5952 (e.g. `2001:0DB8:0000:0000:0000:0000:0000:0001`
    → `2001:db8::1`; leftmost-longest zero-run compression).
  - Scope detection for each row in the table above.
  - Rejects malformed (`::1::2`, `12345::`, `gggg::`, `1:2:3:4:5:6:7:8:9`).
  - `parseIP` dispatch (v4 vs v6 vs null).
  - `extractIps`: whitespace/comma/semicolon split, dedupe by canonical,
    drops private/reserved/non-IP, caps at 100.
- `lib/ioc.test.ts` (extend): IPv6 strings detect as `"ip"`.
- `lib/ti/geo.test.ts` (new): `bulkGeolocate` maps a mocked ip-api batch
  response (mix of `success` and `fail` entries) to the correct `GeoRow[]`,
  with `fetch` mocked (mirror the existing source tests, e.g.
  `lib/ti/sources/censys.test.ts`).

## Verification

- `npm test` and `npm run lint` pass.
- Manual: paste a v4+v6 list (e.g. `8.8.8.8, 1.1.1.1, 2606:4700:4700::1111`)
  into the home input → bulk table renders; a single `8.8.8.8` still runs the
  full check; a single `2606:4700:4700::1111` renders a one-row geo table.
