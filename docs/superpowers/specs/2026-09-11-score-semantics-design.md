# Give the score a meaning, and the adapters a vocabulary

Status: approved design, not yet planned
Date: 2026-09-11

## What this is

The number on the result page is the product. Everything else on the page, the
sprite, the confidence tier, the narrative, the verdict word, is a rendering of
it. This spec defines what that number means, and changes what a source is
allowed to say so the number can mean it.

It closes the input half of #60, all of #59, and the first half of #37. The
aggregation half of #60 is here too, but as a smaller change than the issue
implies, because `aggregate.ts` is mostly right already and this spec says so
explicitly.

## The decisions this rests on

Settled in conversation on 2026-09-11, recorded here so the reasoning is not
lost and so a later disagreement has something to disagree with.

| Question | Decision |
| --- | --- |
| What ophanim is | A real tool people use to decide, not a portfolio piece |
| What the number means | The weight of the evidence, not a probability |
| What an adapter may emit | A closed enum, plus the provider's own figure when it genuinely has one. Never a number it chose itself |
| Sources that copy from each other | One piece of evidence, said so on the page |
| A source that answers but answers wrong | Caught at the adapter first, with a cross-time baseline as the net for the ones that cannot tell |
| The 30 stored history snapshots | Wiped |
| The enum's shape | Two axes, what it is and what it did |
| The 75 floor | Kept, but tied to the tier of the assertion rather than to a boolean |
| VirusTotal | One piece of evidence at a high tier, not ninety |
| The verdict bands | Frozen. The new scale is tuned to land on them |

"The weight of the evidence" is the load-bearing one. It was chosen over "the
probability this is malicious" because a probability is a claim about a
reference class we have never measured, and over "what to do about it" because
the action depends on a policy that belongs to the reader's organisation, not
to us. Evidence weight is the only reading of the number we can defend in a
sentence to someone who asks.

## The defect

Normalisation stopped at the shape of `SourceFinding`. The values inside it are
still each source's own dialect, and the centre reconciles afterwards, or fails
to.

### The number is chosen, not measured

Fifty-seven adapters each pick a 0-100 value with no shared scale. `feodo.ts`
says 95 for a listed C2, `et-open.ts` says 85, `quad9` says 80, `spamhaus-drop`
says 55 at netblock granularity, `tor.ts` says 50 for an exit and 25 for a
relay. No document defines the difference between 85 and 90. They were chosen
one adapter at a time by whoever wrote it that day.

`aggregateRisk` then blends the strongest weighted signal at 0.6 with the
weighted consensus at 0.4 (`lib/ti/aggregate.ts:11`), so the gap between 85 and
90 moves the final score and therefore the verdict boundary. An arbitrary number
is being treated as a measurement.

### Classification reads display strings it threw the answer away to make

`lib/ti/sources/abuseipdb.ts:27` holds the real taxonomy as numeric ids:

```ts
const ABUSE_CATEGORIES: Record<number, string> = { 4: "DDoS Attack", 18: "Brute-Force", ... };
```

flattens it at `:78`:

```ts
for (const b of breakdown) categories.push(b.name.toLowerCase());   // "ddos attack"
```

and `lib/ti/threat-type.ts:59` guesses it back with a second hand-typed table:

```ts
"ddos attack": "ddos",
```

A category id is downgraded into a human label and parsed back by a regex. Add
an id to the adapter's table and classification does not learn it. Reword a
display name and classification breaks with no test failing, because the two
tables are related only by someone having typed both.

The same adapter pushes `d.usageType` into `categories` at `:77`, which is the
entire reason `USAGE_NOISE` exists at `threat-type.ts:107`. A filter exists to
undo what an adapter did four files away.

### The two axes are already tangled, and the tangle is visible

