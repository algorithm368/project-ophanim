# SOC hash triage: "what is this file and what does it do"

Date: 2026-07-18
Status: design, awaiting review

Implementation note (2026-07-18): the trustworthy related-indicators half
(section 7) is already built in the working tree, `RelatedIndicator` carries
`tier`/`sources`, `relations.ts` merges by value, the hash sources tag their
pivots, and `connections.tsx` renders the single `RelationTable`. Separately,
the File identity profile card has been rebuilt as a flat, single-column
"record readout" (a status dot for the verdict, lowercase label to value rows,
no grouped bento cells). The undelivered half is the "what is this file and what
does it do" profile detail (sections 2 to 6), which this revision lands as a new
dedicated card rather than a group appended to the identity card (section 8).

## Problem

A SOC analyst often has only a file hash (from an EDR alert, a proxy log, a
ticket) and needs to triage fast: what is this, how bad is it, what does it do,
and what should I block or hunt next. Today the hash result page surfaces a
verdict plus scattered facts (file type, detection labels, some related
indicators), but it does not answer "what is this malware and what does it do"
in plain language, and it does not give a decision,ready readout.

Observed live against `34b138e724d2ed98d178e03b9c9a13c92485e274b8c5961282fa0d29dd894ad2`:
only Kaspersky OpenTIP had the file (a Zip, labelled
`Trojan-Downloader.Win32.Upatre.afcl`). Every sandbox source (MalwareBazaar,
VirusTotal, Triage, Hybrid Analysis) returned "not found", and `malwareFamily`
was empty. The only path to "what is this" was parsing the AV label into a
family (`Upatre`) and describing it. This drives the core design decision below.

## Goals

1. Given only a hash, always try to answer "what family is this and what does it
   generally do", even when the only signal is an AV detection label.
2. When a sandbox report exists, show concrete per,sample behavior mapped to
   MITRE ATT&CK.
3. Make the card decision,ready for SOC: promote detection confidence, and make
   the related indicators trustworthy so an analyst can tell a real C2 from
   sandbox noise, then copy the trustworthy ones as a defanged block.

Goal 3 changed during design. The first cut was "copy all related indicators".
Review feedback: a flat list with no provenance or confidence is unusable,
because an analyst cannot tell a confirmed C2 from benign sandbox noise, and a
copy,all button would drag that noise into a blocklist. So the real work is
provenance + confidence, and the copy export rides on top of it.

## Non,goals

- No new paid sources. Free only (Malpedia public API needs no key, confirmed).
- No threat,actor attribution, next,action checklist, or freshness banner in
  this iteration (considered, deferred).
- All indicator types (IP, domain, hash) share one related-indicator table for
  consistency. The confidence tier column + legend only render for hash malware
  pivots (the only relations that carry a tier); IP/domain DNS facts use the
  same table without them.
- Scoring and verdict are unchanged. Every addition is context,only (weight 0).

## Design

### 1. Data model (`lib/ti/types.ts`, `HashContext` at line 104)

Add:

- `familyDescription?: string` — plain,language summary of the malware family.
- `familyRefs?: string[]` — reference URLs for deeper reading (capped ~5).
- `capabilities?: { label: string; mitre?: string[] }[]` — sandbox,observed
  behaviors, each optionally tagged with MITRE technique ids.
- `mitreTechniques?: { id: string; name?: string; tactic?: string }[]` —
  deduped ATT&CK techniques.
- `detectionRatio?: { malicious: number; total: number }` — for confidence (B).

Family name itself continues to use the existing `malwareFamily` field; what
changes is how it gets resolved (2).

`RelatedIndicator` (types.ts:20) gains two optional fields, for section 7:

- `sources?: string[]` — which sources reported this pivot (provenance +
  corroboration count).
- `tier?: "confirmed" | "observed"` — confirmed = extracted malware C2 config,
  or corroborated by two or more sources; observed = single,source sandbox
  contact that may include benign OS noise. Absent tier renders as today (used
  by DNS/infra relations on the IP/domain views).

### 2. Family resolution (the SOC,critical part)

New pure helper, e.g. `lib/ti/hash/family.ts`:
`resolveFamily(ctx: HashContext): string | undefined`.

