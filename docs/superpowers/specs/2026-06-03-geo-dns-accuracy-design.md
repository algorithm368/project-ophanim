# Geo & DNS Accuracy — Design

**Date:** 2026-06-03
**Status:** Approved (design)
**Topic:** Improve the accuracy of IP geolocation and domain DNS resolution by
moving from single-provider lookups to multi-provider reconciliation with an
explicit confidence signal.

## Problem

Both accuracy-sensitive subsystems currently trust a single provider with no
cross-checking, no confidence signal, and a limited data set:

- **IP geolocation** relies solely on `ip-api.com` (`lib/ti/sources/ipapi.ts`).
  The IP orchestrator merges geo with a naive *first-non-empty* strategy
  (`mergeGeo` in `lib/ti/check.ts`). City/region/coordinates from any single
  geo-IP provider are inherently unreliable, and the user cannot tell how
  trustworthy a given field is.
- **Domain DNS** relies on a single Cloudflare DoH resolver
  (`lib/ti/domain/sources/dns.ts`) and fetches only A/AAAA/MX/NS. No PTR, no
  DNSSEC, no resolver cross-checking, no SPF/DMARC/CAA visibility.

Goal: raise the fidelity of both subsystems and **make accuracy visible** —
surface per-field confidence, provider disagreement, FCrDNS verification, DNSSEC
status, and resolver agreement in the result UI.

## Goals

- Query multiple geo providers and reconcile them into one answer with a
  per-field confidence level.
- Add authoritative registry data (RDAP/RIR) as a country/ownership tiebreaker.
- Enrich domain DNS: more record types, SPF/DMARC parsing, PTR, DNSSEC, and
  multi-resolver agreement.
- Add forward-confirmed reverse DNS (FCrDNS) on the IP side.
- Surface all new confidence/disagreement signals prominently in the result UI.

## Non-goals