`ThreatType` (`threat-type.ts:15`) is a good closed vocabulary of twelve values,
but it holds `anonymizer` alongside `c2` and `brute force`. Being a Tor exit is
not something an address *did*, it is something it *is*. `BodyKey`
(`lib/ti/sprite.ts:17`) shows the same tangle from the other side: `hosting`,
`mobile`, `residential`, `site` and `file` are identity; `scanner`, `c2` and
`anonymizer` are behaviour; they sit in one union because nothing in the model
separates them.

### Corroboration counts sources, not evidence

`dshield.ts:111` has the right instinct in a comment, "the `threatfeeds` map is
largely other people's feeds", and sets `weight: 0` for that reason. Four files
away, `ipsum.ts:29` says in its own comment that it "aggregates 30+ public
blocklists" and carries `weight: 0.7`. `blocklist-de` (0.6) and `et-open` (0.9)
are registered separately, and are plausibly among the thirty. `virustotal.ts`
carries `weight: 1` for what is ninety vendors in a box, several of which
consume the same feeds.

So `weightedAvg` and the `flagging` count in `aggregateRisk` both treat one
piece of evidence, repeated, as several. Under "the weight of the evidence" that
is not a rounding error, it is the thing the number is supposed to measure.

### A source that cannot look is indistinguishable from one that looked

`confidence.ts` and `partial.ts` handle the honest cases well. `partial.ts:27`
keeps `noRecord` apart from `clean` on exactly the right grounds, and
`confidence.ts:48` argues carefully about which absences belong in the
denominator. Neither can help with the dangerous case: a source that returns
HTTP 200 carrying an answer it is not entitled to give. #37 is this. GreyNoise
exhausts its daily quota, answers that it does not know the address, and to
`confidence.ts` that is a source which answered. Coverage stays full, agreement
stays high, the score does not move, and the label is wrong.

Per-lookup measurement cannot see this. Only time can.

### `lastSeen` is a string holding at least three formats

```ts
lastSeen: d.lastReportedAt        // abuseipdb   ISO 8601 with offset
lastSeen: relay.last_seen         // tor         "2026-08-30 01:00:00"   (no zone)
lastSeen: data.lastseen           // urlhaus     "2026-08-30 01:00:00 UTC"
```

Time is evidence. Right now it is text.

## The design

### 1. What an adapter is allowed to say

An adapter reports what it observed. It does not price it. `SourceFinding`
gains an `assertion` and loses the adapter's right to set `score`.

```ts
/** What a source claims about an indicator. The only channel through which a
 *  source can move the risk number. */
export interface Assertion {
  /** What the indicator IS. One value: an address is not two kinds of thing. */
  identity?: IdentityClass;
  /** What the indicator DID. Ordered by the source's own ranking, deduped. */
  behavior?: ThreatType[];
  /** How firmly the source stands behind `behavior`. Required: a source that
   *  cannot say how firmly it believes something has not made an assertion. */
  tier: AssertionTier;
  /** The provider's own figure, where the provider genuinely publishes one.
   *  Not a score, and never invented to fill the field. */
  providerConfidence?: ProviderConfidence;
  /** When the source last observed what it is asserting. */
  observedAt?: Instant;
}
```

`score` stays on `SourceResult` as a computed field so the UI and the cache keep
working, but it is written by the centre, never by an adapter. A lint rule and a
type change enforce this: `TiSource.check()` returns a narrowed
`SourceFindingInput` with no `score` and no `malicious` on it at all.

### 2. The two axes

**Identity, what it is.** One value, drawn from what the address or file is,
never from what it did:

```
hosting | residential | mobile | business | education | government
| cdn | dns-infra | anonymizer | unknown
```

`anonymizer` moves here from `ThreatType`. A Tor exit is a kind of address, and
whether that is bad is the reader's policy, not our finding. This also retires
`USAGE_NOISE`: AbuseIPDB's `usageType` becomes an `identity` and stops being a
category that has to be filtered out of a behaviour list downstream.

