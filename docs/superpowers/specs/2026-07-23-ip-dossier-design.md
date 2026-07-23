# IP Dossier — design

**Date:** 2026-07-23
**Branch context:** `feat/soc-threat-profile` (mirrors the hash "File identity card" work)
**Status:** approved design, pending spec review → writing-plans

## Goal

Give an analyst a single, readable "who/what/how" readout for an IP so they
*know the address*, not just its score. A passive profile only: aggregate data
the pipeline already collects (plus two cheap free-API additions) into one
consolidated **IP Dossier** card. No active scanning.

The core insight from the exploration: ~80% of what makes an analyst "know" an
IP is **already collected but buried** in per-source `details`, only visible in
the Source Breakdown accordion. This feature is primarily *surfacing and
organizing* that data, not fetching more.

## Non-goals

- **Active scanning / banner grabbing / TLS fetch on port 443.** Requires a live
  socket to the target = active. Out of scope (user chose passive).
- **ASN-neighborhood reputation** ("N malicious IPs in this AS"). High noise,
  low value for judging a single IP.
- **BGP routing-anomaly / hijack history.** Too niche for the general analyst.
- No changes to the domain or hash result layouts.

## What already exists (data audit)

| Question | Data | Where it lives now |
|---|---|---|
| What is it | `classifyType(geo)`, GreyNoise `riot`/`actor`, geo `isProxy`/`isMobile`, Tor source, `geo.reverse`/`fcrdns` | Origin card + buried in source `details` |
| What it runs | Shodan InternetDB `ports`/`cpes`/`tags`/`vulns`/`hostnames` | Exposed Services card + buried |
| How it behaves | GreyNoise classification/tags/last_seen, ThreatFox `malware_printable`, Feodo `malware` (C2), blocklist membership (dnsbl/blocklist-de/ipsum/spamhaus-drop/et-open), `result.history` | **Source Breakdown accordion only** |
| From whom | `geo.asn`/`asnOrg`/`isp`/`org`, RDAP `networkName`/`range`/`abuseContact`/`abuseOrg`, RIPEstat `prefix`/`rpkiStatus` | Origin card (partial) + **Source Breakdown only** (RDAP/RIPEstat) |

## New data (the only genuinely new fetches)

1. **PeeringDB** — ASN → network class (ISP / Content / Hosting / Enterprise /
   CDN), org name, traffic level. Free, no key. Answers "what kind of network is
   this." One `net?asn=<asn>` call.
2. **Cloud provider identification** — static ASN → provider map in `lib/ti/cloud.ts`
   (AWS 16509, GCP 15169/396982, Azure 8075, Cloudflare 13335, DigitalOcean
   14061, Oracle, Linode, Hetzner, OVH, …). **Zero network cost** — we already
   have `geo.asn`. (Range-file matching is a possible future enhancement; the ASN
   map covers the "which cloud" answer cheaply.)

Everything else in the dossier is a 0-call surface of already-collected data.

## The dossier (5 groups + footer)

Reference mockup (formal wording; `—`/"None" rows shown for illustration only —
in the real card **absent rows self-hide**):

```
┌─ IP DOSSIER ──────────────────────────────── 45.9.148.99 ─┐
│  🇳🇱  Netherlands  NL · Amsterdam, North Holland           │
│                                                            │
│  HOST CLASSIFICATION                                        │
│    Assignment type      Residential / Business endpoint    │
│    Recognized service   Cloudflare Public DNS  (RIOT)      │
│    Cloud infrastructure Amazon Web Services                 │
│    Anonymization        None (not Tor, VPN, proxy, mobile) │
│    Reverse DNS (PTR)    one.one.one.one  ✓ FCrDNS          │
│                                                            │
│  EXPOSED SERVICES                                           │
│    Open ports           22 SSH · 80 HTTP · 443 HTTPS       │
│    Detected software    Linux kernel · Debian · OpenSSH 10 │
│    Known vulnerabilities  2  CVE-2024-6387, CVE-2023-38408  │
│    Infrastructure tags  cloud, cdn                          │
│    Associated hostnames example.com                         │
│                                                            │
│  THREAT ACTIVITY            (whole group hides when clean)  │
│    Observed activity    SSH brute-force  (GreyNoise)        │
│    Last observed        2026-07-20 · target ports 22, 2323 │
│    Malware association  Emotet  (ThreatFox)                 │
│    Command and control  Emotet botnet C2  (Feodo)          │
│    Blocklist listings   IPsum ×8, UCEPROTECT, blocklist.de  │
│    Reputation history   Since 2025-11-03  ▁▂▄▆████ rising   │
│                                                            │
│  RELATIONSHIPS             (summary + pivot to detail cards)│
│    Hosted domains       3 domains, e.g. admin-panel.tax…    │
│    Passive DNS          158 historical resolutions          │
│    Related indicators   18 linked IOCs                      │
│                                                            │
│  NETWORK PROVENANCE                                         │
│    Autonomous system    AS49447  Nice IT Services Group     │
│    Network class        Hosting / NSP        (PeeringDB)    │
│    Internet provider    Nice IT Services Group Inc.         │
│    Allocation           NICEIT-NL, 45.9.148.0 to .255       │
│    Announced prefix     45.9.148.0/24   RPKI valid          │
│    Abuse contact        abuse@niceit.nl, NICE-IT NOC        │
│    Regional registry    RIPE, allocated NL                  │
│                                                            │
│  Enriched from 22 sources · checked 2026-07-23 14:12        │
└────────────────────────────────────────────────────────────┘
```

