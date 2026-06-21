# Threat-Intel Checker: Security-Analyst Review & Improvement Spec

**Reviewer lens:** working SOC / threat-intel analyst using this as a daily triage tool.

**Method:** live-tested the running app (clean IP `8.8.8.8`, Tor exit `185.220.101.1`,
EICAR hash, `google.com`, NXDOMAIN) and read the pipeline, scoring, route, and UI code.
A 6-dimension multi-agent pass produced 42 findings; the coverage and scoring items were
adversarially code-verified end-to-end. The trust / UX / API / abuse items had their
verification pass cut short, but their load-bearing claims were re-checked by hand
(dead `scoreExplanation`, dead `history`, missing `middleware`, existing geo dissent UI
all confirmed). Items worth smoke-testing before building are flagged inline.

## TL;DR (analyst verdict)

This is a genuinely strong aggregator: clean normalized model, 23/13/13 free sources
fanned out in parallel with NDJSON streaming, multi-provider geo reconciliation with
per-field confidence, FCrDNS, reputation history recording, and solid input-boundary
security. The gap is **defensibility and throughput**, not data. Three of the most
valuable fixes are *already coded and just not wired to the UI*. The single most
consequential correctness issue is that **one `malicious` source pins the verdict
regardless of dissent**, and the tool will label the industry-standard benign EICAR file
as live `Backdoor.Win32.Androm` malware (score 89).

## What it already does well (preserve these)

- **Uniform pipeline** across IP/domain/hash; `SourceFinding` to `SourceResult` to aggregate is clean and extensible.
- **Graceful no-key degradation**, parallel fan-out, and per-source streaming progress.
- **Geo reconciliation** already models `confidence / agreement / alternatives` and has a real dissent/voting UI (`confidence.tsx`, `voting.tsx`).
- **Input-boundary security is solid** (verified live): `validateIp` rejects private/reserved/IPv6/CIDR with 422; strict parser charsets neutralize path/query injection; refang is linear-time; the `/check` page and OG image read only the cache, so crafted permalinks trigger no server-side fetch (no SSRF).

---

## Theme A — Trust & defensibility of the verdict

*The #1 analyst question is "can I defend this verdict in a write-up?" Today, often no.*

### A1. Render `scoreExplanation()` — it's implemented and shown nowhere. [P0, S]

`lib/ti/narrative.ts:542` produces a plain-language "why this score" (dominant weighted
source, floor source). Grep confirms **zero consumers**. Wire it into `VerdictShell`
(`verdict.tsx`) the way `buildNarrative` already is. Pure win, near-zero cost.

### A2. Name the sources that failed, on the verdict card, with a confidence caveat. [P0, M]

