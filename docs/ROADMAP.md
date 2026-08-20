# Roadmap: SOC L3 / DFIR upgrades

Backlog from an analyst-perspective review of the tool (2026-06-13). Framed for
day-to-day triage (SOC L3) and incident/forensic work (DFIR). Constraints kept
in mind: **free sources only** (no Censys / paid Shodan full-host, and no
Criminal IP since 2026-08-20, whose free quota is too small to lean on), and relation
data stays a **readable detail document, not a node-edge graph**.

## Field-test note

`POST /api/check {"ip":"45.95.147.236"}` returned **malicious / 75** with 22
sources queried but **only 1 of 22 flagged it**, the verdict came entirely from
the hard-malicious floor (`lib/ti/aggregate.ts:56`). The same call had **3
errored + 1 rate-limited** (~18% of the panel contributed nothing) with no health
signal surfaced. Most items below trace back to that one observation.

## Already solid (do not regress)

Parallel fan-out + NDJSON streaming, normalized model with reconciled geo
(per-field confidence), passive DNS, cert-transparency, imphash/ssdeep/tlsh,
SPF/DMARC/CAA/DNSSEC + resolver-disagreement detection, reputation history,
refang/defang, and FP-aware VirusTotal logic (`vtDefinitive`).

## P0, operational must-haves

- [ ] **URL indicator type.** Today only IP / domain / hash
  (`lib/ti/registry.ts`, `domain/registry.ts`, `hash/registry.ts`; detection in
  `lib/ioc.ts`). URLs are the most common pasted IOC in phishing/malware triage,
  and the backends already accept URLs (URLhaus, OpenPhish, Safe Browsing, VT).
  Add a `url` type through `detectIOC` + a new registry + a route via
  `makeIndicatorRoute` (`lib/ti/route-handler.ts`), so the path/query verdict is
  not lost by stripping to the domain.
- [ ] **Machine-readable export + case attachment.** Only per-field clipboard
  copy exists (`components/CheckResults/primitives.tsx`). Add JSON / CSV / STIX
  2.1 (and ideally MISP) export plus a copy-all-IOCs action and a shareable
  report, so enrichment can attach to a ticket (TheHive / Jira / ServiceNow) or
  feed a SOAR playbook instead of dying in the browser.
- [ ] **False-positive dampening / allowlist.** A single stale listing floors the
  score to 75=malicious regardless of consensus (`lib/ti/aggregate.ts:56`,
  reproduced: 1/22 to malicious). Add (a) a known-good overlay from free data
  (Tranco top list + published cloud/CDN ranges: AWS/GCP/Azure/Cloudflare), and
  (b) require >=2 corroborating hard listings *or* recency before flooring.
  Shared-hosting / CDN context alone removes many FPs.

## P1, investigation depth

- [ ] **Intel freshness / recency decay.** `firstSeen`/`lastSeen` are captured
  per source (`lib/ti/types.ts`) but the aggregate weights a C2 last seen years
  ago the same as one seen yesterday. Decay stale signals and surface "still
  live?" (Feodo online/offline, GreyNoise last-seen). Separates historical from
  active threat.
- [ ] **Threat context: ATT&CK + actor/campaign + the "why".** The score is a
  bare number. Sources already queried (OTX pulses, ThreatFox, Triage) carry
  malware family, ATT&CK techniques, and campaign tags, surface them, and show
  **which source drove the score**. Reports need who/what/why, not just 0-100.
- [ ] **Authenticated, rate-limited batch API.** `/api/check` is open (no
  `x-api-key`, no throttle) and single-indicator (bulk is geo-only, see
  `components/BulkGeoResults.tsx` + `extractIps`). Add API-key auth + a
  `POST /api/bulk` taking a mixed IOC list returning full enrichment, the hook
  for Splunk SOAR / Cortex / Tines.

## P2, DFIR / forensics

- [ ] **Evidence preservation + audit trail.** `lib/ti/orchestrate.ts:58` deletes
  `result.raw`. Add optional raw-response retention (timestamped, hashed) for
  chain-of-custody, a query audit log (who/what/when), and TLP tagging on output.
- [ ] **Behavioral artifacts for hashes.** `HashContext` (`lib/ti/types.ts`) has
  imphash/ssdeep/tlsh but no **mutexes, registry keys, dropped files, process
  tree, or extracted C2**, the artifacts an investigation pivots on. Triage / HA
  return these; the model just has nowhere to put them. (File upload for
  detonation is a larger lift; surfacing existing sandbox host/network IOCs is
  cheap.)
- [ ] **Close the loop to detection output.** Auto-generate hunt queries
  (Sigma / KQL / SPL) and an exportable block list from the verdict, so
  enrichment becomes a detection or a block, not a dead end.

## Cross-cutting

- [ ] **Source health / quota visibility.** 18% of the panel was silent in the
  field test with no indication. Surface per-source error/timeout/rate-limit
  trends, key-quota status, and cache age/TTL so an analyst knows how complete a
  verdict actually is.
