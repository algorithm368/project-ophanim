# IPv4 Threat Intelligence

Check an IPv4 address against multiple threat-intelligence sources and get a
single normalized risk verdict (0–100). Built with Next.js (App Router) +
TypeScript.

## Sources

Works out of the box, **no API key required**:

| Source            | What it provides                          |
| ----------------- | ----------------------------------------- |
| ip-api.com        | Geolocation, ASN, ISP, proxy/hosting flag |
| Shodan InternetDB | Open ports, known CVEs, host tags         |
| DNS Blocklists    | Spamhaus, SpamCop, Barracuda, DroneBL, …  |
| blocklist.de      | Recent attack/abuse report counts         |
| Feodo Tracker     | Known botnet C2 IPs (abuse.ch)            |

Enabled only when an API key is set (free signup):

| Source         | Env var               |
| -------------- | --------------------- |
| VirusTotal     | `VIRUSTOTAL_API_KEY`  |
| AbuseIPDB      | `ABUSEIPDB_API_KEY`   |
| AlienVault OTX | `OTX_API_KEY`         |
| GreyNoise      | `GREYNOISE_API_KEY`   |

Sources without a key are shown in the UI as "No key" and skipped — add a key in
`.env.local` and they light up automatically.

## Getting started

```bash
cp .env.example .env.local   # optional: add any API keys you have
npm run dev
```

Open http://localhost:3000.

## API

- `GET  /api/check?ip=8.8.8.8` — normalized result for an IP
- `POST /api/check` with body `{ "ip": "8.8.8.8" }`
- `GET  /api/sources` — registered sources and whether each is enabled

Each source is normalized into `{ status, score (0-100), malicious, summary,
categories, details, raw }`. The aggregate risk score weights the worst signal
while rewarding consensus; any definitive malicious listing sets a floor.

## Architecture

```
lib/ip.ts            IPv4 parsing + scope detection
lib/ti/types.ts      Normalized data model
lib/ti/http.ts       fetch helpers (timeout-aware)
lib/ti/sources/*     One adapter per source
lib/ti/registry.ts   List of sources
lib/ti/aggregate.ts  Risk scoring + verdict
lib/ti/check.ts      Parallel orchestrator
app/api/check        Route handler
components/Checker.tsx  UI
```

Add a new source by implementing the `TiSource` interface in `lib/ti/sources/`
and registering it in `lib/ti/registry.ts`.