Precedence:
1. An explicit `malwareFamily` set by any source.
2. Otherwise, parse a family token out of `detectionNames` (unioned across all
   sources). Strip vendor prefix, platform, type and variant affixes, e.g.
   `Trojan-Downloader.Win32.Upatre.afcl` and `HEUR:Trojan.Win32.Generic` →
   `Upatre` (ignoring the generic `Generic`). Choose the most frequent
   non,generic token.

Unit,tested against the real labels seen for the reference hash plus generic
and multi,platform cases.

### 3. Malpedia enrichment (post,aggregation step)

Because sources run in parallel and cannot see each other's output, the family
description is resolved after merge, in `lib/ti/hash/check.ts`, after `runAll`:

1. `resolveFamily(mergedContext)`; if no family, skip.
2. Map family name to a Malpedia id. Try `win.<slug>` first (covers most
   Windows malware), then fall back to other platform prefixes
   (`elf`, `osx`, `apk`, `js`), or match against the cached families index.
3. Fetch Malpedia `GET /api/get/family/{id}` (public, no key, confirmed). Attach
   `familyDescription` (from `description`) and `familyRefs` (from `urls`,
   capped). On miss/timeout, leave them unset; the family name still shows.

New source file `lib/ti/hash/sources/malpedia.ts` is NOT the right shape here
(it would need the family, which no single source knows). This stays a
post,step. It uses the `lib/ti/http.ts` helpers and honors the abort signal.
Cache,friendly: the family,to,description mapping can be cached by family name.

Slug mapping is the main implementation risk; verify against real families
during build. If Malpedia proves unreliable, the family name + AV labels still
render, so the feature degrades, it does not break.

### 4. Sandbox behavior (extend existing sources)

- `lib/ti/hash/sources/triage.ts`: today `signatures[].name` is dumped into
  `categories`. Also emit them as `capabilities`, and pull `signatures[].ttp`
  (MITRE ids) into `mitreTechniques`.
- `lib/ti/hash/sources/hybrid-analysis.ts`: emit `mitre_attcks[]` as
  `mitreTechniques` and behavioral signatures as `capabilities`.

Both remain their current weight; these are context,only fields.

### 5. Detection confidence (B)

`lib/ti/hash/sources/virustotal.ts` already computes `malicious` and `total`
and writes "N/M engines detect this file" into its summary. Promote that into
`hashContext.detectionRatio = { malicious, total }` so the UI can show it as a
first,class confidence number. Only present when VirusTotal has the sample.

### 6. Merge (`mergeHashContext` in `lib/ti/assemble.ts`)

`mergeFields` (orchestrate.ts:91) is first,non,empty. Add union+dedupe handling
for the array fields `capabilities` and `mitreTechniques` so Triage and Hybrid
contributions combine instead of first,wins. Scalars (`familyDescription`,
`detectionRatio`) stay first,non,empty.

### 7. Trustworthy related indicators (A)

Related indicators already flow (`relations` on the result type, assembled via
`lib/relations` `relationsFor`/`groupRelations`, rendered by
`components/CheckResults/connections.tsx`). Two root,cause problems make them
hard to trust today, both fixed here:

Problem 1, corroboration is discarded. `dedupe` in `lib/relations.ts` keeps the
first occurrence of a value and drops the rest, so "reported by Triage and
VirusTotal" collapses to a single anonymous entry. Fix: replace `dedupe` with a
`mergeRelations` that keys by lowercased value, unions `sources`, and keeps the
strongest tier/relation. Corroboration by two or more sources sets
`tier: "confirmed"`.

Problem 2, one "contacts" bucket mixes real C2 with sandbox noise.
`extractTriageRelations` (triage.ts) flattens `extracted.config.c2/domains/hosts`
(clean C2 extracted from the malware config) and each target's `iocs` (sandbox
network observations, mixed with benign OS noise) into the same "contacts"
relation. Fix: tag config,derived indicators `tier: "confirmed"` and
sandbox,observed ones `tier: "observed"`, and record the source id on each.
VirusTotal/OTX file relations carry their source id similarly.

Every hash source that emits relations is tagged: extracted C2 config
(MalwareBazaar `malware_config`, Triage `extracted.config`) and URLhaus
distribution hosts are `confirmed`; sandbox contacts (Triage `iocs`), VirusTotal
file relations, MalwareBazaar imphash siblings, and Hybrid Analysis
parent/child hashes are `observed`. `mergeRelations` then promotes any pivot two
or more sources agree on to `confirmed`.

