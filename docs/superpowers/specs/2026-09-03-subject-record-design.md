# Subject record: one identity card for all three indicator types

Status: design approved 2026-09-03, not yet implemented
Issue: #59 (partial, see Scope)

## The ask

Replace the three per-type identity cards with one card, laid out like a formal
record: a 1:1 sprite in the top right corner, and a short field list saying what
the indicator **is** and what it **did**, each with the sources that said so.

## Scope

This covers the record card and the sprite. It does not do steps 1 through 4 of
#59 (`signals` on `SourceFinding`, converting adapters, moving classification
into `assemble*`, the `v3:` cache bump). Those remain useful on their own and
ship independently.

Nothing in this design touches a source adapter, `aggregate.ts`, or the cache
schema. Everything is computed at render time from `SourceResult[]`, which is
already in the result.

## The two axes, from sources that already exist

#59's central claim is that "what an indicator is" and "what it did" are
different questions, and forcing one label to answer both makes one true fact
lose. The worked example is `71.6.146.185`: GreyNoise says it is a scanner,
AbuseIPDB says it was reported for brute force, both are true, and today they
compete for a single slot.

The axes can be split without adapter changes, because `threat-type.ts` already
names the sources that identify:

```ts
const IDENTIFIERS = new Set(["greynoise", "scanner-id", "tor-project"]);
```

**Behaviour** is `threatTypeOf` with the identifiers filtered out:

```ts
threatTypeOf(sources.filter((s) => !IDENTIFIERS.has(s.source.id)), opts)
```

`IDENTIFIERS` has to be exported for this. `verdict.tsx` keeps calling
`threatTypeOf` unfiltered, so the headline is unaffected.

