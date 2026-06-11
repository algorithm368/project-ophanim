# TI free-tier data coverage — enrichment (Phase 2+)

## Goal

We already query 40+ TI sources but **parse only a fraction of what each free
response returns**. This spec catalogs the free-tier data the adapters
fetch-but-drop (or could get for one extra free call), maps each gap to the
normalized model in `lib/ti/types.ts`, and orders the work by value ÷ effort.

This is the follow-on to `2026-06-11-deep-data-enrichment-design.md` (Phase 1 =
Certificate Transparency + passive DNS). Same constraints carry over:

- **Free / no-cost tiers only.** Anything that needs a paid plan is excluded
  (Shodan host API, Censys, VT premium relationships, GreyNoise v3, ipinfo
  Basic). See "Skip / paid-gated" below for the honest ceilings.
- **Monochrome-minimal, formal UI. No edits to shipped components and no new
  cards.** Every addition surfaces through render channels existing cards already
  drive — see "UI surface" below. Detail-document style (label→value rows +
  relation pivots), not node-edge graphs.
- **No verdict regressions.** Most additions are context (`weight: 0`); the one
  intended scoring change is URLhaus-host blocklist membership.

## How this was produced

A 16-agent audit (one per source family) read each adapter and cross-checked the
**current** official free-tier API docs (live fetch, not memory), then a
synthesis pass ranked the gaps. Findings below are the audit output; the two
load-bearing claims were re-verified against the code:

- **Passive DNS never reaches Related** — confirmed. `lib/ti/passive-dns.ts`
  emits `passiveDns`, but `relationsFor()` (`lib/relations.ts`) only merges
  `ipRelations`/`domainRelations`/`hashRelations` + `sourceRelations`; none read
  `result.passiveDns`. The `hosted`/`resolved` keys already exist in
  `RELATION_META` + `RELATION_ORDER`, unused.
- **VT hash over-spends quota** — confirmed. `lib/ti/hash/sources/virustotal.ts`
  fires **7 requests per hash** (main + 4 indicator-rel + 2 url-rel). `itw_urls`
  is Enterprise-only (dead on the free key) yet still fetched. `last_analysis_results`,
  `ssdeep`, `imphash` are never read, so `hashContext.detectionNames` is empty.

## Two dominant themes

1. **Free related-indicator pivots are everywhere and almost none reach the
   Related readout.** Passive-DNS rows, payload/C2 hashes, rDNS hostnames, and
   cross-domain cert SANs are parsed-but-dropped or fetched-but-ignored.
2. **`hashContext` is under-filled.** ssdeep / imphash / tlsh, `detectionNames`,
   firstSeen / lastSeen are returned by nearly every hash source but unmapped.

Quota is rarely the blocker — most wins cost **zero** extra calls.

## Quick wins — zero extra API calls (data already on the wire)

