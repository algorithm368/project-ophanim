# Deep-data enrichment (Phase 1) + result-card cleanup

## Goal

Give each IOC lookup more **depth** using only free / no-key (or already-keyed)
sources, and declutter the result page by removing three low-value cards to make
room. Color stays reserved for the verdict (monochrome-minimal skin).

Decisions made with the user:
- **Depth =** new intel dimensions + richer rendering of data we already have.
- **Free TI only** (no paid APIs — Shodan full host / Censys remain excluded).
- **All three IOC types**, **always-on** (no on-demand gate).
- Also: **remove** three result cards.

## Part A — Remove three result cards

Remove these from `components/CheckResults/index.tsx` for IP, domain, and hash:

| Card | Heading | Component | File |
| --- | --- | --- | --- |
| Observed activity | "Observed activity" | `ActivityCard` | activity.tsx |
| Reputation | "Reputation history" | `HistoryCard` | activity.tsx |
| Source scores | "Source scores · …" | `ScoreChart` | sources.tsx |

- Delete the now-unused component definitions, their imports, and dead helpers
  (e.g. `trendNote`). Keep `SourceHealthNotice` and `SourceBreakdown` (the
  per-source detail — that is where scores still live).
- **Keep** the Redis history *recording* in `route-handler.ts`; only the
  timeline UI is removed.
- Verify no other module imports the removed exports.

## Part B — Deep-data enrichment (architecture)

**Hybrid (Approach C).** Deep-data providers are normal `TiSource`s with
`weight: 0` (so they never move the verdict) added to the existing registries —
reusing the parallel runner, per-source timeouts, NDJSON streaming, cache, and
history with zero new orchestration. The normalized model gains **typed
deep-context fields** so the data renders as structured panels, not raw JSON —
mirroring how `geo` / `domainContext` / `hashContext` already work.

### New typed fields (`lib/ti/types.ts`)

```ts
export interface CertificateRecord {
  issuer: string;
  commonName?: string;
  sans: string[];
  firstSeen?: string;   // ISO
  notAfter?: string;    // ISO expiry
}

export interface PassiveDnsRecord {
  value: string;                 // domain (for an IP lookup) or IP (for a domain lookup)
  type: "domain" | "ip";
  firstSeen?: string;
  lastSeen?: string;
  recordType?: string;           // A / AAAA / CNAME …
}
```

Added as optional fields on `SourceFinding` (and surfaced on the result):
`certificates?`, `subdomains?` (`string[]`), `passiveDns?`.

### Merge rule

`mergeFields` currently does first-non-empty merge for single context objects.
Deep-context **array** fields (certificates / subdomains / passiveDns) can come
from more than one source (e.g. OTX + mnemonic both return pDNS), so they merge
by **union + dedupe** (by a stable key: cert serial-or-(issuer+notAfter);
subdomain string; pDNS `type|value`). This is a small, isolated addition to the
assembly step, distinct from the existing single-object merge.

## Phase 1 — sources & panels

| Source | File | Key | IOC | Produces |
| --- | --- | --- | --- | --- |
| **Cert Spotter** (SSLMate) | `lib/ti/domain/sources/certspotter.ts` | none (optional `CERTSPOTTER_API_KEY`) | domain | `certificates`, `subdomains` |
| **mnemonic** passive DNS | `lib/ti/passive-dns.ts` + `sources/pdns.ts` + `domain/sources/pdns.ts` | none | IP, domain | `passiveDns` |

- **Cert Spotter**: `GET https://api.certspotter.com/v1/issuances?domain=<apex>&include_subdomains=true&expand=dns_names&expand=issuer`;
  parse issuer (`friendly_name`), `not_before`/`not_after`, `dns_names` (SANs);
  derive unique subdomains (strip wildcards, dedupe, drop the apex). Bound size;
  own timeout. **Chosen over crt.sh during build** — crt.sh is frequently slow or
  returns 502 (verified), while Cert Spotter answered in ~0.9s.
- **passive DNS**: mnemonic `pdns/v3/<value>?limit=200` (no key) →
  `PassiveDnsRecord[]`; A/AAAA answers become IP resolutions (domain lookup) or
  domain resolutions (IP lookup), CNAME → domain. Cap rows; sort newest-first.
  **Chosen over OTX passive_dns during build** — OTX reliably exceeded a 12s
  timeout (verified); mnemonic is no-key and answered in ~6s. Caveat: mnemonic
  can still time out for hyper-popular IPs (e.g. 1.1.1.1) — it degrades
  gracefully (no panel) for those.

### UI panels (`components/CheckResults/`)

Two new flat panels in the shipped monochrome style (uppercase `SectionHeading`,
source attribution, hairline rules, mono data, pivotable chips, `▾` to expand):

1. **Certificate Transparency + Subdomains** (domain results) — certs table
   (issuer / first seen / expires / SAN count) + subdomain chips that pivot into
   their own checks; flagged subdomains tinted by verdict color only.
2. **Passive DNS** (IP + domain results) — resolution history table (value /
   first seen / last seen / owner-ASN), value is a pivot chip.

Placement in `index.tsx` (after card removal): domain → Certs/Subdomains +
Passive DNS; IP → Passive DNS; hash → (no new Phase-1 panel; benefits in Phase 2).

## Out of scope (later phases — listed, not built now)

- **Phase 2:** Sandbox behavior panel (Triage / MalwareBazaar) for hash;
  Routing/BGP panel (RIPEstat data calls + BGPView) for IP; render Shodan
  InternetDB ports/CVEs as a structured table.
- **Phase 3:** urlscan.io historical scans; convert remaining per-source
  raw-JSON disclosures to the structured renderer.
- No scoring/verdict changes (deep sources are weight 0).

## Verification

- `npm run lint` + `npm test` (add unit tests for crt.sh parsing + pDNS
  normalization + the union-dedupe merge).
- Isolated `next build` (same-FS copy, hardlinked node_modules — never touch the
  running :3000 dev server).
- Before/after screenshots (light + dark) for IP/domain/hash: the three cards
  gone, the new deep-data panels present.
