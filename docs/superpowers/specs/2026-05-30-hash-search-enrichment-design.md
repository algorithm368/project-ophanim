# Hash Search Enrichment — Design

**Date:** 2026-05-30
**Status:** Approved (design); implementation plan pending
**Topic:** Make the file-hash report richer — broader source coverage, more
pivots/relations, and better presentation of what we collect.

## Goal

Today a hash lookup fans out to 9 sources and renders file identity (digests,
names, type, family, tags) plus the shared score/activity/history/breakdown
cards. Three gaps motivate this work:

1. **Coverage** — too many hashes come back "unknown" because we query a
   limited source set.
2. **Pivots / relations** — sources already return related indicators
   (VirusTotal contacted IPs/domains, URLhaus distribution URLs) that we either
   drop or only feed into the separate `/investigate` graph. The result page
   never shows "what this file connects to."
3. **Presentation** — the connections that *do* exist aren't surfaced on the
   result page, and download URLs / related samples have nowhere to live.

This design closes all three with a layered build that stays inside the
existing pipeline conventions (`TiSource` adapters, the normalized
`SourceFinding` model, the shared orchestrator).

## Non-goals

- **No first-class URL indicator.** `detectIOC` keeps routing only ip/domain/
  hash. URLs are shown read-only with a pivot to their *host* (a domain).
- **No "deeper per-sample detail" deep-dive.** We are not building a per-engine
  AV matrix, sandbox process trees, MITRE ATT&CK mapping, or PE-section views.
  Detection *names* are captured lightly; behavioral depth is out of scope.
- **No VirusTotal `similar_files`.** That endpoint requires a premium VT plan;
  "similar" pivots come from MalwareBazaar imphash clustering instead.
- **No scoring-algorithm change.** `aggregateRisk` is untouched; new sources
  only contribute weighted signals.

## Approach (chosen: A — Layered)

Build bottom-up so each layer is independently shippable and testable, and the
user-visible win lands before any new API key is required:

1. **Data model + mine existing sources** (zero new keys)
2. **Shared Connections card + Distribution URLs UI** (visible win, zero keys)
3. **Four new key-gated sources**, added one at a time into the finished model

Rejected alternatives: *Sources-first* (can't see/verify new relations until UI
exists; large unreviewed surface) and *Hash-isolated* (duplicates rendering
wanted on IP/domain too; user chose the shared card).

---

## Component 1 — Data model (`lib/ti/types.ts`)

Extend `HashContext` with two optional fields:

```ts
/** URLs the sample has been served/downloaded from (URLhaus, VT itw/contacted). */
distributionUrls?: string[];
/** AV/engine detection labels, e.g. "Trojan.Win32.Emotet" (Kaspersky, Maltiverse). */
detectionNames?: string[];
```

`RelatedIndicator` is **unchanged**: its `relation` field is already a free
string, so new edge labels need no type change. Labels used by the hash flow:

| label      | target type | meaning                                   |
|------------|-------------|-------------------------------------------|
| `contacts` | ip / domain | C2 / network indicators the sample reaches |
| `drops`    | hash        | files this sample drops/writes            |
| `parent`   | hash        | samples that execute/contain this one     |
| `similar`  | hash        | samples clustered by imphash              |
| `host`     | domain      | host extracted from a distribution URL    |

URLs are **not** `RelatedIndicator`s (no `url` type). They live only in
`distributionUrls`; their hostnames may additionally appear as `host` domain
relations.

New pure helper in `lib/`:

```ts
/** Extract the hostname from a URL string, or undefined if unparseable. */
export function hostFromUrl(url: string): string | undefined;
```

Unit-tested; reused by the URL sources and the Distribution URLs UI.

## Component 2 — Mine existing sources (no new keys)

### VirusTotal hash (`lib/ti/hash/sources/virustotal.ts`)
Expand the existing best-effort relations fetch (currently `contacted_ips` +
`contacted_domains`) to also pull, each list independently guarded:

- `dropped_files` → `hash` relations (`drops`)
- `execution_parents` → `hash` relations (`parent`)
- `contacted_urls` and `itw_urls` → push raw URLs into `distributionUrls`; add
  their hosts as `domain` relations (`host`)

Keep per-list caps (existing pattern: dedupe + `.slice(0, 6)`). Any list that
errors yields `[]`. **Skip `similar_files`** (premium-gated).

### URLhaus hash (`lib/ti/hash/sources/urlhaus.ts`)
`sampleUrls` is already fetched into `details` but dropped from context.
Promote it: populate `hashContext.distributionUrls`, and add URL hosts as
`host` domain relations.

### MalwareBazaar (`lib/ti/hash/sources/malwarebazaar.ts`)
When the primary lookup returns an `imphash`, issue one follow-up
`get_imphash` query to fetch sibling samples sharing that import hash. Map a
capped set of their SHA-256s (excluding the queried hash) to `similar` hash
relations. Best-effort: a failed/empty follow-up just yields no relations and
never fails the primary result.

## Component 3 — New sources (4 adapters)

Each new adapter mirrors `lib/ti/sources/feodo.ts`: implements `TiSource`
(`meta`, `isEnabled`, `check`), honors the `AbortSignal`, uses the `lib/ti/http`
helpers (never bare `fetch`), and on failure returns
`{ status: isTimeout(err) ? "timeout" : "error", error: errorMessage(err) }`
rather than throwing. Registered in `lib/ti/hash/registry.ts`; key documented in
`.env.example`; out-link added to `HASH_LOOKUP_URL` in `CheckResults.tsx`.

> Implementer note: confirm each endpoint/auth shape against the provider's
> current API docs before coding — versions drift. Shapes below are the design
> intent, not a guarantee of the exact path.