- Bundling a local MaxMind GeoLite2 database (rejected: binary-DB management,
  licensing, build weight — out of step with the app's "fan out to APIs" model).
- Replacing the streaming/`TiSource` architecture. New providers are ordinary
  sources; only the reconciliation step is new.
- Reworking the risk-scoring model. All new geo providers are context-only
  (`weight: 0`) and do not move the 0–100 risk score.

## Approach

**Provider-plugin + central reconciliation layer.** Each geo provider stays an
ordinary `TiSource` (`category: "context"`, `weight: 0`) that contributes a
plain `GeoContext`, exactly as `ip-api` does today. The naive `mergeGeo` is
replaced by a pure, unit-testable `reconcileGeo` function that votes across all
contributed geo objects per field and emits a richer resolved object with
confidence and alternatives. DNS receives the same treatment: the single
resolver becomes a multi-resolver step that votes, plus new records, PTR/FCrDNS,
and DNSSEC.

This fits the existing `TiSource` / `orchestrate` / streaming model: sources stay
dumb and individually testable, per-provider progress still streams to the UI,
and the genuinely new logic (reconciliation) is isolated into pure functions.

Rejected alternatives:
- *One "geo aggregator" mega-source* — buries reconciliation inside an opaque
  adapter and loses per-provider streaming progress.
- *Local MaxMind DB* — see non-goals.

## Data model

Sources keep emitting the simple `GeoContext` they already do. Reconciliation
produces new richer types so the source contract is never complicated.

New types in `lib/ti/types.ts`:

```ts
type Confidence = "high" | "medium" | "low";

/** One reconciled field: winning value + how sure we are + what else was seen. */
interface ResolvedField<T> {
  value: T;
  confidence: Confidence;   // high = providers agree, low = split/single
  agreement: number;        // agreeing providers / providers that reported (0–1)
  sources: string[];        // provider ids backing the winning value
  alternatives?: { value: T; sources: string[] }[]; // dissenting values
}

/** Reconciled geo. Each estimated field carries confidence. */
interface GeoResolution {
  country?: ResolvedField<string>;   // countryCode rides along with the winner
  region?: ResolvedField<string>;
  city?: ResolvedField<string>;
  coordinates?: ResolvedField<{ lat: number; lon: number }>;
  asn?: ResolvedField<string>;
  asnOrg?: ResolvedField<string>;
  isp?: ResolvedField<string>;
  flags: {
    isHosting: boolean;
    isProxy: boolean;
    isMobile: boolean;
    sources: Record<string, string[]>; // flag name -> provider ids that asserted it
  };
  providerCount: number; // how many providers answered
}
```

- `CheckResult` gains `geoResolution?: GeoResolution`.
- The existing `geo?: GeoContext` is **retained as a flattened compatibility
  view** (winning values only), so existing consumers (OG image, bulk geo,
  history) keep working during and after the transition.
- `DomainContext` gains:
  - `reverse?` — PTR hostname(s) per resolved IP.
  - `dnssec?: "signed" | "unsigned" | "unknown"`.
  - `txt?: string[]`, `spf?: string`, `dmarc?: string`, `caa?: string[]`,
    `soa?: string`, `cname?: string[]`.
  - `resolverAgreement?: boolean` — false when DoH resolvers return differing
    A-record answer sets.
- `GeoContext.reverse` is upgraded on the IP side to carry FCrDNS-verified
  state (verified / unverified).

## IP geolocation: providers + reconciliation

### Providers

Each is a normal `TiSource`, `category: "context"`, `weight: 0`. Key-gated ones
follow the existing `requiresKey` / `keyEnv` / `isEnabled()` pattern; a missing
key just means one fewer voter — the app still works.

| Provider            | Key?                        | Best for                                      |
| ------------------- | --------------------------- | --------------------------------------------- |
| ip-api.com *(exists)* | no                        | city/region/coords, proxy/hosting flags       |
| ipwho.is            | no                          | second free opinion on city/country           |
| RDAP for IP (RIR)   | no                          | authoritative allocation country, net name    |
| ipinfo.io           | yes (`IPINFO_TOKEN`)        | strong ASN/company + privacy detection        |
| ipgeolocation.io    | yes (`IPGEOLOCATION_API_KEY`) | extra geo vote + ASN                        |

New adapters live under `lib/ti/sources/` and register in `lib/ti/registry.ts`,
mirroring `feodo.ts`'s error/timeout handling.

### Reconciliation

New pure module `lib/ti/geo/reconcile.ts`, `reconcileGeo(results): GeoResolution`:

- Collect every `GeoContext` from `status === "ok"` sources.
- **Categorical fields** (country, region, city, ASN, asnOrg, ISP): normalize
  (trim/lowercase, canonical ASN form), tally votes, pick the plurality winner.
  - `agreement = winningVotes / reporting`.
  - `confidence`: **high** (≥ ⅔ agree AND ≥ 2 providers), **medium** (plurality
    but contested), **low** (single provider or tie).
- **Country authority tiebreaker**: when geo providers split on country, the
  RDAP/RIR allocation country wins and is marked high confidence — it is the one
  field with a real ground truth (allocation jurisdiction).
- **Coordinates**: centroid of agreeing providers; if providers are
  geographically far apart (> ~50 km spread), drop to low confidence and keep the
  alternatives.
- **Flags** (proxy/hosting/mobile): OR across providers, recording which
  providers asserted each — any provider flagging proxy/hosting is worth
  surfacing.

`checkIp` swaps `mergeGeo` → `reconcileGeo`, sets `geoResolution`, and flattens
the winners into `geo` for compatibility.

**City display decision:** city is shown even at low confidence, visibly marked
as low-confidence rather than suppressed — an analyst prefers a hedged guess to
nothing.

## DNS enrichment

### Domain DNS

`lib/ti/domain/sources/dns.ts` is expanded, likely split into a small
`lib/ti/domain/dns/` folder (query helpers, parsers, the source) so files stay
focused.

- **More records:** add TXT, SOA, CNAME, CAA on top of A/AAAA/MX/NS. Parse TXT
  to extract **SPF** and **DMARC** (the `_dmarc` subdomain) into dedicated fields.
- **Multiple resolvers + agreement:** query Cloudflare, Google, and Quad9 DoH in
  parallel **for the A record**. If answer sets disagree, set
  `resolverAgreement: false` and surface it (catches GeoDNS, split-horizon,
  poisoning). Records other than A use a single resolver to keep request volume
  sane.
- **PTR / reverse:** resolve each A/AAAA result back to a hostname.
- **DNSSEC:** request with the DO bit / read the resolver's AD (Authenticated
  Data) flag → `dnssec: signed | unsigned | unknown`.

