# IOC timeline: a phase strip over a dated ledger

Status: 2026-10-04. Design agreed in conversation, section by section, with
rendered mocks (`.superpowers/brainstorm/264163-1791118465/content/`).

Related: `2026-09-05-subject-record-rap-sheet-design.md` (the record this tile
sits above and takes the date rows from), `2026-09-13-bestiary-panel-design.md`
(the frame, the hatched-absence language, colour on threat only).

## Why

The sources already return a lot of dates (registered, first resolved, cert
issued, listed, first seen, last reported, expires), but the page scatters
them: two sit in the Subject record, the rest stay inside source details. No
card tells the indicator's life in order, and the shape of that life is
evidence in itself. A domain that sat unused for 19 months, went live, and was
listed within weeks reads very differently from one that has been resolving
quietly for a decade.

## Decisions from the conversation

- **Story: life story from outside sources.** Not our own verdict history, and
  not both on one axis. **No Ophanim data at all:** `ti:hist` checks are not
  events. Priors stays where it is, as a count in the panel corner.
- **Form: a vertical ledger for the detail, plus a mini horizontal phase strip
  for the shape.** The strip is the phase bar (option B), with phase names
  written on the bar.
- **Dates leave the Subject record.** `created`, `expires`, `first` and `last`
  are removed from `lib/ti/identity.ts`, so each date appears in one place. The
  record becomes "what it is", and the timeline becomes "when".
- **Earliest wins, the rest fold in.** One row per event kind, dated by the
  earliest source, showing `+N` and listing each folded source's date on hover.
- **Always render.** With zero events the tile shows
  `No source has dated this indicator`. An absence is a finding.
- **No netblock dates for IPs.** RDAP IP registration describes the block, not
  the address. It stays in the record as an attribute and is never a timeline
  event.
- **Dormant only from 2018-05.** Before CT enforcement made new certs visible
  almost at once, a gap between registration and first observation is
  unknowable. For older domains the stretch is drawn as a thin plain line
  labelled `before records`.
- **Defaults accepted:** the quiet-gap line appears at ≥ 6 months, and RDAP
  `Updated` is dropped as housekeeping noise.
- **v1 reads the check result only.** Research-stream dates (Wayback first and
  last capture, crt.sh `notBefore`) are a follow-up.

## Planning deltas

- **VT `creation_date` is not read by the domain adapter** (type only), so `registered` comes from RDAP alone.
- **ThreatFox records no first-seen** in any of its three adapters, so it can't open a listing. Task 1 adds `details.firstSeen` (and `hashContext.firstSeen` for hashes).
- **The passive result page has no section nav** (only the scan page uses `SectionNav`), so the tile gets `id="timeline"` and no nav entry.
- **`IdentityCard` on the active-scan page also renders `RecordTile`.** Dates leave the record only when `omitDates` is passed, which `/check` does, so the scan page keeps its dates.
- **Live starts at the earliest of `first-resolved`, `cert-issued`, `first-seen`, `listed`**, for every type. Dormant ends at the same point.

## Data: `lib/ti/timeline.ts`

A pure module, in the same style as `buildIdentity`. It makes no fetches and
reads the normalized contexts and source `details`.

```ts
type EventKind =
  | "registered" | "first-resolved" | "last-resolved" | "cert-issued"
  | "first-seen" | "last-seen" | "listed" | "last-reported"
  | "cert-expires" | "expires";

interface TimelineEvent {
  kind: EventKind;
  at: string;                                // ISO day, earliest across sources
  source: string;                            // the source that supplied `at`
  also: { source: string; at: string }[];    // folded-in sources
  detail?: string;                           // "via NameCheap", "tag emotet"
  tone: "neutral" | "adverse" | "future";
}

interface TimelineGap { after: EventKind; months: number }   // ≥ 6 months

type PhaseKind = "before-records" | "dormant" | "live" | "listed" | "quiet" | "paid-to" | "lapsed";
interface Phase { kind: PhaseKind; from: string; to: string; ongoing: boolean }

function buildTimeline(result: AnyCheckResult, now?: Date):
  { events: TimelineEvent[]; gaps: TimelineGap[]; phases: Phase[] };
```

`now` is injectable so the tests are deterministic.

### Event kinds per type

Each kind appears at most once. A kind with no date is left out.