| Source | id / file | keyEnv | weight | Notes |
|--------|-----------|--------|--------|-------|
| Maltiverse | `maltiverse` / `maltiverse.ts` | `MALTIVERSE_API_KEY` | 0.7 | Bearer token; `GET /sample/{sha256}`. classification → score/malicious; AV detections → `categories` + `detectionNames`; related domains/ips → `relations` (`contacts`), related urls → `distributionUrls`. SHA-256-keyed → `skipped` for MD5/SHA-1. |
| Hatching Triage | `triage` / `triage.ts` | `TRIAGE_API_KEY` | 0.8 | Bearer; search by hash, then fetch sample overview. score (0–10 → ×10); family/signatures → `categories`; extracted C2 domains/ips → `relations` (`contacts`). |
| Pulsedive | `pulsedive` / `pulsedive.ts` | `PULSEDIVE_API_KEY` | 0.6 | Indicator lookup by value; risk (none/low/medium/high/critical) → score/malicious; linked indicators → `relations`. |
| Kaspersky OpenTIP | `kaspersky-opentip` / `kaspersky-opentip.ts` | `KASPERSKY_OPENTIP_API_KEY` | 0.9 | `x-api-key` header; hash search → zone (Red/Yellow/Green/Grey) → score/malicious; detection names → `categories` + `detectionNames`; file general info → `hashContext`. |

Scoring conventions reused from existing adapters: a "not found" / clean-miss
response returns `status: "ok"` with **no score** (absence ≠ clean), matching
MalwareBazaar/ThreatFox behavior; a definitive malicious classification sets
`malicious: true`.

Registry order (display): keep authoritative/“what is it” sources first —
e.g. `malwarebazaar, virustotal, kaspersky-opentip, metadefender, triage,
maltiverse, threatfox, urlhaus, pulsedive, hybrid-analysis, cymru-mhr,
hashlookup, otx`. (Order is cosmetic; finalize during implementation.)

## Component 4 — UI (`components/CheckResults.tsx`)

### Shared `ConnectionsCard`
A new component rendered in `Results`, `DomainResults`, and `HashResults`.
It calls the existing `relationsFor(result)` (pure, client-safe, in
`lib/relations.ts`), groups `related` by `relation` label, and renders a
`PivotList` per group using the existing `Pivot` component (which fires
`onPivot` through `PivotContext`). Group order: `contacts`, `drops`, `parent`,
`similar`, `host`. Renders nothing when there are no relations.

Because `relationsFor` already merges context-derived + source-contributed
relations and dedupes them, the card needs no new data plumbing — it surfaces
data that previously only reached the `/investigate` graph.

### Distribution URLs (hash report)
A block in the hash report listing `ctx.distributionUrls` read-only:
- copy button (reuse `useCopied`)
- external "open" link (`<a target="_blank" rel="noopener noreferrer">`)
- a "check host" pivot button — `hostFromUrl(u)` → `Pivot` into the domain
  checker

Capped (e.g. first 8) with a "+N more" note, matching `PivotList` conventions.

### Related samples
No dedicated block — they are the `drops` / `parent` / `similar` groups in the
`ConnectionsCard`.

### Out-links
Add `HASH_LOOKUP_URL` entries so the new sources' cards deep-link to their
lookup pages (Maltiverse, Triage, Pulsedive, Kaspersky OpenTIP).

## Error handling

- Source failures stay isolated: the orchestrator's `runSource` already wraps
  skip/timeout/error and drops `raw`; new adapters follow the catch-and-return
  contract so one provider's outage never breaks the report.
- Follow-up/relation fetches (VT extra lists, MB imphash) are best-effort and
  degrade to "no relations," never to an error on the parent finding.
- URL parsing is defensive: `hostFromUrl` returns `undefined` on bad input, and
  the UI omits the host pivot when extraction fails.
- New sources gate on their key via `isEnabled()`; with no key set they report
  `skipped` and the report degrades gracefully (existing behavior).

## Testing

Follow the colocated `lib/**/*.test.ts` (Vitest, no network, `@/` alias)
convention. Sources stay un-unit-tested (they hit the network), matching
current practice.

- `lib/url.test.ts` (or wherever `hostFromUrl` lands): valid URLs, missing
  scheme, garbage input, IPv4/port hosts.
- `lib/relations.test.ts`: add cases for the new labels (`drops`, `parent`,
  `similar`, `host`); cross-source dedupe; focus-self exclusion still holds.
- `lib/ti/narrative.test.ts`: a hash case exercising `distributionUrls` /
  added context, if narrative copy is touched.
- `lib/ti/aggregate.test.ts`: a sanity case mixing several new weighted
  signals, confirming the blend/floor behavior is unchanged.

## Verification

1. `npm test` and `npm run lint` both pass.
2. Exercise the live pipeline with the keys present against a known-bad sample
   (e.g. a well-known Emotet/EICAR-style SHA-256) and a clean/unknown hash;
   confirm new relations, distribution URLs, and the four sources populate.
3. `npm run dev` + the Playwright shot helpers in `scripts/` to visually check
   the hash report **and** the IP/domain pages (the shared Connections card
   affects all three).

## Build sequence

1. **Model + mining** — `HashContext` fields, `hostFromUrl`, VT relation
   expansion, URLhaus URL promotion, MB imphash siblings, tests. *(no keys)*
2. **Shared UI** — `ConnectionsCard` wired into all three result types,
   Distribution URLs block, out-links. *(no keys; visible win)*
3. **New sources** — Maltiverse → Triage → Pulsedive → Kaspersky OpenTIP, each
   with adapter + registry + `.env.example` + out-link + (optional) README
   source-list update.

Each step leaves the app shippable: tests green, lint clean, no half-wired
sources in the registry.
