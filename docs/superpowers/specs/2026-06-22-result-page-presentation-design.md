# Result page presentation redesign

**Date:** 2026-06-22
**Status:** Design approved, pending spec review

## Problem

The indicator pipeline now produces rich, normalized context for all three IOC
types (IP, domain, hash): reconciled geo with per-field confidence, exposed
services, passive DNS, certificates, related indicators, live research intel,
and a per-source breakdown. The data is there; the question is how the result
page should present it so an analyst can read a verdict fast and pivot without
losing their place.

This spec defines the information architecture and a consistent visual skeleton
for the result page. It is a presentation-layer change only: no scoring, source,
or data-model changes.

## Design principle: inverted pyramid

The page answers an analyst's questions in the order they ask them:

1. **Is it bad?** verdict + score (one-second glance)
2. **Why do you say that?** what flagged, how sure
3. **What is it?** identity (geo/owner for IP, registration for domain, file
   facts for hash)
4. **What is it touching?** services, passive DNS, certificates, related IOCs
5. **Let me dig.** live intel + outbound pivots
6. **Prove it.** per-source breakdown

The current card order already follows this. The redesign keeps the order and
adds three things: a consistent section anatomy, inline confidence, and a
persistent identity bar.

## Section anatomy

Every block below the verdict uses one skeleton:

```
SECTION LABEL                              summary, N items  ↗
─────────────────────────────────────────────────────────────
  field            value                        ·conf· sources
  field            value
```

- Left: mono uppercase section label.
- Right: a one-line summary plus an outbound arrow (↗) that opens the source.
- Body: key/value rows. Where a field is a reconciled `ResolvedField`, show its
  confidence as a `·HIGH·` / `·MED·` / `·LOW·` tag and the agreeing source count.

User-facing copy uses commas, not dashes or " - " separators. Color is reserved
for the verdict word only; everything else is monochrome.

## Wireframes

### IP

```
┌───────────────────────────────────────────────────────────┐
│ 45.155.205.233              checked 22 Jun 03:14 · cached  │  identity bar, sticky
├───────────────────────────────────────────────────────────┤
│  [MALICIOUS]                                      88 / 100  │  BLUF
│  Flagged by 6 of 21 detectors. Listed on Feodo Tracker as  │  narrative
│  a known C2, and on 3 blocklists. Hosted on a bulletproof  │
│  range in RU.                                               │
│  21/21 detectors · 6 flagged · 13 clean · 2 no key         │  consensus line
│  ▸ why this score                                           │  disclosure
└───────────────────────────────────────────────────────────┘

┌─ PROFILE ──────────────────────────────── AS-level intel ↗ ┐
│  Country      Russia (RU)                        ·HIGH· 5  │
│  City         Moscow                              ·MED· 3  │
│  ASN          AS204601 (Bulgaria-hosting)        ·HIGH· 4  │
│  ISP          DigitalOcean-like reseller          ·MED·    │
│  rDNS         no PTR                                        │
│  Flags        hosting, proxy                               │
└────────────────────────────────────────────────────────────┘

┌─ EXPOSED SERVICES ───────────────────── Shodan InternetDB ↗ ┐
│  22/tcp SSH · 80/tcp HTTP · 443/tcp HTTPS                  │
│  3 open ports, 1 CVE flagged (CVE-2023-1234)              │
└────────────────────────────────────────────────────────────┘

┌─ PASSIVE DNS ────────────────────────── 14 resolutions  ↗ ┐
│  evil-c2.example       A     2024-01 → 2024-06            │
│  malware-drop.test     A     2023-11 → 2024-02            │
│  …9 more  [show all]                                       │
└────────────────────────────────────────────────────────────┘

┌─ CONNECTIONS ─────────────────────────── 8 related IOCs  ↗ ┐
│  domains   evil-c2.example, malware-drop.test  (click to   │
│  hashes    a1b2c3… (drops from this host)       pivot)     │
└────────────────────────────────────────────────────────────┘

┌─ RESEARCH ───────────────────────  45.155.205.233  [Copy] ┐
│  LIVE INTEL                                                 │
│   urlscan   3 recent scans      [▣][▣][▣]            ↗     │
│   wayback   2019 → 2024          2 snapshots         ↗     │
│  OPEN IN                                                    │
│   Shodan ↗  Censys ↗  GreyNoise ↗  VirusTotal ↗  [Open all]│
└────────────────────────────────────────────────────────────┘

┌─ SOURCES ──────────────────────── 21 queried · 6 flagged  ┐
│  Feodo Tracker     [MALICIOUS]  C2 botnet       100  ·1.0 │
│  AbuseIPDB         [flagged]    94% confidence   88  ·0.9 │
│  GreyNoise         clean        benign            0  ·0.7 │
│  …18 more  [show all]                                      │
└────────────────────────────────────────────────────────────┘
```