| Source | Unused data | Maps to | Why it matters |
| --- | --- | --- | --- |
| **mnemonic pDNS** (IP+domain) | resolutions parsed into `passiveDns`, no `relations[]` emitted | `relations[]` (`hosted`/`resolved`) | Related readout never reads `passiveDns`. Pure reuse, top pivot win |
| **VirusTotal** (all 3) | `last_analysis_results` (per-engine), `total_votes`, `last_https_certificate` | `hashContext.detectionNames`, details, `certificates[]` | Names *what* flagged it, not just a count |
| **MalwareBazaar** (hash) | `vendor_intel[*].malware_config` (C2 + dropped hashes) | `relations[]` (`contacts`/`drops`) | Strongest hash pivot, already in `get_info` |
| **Triage / Hybrid Analysis** (hash) | HA `domains[]`/`hosts[]`/`extracted_files[].sha256`/`related_*_hashes`; Triage `iocs` | `relations[]` (`contacts`/`drops`/`parent`) | Dropper→payload + C2 chains in the overview we fetch |
| **ThreatFox** (all 3) | `malware_samples[]` (md5/sha256) | `relations[]` (`sample`) | IOC → associated sample hashes, zero cost |
| **AbuseIPDB** (IP) | `reports[].categories[]` + `hostnames[]` (needs `verbose=true`, **same call**) | named categories + `relations[]` (`rDNS`) + `geo` | Shows *what* an IP is reported for |
| **VT domain** | `last_dns_records`, `whois`/`creation_date`/`registrar` | `domainContext.*` | Could drop the separate `/resolutions` call |
| **MB / VT / URLhaus** (hash) | `ssdeep`, `imphash`, `tlsh`; `code_sign`; `yara_rules` | `hashContext` (fields exist, unpopulated) + `certificates[]` | File identity, clustering, trusted-signer = benign signal |
| **OTX** (all 3) | pulse `malware_families` / `adversary` / `attack_ids` (MITRE) | categories + `details.adversaries` | Already in the `/general` body we fetch |
| **RDAP** (IP+domain) | abuse/registrant entities, registration date, DNSSEC `delegationSigned` | `details.abuseContact`, `domainContext.abuseEmail`/`dnssec` | Flat interface ignores nested fields today |
| **Shodan InternetDB** (IP) | `hostnames[]` | `relations[]` (`rDNS`) | Already surfaced via `shodanHostnames()` for `host`; confirm/keep |
| **URLhaus host** (domain) | `blacklists{spamhaus_dbl, surbl}` | **score / malicious** + categories | Reputable-blocklist confirmation invisible to `aggregateRisk` |
| **`lib/relations.ts`** | domain `cname`/`reverse`/`ipv6` in context, never relations | `relations[]` (`CNAME`/`rDNS`/`AAAA`) | Pure relations-layer change, no adapter touch |
| **Feodo** (IP) | `hostname`, `as_number`/`as_name`/`country` | `relations[]` (`rDNS`) + `geo` | Cached feed, zero requests |
| **Kaspersky / Pulsedive / Maltiverse** (hash) | KOTIP `FirstSeen`/`LastSeen`/`Signer`; Maltiverse `dns_request[]`/`tag[]`; Pulsedive `feeds` | `hashContext.firstSeen`/`lastSeen`/`tags` + `relations[]` (`resolves`) | Timeline + domain pivots |
| **ipwho.is** (IP) | `connection.domain` (AS operator domain) | `relations[]` | Free pivot edge, on the wire |

## High-value enrichments — one extra free call

| Source | New endpoint / param | Unlocks | Quota cost | Related? |
| --- | --- | --- | --- | --- |
| **VirusTotal** (all 3) | append `?relationships=…` to the **main** GET | same pivots, **collapses 1+N → 1 request** | **saves** quota | ✅ |
| **OTX** (IP+domain) | `GET …/malware` (parallel to `/general`) | sample hashes contacting the indicator | +1 | ✅ |
| **OTX** (hash) | `GET …/file/{hash}/analysis` | file identity + ssdeep + Cuckoo contacted IOCs | +1 | ✅ |
| **CIRCL hashlookup** | `/lookup/parents` + `/lookup/children` (gate on a hit) | parent/child file hashes | +1–2, only on hits | ✅ |
| **Criminal IP** | `/report/summary` → full `/v1/asset/ip/report` (same 1 credit) | port products/CVEs, `connected_domains`, `abuse_record` | same credit | ✅ |
| **RIPEstat** | `/data/rpki-validation` | `details.rpkiStatus` + soft-risk tag | +1 (1000/day fair-use) | — |

## Related-indicator expansion (active work area)

Free sources that can grow `relations[]`, by IOC type:

- **IP** — mnemonic pDNS query→domain (`hosted`); InternetDB/AbuseIPDB/Feodo
  `hostnames`/`hostname` (`rDNS`); ipwho.is `connection.domain`; OTX `/malware`;
  VT `communicating_files` (inline via `?relationships=`).
- **Domain** — mnemonic pDNS A/AAAA (`resolved`); `lib/relations.ts` `cname`→
  `CNAME`, `reverse`→`rDNS`, `ipv6`→`AAAA` from existing context; CertSpotter
  cross-apex SANs; VT `communicating_files`/`subdomains`/`siblings`.