`ConsensusLine` (`verdict.tsx:189-220`) shows only counts ("20/23 detectors, 1 errors,
3 rate limited"). Live `8.8.8.8` rate-limited **GreyNoise, Criminal IP, Reverse IP** —
exactly the detectors that would flag a bad IP — and reported `clean / 0`. Make the
error/rate-limited counts expand to the affected source names plus `result.error`, and add
one muted line: *"confidence reduced, 3 reputation sources did not respond."* A "clean"
with the heavy hitters silently down is indistinguishable from genuinely clean.

### A3. Give the verdict a coverage/confidence tier. [P1, M]

`aggregateRisk` returns only `{riskScore, verdict}` and never looks at how much scoring
capacity errored/rate-limited/was skipped (`computeStats` tracks it but it's unused).
Emit `confidence: { tier, scoredWeight, missingWeight }` from
`sum(weights of ok scoring sources) / sum(weights of all scoring sources)` and badge
"low coverage" when thin. The `Confidence` type already exists (`types.ts:145`).
**On a no-key install every IP source with weight >= 0.8 is key-gated** (VT, AbuseIPDB,
ThreatFox, OTX, GreyNoise, Criminal IP) — so an abusive IP can read "clean 0" because
every consensus-grade detector was skipped.

### A4. Expose floor + dissent: show when one listing overrode the consensus. [P1, M]

When `aggregate.ts:53-56` applies the 75 floor, record `flooredBy: <sourceId>` and surface
*"floored to 75 by AbuseIPDB; 8 of 11 scoring sources rated this clean."* Reuse the
`Disagreement` pattern from `confidence.tsx`. The reputation verdict deserves the dissent
UI geo already has.

### A5. Show cache age + per-source freshness. [P1, M]

TTL is 1 week (`cache.ts:7`) but the card shows only a boolean `cached`. Render relative
age ("cached, 5 days old") from `checkedAt`, and show `lastSeen` as an "as of <date>" chip
on source rows (populated by feodo/tor/greynoise/abuseipdb/urlhaus but only read in
profile/passive-DNS today). A week-old "clean" on a fast-moving IP must not look fresh.
*(Smoke-test the exact `lastSeen` population per source before building.)*

### A6. Provide a path to the raw upstream payload. [P1, L]

`runSource` deletes `result.raw` before returning (`orchestrate.ts:56-58`); the analyst can
only see normalized `details`. When the summary looks wrong there's no ground truth. Either
an on-demand "view raw" single-source re-fetch, or guarantee every scoring source puts the
exact upstream verdict fields (detection count, listing reason, report id) into `details`.

### A7. Full error text on failed rows; populate or delete `SourceFinding.confidence`. [P2, S]

Error strings are `truncate`'d and demoted in `sources.tsx`; show them in full.
`SourceFinding.confidence` (`types.ts:222`) is declared but never set or read — either
populate it from AbuseIPDB %, ThreatFox `confidence_level`, VT ratio (and factor into
scoring), or remove it.

---

## Theme B — Scoring-model correctness

*The engine should produce numbers an analyst can stand behind.*

### B1. Gate the hard `malicious` floor on weight + quorum. [P1, M] — most consequential

`aggregate.ts:53-56`: **any** single `ok` source with `malicious===true` pins risk to >=75,
no weight, no quorum. `abuseipdb.ts:86` sets `malicious` at just 50% confidence. One stale
or disputed listing reads identical to a confirmed C2. Apply the floor only when the listing
source's weight >= 0.7 (so VT/AbuseIPDB/Feodo qualify, Tor@0.4 never can), or require >=2
malicious sources, and scale the floor with the strongest malicious weight. Add unit cases.

### B2. Handle benign test artifacts + propagate allowlists. [P1, M]

Live: **EICAR (`44d88612...`) -> malicious 89, labeled `Backdoor.Win32.Androm`.** Per-source
allowlist signals exist (`maltiverse` whitelist->0, `hybrid-analysis` whitelisted->0,
`abuseipdb` isWhitelisted) but never reach the aggregate. Add (1) a hardcoded benign-hash set
(EICAR md5/sha1/sha256) -> forced `clean` + "benign test artifact" note; (2) treat strong
allowlist hits as a counter-signal that suppresses the floor unless a high-weight detection
also fires. Labeling the standard AV test file as live malware fails the first credibility
check an analyst runs.

### B3. Time-decay stale listings. [P1, M]

`lastSeen` is populated but `aggregate.ts` never reads it — a Feodo entry last seen in 2021
(hardcoded score 95) blends exactly like a fresh one. Add an opt-in age decay (e.g. linear
to a 0.5 floor at 1y past a 90d window); make the malicious floor age-aware too. Threat infra
is perishable; freshness is the biggest signal-quality lever analysts weigh by hand.

### B4. Down-weight Tor/VPN/hosting context. [P2, M]

`GeoFlags.isHosting/isProxy/isMobile` exist but `aggregateRisk` ignores them, so contextual
presence contributes raw positive score. *(Corrected framing from verification: the live Tor
`185.220.101.1 -> 77` is driven by real VT + AbuseIPDB listings, not Tor; Tor-only already
computes to "low".)* Exclude pure-context positives from `effectiveMax` and annotate the
verdict with the context reason.

### B5. Name the thresholds; flag borderline; return a score breakdown. [P2, S]

`70/40/15` and the `0.6/0.4` blend are magic numbers; the 75 floor lands 5 pts into
"malicious" creating a 70-74 dead band. Make them named constants, add a "borderline"
annotation within +/-5 of a cutoff, and have `aggregateRisk` return
`scoreBreakdown { effectiveMax, weightedAvg, dominantSourceId, floorApplied }` so
`narrative.ts` reads real intermediates instead of independently re-deriving them
(current drift risk).

---

## Theme C — Coverage & indicator types

### C1. Add URL and CIDR/ASN as first-class indicators. [P1, L]

`detectIOC` (`lib/ioc.ts`) only returns ip/domain/hash; a pasted URL is reduced to its host
(path/query discarded) even though URLhaus/OpenPhish/SafeBrowsing are URL-scoped. No CIDR/ASN
despite an existing `cidr.ts`. Phishing triage is URL-first and infra triage is CIDR/ASN-first;
both are daily pivots the tool can't do.

### C2. Register the orphaned `spamhaus-drop` adapter; decide `censys`. [P2, S] — cheap correctness

`spamhaus-drop.ts` (no-key, weight 0.3, tested) is **not imported in `registry.ts`**, yet the
README lists "Spamhaus" — overstating coverage. Wire it in; either wire or delete `censys.ts`
(paid -> delete, per free-only policy); fix the README.

### C3. Add registrant + typosquat pivots for domains. [P2, M]

RDAP already extracts the abuse contact but `DomainContext` has no registrant field, and
there's no look-alike enumeration. The two highest-value phishing/BEC pivots ("what else did
this registrant register", "typosquat neighbors") force the analyst out to dnstwist/WHOIS.
Add a registrant field (RDAP vcard, `findEntityByRole` already supports it; note GDPR
redaction) and a no-key dnstwist-style neighbor source over the existing DoH layer.

---

## Theme D — Analyst workflow & throughput

### D1. Render the reputation history timeline — it's recorded but invisible. [P0, M]

Every result carries `history: HistorySnapshot[]` (route attaches it, Redis dedupes on write)
and **no component reads it.** Add a `HistoryTimeline` card (readable grouped readout: date,
verdict word in color, score, delta from prior). Whether an indicator is newly-flagged or
long-bad is the most decision-relevant thing the app already stores.

### D2. Bulk / batch triage (UI + `POST /api/bulk`). [P1, L]

Bulk exists only for IP geolocation (`bulkTargets`, geo-only, no verdicts). The API body
reader is scalar-only, so an array is dropped. SOC work arrives as lists (alert IOC tables,
CSVs). Add a batch input that runs each refanged IOC through its per-type checker into a
compact verdict table (each row pivotable), plus `POST /api/bulk {indicators:[...]}`
(cap ~100, concurrency-capped to protect keyed quota, NDJSON variant).

### D3. Structured export of the full verdict. [P1, M]

Only the one-line summary is copyable. Add "Copy report" (Markdown: indicator, verdict,
score, checkedAt, flagged sources + summaries; commas not dashes) and "Download JSON" on
`VerdictHero`; honor `Accept: text/csv` and `application/stix+json` on the API (content
negotiation is currently ignored except NDJSON). Unlocks tickets and SIEM/TIP pipelines.

### D4. Pivot trail breadcrumb. [P2, M]

`pivot()` replaces the result and relies on browser Back; there's no in-page trail. Render a
breadcrumb of visited IOCs (already keyed in `resultsCache`):
`IP 1.2.3.4 > host evil.com > IP 5.6.7.8`, each one-click. Restores the investigative thread
the connections panel promises.

### D5. Broaden keyboard-first flow. [P2, S]

Only `/` (focus) and `Esc` (clear) exist. Add `r` re-check, `c` copy report, jump-to-sources,
`j/k` through flagged rows (guard with the existing `typing` check).

---

## Theme E — API & integration

### E1. Rate-limit the routes and gate the `refresh` flag — denial-of-wallet. [P0 before public exposure, M]

Confirmed: **no `middleware.ts`, no rate limiter, no `RateLimit-*` headers**, fully anonymous,
and `?refresh=1` always bypasses the cache and re-queries every keyed source
(VT/AbuseIPDB/GreyNoise/Criminal IP/SafeBrowsing). A scripted `refresh` loop drains the
operator's free-tier quotas in minutes and degrades the tool to `rate_limited` for every real
analyst. Add `@upstash/ratelimit` (Redis is already wired) keyed on client IP, a tighter
bucket for `refresh`, and require an operator token to force refresh.

### E2. Surface cache provenance/TTL in the body + HTTP cache headers. [P1, M]

Body exposes only `cached`/`checkedAt`, not `expiresAt`/`ttl`; no `Cache-Control`/`Age` on
JSON. Add `cacheTtlSeconds` + computed `expiresAt`, set `Cache-Control: public,
max-age=<remaining>` on cached and `no-store` on fresh.

### E3. Document the NDJSON stream contract + add `schemaVersion`. [P1, S]

Per-source failures arrive inside `source` events while top-level `error` means whole-stream
death, and a cache hit collapses to a lone `done` — all undocumented. Specify the grammar
`start{total,sources,schemaVersion} -> N x source -> done`, reserve `error` for fatal, and
state the cache-hit sequence.

### E4. Stable result ID / point-in-time permalink. [P2, L]

Results have `checkedAt` but no `id`; `/check/<indicator>` re-runs and may show a different
verdict than the analyst cited. Assign a time-addressed `id`, persist the full result under
it, add `GET /api/result/<id>` + a read-only `/result/<id>` page, and link history snapshots
to it.

### E5. Enrichment webhook/callback. [P2, L]

All paths are synchronous. Add an optional `callbackUrl` (return `202` + id, POST the final
result HMAC-signed on completion, host-allowlisted + operator-token-gated) so the tool can be
a node in a SOAR/ticketing pipeline.

---

## Theme F — Tool abuse resistance (the app's own security)

### F1. Cap upstream response size before buffering. [P1, M]

`lib/ti/http.ts` does `await res.text()` + `JSON.parse` with no size/decompression-ratio
guard (undici auto-inflates gzip/br); element caps (certspotter 5000, reverse-ip 40,
pdns 200) all apply *after* the full body is in memory. A gzip bomb or huge passive-DNS/CT
payload for an attacker-controlled indicator can OOM the function across parallel sources.
Read through a size-bounded reader (~5-10 MB ceiling), abort on exceed.

### F2. Move keys out of URL query strings; redact in errors. [P2, S]

`ipgeolocation`, `ipinfo`, and SafeBrowsing put the key in the URL (others use headers). Not
leaking today (verified: `err.message` is "fetch failed", key only in `err.cause` which
`errorMessage` never reads) — but one diagnostics tweak away from leaking into the streamed
`SourceResult.error`. Prefer headers; add a redaction pass stripping `key|apiKey|token` from
any error string. *(Smoke-test the exact key-in-URL lines before building.)*

### F3. Enforce the 253-octet domain cap + an input length bound. [P3, S]

`parseDomain` enforces per-label 63 but not total length; a 323-char host is accepted and
fanned out. Reject >253-octet names and cap the indicator string (~255) before work.

### F4. `encodeURIComponent` defense-in-depth on indicator interpolation. [P3, S]

Most sources interpolate the raw value into the URL (`rdap.org/domain/${registrable}`); safe
today only because parser charsets are strict. Wrap path/query interpolation (no-op for clean
values) so a future parser loosening can't open injection. Make it the documented
"adding a source" convention.

### F5. Validate/`notFound()` the `/check/[ioc]` segment. [P3, S]

`page.tsx` + `opengraph-image.tsx` reflect the raw decoded segment into
`<title>`/`<meta>`/OG image before any validation — a brand-abuse primitive (legit-looking
Ophanim cards for arbitrary text). Run `detectIOC` first, `notFound()` on null, render the
canonicalized value. (No XSS — Next escapes — and no SSRF, since both read only the cache.)

### F6. Lock the already-solid controls with regression tests. [P3, S]

Assert: IP route rejects private/reserved/IPv6/CIDR; parsers are the injection boundary;
`/check` page + OG image never fetch outbound; refang stays linear-time.

---

## Prioritized roadmap

| Tier | Item | Effort | Why first |
|---|---|---|---|
| **Now** | A1 Render `scoreExplanation()` | S | Already coded, zero risk |
| **Now** | D1 Render history timeline | M | Data already recorded, invisible |
| **Now** | A2 Name failed/skipped sources + caveat on verdict | M | Core defensibility gap |
| **Now** | E1 Rate-limit + gate `refresh` | M | Blocks any public exposure (denial-of-wallet) |
| **Now** | C2 Register `spamhaus-drop` / fix README | S | Free coverage + accuracy, trivial |
| **Next** | B1 Weight/quorum-gate the malicious floor | M | Most consequential misclassification path |
| **Next** | B2 EICAR/test-artifact + allowlist propagation | M | Credibility-breaking false positive |
| **Next** | B3 Time-decay stale listings | M | Biggest manual signal-quality lever |
| **Next** | A3/A4/A5 Verdict confidence, floor dissent, freshness | M | Defensibility |
| **Next** | C1 URL + CIDR/ASN indicator types | L | Most common missing pivots |
| **Next** | D2/D3 Bulk triage + structured export | L/M | Turns a lookup toy into a triage surface |
| **Next** | F1 Upstream size cap | M | Real OOM/DoS surface |
| **Next** | E2/E3 Cache provenance + stream contract | M/S | Integration correctness |
| **Later** | B4/B5, C3, A6/A7, D4/D5, E4/E5, F2-F6 | mixed | Polish, hardening, deeper integration |

---

## Live test cases used

| Indicator | Type | Result | Note |
|---|---|---|---|
| `8.8.8.8` | IP | clean / 0 | 3 rate-limited + 1 errored source hidden behind bare counts |
| `185.220.101.1` | IP (Tor exit) | malicious / 77 | real VT + AbuseIPDB listings; floor pins verdict regardless of dissent |
| `44d88612fea8a8f36de82e1278abb02f` | hash (EICAR) | malicious / 89 | benign AV test file labeled `Backdoor.Win32.Androm` |
| `google.com` | domain | clean / 0 | all 13 sources ok |
| `thisdomaindoesnotexist-zzq.com` | domain (NXDOMAIN) | unknown / 0 | 1 errored, no explanation surfaced |