| Kind | IP | Domain | Hash |
|---|---|---|---|
| Registered | | RDAP `createdAt` | |
| First / last resolved | passive DNS | passive DNS | |
| Cert issued | | CertSpotter `firstSeen`, VT cert | |
| First / last seen | Feodo, ThreatFox, DShield, GreyNoise, Tor | | VT, MalwareBazaar, ThreatFox, URLhaus, YARAify, Kaspersky, Pulsedive |
| Listed (first) | Feodo, ThreatFox, DShield | URLhaus `date_added`, ThreatFox | MalwareBazaar, ThreatFox, URLhaus |
| Last reported | AbuseIPDB `lastReportedAt`, ThreatFox | ThreatFox, URLhaus | |
| Cert expires | | CertSpotter / VT `notAfter` | |
| Expires | | RDAP `expiresAt` | |

The exact field per source is pinned during planning against each adapter's
`details`. The table is the contract for which kinds exist per type.

### Rules

- **Fold:** group candidates by kind. The earliest valid date wins and the
  rest go into `also`. For `last-*` kinds the latest wins.
- **Tone:** `adverse` for `listed` and `last-reported` when the supplying
  source's finding is `malicious`. `future` for any date after `now`.
  Otherwise `neutral`.
- **Validity:** drop unparseable dates, dates before 1990, and non-expiry
  dates more than a year after `now`.
- **Order:** chronological. Ties keep the kind order in the table above.
- **Gaps:** one `TimelineGap` between consecutive events at least 6 calendar
  months apart.

### Phases

A phase exists only when both of its edge events exist.

| Phase | Draw | Domain | IP | Hash |
|---|---|---|---|---|
| Before records | thin plain line | registered (< 2018-05) → first use | | |
| Dormant | hatched | registered (≥ 2018-05) → first use | | |
| Live | grey | first use → first listed, or → now | first seen → first listed, or → now | first seen → first listed, or → last seen |
| Listed | red | first listed → last reported | same | first listed → last seen |
| Quiet | outlined | last reported → now, if ≥ 90 days | same | last seen → now, if ≥ 90 days |
| Paid to | dashed | now → expires | | |
| Lapsed | dim end cap | expires < now, the bar ends there | | |

"First use" for a domain is the earlier of `first-resolved` and `cert-issued`.
Listed is red only when its opening event is `adverse`. Otherwise no listed
phase is drawn and Live runs on.

## UI: `components/CheckResults/timeline.tsx`

`TimelineTile`: span 12, `id="timeline"`, title `Timeline`, note
`N events · M sources`. It is a section of the panel's frame, placed directly
before `RecordTile` in all three result views.

- **PhaseStrip.** A linear axis from the first event to the later of now and
  the last future event, with year ticks below and a dashed `TODAY` line. Each
  phase is a 14px segment, drawn as in the table. A phase name sits on its
  segment only when it fits. Otherwise the segment is unlabelled and the name
  goes into `title`, so labels never overlap. Hovering a segment highlights the
  ledger rows at its edges.
- **Ledger.** Rows grouped under year headings. Columns: `MM-DD`, a dot on a
  vertical rule (filled for neutral, red for adverse, dashed for future), the
  event name plus detail, and the source with `+N` on the right. A gap line
  `· N months quiet ·` goes between rows. Future rows are dim.
- **Empty.** The tile with one quiet line and no strip.
- **Skin.** Monochrome, system fonts, mono for dates and sources, colour only
  on adverse rows and the listed phase (house direction).

## Loading

The tile renders only once the full result is in, like `RecordTile`. The fold
can reorder rows as late sources answer, so filling it during streaming would
make rows jump. `pending.tsx` gets a skeleton with the same height bands
(strip plus 4 ghost rows), so nothing shifts when the result lands.

## Subject record change

Remove `created` and `expires` (domain) and `first` and `last` (hash) from
`lib/ti/identity.ts`, then rebalance the two-column placement. IP netblock
allocation stays in the record.

## Testing

`lib/ti/timeline.test.ts`, pure, with an injected `now`:

- the fold: earliest wins for first-kinds, latest for last-kinds, `also` filled
- tone: adverse only from malicious findings, and future dates
- validity: pre-1990, unparseable and far-future dates dropped
- gaps at the 6-month boundary
- phases per type, including the 2018-05 dormant / before-records cutoff,
  quiet at 90 days, and lapsed
- the empty result
- one realistic fixture per type (malicious domain, listed IP, known hash)

Update the identity tests for the removed rows. UI is verified in a browser at
1280+ on a data-rich hash, a malicious domain and a clean old domain.

## Follow-up (not v1)

- Research-stream events: Wayback first and last capture ("first seen on the
  web", which fills the `before records` stretch) and crt.sh `notBefore`,
  inserted with a fade when the research stream lands.