- **Hash** — MB `malware_config` (`contacts`/`drops`); ThreatFox
  `malware_samples` (`sample`); Triage/HA contacted/dropped/parent; Maltiverse
  `dns_request` (`resolves`); CIRCL parents/children; VT relationship collapse.

## Skip / paid-gated (honest ceilings)

- **GreyNoise** — Community endpoint already near-fully consumed; actor/tags/
  ports/IP-similarity/first_seen are **paid v3 only**. Only free fix is cosmetic:
  RIOT `name` is mislabeled `details.actor` (it's a business-service name).
- **VT `itw_urls`** — Enterprise-only, returns nothing on the free key, and
  **wastes a relationship slot → remove it.** Also paid: `downloaded_files`,
  `similar_files`, `embedded_*`. Respect **500/day + 4/min**: the
  `?relationships=` collapse is mandatory, not optional.
- **OTX `/passive_dns`** — free but reliably exceeds a 12s timeout (mnemonic
  already chosen). Skip `/geo` (redundant) and `/reputation` (usually null).
- **Criminal IP** — full `/report` is free but spends **1 credit** from a
  limited monthly pool; make it the single richer call, never summary + report.
- **Shodan host API, ipinfo privacy/company, ipgeolocation/ipwho.is security
  modules** — all paid → excluded.
- **crt.sh / CertSpotter pagination** — extra requests against a tight hourly
  quota; keep the single un-paginated call.

## UI surface — minimal, formal, no edits to shipped components

**Constraint:** do **not** edit any shipped React component and do **not** add
new cards. The result page (a vertical card stack) stays exactly as it is; the
enrichment only *fills* cards that already render their data dynamically. This is
deliberate — the monochrome/formal redesign and the Related detail-document are
freshly shipped and should not be churned. The work becomes almost entirely
`lib/` + adapter changes, no `.tsx` diffs.

### Existing render channels each datum flows into (zero component edits)

| Channel (shipped) | Fed by | Notes |
| --- | --- | --- |
| **Related indicators** (`ConnectionsCard`) | `relations[]` | Auto-groups by relation kind. New kinds need only a `RELATION_META` + `RELATION_ORDER` entry in `lib/relations.ts` (a lib file, not a component); unknown kinds already fall back to the raw label. |
| **Passive DNS** (`PassiveDnsCard`, IP+domain) | `passiveDns` | Resolution table; values are **already pivot chips**. |
| **Certificates** (`CertificatesCard`, domain) | `certificates[]`, `subdomains` | Domain only — there is no IP cert card. |
| **Profile cards** (IP / domain / hash) | `geo`, `domainContext`, `hashContext` — **only the fields they already render** | Populating these from more sources just fills existing rows / removes blanks. Fields the card does *not* already render do **not** appear here. |
| **Source breakdown row** (`SourceBreakdown`) | per-source `summary` (one-liner) + `details` (the "Show raw details" JSON disclosure) | `categories` are **not** rendered here — do not rely on them for visibility; put the headline in `summary`, the rest in `details`. |

### Routing rule (where each kind of datum goes, no edits)

- Pivot/relationship data → `relations[]` (shows in Related).
- Historical resolutions → `passiveDns` (shows in Passive DNS table).
- Domain certs / SAN subdomains → `certificates[]` / `subdomains`.
- A field a profile card **already renders** → the typed context object.
- **Everything else** (community votes, report-category breakdowns, abuse
  contacts, RPKI status, new hash identity fields) → that source's `summary`
  (the key fact) + `details` (full payload, visible via the existing disclosure).
  No new rows, no new panels.

### Phase → surface (all "no component edit")

| Phase | Surfaces through | What changes visibly |
| --- | --- | --- |
| 1 | Related (+ `RELATION_META` rows in lib) | New pivot groups: Hosted / Resolves (pDNS) / CNAME / AAAA / Reverse DNS |
| 2 | Related; VT source `summary`+`details` | More Contacts/Drops/Parent pivots; detection labels in the source disclosure (not a profile row) |
| 3 | Related | More pivots + a new **Sample** group |
| 4 | Hash profile **existing** rows (family/first-seen) + source `details` | Fuller hash profile; ssdeep/imphash/tlsh live in the source disclosure |
| 5 | Related (rDNS) + source `summary`/`details` | Richer AbuseIPDB/RDAP lines; reverse-DNS pivots; abuse contact in disclosure |
| 6 | Certificates card (domain) + domain-profile **existing** DNS rows + **VerdictHero** | Domain certs/SANs; fuller DNS; **possible verdict score/color shift (URLhaus)** |
| 7 | Related + source `details` | More pivots; RPKI status in disclosure |
| 8 | Profile / map **existing** fields | Fewer blank geo fields (isp/asnOrg) |

**Only one user-visible behavior change:** URLhaus-host blocklist scoring (Phase 6)
can move a domain's verdict number/color in `VerdictHero`. Everything else is
additive context — `weight: 0`, no verdict movement.

### Deferred — would require new/edited UI (out of scope here, data captured only)

These are captured in the model and visible only in the per-source `details`
disclosure; giving them dedicated formatted rows/panels needs a future,
separately-approved UI phase:

- Hash `detectionNames` list and `ssdeep`/`imphash`/`tlsh` as formatted profile
  rows (the hash profile card renders none of these today).
- An IP **certificate** panel (no IP cert card exists) — IP TLS certs stay in
  `details` only.
- An IP abuse-contact / allocation-age formatted row.

### Redundancy note

Passive-DNS values are **already** pivot chips in `PassiveDnsCard`, so routing
them into the Related card (Phase 1) is *consolidation*, not net-new visibility.
The net-new pivots in Phase 1 are CNAME / AAAA / reverse-DNS (no existing pivot
home). Under "minimal," consider whether to mirror passive DNS into Related at
all, or keep Related for relationship-only pivots and leave resolutions to their
table. (Open decision; default in the plan is to include them for one unified
pivot surface.)

## Recommended sequence

Ordered by value ÷ effort. Detail lives in the companion plan
`docs/superpowers/plans/2026-06-11-ti-data-coverage.md`.

1. **Passive-DNS → `relations[]` + `lib/relations.ts` CNAME/PTR/AAAA emit.**
   Zero quota, pure reuse, directly unblocks the Related readout in active dev.
2. **VT: remove `itw_urls`, collapse relationship calls into `?relationships=`.**
   Quota fix first (frees budget under 500/day, 4/min), delivers the pivots.
3. **Hash-pivot harvest from payloads already fetched** — MB `malware_config`,
   ThreatFox `malware_samples`, Triage/HA contacted/dropped/parent. Zero calls.
4. **`last_analysis_results` → `detectionNames` + fill `hashContext`** identity
   fields (ssdeep/imphash/tlsh, firstSeen/lastSeen). Zero quota.
5. **AbuseIPDB `verbose=true` + RDAP nested-entity parse** (abuse contact,
   allocation age, authoritative DNSSEC). Same-call wins.
6. **Cert + DNS surfacing** — VT `last_https_certificate`/`last_dns_records`,
   CertSpotter cross-apex SANs, URLhaus-host `blacklists` → score (the one
   scoring change).
7. **+1-call enrichments** — OTX `/malware` & `/analysis`, CIRCL parents/children,
   RIPEstat RPKI; each behind best-effort `Promise.all` swallow-to-`[]`.
8. **Maintenance migrations** — ipinfo legacy→Lite (being sunset), ipgeolocation
   v1→nested (currently returns empty `isp`/`asnOrg`). Correctness, not new data.

## Verification (per the project's standing rules)

- Every doc-derived claim is **re-verified against the live adapter + a real
  response** before the change lands (the audit read docs; APIs drift).
- `npm test` + `npm run lint` green; new unit tests for every pure mapper
  (pDNS→relations, per-engine→detectionNames, `malware_config` parse, etc.).
- Array context fields (relations/passiveDns/certificates) merge by
  union+dedupe — reuse the Phase-1 assembly path, don't fork it.
- **No component edits / no new cards** — `git diff --stat` shows no
  `components/**/*.tsx` changes (only `lib/relations.ts` for new relation labels).
- Isolated `next build`; never touch the running :3000 dev server.