### Field → source mapping

**HOST CLASSIFICATION**
- Assignment type ← `classifyType(geo)`
- Recognized service ← GreyNoise `details.riot` + `details.actor` (RIOT common-business-service)
- Cloud infrastructure ← `cloudProvider(geo.asn, geo.org)` (new, `lib/ti/cloud.ts`)
- Anonymization ← `geo.isProxy`, `geo.isMobile`, Tor source category (`tor-exit`/`tor-relay`)
- Reverse DNS (PTR) ← `geo.reverse` + `geo.fcrdns`

**EXPOSED SERVICES**
- Open ports ← Shodan `details.ports` (mapped to service names via a small static port→name table)
- Detected software ← Shodan `details.cpes` (humanized)
- Known vulnerabilities ← Shodan `details.vulns` (CVE list + count)
- Infrastructure tags ← Shodan `details.tags`
- Associated hostnames ← Shodan `details.hostnames`

**THREAT ACTIVITY** — *entire group self-hides when the IP has no scanning, no
malware/C2, no blocklist listings, and a clean/flat history.*
- Observed activity ← GreyNoise `classification` + `categories` + tags
- Last observed ← GreyNoise `last_seen` / finding `lastSeen`
- Malware association ← ThreatFox `malware_printable` (categories/summary)
- Command and control ← Feodo (`botnet-c2` + `details.malware`)
- Blocklist listings ← dnsbl / blocklist-de / ipsum / spamhaus-drop / et-open (which listed + counts)
- Reputation history ← `result.history` (`HistorySnapshot[]`) as a sparkline of `riskScore` over time + first-flagged date. Degrades gracefully to hidden when no Redis (empty array).

**RELATIONSHIPS** — *summary + pivot only; the full Related/Passive-DNS cards
stay below. No duplication of their contents (see "cards show real evidence").*
- Hosted domains ← reverse-ip source (count + one example)
- Passive DNS ← pdns source (count)
- Related indicators ← connections/otx/threatfox linked IOC count

**NETWORK PROVENANCE**
- Autonomous system ← `geo.asn` + `geo.asnOrg`
- Network class ← PeeringDB `details.networkClass` (+ traffic level) (new)
- Internet provider ← `geo.isp`
- Organization ← `geo.org` (only when distinct from ISP/operator)
- Allocation ← RDAP `details.networkName` + `details.range`
- Announced prefix ← RIPEstat `details.prefix` + `details.rpkiStatus`
- Abuse contact ← RDAP `details.abuseContact` + `details.abuseOrg`
- Regional registry ← RDAP registry + `details.allocationCountry`

**Provenance footer** ← responded source count, `result.checkedAt`, `result.cached`.

## Architecture

Keep logic and rendering in separate, independently testable units.

### `lib/ti/ip-dossier.ts` (new, pure, no network)

`buildIpDossier(result: CheckResult): IpDossier` — the single place that digs
facts out of `geo` + each source's `details`/`categories`/`summary` + `history`
and normalizes them into a typed structure of groups → fields, **omitting absent
fields and empty groups**. All the "reach into buried details" logic lives here,
fully unit-testable with synthetic `CheckResult`s (no network), matching the
project's test conventions. Small pure helpers (port→service name, humanize CPE,
format CVE list, cloud lookup call, reputation-sparkline buckets) live here or
beside it.

`IpDossier` shape (sketch):
```ts
type DossierField = { label: string; value: ReactNode; hint?: string };
type DossierGroup = { id: string; title: string; fields: DossierField[] };
type IpDossier = { groups: DossierGroup[]; footer: string };
```
(Value may carry light structure — e.g. Pivot links, the FCrDNS badge, the
sparkline — so `value` is a renderable, but the *selection/labeling* logic is
pure and tested via the field list, not the JSX.)

### `lib/ti/cloud.ts` (new, pure)

`cloudProvider(asn?: string, org?: string): { name: string } | undefined` — a
static ASN→provider map (extensible), zero network. Unit-tested.

### `lib/ti/sources/peeringdb.ts` (new source)

