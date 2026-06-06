# Threat Intelligence

Check an **IPv4 address, domain, or file hash** (MD5/SHA-1/SHA-256) against many
threat-intelligence sources and get a single normalized risk verdict (0-100).
Paste one indicator into the search box and the type is detected automatically -
no mode toggle. Defanged input (`evil[.]com`, `185.220.101[.]1`, `hxxps://…`,
`sha256:…`) is refanged before checking. Built with Next.js (App Router) +
TypeScript.

## IP sources

Works out of the box, **no API key required**:

| Source             | What it provides                                |
| ------------------ | ----------------------------------------------- |
| ip-api.com         | Geolocation, ASN, ISP, proxy/hosting flag       |
| ipwho.is           | Second geolocation/ASN opinion (reconciled)     |
| RDAP (RIR)         | Authoritative allocation country + network name |
| Reverse DNS (FCrDNS)| PTR + forward-confirmed reverse DNS             |
| RIPEstat           | Announced BGP prefix + origin ASN (RIPE NCC)    |
| Shodan InternetDB  | Open ports, known CVEs, host tags               |
| DNS Blocklists     | Spamhaus, SpamCop, Barracuda, DroneBL, …        |
| blocklist.de       | Recent attack/abuse report counts               |
| IPsum              | Aggregated reputation across 30+ blocklists     |
| Feodo Tracker      | Known botnet C2 IPs (abuse.ch)                  |
| ET Open            | Known compromised hosts (Emerging Threats)      |
| Tor Project        | Tor relay / exit node membership                |

Geolocation is **reconciled across multiple providers**: matching values raise a
per-field confidence (country, city, ASN, coordinates), disagreements are
surfaced, and the RIR allocation country (RDAP) breaks country ties.

Enabled only when an API key is set (free signup):

| Source         | Env var                              |
| -------------- | ------------------------------------ |
| ipinfo.io      | `IPINFO_TOKEN` (extra geo/ASN vote)  |
| ipgeolocation.io | `IPGEOLOCATION_API_KEY` (extra geo vote) |
| VirusTotal     | `VIRUSTOTAL_API_KEY`                 |
| AbuseIPDB      | `ABUSEIPDB_API_KEY`                  |
| AlienVault OTX | `OTX_API_KEY`                        |
| GreyNoise      | `GREYNOISE_API_KEY`                  |
| ThreatFox      | `THREATFOX_API_KEY`                  |
| Criminal IP    | `CRIMINALIP_API_KEY`                 |

Sources without a key are shown in the UI as "No key" and skipped - add a key in
`.env.local` and they light up automatically.

## Domain sources

Works out of the box, **no API key required**:

| Source        | What it provides                                  |
| ------------- | ------------------------------------------------- |
| DNS Records   | A/AAAA/MX/NS/TXT/SOA/CNAME/CAA, SPF/DMARC, PTR, DNSSEC, multi-resolver agreement (Cloudflare + Google DoH) |
| RDAP / WHOIS  | Registration date, registrar, age, status         |
| Spamhaus DBL  | Domain block list (spam/phish/malware/botnet)     |
| SURBL         | Domain reputation block list                      |
| Quad9         | Security-DNS blocking (vs. a control resolver)     |
| OpenPhish     | Community phishing feed (active phishing hosts)    |

Enabled only when an API key is set:

| Source                | Env var                              |
| --------------------- | ------------------------------------ |
| URLhaus               | `THREATFOX_API_KEY` (abuse.ch key)   |
| Google Safe Browsing  | `GOOGLE_SAFE_BROWSING_API_KEY`       |
| VirusTotal            | `VIRUSTOTAL_API_KEY`                 |
| AlienVault OTX        | `OTX_API_KEY`                        |
| ThreatFox             | `THREATFOX_API_KEY`                  |

> The DNS blocklists (DBL/SURBL) are most accurate when not queried through a
> large public resolver - some refuse open-resolver queries and return a "query
> refused" code, which the app reports rather than treating as a listing.
> Special-use names (RFC 2606/6761: `example.com`, `*.test`, `*.localhost`, …)
> are rejected since they never point at real infrastructure.

## File-hash sources

Accepts MD5, SHA-1, or SHA-256 digests. Works out of the box, **no API key
required**:

| Source           | What it provides                                  |
| ---------------- | ------------------------------------------------- |
| MetaDefender Cloud | Multi-engine AV scan (via Filescan.io)          |
| Team Cymru MHR   | Malware hash registry + AV detection rate         |
| CIRCL hashlookup | Known-file lookup (NSRL known-good / known-bad)   |