One consequence must be documented at the call site. `threatTypeOf` withholds a
tied label when an identification source could not be consulted (#37, #39).
Filtering the identifiers out means that guard never fires on this axis. That is
correct here: the guard exists because one label served both meanings, and
"reported for brute force" is true whether or not the address is also a scanner.
The guard still protects `verdict.tsx`, which is where the single label lives.

**Identity** is two independent lookups, not one ladder. `infra` and `threat`
can both resolve, and often do: an EC2 instance running Dridex is genuinely
both. A single ordered ladder can only return one, which was the flaw in the
first draft of this design.

## The free-source rule

> A rung the sprite depends on must be a source that needs no API key and has no
> quota. Key-gated sources may refine the label text. They may never change the
> picture.

`greyNoiseSource` sets `requiresKey: true` and runs on the Community API's daily
quota. #37 documents what that costs: on a quota-exhausted day the same address
classifies differently, "depending on how much the tool was used earlier that
day". 9e9aa5b caches GreyNoise's identification for 30 days to soften this, and
its own commit message leaves open "finding a second identification source".

A sprite built on a metered source would make the icon change shape for reasons
that have nothing to do with the indicator. The rule above prevents that, and
the ladders below are the second identification source that commit asked for,
nine of them.

## identity.infra: who runs the box

Resolved in order, first hit wins. All free, no key.

| # | source | claim | evidence |
|---|--------|-------|----------|
| 1 | `cloud-range` | `Amazon Web Services, eu-west-1, EC2` | `details.provider/region/service/cidr`, from the provider's published prefix list |
| 2 | `cloud.ts` ASN table | `Microsoft Azure` | AS8075. A fact, not an inference |
| 3 | `shodan-internetdb` | `CDN edge` | `tags` containing `cdn` |
| 4 | `peeringdb` | `Content network, Fastly` | `details.networkClass` (`info_type`) + `details.peeringName` |
| 5 | `cloud.ts` org regex | `Hosting`, unnamed | an inference, see below |
| 6 | `classifyType(geo)` | `Hosting / Datacenter`, `Mobile network`, `Residential / Other` | `geo.isHosting` / `isMobile` |

Rung 5 is deliberately unnamed. `cloud.ts` resolves a provider two ways and only
one is reliable; the file already carries the scar in a comment (`jAWSon`,
`strAWSon`, `hAWSley` matching `aws` without word boundaries). #59's rule
applies: a named provider sprite renders only from a published prefix list or
the ASN table; an org-name match falls back to the generic `hosting` sprite. A
correct generic beats a confident wrong logo.

`cloudProvider()` currently returns `{ name }` and does not say which path it
took. It gains `via: "asn" | "org"`. Small, and unit-testable against the
existing ASN table.

For a **domain**, an infra match against `domainContext.resolvedIps` reads
`Behind Cloudflare`, not `Is Cloudflare`. #59 is explicit that these are
different claims: on an IP the match means that address is the edge; on a domain
it means the origin is not visible from here.

## identity.threat: what the box is

Resolved in order, first hit wins. All free, no key.

| # | source | claim | evidence |
|---|--------|-------|----------|
| 1 | `feodo` | `Dridex C2` | `details.malware`, the named family |
| 2 | `tor` | `Tor exit node` / `Tor relay` | `details.role`, Onionoo |
| 3 | `scanner-id` | `Research scanner, Censys` | `details.operator`, from the host's own PTR |
| 4 | `shodan-internetdb` | `Honeypot`, `Compromised host`, `Botnet` | `maliciousTags(tags)`, whose set is malware, compromised, c2, phishing, botnet, honeypot |
| 5 | `spamhaus-drop` | `Criminal netblock` | `categories: ["criminal-netblock"]` |
| 6 | `et-open` | `Compromised host` | `categories: ["compromised"]` |

Rung 1 is the one currently being thrown away. Feodo returns the malware family
free and without a key, and `Dridex C2` identifies the host far better than the
`c2` that survives `classifyCategory` today. The family reaches `categories` as
a flat string and is never read again.

Note for implementation: `ip-dossier.ts:225` says spamhaus-drop's "source is not
registered in `lib/ti/registry.ts`, so it never contributes a finding". That
comment is stale. `spamhausDropSource` is imported at `registry.ts:16` and
listed at `registry.ts:48`. The rest of that comment, that it never sets
`malicious` by design, still holds and is why `blocklistEvidence` excludes it.
Verify the finding actually arrives before relying on rung 5, and fix the
comment either way.

**GreyNoise refines, it does not resolve.** When present, `riot === true` with an
`actor` appends the operator to whatever the ladders chose: rung 4 of infra gives
`Content network, Google LLC`, GreyNoise turns it into `Google Public DNS`. On a
quota-exhausted day the label is coarser. It is never absent, and the sprite
does not move.

## Per type

**Domain.** infra as above against `resolvedIps`. Threat: `openphish` →
`Phishing page`; `spamhaus-dbl` `details.meanings` → e.g. `Botnet C2 domain`;
`quad9` → `DNS-blocked`; `rdap` `registry-hold` → `Registry hold`. Identity of
last resort: `tranco` `details.rank` when `vouched` → `Popular domain, Tranco
rank 412`, then `classifyDomain(ctx, resolves)` (`Newly registered`, `Inactive /
parked`, `Established`). All free.

**Hash.** No infra axis. Threat: `cymru-mhr` (`Known malware, Team Cymru MHR`),
`hashlookup` known-malicious (`details` carries the flagging source), then
`maltiverse` detection names and `metadefender`'s verdict. Then `hashlookup`
known-good → `Known legitimate file, NSRL`, which no other free source answers
and which is the only positive identification available for a clean file. Then
`classifyHash(ctx, hasData)`.

Hash is where the free-source rule bites hardest. Of the 14 sources in
`hash/registry.ts`, 10 are key-gated: `malwarebazaar`, `virustotal`,
`virustotal-sandbox`, `kaspersky-opentip`, `triage`, `threatfox`, `urlhaus`,
`pulsedive`, `hybrid-analysis`, `yaraify`. Their labels are better when present,
so they refine, but the sprite comes off the four free ones: `metadefender`,
`maltiverse`, `cymru-mhr`, `hashlookup`.

`malpedia` is deliberately absent from that list. It is not a `TiSource` and is
not registered; `fetchFamilyDescription` takes a family name that some other
source already produced and returns prose about it. It cannot identify a hash,
so it cannot back a `CLASS` claim.

## The module

`lib/ti/subject-record.ts`, pure, no JSX, no network.

```ts
export type Claim = { label: string; sources: string[] };

export type SubjectRecord = {
  subject: string;                 // the indicator, verbatim
  qualifier?: string;              // hash only: "SHA256"
  class: Claim;                    // identity.threat, else identity.infra, else per-type
  hostedOn?: Claim;                // identity.infra, when it differs from class
  reportedFor?: Claim & { also: string[] };
  seen?: { first?: string; last?: string };
  sprite: { key: SpriteKey; flagged: boolean };
  footer: string;
};

export function buildSubjectRecord(
  result: CheckResult | DomainCheckResult | HashCheckResult,
): SubjectRecord;
```

Each rung is its own resolver, and the ladder is a list:

```ts
type Resolver = (r: AnyResult) => Claim | null;
const INFRA: Resolver[] = [fromCloudRange, fromAsnTable, fromShodanCdn, ...];
const THREAT: Resolver[] = [fromFeodo, fromTor, fromScannerId, ...];
const first = (rs: Resolver[], r: AnyResult) =>
  rs.reduce<Claim | null>((hit, f) => hit ?? f(r), null);
```

This keeps every function small enough to stay well under
`sonarjs/cognitive-complexity` (S3776, limit 15), which a single branching
ladder would not.

`class` prefers the threat claim, because "Dridex C2" is more informative than
"AWS". `hostedOn` carries the infra claim so nothing is lost. When no threat
claim resolved, `class` falls back to the infra claim and `hostedOn` is
`undefined`, so the same fact never renders on two rows. The sprite orders the
two the other way round, see below.

### Timestamps

`SourceFinding` has `lastSeen` but no `firstSeen`. First-seen exists only in
`hashContext.firstSeen`, `feodo` `details.firstSeen`, and `dshield`
`details.feedFirstSeen`. The row therefore renders:

- both known: `2026-02-11 to 2026-08-30`
- only last: `Last seen 2026-08-30`
- neither: the row is hidden

`lastSeen` is typed `string` and carries at least three formats (#60). A local
`parseSeen` helper handles it, because comparing values across sources requires
actually parsing them:

- `YYYY-MM-DD HH:MM:SS` with no zone (Onionoo) is read as **UTC**, not local.
  `Date.parse` reads it as local today, which shifts the Tor timestamp by the
  deployment's offset, seven hours on `sin1`, silently.
- a trailing `UTC` (URLhaus) is stripped and read as UTC
- anything else goes to `Date.parse`
- `NaN`, or a year outside 1990 to next year, is discarded rather than rendered

This is a narrow fix for one field. #60's `lib/ti/canon/` is the real home for
it, and `parseSeen` should move there when that lands.

## The sprite

`lib/ti/sprite.ts`, pure, no JSX.

### Set

```ts
export type SpriteKey =
  | "hosting"                                   // base body, and the IP fallback
  | "aws" | "azure" | "gcp" | "cloudflare"      // 6x3 chest marks, not standalone
  | "scanner" | "c2" | "anonymizer"             // threat identity
  | "site" | "file";                            // domain and hash fallbacks
```

The four provider keys are marks, not bodies: they are only ever composited into
`hosting`'s well, never rendered alone.

The free-source rule decides the set too: v1 draws exactly what a free rung can
produce, so there is nothing to guess about which sprites are worth the work.

```
base       hosting                       rack with an empty 6x3 chest well
marks      aws  azure  gcp  cloudflare   6x3 patches composited into the well
threat     scanner  c2  anonymizer       from scanner-id, feodo, tor
fallback   site  file                    domain and hash with nothing resolved
overlay    horns
```

Eleven grids, not seventeen. `hosting` with an empty well is also the IP
fallback, so no separate `host` is needed. Behaviour sprites (`brute force`,
`spam`, `web attack`) are **not drawn**. They would only render when no rung
identified the indicator at all, which means we do not know what it is, only
what it did. The honest rendering there is the type fallback with horns, letting
`REPORTED FOR` carry the fact in text. `SPRITES[key] ?? fallback` makes this
degrade cleanly, exactly as #59 specifies.

### Resolution

```
1. identity.infra    hosting + provider mark
2. identity.threat   c2 | scanner | anonymizer
3. type fallback     hosting | site | file
+  horns            when verdict is malicious or suspicious
```

Infra first, the opposite of `class`, and deliberately so. The sprite answers
"what is this thing", and for something physically an EC2 instance, an AWS box
is a truer answer than a C2. The threat is not lost: it is the `CLASS` line an
inch to the left.

A Dridex C2 on EC2 therefore renders as the rack body, the AWS chest mark,
horns, in the verdict's destructive red, beside:

```
CLASS      Dridex C2
HOSTED ON  Amazon Web Services, eu-west-1
```

### Storage and composition

ASCII grids in source, per #59. A hex-per-row encoding is four times smaller and
completely unreviewable; a one-character diff in hex is a change nobody can
evaluate, while `git diff` on ASCII shows what changed about the drawing. Cost
is roughly 2.5 KB of text that gzips extremely well.

```ts
const HOSTING = `
  ................
  ...##########...
  ..############..
  ..##........##..
  ..##.##..##.##..
  ..##.##..##.##..
  ..##........##..
  ..############..
  ..##........##..
  ..##.MMMMMM.##..     M = the 6x3 mark well, rows 8-10, cols 5-10
  ..##........##..
  ..############..
  ...##########...
  ....##....##....
  ...###....###...
  ................
`;
const HORNS = `##...........###
.##.........##..`;
```

Composition happens **in the grid domain**: base, then mark into the well, then
overlay, then one conversion to SVG. Not three stacked SVGs. Composing as grids
means a test can assert which cells were overwritten.

`toRects()` merges horizontal runs into single `<rect>` elements, roughly 30 to
40 per sprite, filled with `currentColor`. No image assets, no extra request,
crisp at any DPI.

Colour comes from `VERDICT_STYLE[verdict].text`, already exported from
`verdict.tsx`, which is the one place in this UI where colour is allowed. The
horns supply a shape difference as well, so colour never carries the meaning
alone.

### Contact sheet before art

The grids above establish size and visual language. They are not finished
drawings and cannot be judged as text: a terminal character cell is taller than
it is wide, so everything sketched this way is distorted.

`scripts/sprites.mjs` therefore comes **before** the remaining sprites. It
renders the whole set at 16, 32 and 64px, both themes, with and without the
overlay, on one page, and screenshots it with the Playwright helpers already in
`scripts/`. Draw one, look at it, then draw the rest.

## Layout

`components/CheckResults/record.tsx` renders the masthead. The card's existing
groups continue below a `Rule`, untouched.

```
┌─ SUBJECT RECORD ──────────────────────────────────┐
│                                        ┌────────┐ │
│  SUBJECT       185.220.101.42          │        │ │
│                                        │ sprite │ │
│  CLASS         Dridex C2               │  64px  │ │
│                feodo                   └────────┘ │
│                                                   │
│  HOSTED ON     Amazon Web Services, eu-west-1     │
│                cloud-range                        │
│                                                   │
│  REPORTED FOR  Brute force, port scan             │
│                abuseipdb, otx                     │
│                                                   │
│  SEEN          2026-02-11 to 2026-08-30           │
│ ───────────────────────────────────────────────── │
│  HOST CLASSIFICATION            (existing groups) │
└───────────────────────────────────────────────────┘
```

- The mugshot frame is 64px (the 16 grid at 4x), `border-foreground/20`, no
  caption. A caption would repeat `CLASS` two inches away.
- Every row carries a provenance line: mono 11px, muted, the source ids that
  backed the claim. This is what keeps the card from repeating `VerdictHero`.
  The hero says how bad. This card says what, and who said so.
- Rows with no data disappear entirely, except `CLASS` and `REPORTED FOR`, which
  render `Unclassified` and `Nothing on file`. For those two, absence is the
  answer, not a gap.
- Small screens: the frame drops to 48px and stays top right. Label column is
  `w-32`; long values wrap beneath the label.
- Streaming: the frame is a `sweep` block, rows are `sweep` bars, matching the
  existing `IpDossierCard` skeleton.

### Files

```
new     lib/ti/subject-record.ts       + .test.ts
new     lib/ti/sprite.ts               + .test.ts
new     components/CheckResults/record.tsx
new     scripts/sprites.mjs
edit    lib/ti/cloud.ts                  cloudProvider gains via: "asn" | "org"
edit    lib/ti/threat-type.ts            export IDENTIFIERS
edit    lib/ti/ip-dossier.ts             fix the stale spamhaus-drop comment
edit    components/CheckResults/dossier.tsx   heading, mount the masthead
edit    components/CheckResults/profile.tsx   two headings, mount the masthead
delete  IdentityHeader (profile.tsx), the hash family header, hashKind,
        HASH_KIND_TONE, and anything else left with no caller
```

`IdentityHeader` and the hash `StatusDot` header are removed rather than left
above the masthead. They are the same idea as `CLASS`, in three shapes that do
not agree, which is the thing this card exists to fix.

## Testing

Vitest, colocated under `lib/`. Sonar's `new_coverage` gate requires 80% on
changed lines, so every new file in `lib/` needs tests before the PR opens.

- Each resolver, against a payload the real source returns. Feodo's family
  reaching `CLASS` as `Dridex C2` is the headline case.
- Both axes resolving at once: cloud-range plus feodo gives `class` = the C2 and
  `hostedOn` = the provider, and the sprite key is the provider's, not the C2's.
- The `71.6.146.185` case already in `threat-type.test.ts`: `class` is `Scanner`
  backed by scanner-id, `reportedFor` is `Brute force` backed by abuseipdb and
  otx, neither buried.
- Provenance: an org-regex provider match yields `Hosting` and the `hosting`
  sprite, never a named mark. An ASN-table match yields the name.
- No key, no quota: with every key-gated source returning `status: "error"`, the
  sprite key and `class` are unchanged from the all-sources run.
- `parseSeen`: the Onionoo zone-less shape and the URLhaus `UTC`-suffixed shape
  resolve to the same instant; a garbage string is discarded, not rendered.
- Sprites: every grid is exactly 16x16 and contains only `#` and `.`; every mark
  is exactly 6x3; every `SpriteKey` resolves to a grid or the documented
  fallback; grid to rects round-trips to the same shape; composition overwrites
  exactly the well's cells and no others.
- `threat-type.test.ts` passes unchanged, since `threatTypeOf` itself is not
  modified.

## Not in this design

- Steps 1 through 4 of #59: `signals` on `SourceFinding`, converting adapters to
  emit their own taxonomy, the `unmapped` tally, moving classification into
  `assemble*`, the `v3:` cache bump. This design works from what the adapters
  emit today, and does not conflict with any of it; when `signals` lands, the
  resolvers read it instead of `details` and the ladders get shorter.
- Behaviour sprites. They wait for the unmapped tally to show they occur often
  enough to earn the drawing.
- Unifying domain and hash field assembly into `DossierGroup[]` behind one card.
  That means rebuilding `DllImports`, `RuntimeBehavior`, the MITRE links and
  `ExpandableList` as `{ label, value: string }`, which they are not. It is the
  direction of #61 and belongs to that issue.
- Adding Azure's published prefix list to `cloud-ranges.ts`, and CNAME suffix
  matching for domains. Both are from #59 and both are worth doing; neither is
  needed for the card to render correctly, because the ASN table already covers
  Azure for IPs and rung 5 degrades to `Hosting` for domains.