### Domain

Identity block swaps PROFILE for registration facts and adds CERTIFICATES; the
rest of the skeleton is identical.

```
┌─ PROFILE ──────────────────────────────── registration ↗ ┐
│  Registrar    NameCheap                                    │
│  Created      2024-06-01  (21 days old)  newly registered  │
│  Nameservers  ns1.cloudflare.com, ns2.cloudflare.com       │
│  Resolves to  104.21.x.x, 172.67.x.x                       │
│  DNSSEC       unsigned     SPF ok, DMARC missing           │
└────────────────────────────────────────────────────────────┘

┌─ CERTIFICATES ──────────────── crt.sh · 12 certs, 5 SANs ↗ ┐
│  Let's Encrypt R3   2024-06-01 → 2024-09-01                │
│  …                                                         │
└────────────────────────────────────────────────────────────┘
```

### Hash

Identity is file facts; CONNECTIONS plus DISTRIBUTION replace the network blocks.

```
┌─ FILE ────────────────────────────────────── identity  ↗ ┐
│  Name      invoice.exe  (+3 aliases)                       │
│  Type      Win32 EXE · 245 KB                              │
│  Family    Emotet            Label  trojan.emotet/heur     │
│  First/Last 2024-01-12 → 2024-06-20                        │
│  SHA256    a1b2c3…   imphash f00d…   ssdeep 3:xy…          │
└────────────────────────────────────────────────────────────┘

┌─ DISTRIBUTION ───────────────────── 5 in-the-wild URLs  ↗ ┐
│  hxxp://drop.evil/x.exe, hxxp://…  (defanged)             │
└────────────────────────────────────────────────────────────┘
```

## Three concrete changes vs. current implementation

1. **Sticky identity bar.** The indicator, checked-at timestamp, and cached
   marker move out of the verdict card into a pinned bar so they stay visible on
   a long report. Source: `result.ip` / `.domain` / `.hash`, `result.checkedAt`,
   `result.cached`.

2. **Inline confidence on profile fields.** Surface `ResolvedField.confidence`
   (`high`/`medium`/`low`) and the agreeing source count as a per-row tag in the
   IP PROFILE block. Source: `result.geoResolution.{country,city,asn,asnOrg,isp}`.

3. **Weight column in the source breakdown.** Show each source's
   `SourceMeta.weight` so an authoritative flag visibly outranks a weak one.
   Source: `source.source.weight` per `SourceResult`.

## Scope and non-goals

- In scope: layout, section anatomy, the identity bar, inline confidence, the
  weight column. All read existing fields already present on the result types.
- Out of scope: any change to scoring (`aggregate.ts`), sources, the data model
  (`lib/ti/types.ts`), or the research providers. No new data is fetched.
- Affected components: `components/CheckResults/` (`index.tsx`, `verdict.tsx`,
  `profile.tsx`, `sources.tsx`, plus a new identity-bar component). The card
  inventory (verdict, profile, services/certs, passive DNS, connections,
  research, sources) is unchanged; only their framing and a few rows change.

## Verification

- `npm test` and `npm run lint` pass.
- `npm run dev`, then visually check a known-bad IP, a clean IP, a newly
  registered domain, and a known-bad hash against the wireframes above. Use the
  Playwright screenshot helpers in `scripts/` for before/after captures.