Context-only source (`weight: 0`, `isEnabled()` always true — no key). Resolves
the IP's ASN (cheap lookup), then `GET https://www.peeringdb.com/api/net?asn=<asn>`,
attaching `details.networkClass` / `peeringName` / `trafficLevel`. Follows the
`feodo.ts` reference adapter: honors `AbortSignal`, returns
`{ status: isTimeout(err) ? "timeout" : "error", ... }` rather than throwing,
uses `lib/ti/http.ts` helpers. Registered in `lib/ti/registry.ts`.

*Open item for the plan:* ASN resolution strategy. PeeringDB is keyed by ASN,
but sources run in parallel before geo is merged, so the adapter cannot read the
merged `geo.asn`. Two candidates: (a) the adapter self-resolves ASN via a cheap
IP→ASN lookup (RIPE prefix-overview or Team Cymru DNS) then queries PeeringDB
(2 calls, idiomatic registry pattern); (b) a post-fan-out enrichment step in
`lib/ti/check.ts` using the already-merged `geo.asn` (1 call, but adds a
sequential hop and steps outside the source pattern). Decide in the plan;
default to (a) unless latency argues otherwise.

### `components/CheckResults/dossier.tsx` (new)

`IpDossierCard({ result })` renders the `IpDossier` structure — group headings
+ label/value grids. Reuses `SectionHeading`, `GridItem`, `Rule`, `Pivot`,
`VotingCard`, and the flag/identity line from `profile.tsx` (export the shared
bits as needed). Appends the existing `VotingCard` (geo resolution) as
`ProfileCard` does today.

### `components/CheckResults/index.tsx` (wiring)

In the IP `Results()` layout, **replace** the `Origin` (`ProfileCard`) and
`Exposed` (`ExposedServicesCard`) sections with a single dossier section. Keep
`PassiveDnsCard`, `ConnectionsCard`, `ResearchCard`, `SourceBreakdown`. Update
`IP_SECTIONS` nav accordingly (a single `dossier` anchor, or per-group anchors —
decide in plan). Domain/hash layouts unchanged.

`ProfileCard` / `ExposedServicesCard` become unused by the IP layout; the plan
decides whether to delete them or retain for reuse.

## Data flow

```
route-handler → runAll (parallel sources) → mergeFields (geo) → aggregateRisk
             → attach history (Redis, optional) → CheckResult
CheckResult → buildIpDossier() [pure] → IpDossier → IpDossierCard [render]
```

`cloudProvider()` is called inside `buildIpDossier` (pure, no network — just a
table lookup on `geo.asn`). PeeringDB data arrives via the normal source
pipeline as `details.networkClass`.

## Error / empty handling

- Every field self-hides when its source datum is absent (existing project
  pattern) — no "—" clutter. The illustrative "None"/"—" rows in the mockup do
  **not** render in production.
- The dossier header is the identity line only (flag, country, city). It does
  **not** repeat the verdict word, risk level, or the `N/M sources` tally —
  `VerdictHero` sits directly above and owns those (no duplication).
- THREAT ACTIVITY hides as a whole group when the IP is clean.
- RELATIONSHIPS hides when there are no hosted domains, passive DNS, or related
  IOCs.
- PeeringDB / any enrichment source failing degrades to its field simply not
  showing; the rest of the dossier renders. No blocking on one source.
- No Redis → `result.history` empty → Reputation history row hidden.

## Testing

- `lib/ti/ip-dossier.test.ts` — synthetic `CheckResult`s: (1) rich malicious
  host → all five groups populated with expected fields; (2) clean business
  service (Cloudflare/RIOT) → THREAT ACTIVITY group absent, Recognized service
  present; (3) sparse IP (geo only) → only classification + provenance basics,
  everything else hidden. Asserts the "cards show real evidence" rule at the
  field level.
- `lib/ti/cloud.test.ts` — ASN→provider mapping, including unknown ASN → undefined.
- `lib/ti/sources/peeringdb.test.ts` — parse a PeeringDB `net` response →
  `networkClass`; timeout/error → graceful finding.
- `bun run test` and `bun run lint` green before done. Visual check via
  `scripts/` screenshot helpers against a known-bad and known-clean IP.

## Design / visual conventions (existing skin)

- Monochrome; color reserved for the verdict word only.
- Mono font for identifiers (ASN, prefix, CVE, coordinates, ranges).
- Commas as separators, not dashes (no em/en-dash, no " - ").
- Absent rows self-hide; system fonts; flat, formal, military-grade minimal.
- Formal section labels: HOST CLASSIFICATION / EXPOSED SERVICES / THREAT ACTIVITY
  / RELATIONSHIPS / NETWORK PROVENANCE.

## Open items for the implementation plan

1. PeeringDB ASN-resolution strategy (self-resolve vs orchestrator enrichment).
2. Full cloud ASN→provider list to seed `lib/ti/cloud.ts`.
3. Nav anchors: one `dossier` section vs per-group anchors in `IP_SECTIONS`.
4. Delete vs retain `ProfileCard` / `ExposedServicesCard` after the IP layout
   stops using them.
5. Reputation-sparkline rendering (inline unicode blocks vs a tiny SVG).