Presentation (chosen layout: SIEM-style table, "layout C"): the hash
`ConnectionsCard` renders a single flat table sorted confirmed-first, columns
CONF · INDICATOR · TYPE · RELATION · SOURCES. The CONF column shows a red shield
for confirmed and a hollow dot for observed; a legend explains both. The
indicator is a pivot chip; SOURCES shows provenance. The file's own other
digests (`DIGEST_RELATIONS`) are filtered out (they live in the profile card).
Observed rows are capped at 12 with a "+N more observed" expander so sandbox
noise never floods the view; confirmed rows always show in full. IP and domain
results render through the same `RelationTable`, minus the CONF column and
legend (their DNS/infra relations carry no tier), with the whole list capped
uniformly. The old grouped `groupRelations` readout is removed.

No copy/export button (dropped during design review as out of scope for this
iteration).

### 8. UI (revised)

The original plan appended these facts as a `Group` inside the identity profile
card. That card has since been rebuilt as a tight flat "record readout" (see the
implementation note at the top), which is the wrong home for narrative content (a
description paragraph, a behavior list, technique chips). So the profile detail
lands as its own card instead.

New component `ThreatProfileCard` in a new file
`components/CheckResults/threat-profile.tsx` (kept out of the already large
`profile.tsx`). Rendered on the hash result page after the File identity card and
before the Related indicators card. Monochrome, color only on verdict tone,
commas not dashes, matching the rest of the result page.

Header: a `SectionHeading` reading "Threat profile", with a right-aligned
`N / M engines` confidence chip (from `detectionRatio`, mirroring the algorithm
chip on the identity card). The chip is shown only when `detectionRatio` is
present (i.e. VirusTotal had the sample).

Body sections, each hidden when it has no data:

- Family: a verdict-tone status dot + family name, the `familyDescription`
  paragraph, and `familyRefs` as labelled outbound links. Shows whenever a
  family resolves (name alone is enough; the description may be absent on a
  Malpedia miss).
- What this file does: the `capabilities` list, each item with its MITRE
  technique ids tagged beneath it. When no sandbox report exists (as with the
  reference hash), render a single clear empty-state line pointing the analyst
  to the family description above, rather than hiding the section silently.
- MITRE ATT&CK: `mitreTechniques` as technique chips (id, and name when known),
  hidden when empty.

The whole card returns `null` when nothing resolves (no family, no capabilities,
and no detection ratio), so an unknown hash shows only File identity.

Wiring (`components/CheckResults/index.tsx`): add a new `<Section id="threat">`
holding `ThreatProfileCard` between the `origin` and `related` sections in the
hash result layout, and add a matching `{ id: "threat", label: ... }` entry to
`HASH_SECTIONS` so the left-rail `SectionNav` stays in sync. Because the card can
render `null`, an empty section is acceptable (the nav entry simply scrolls to an
empty anchor); if that reads poorly, gate the nav entry on the same has-content
check the card uses.

Detection confidence may reuse `components/CheckResults/confidence.tsx` for the
`N / M` rendering.

The Related indicators card (`components/CheckResults/connections.tsx`) is
unchanged by this revision, it is already the single `RelationTable` described in
section 7 (the earlier "two sections + copy actions" sketch here was superseded
by section 7 and is dropped). IP and domain views are untouched.

## Testing

- `lib/ti/hash/family.ts`: AV,label → family parser (incl. the real Upatre and
  Generic labels, multi,platform, junk).
- Triage / Hybrid extraction: fixtures with `signatures`/`ttp`/`mitre_attcks`.
- Malpedia lookup + slug mapping: mocked JSON.
- `mergeHashContext`: union+dedupe for `capabilities`/`mitreTechniques`.
- VT `detectionRatio` promotion.
- `mergeRelations`: same value from two sources merges, unions `sources`, and
  is promoted to `tier: "confirmed"`.
- `extractTriageRelations`: config,derived C2 tagged `confirmed`, sandbox `iocs`
  tagged `observed`.
- `sortRelationsForTable`: confirmed-first ordering, no input mutation.

All unit, no network, colocated `*.test.ts`, run with `bun run test`.

## Verification

`bun run test` and `bun run lint` pass. Exercise end,to,end against the
reference hash (family resolves to Upatre with a Malpedia description, empty
behavior state) and a known sandbox,covered hash (capabilities + MITRE
populated), plus a VirusTotal,covered hash for `detectionRatio`.