**Behaviour, what it did.** The existing `ThreatType` vocabulary minus
`anonymizer`, unchanged otherwise. It is good, it was built from what live
sources actually emitted rather than from documentation, and nothing here
rebuilds it.

`BodyKey` in `sprite.ts` is then derived from the pair rather than being a third
vocabulary that overlaps both. That is a follow-on, not part of this change.

### 3. The tier ladder, and the one table that defines the scale

The tier is what "evidence strength" means, made discrete. Seven values, each
defensible in a sentence:

| Tier | Means | Example |
| --- | --- | --- |
| `confirmed` | The source holds the artefact itself | Feodo with an extracted C2 config; MalwareBazaar holding the sample |
| `attributed` | The source asserts it from its own analysis, without a first-party artefact | ET Open; Spamhaus DROP at netblock granularity |
| `reported` | Third parties reported it to the source | AbuseIPDB reports; OTX pulses |
| `observed` | The source saw the behaviour, which is not inherently adverse | GreyNoise internet scanning; a Tor relay |
| `none` | Looked, and found nothing adverse | A DNSBL with no listing |
| `no-record` | Has no record of this indicator at all | VirusTotal's 404 path |
| `vouched` | An authoritative allowlist explicitly vouches | Maltiverse whitelist |

The mapping from tier to points lives in exactly one file, `lib/ti/scale.ts`,
as one table with a comment per row explaining what that row is worth and why.
That file is the answer to "what is the difference between 85 and 90", and if
it cannot answer, the row is wrong.

`no-record` is not evidence of cleanliness and never contributes toward a low
score. `none` is. Keeping them apart is the same distinction `partial.ts`
already draws, promoted from a count into the model.

`vouched` replaces the standalone `allowlisted?: boolean`, which becomes derived
(`tier === "vouched"`). `computeFloor`'s vouch quorum keeps reading it and keeps
its current behaviour; only where the value comes from changes.

`identity` is emitted on the assertion by whichever source knows it, including
the context-only sources at weight 0, and is merged across sources by the
existing first-non-empty `mergeFields`. It is deliberately not moved to the
assembled context: identity is something a source observed, and putting it
anywhere else recreates the gap this spec exists to close. A weight-0 source
emitting an identity still moves nothing in the score, which is correct, and it
is exactly how AbuseIPDB's `usageType` stops being a fake behaviour category.

`providerConfidence` modulates within a tier and cannot move across one. A
60/90 VirusTotal and a 2/90 VirusTotal differ, and both are still one piece of
evidence at VirusTotal's tier.

### 4. Lineage, so corroboration counts evidence

`SourceMeta` gains:

```ts
/** Whether this source observed what it reports, or republishes others. */
lineage: "first-party" | "aggregate";
/** For aggregates, the feeds it republishes, where they are knowable. */
aggregates?: string[];
```

Corroboration is then counted over distinct evidence origins rather than
distinct sources. An `aggregate` contributes at most one, whatever its internal
count, and a first-party source named in some aggregate's `aggregates` list
collapses into that aggregate rather than adding to it.

The honest limitation, stated because a silent cap reads as coverage: IPsum does
not publish *which* of its thirty lists fired for a given IP, so the collapse is
approximate. We cap rather than pretend. The page says so, next to the source:
`aggregate of 30+ lists, counted once`.

`virustotal` becomes `lineage: "aggregate"` with `providerConfidence` carrying
the vendor ratio. It stays at a high tier, because ninety vendors agreeing is
real evidence, and it stops being ninety votes.

### 5. A source that cannot look must not say it looked

Two mechanisms, in the order decided.

**At the adapter, mandatory.** Any adapter whose provider can signal exhaustion,
a 429, a quota header, a known body string, must map that to `status:
"rate_limited"` and must not emit an assertion. Any adapter that *cannot*
distinguish exhaustion from a genuine miss must emit `tier: "no-record"` rather
than `tier: "none"`. The rule in one line: **an adapter may only say `none` when
it is certain it looked.** This is testable per adapter and is where most of the
value is.