### IP-side reverse DNS (FCrDNS)

Promote reverse DNS to a small dedicated step that performs **forward-confirmed
reverse DNS**: PTR for the IP, then forward-resolve the returned hostname and
confirm it points back to the original IP. The result carries verified /
unverified state — a real trust signal, since forged PTRs are common.

### Error handling

Per convention, each resolver/record query catches and degrades: a failed
resolver drops out of the agreement vote rather than failing the whole lookup;
adapters return `{ status: isTimeout(err) ? "timeout" : "error", error }`.

## UI surfacing

Reuses the existing sketch-styled primitives
(`components/CheckResults/primitives.tsx`) — no new design language, just
confidence chips and disclosure affordances layered onto current cards.

**IP geo card** (`components/CheckResults/profile.tsx`):
- Each estimated field (country, city, region, ASN) gets a small **confidence
  chip** — green = high, amber = medium, gray = low — from
  `ResolvedField.confidence`.
- When providers disagree, a tappable **"N providers · disagree"** affordance
  reveals the alternatives (which provider said what), collapsed by default.
- A small **"based on N providers"** line anchors overall trust.
- Reverse DNS shows an **FCrDNS verified / unverified** badge.
- Proxy/hosting/mobile flags note which providers asserted them.

**Domain DNS view:**
- **DNSSEC** status badge (signed / unsigned).
- **Resolver agreement** indicator — quiet "all resolvers agree" vs prominent
  "resolvers disagree" warning with the differing answer sets.
- New records (SPF/DMARC/CAA/TXT/SOA) rendered in the existing
  details/expandable style; SPF/DMARC presence is a small posture signal.

## Testing & verification

Pure unit tests (Vitest, colocated, no network), per repo convention:

- **`lib/ti/geo/reconcile.test.ts`** (the core): unanimous → high; plurality
  with one dissenter → medium; single provider → low; country tie broken by RDAP
  authority; coordinate centroid + far-apart spread → low; flags OR'd with
  provider attribution; empty / all-error input → no resolution.
- **Provider adapters**: each new source maps a captured sample payload →
  `GeoContext` (mirroring `ipapi.test.ts`), plus the error/timeout fallback path.
- **DNS parsing**: TXT→SPF/DMARC extraction, MX/PTR host normalization,
  resolver-disagreement detection, DNSSEC AD-flag reading, FCrDNS
  verified-vs-forged logic — pure functions fed canned resolver responses.

**Manual / E2E** (per CLAUDE.md): no-key providers (ip-api, ipwho.is, RDAP, DoH
resolvers) exercise the real pipeline end-to-end against a known IP and domain.
UI checked via `npm run dev` + `scripts/shot.mjs`. `npm test` and `npm run lint`
must both pass before completion.

## Implementation sequencing

Three independently testable, shippable phases:

1. **Data model + reconciliation + IP providers** — new types, `reconcileGeo`,
   new geo source adapters, `checkIp` swap. (`geo` compatibility view keeps the
   UI working before phase 3.)
2. **DNS enrichment** — expanded domain DNS resolver/parsers, multi-resolver
   agreement, DNSSEC, IP-side FCrDNS.
3. **UI surfacing** — confidence chips, disagreement disclosure, FCrDNS/DNSSEC
   badges, resolver-agreement indicator.

## Files touched

- `lib/ti/types.ts` — new `Confidence`, `ResolvedField`, `GeoResolution`;
  `DomainContext` and `GeoContext` extensions; `CheckResult.geoResolution`.
- `lib/ti/geo/reconcile.ts` (+ `.test.ts`) — new reconciliation module.
- `lib/ti/sources/ipwhois.ts`, `rdap-ip.ts`, `ipinfo.ts`, `ipgeolocation.ts`
  (+ tests) — new geo providers.
- `lib/ti/registry.ts` — register new providers.
- `lib/ti/check.ts` — `mergeGeo` → `reconcileGeo`.
- `lib/ti/domain/dns/` — expanded DNS resolution, records, parsers (+ tests).
- IP-side FCrDNS step (new small module under `lib/ti/`).
- `components/CheckResults/profile.tsx` and the domain view — confidence-aware UI.