Enabled only when an API key is set:

| Source         | Env var                              | What it provides                       |
| -------------- | ------------------------------------ | -------------------------------------- |
| MalwareBazaar  | `THREATFOX_API_KEY` (abuse.ch key)   | Sample metadata, malware family, type  |
| VirusTotal     | `VIRUSTOTAL_API_KEY`                 | Multi-engine AV detection ratio        |
| ThreatFox      | `THREATFOX_API_KEY`                  | IOC intel, malware family (abuse.ch)   |
| URLhaus        | `THREATFOX_API_KEY`                  | Hashes seen as malware payloads        |
| Hybrid Analysis| `HYBRID_ANALYSIS_API_KEY`            | Sandbox detonation verdict             |
| AlienVault OTX | `OTX_API_KEY`                        | Mentions in community threat pulses    |

> A single abuse.ch Auth-Key (`THREATFOX_API_KEY`) enables ThreatFox,
> MalwareBazaar, and URLhaus across all modes.

## Getting started

```bash
cp .env.example .env.local   # optional: add any API keys you have
npm run dev
```

Open http://localhost:3000. Each checked indicator also has a shareable
permalink at `/check/<indicator>`.

## API

- `GET  /api/check?ip=8.8.8.8` - normalized result for an IP
- `POST /api/check` with body `{ "ip": "8.8.8.8" }`
- `GET  /api/check-domain?domain=example.org` - normalized result for a domain
- `POST /api/check-domain` with body `{ "domain": "example.org" }`
- `GET  /api/check-hash?hash=<md5|sha1|sha256>` - normalized result for a hash
- `POST /api/check-hash` with body `{ "hash": "…" }`
- `GET  /api/sources` - registered IP sources and whether each is enabled
- `GET  /api/sources?type=domain` (or `?type=hash`) - sources for that mode

Add `?refresh=1` (GET) or `{ "refresh": true }` (POST) to bypass the cache and
re-query every source. A POST sent with `Accept: application/x-ndjson` streams
per-source progress as newline-delimited JSON (`start` / `source` / `done` /
`error` events) so the UI can fill in results as they land.

Each source is normalized into `{ status, score (0-100), malicious, summary,
categories, details, raw }`. The aggregate risk score weights the worst signal
while rewarding consensus; any definitive malicious listing sets a floor.

## Architecture

All three indicator types share one normalized model and one execution path.

```
lib/ip.ts                  IPv4 parsing + scope detection
lib/domain.ts              Domain parsing + reserved-name detection
lib/hash.ts                Hash parsing + algorithm detection
lib/ioc.ts                 Refang + auto-detect (ip | domain | hash)
lib/ti/types.ts            Normalized data model (shared by all modes)
lib/ti/http.ts             fetch helpers (timeout-aware)
lib/ti/orchestrate.ts      runSource / runAll / mergeFields (shared)
lib/ti/aggregate.ts        Risk scoring + verdict (shared)
lib/ti/route-handler.ts    makeIndicatorRoute: shared GET/POST + streaming
lib/ti/cache.ts            Upstash Redis cache (optional)
lib/ti/history.ts          Per-indicator reputation timeline (optional)
lib/ti/sources/*           One adapter per IP source
lib/ti/domain/sources/*    One adapter per domain source
lib/ti/hash/sources/*      One adapter per file-hash source
lib/ti/{registry,check}.ts                IP source list + orchestrator
lib/ti/domain/{registry,check}.ts         Domain source list + orchestrator
lib/ti/hash/{registry,check}.ts           Hash source list + orchestrator
app/api/{check,check-domain,check-hash}/  Route handlers (built from the factory)
app/check/[ioc]/                          Unified result page + permalink
components/Checker.tsx                     UI (single auto-detecting input)
```

Every source implements the same `TiSource` interface. To add one: drop an
adapter in the matching `sources/` directory and register it in that mode's
`registry.ts` (`lib/ti/registry.ts` for IP, `lib/ti/domain/registry.ts` for
domain, `lib/ti/hash/registry.ts` for hash). Mirror an existing adapter such as
`lib/ti/sources/feodo.ts`: honor the `AbortSignal`, return `{ status, error }`
instead of throwing, and set a `weight` reflecting how authoritative the source
is for maliciousness (context-only sources use `0`).