**A cross-time baseline, as the net.** A per-source counter in Redis records,
per day, how many lookups the source answered and how many of those answers were
assertions rather than `no-record`. When today's rate falls below a quarter of
the trailing median of the previous seven days, *and* the source has been asked
at least twenty times today, it is marked `degraded` for everyone: excluded from
the score, counted as a gap by `confidence.ts`, and named on the page. The
twenty-lookup minimum is what keeps a quiet morning from reading as an outage;
the quarter is a starting value, recorded here so that moving it is a decision
rather than a tweak. This catches #37's exact shape, a provider that answers 200
with nothing, which no adapter-side rule can see.

The counters are two integers per source per day and expire after eight days.
Redis is optional in this app, so an absent cache means no baseline, which is
the same graceful degradation the cache and history already have.

### 6. Time gets a type

`lastSeen?: string` becomes `observedAt?: Instant`, where `Instant` is an ISO
8601 string in UTC, produced by one parser per upstream format at the adapter
boundary. The parsers live next to the adapters that need them and are unit
tested against the literal strings the providers actually return, which are
recorded in the tests rather than described.

### 7. What changes in `aggregate.ts`, and what does not

Most of `aggregate.ts` is right and stays. The weight-and-quorum floor gate, the
allowlist suppression with its vouch quorum, the corroboration gate that
withholds "malicious" from a lone loud source, the borderline band: all keep
their current shape and their comments, which argue their cases well.

Three things change.

**Scores arrive from `scale.ts`, not from adapters.** `aggregateRisk`'s inputs
become meaningful without its arithmetic changing.

**Corroboration counts origins.** `flagging` (`aggregate.ts:229`) counts
distinct evidence origins rather than rows.

**The floor is tied to the tier.** `computeFloor` currently keys on
`malicious === true` plus `FLOOR_MIN_WEIGHT`. It keys on the tier instead:

- `confirmed` may pin `MALICIOUS_FLOOR` alone
- `attributed` may pin it only with a quorum of two distinct origins
- `reported` may never pin a floor; reports are evidence, not confirmation

This is the decision "keep the floor, tie it to the tier". Feodo saying an
address is a C2 whose config it extracted still pins the verdict on its own. A
DNSBL saying "listed" no longer can.

`malicious?: boolean` is then derived (`tier` is `confirmed` or `attributed`)
rather than set, and is kept on `SourceResult` only for the cache and the wire
format until #61 rebuilds those.

### 8. The bands are frozen, and a test holds them there

`MALICIOUS_AT` 70, `SUSPICIOUS_AT` 40, `LOW_AT` 15 do not move. Changing the
scale and the boundaries at once would make it impossible to tell which of them
moved a verdict.

The way this is held honest is a checked-in calibration set: roughly twenty
indicators across all four types, each with its expected band and one line
saying why that band is right, with the source responses recorded as fixtures so
the test is offline and deterministic. A change to `scale.ts` that moves any
calibration indicator across a band fails the test. Moving one is then allowed,
but only by editing the expectation and its justification in the same commit,
which is the point: the argument gets written down.

This fixture is also the only defensible way to tune the tier-to-points table.
Tuning it by eye against whatever indicator is open is how the current numbers
happened.

### 9. History is wiped

The 30 stored snapshots per indicator carry scores on the old scale.
`reputationTrend` and `isNewlyFlagged` compare them, so on deploy day every
indicator would appear to move, and `isNewlyFlagged` would lie in bulk about
things that did not change.

The wipe is done by bumping the key prefix at `lib/ti/history.ts:4` from
`ti:hist:` to `ti:hist:v2:`. The old keys stop being read and age out on their
own, which is a wipe from the app's point of view without a destructive command
against a shared Redis.

The reputation card needs an empty state for the week after: `history was reset
when the scale changed`, not a card that looks broken.

### 10. What the page must say

The score changing meaning is only honest if the page says what it now means.

- A tooltip or a line on the verdict hero defining the number in one sentence
- Each source row shows its tier in words, not only a colour
- Aggregate sources are labelled as aggregates, with the note that they count
  once
- A degraded source is named as degraded, distinct from errored and from
  no-record
- The reputation card's reset empty state

## Sequencing

Too large for one merge, so it lands in three, each shippable on its own and
each leaving the app working.

**Stage 1, the model and the scale, emitted in parallel and read by nothing.**
`Assertion`, `IdentityClass`, `AssertionTier`, `Instant` and `scale.ts` are
added. A converted adapter emits its assertion *alongside* its existing `score`,
`malicious` and `categories`, all three unchanged, and `aggregateRisk` keeps
reading the legacy fields. Only the calibration test reads the new one, which is
how the mapping gets checked against eight adapters' worth of real behaviour
before anything depends on it. Convert Feodo, IPsum, AbuseIPDB, VirusTotal,
GreyNoise, Tor, a DNSBL and ET Open, chosen to cover every tier and both
lineages. Nothing on the page changes, and no verdict moves, because nothing
downstream is reading the new field yet.

The invariant this stage is held to is **band preservation, not digit
preservation**. `assertionScore()` will not reproduce every adapter's current
integer, and should not: AbuseIPDB passing its own 0-100 confidence straight
through to a possible 100 is one of the things this spec exists to stop. What
must not move is any calibration indicator's verdict band.

**Stage 2, the remaining adapters, and the old fields go away.** The other
forty-nine adapters convert. `score` and `malicious` are removed from the type
an adapter returns, which is the change that makes the rule enforceable rather
than agreed. Lineage, tier-keyed floors and origin-counted corroboration land
with it, because they cannot be correct until every adapter has a tier.

**Stage 3, degradation and the page.** The Redis baseline, the `degraded`
status, the history prefix bump with its empty state, and the wording changes
that tell the reader what the number now means.

The history wipe belongs in stage 3 and not earlier: the scale only finishes
moving at the end of stage 2, and wiping twice is worse than wiping late.

## Testing

- Per adapter: the assertion it emits for a recorded upstream payload, including
  its exhaustion path and its no-record path. This is the bulk of the work and
  the bulk of the value.
- `scale.ts`: every tier maps to a point value, and the table is total over the
  enum, so a new tier cannot be added without pricing it.
- Lineage: corroboration collapses for a known aggregate, and an aggregate alone
  cannot satisfy a quorum.
- The calibration set, as above.
- Time parsers, against literal provider strings.
- The baseline: a source whose answer rate collapses is marked degraded; one
  with no Redis is not.

`bun run test`, `bun run lint`, `bun run typecheck` all pass. New files under
`lib/` need coverage before a PR, per the Sonar new-code gate.

## Not in this spec

- #61, the four near-identical result shapes and the hand-spelled union. It will
  be tempting, because this work opens `types.ts`, and it is a separate argument.
- #57, per-type code splitting.
- #50, the 5 MB feeds in every function instance.
- #70, the region choice.
- Deriving `BodyKey` from the two axes.
- Any change to `confidence.ts`'s coverage and agreement maths, which is sound.

## Open questions for the plan

1. Exactly which adapters can detect exhaustion, and which must fall back to
   `no-record`. This needs a pass over all fifty-seven and is the first task of
   stage 2, not a guess made here.
2. The calibration set's membership. It should include at least one indicator
   per known failure mode: the zero-byte file digest named in `aggregate.ts`,
   an identified scanner, a compromised major site, and an IPv6 address.
3. Whether the tier of a `reported` source should scale with the report count.
   AbuseIPDB with 200 reports and AbuseIPDB with 2 are different, and
   `providerConfidence` may or may not be enough to express it without letting
   a report count climb into `attributed` through the back door.
