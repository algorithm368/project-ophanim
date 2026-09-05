# Subject record as a rap sheet: origin, priors, and why it was flagged

Status: design approved 2026-09-05, not yet implemented
Supersedes parts of: `2026-09-03-subject-record-design.md` (the `reportedFor`
row and its single-label ballot)

## The ask

Re-read the subject record as a **criminal record**. A rap sheet states who the
subject is, where they are from, and lists the charges with counts. It does not
pick one word to summarise a person.

Two rows change and one is added:

- `ORIGIN`, new, the country the geo providers voted for. IP only.
- `PRIORS`, replacing `REPORTED FOR`, charges with counts instead of one
  ballot-winning label.
- `RECORD`, the existing `SEEN` row, renamed to match the register.

## Why, from live data

Nine indicators were fetched through the running dev server (`/api/check`,
`/api/check-domain`, `/api/check-hash`) and the rendered card was read against
the raw `SourceResult[]`. Two of them render text that is actively misleading.

**`45.155.205.233`** renders a red `MALICIOUS / HIGH RISK` banner directly
above:

```
CLASS         Hosting / Datacenter
REPORTED FOR  Nothing on file
```

The card asserts a malicious verdict and, four lines later, that nothing is on
file. The actual reason (`scoreBreakdown.floorApplied: true`,
`flooredBy: "virustotal"`, 15 of 91 vendors) is real and present in the
response, but appears only in the source breakdown near the bottom of a
4,400px page.

**`185.220.101.42`** says "anonymizer" three times in the first five lines: the
hero narrative ("an anonymizer (proxy, VPN, or Tor)"), then `CLASS: Tor exit
node`, then `REPORTED FOR: Anonymizer`. Meanwhile AbuseIPDB's 148 reports
across 62 reporters, whose largest bucket is Web App Attack at 70, reach the
card as the tail of a sentence, `also described as web attack, brute force`,
with no numbers at all.

The mechanism behind the second one is a ballot. `threatTypeOf` counts distinct
backing sources per `ThreatType`. Both `virustotal` (`categories:
["suspicious-udp", "tor"]`) and `abuseipdb` (whose `categories` array mixes its
report taxonomy with `"tor"` and `"Fixed Line ISP"`) emit a `tor` category,
which `classifyCategory` maps to `anonymizer`. That is two backing sources.
`web attack` and `brute force` are backed by `abuseipdb` alone, so they lose,
2 to 1, despite representing 148 filed reports against a tag.

`IDENTIFIERS` in `threat-type.ts` already excludes identification *sources*
(`greynoise`, `scanner-id`, `tor-project`) from this axis. It cannot help here,
because the polluting `tor` category is emitted by two sources that are not
identifiers.

## The design decision

**A rap sheet lists charges with counts; it does not elect one.** Dropping the
single-winner label for the display of priors dissolves the ballot problem
rather than fixing it, because there is no election left to rig. The charges
come from `abuseipdb`'s `details.reportCategories`, which is a structured
`{ name, count }[]` of its own report taxonomy, and which never contained the
`tor` tag: that lives in the separate, polluted `categories` array.

This is display-layer only. `threatTypeOf` is not modified, and `verdict.tsx`
keeps calling it unfiltered for the headline. The deeper normalization of
per-source category strings into identity/behavior signals remains parked as
its own initiative; see "Not in this design".

## Rows

### ORIGIN, new, IP only

Reads `geoResolution.country` (`value`, `sources`, `alternatives`) plus
`geoResolution.countryCode`, falling back to `geo.country` / `geo.countryCode`
when a caller did not reconcile. The city is appended from
`geoResolution.city` when it resolved, because "Germany, Berlin" places a host
better than "Germany" and costs no extra row.

```
ORIGIN      Germany (DE), Berlin
```

Domains get no `ORIGIN` row. The domain pipeline fetches no geo at all: there
is no `geo`, no `geoResolution`, and no country field anywhere in
`DomainContext`, only `resolvedIps`. Deriving one would mean geolocating the
resolved IPs from inside the domain path, which is a new fetch and a new
source, out of scope here. The row simply does not render, the same way
`hostedOn` and `seen` already do not when nothing backs them. Hashes have no
origin by nature.

### PRIORS, replacing REPORTED FOR

Four rungs, first that answers wins.

1. **Counted charges.** `abuseipdb` `details.reportCategories`, sorted by
   count descending, top three named, the rest dropped rather than
   summarised. Counts render as `(n)`, parenthetical, after the charge, not
   inline with a symbol. The report total leads the sentence, not the
   provenance line:

   ```
   PRIORS      148 reports, led by web app attack (70), hacking (49),
               brute force (18)
               abuseipdb
   ```

   The total leading the label, rather than sitting in the provenance line as
   an earlier draft had it (`abuseipdb, 148 reports`), is not a style choice:
   `Row`'s `sources` prop is a list of source ids everywhere else in this file
   (`["cymru-mhr"]`, `["peeringdb"]`) and never carries a second, unrelated
   number. Keeping that contract means every provenance line in the card can
   be read the same way, source ids only.

   `148`, not the sum of the three shown categories, is also the tell that
   more exist: `70 + 49 + 18 = 137 < 148`, so "led by" rather than "for" is
   deliberate — these three are not claimed to be the whole 148, only the
   largest buckets in it. No `, and 8 more` clause: an earlier draft carried
   one (matching `linkLine` in `components/ScanReport/target.tsx`, prose
   joined into the sentence rather than the `+N more` toggle-button label
   `ExpandableList`/`primitives.tsx` use elsewhere, since nothing in this row
   expands), cut for length once the leading total already implied it.

   The total comes from `details.totalReports`, not from summing the
   per-category counts. The two do not match and are not meant to: one report
   can carry several categories, so this payload's counts sum to 173 across 148
   reports. Rendering the sum would overstate the record.

2. **Uncounted fallback.** The existing `threatTypeOf` result, rendered as it
   is today. This keeps every indicator that has a behaviour type but no
   AbuseIPDB answer working exactly as before.

3. **Flagged with no charges.** When the verdict is malicious or suspicious and
   neither rung above answered, name who flagged it, from
   `scoreBreakdown.flooredBy` if a floor was applied, else
   `scoreBreakdown.dominantSourceId`, with that source's own summary count. No
   preamble sentence stating that nothing was categorised: every other row on
   this card is a noun phrase, and a card that suddenly explains its own data
   model reads as an apology rather than a record.

   ```
   PRIORS      Flagged by VirusTotal (15 of 91 vendors)
               virustotal
   ```

   This is the row that fixes the `45.155.205.233` contradiction.

4. **No record.** When the verdict is clean or unknown, `No record` alone, or,
   when a voucher exists (`tranco` rank, `hashlookup` known-good), `No record,
   vouched by Tranco (rank 1)`. One line, no closing period, matching every
   other row's noun-phrase register; the memory constraint against
   dash-separated copy rules out an em-dash join here too.

### RECORD, renamed from SEEN

Unchanged data (`seenRange`), renamed to fit the register. No provenance line;
see the counting rule below.

## The counting rule

> A count renders only when it changes how the row reads. Agreement is the
> expected default, so it stays silent. Disagreement is news, so it speaks.

Applied:

- `ORIGIN` renders **no** provenance line when the country vote was unanimous.
  When providers disagreed, and only then, the dissent is named from
  `alternatives`: `2 sources say Netherlands`. A unanimous `7 of 7 sources
  agree` is noise, because unanimity is what a reader already assumes.
- `RECORD` drops the `5 of 27 sources flagged` line that an earlier draft of
  this design carried. The same tally is already the point of the source
  breakdown further down the page.
- `PRIORS` rung 1 leads with `148 reports`, not `148 reports from 62
  reporters`. The report count carries weight; the reporter count is a second
  number that does not change the reading.
- Two counts stay, because in both the number *is* the substance of the row:
  `Flagged by VirusTotal (15 of 91 vendors)` (a 15/91 minority reads very
  differently from 80/91, and this row exists precisely to explain a verdict a
  reader is questioning) and the existing hash `DETECTIONS 66 of 68 engines`.

## Type changes

`lib/ti/subject-record.ts`:

```ts
export type Origin = Claim & {
  countryCode?: string;
  city?: string;
  /** Dissenting country values, rendered only when non-empty. */
  dissent?: { value: string; sources: string[] }[];
};

export type SubjectRecord = {
  subject: string;
  qualifier?: string;
  class: Claim;
  origin?: Origin;                              // new, IP only
  hostedOn?: Claim;
  priors?: Claim & { also: string[] };          // replaces reportedFor
  detections?: { malicious: number; total: number };
  seen?: { first?: string; last?: string };
  sprite: SpriteSpec;
};
```

`reportedFor` is renamed to `priors`, keeping its shape rather than gaining a
structured `items` list: every rung, including rung 1, resolves to one
fully-formed `label` string (`"148 reports, led by web app attack (70), ..."`),
built in `lib/ti/subject-record.ts` exactly the way `class` and `hostedOn`
already are. `record.tsx` needs no new rendering branch for `priors`, only the
rename. `also` stays, because rung 2 (the unmodified `threatTypeOf` result) is
the one caller that still populates it with runner-up types; rungs 1, 3, and 4
leave it `[]`, and the component's existing `reported?.also.length ? ... : ""`
guard already renders nothing for an empty array, so that line of `record.tsx`
does not change.

## Worked results

`185.220.101.42`:

```
SUBJECT     185.220.101.42
CLASS       Tor exit node
            tor-project
ORIGIN      Germany (DE), Berlin
HOSTED ON   Non-Profit, Zwiebelfreunde
            peeringdb
PRIORS      148 reports, led by web app attack (70), hacking (49),
            brute force (18)
            abuseipdb
RECORD      2020-03-20 to 2026-09-05
```

`45.155.205.233`:

```
SUBJECT     45.155.205.233
CLASS       Hosting / Datacenter
            geo flags
ORIGIN      Russia (RU), Moscow
PRIORS      Flagged by VirusTotal (15 of 91 vendors)
            virustotal
RECORD      2020-01-15 to 2026-08-13
```

Note `ORIGIN` for `45.155.205.233` is silent about the vote despite the city
being contested (`region` confidence is low, `city` splits 3 to 1 between
Moscow and St Petersburg). The rule keys on the **country** vote, which was
unanimous at 7 of 7. City disagreement does not open the dissent line: the row
is an origin claim, and the country is the claim.

## Files

```
edit    lib/ti/subject-record.ts        Origin type, priorsOf(), originOf(),
                                        reportedFor renamed to priors
edit    lib/ti/subject-record.test.ts   cases below
edit    components/CheckResults/record.tsx   ORIGIN/PRIORS/RECORD rows
```

No adapter is touched, no cache key changes, `aggregate.ts` and
`threat-type.ts` are untouched. Everything is computed at render time from the
`SourceResult[]` already in the result, exactly as the 2026-09-03 design
established.

## Testing

Vitest, colocated, per the Sonar `new_coverage` 80% floor on changed lines.

- `originOf`: unanimous country renders no dissent; a split country populates
  `dissent` from `alternatives`; a result with `geo` but no `geoResolution`
  falls back to `geo.country`; a domain and a hash both yield `undefined`.
- `priorsOf` rung 1: AbuseIPDB's real `185.220.101.42` payload yields a label
  leading with `148 reports`, exactly three named categories, `web app attack
  (70)` first, and the string `anonymizer` appears nowhere in it; `sources` is
  `["abuseipdb"]` only, no count smuggled into that array.
- `priorsOf` rung 2: with `abuseipdb` absent, the `threatTypeOf` label renders
  as it does today.
- `priorsOf` rung 3: a malicious verdict with `floorApplied` and no categories
  names the flooring source, covering `45.155.205.233`, and the label carries
  no preamble sentence, just the noun phrase.
- `priorsOf` rung 4: a clean verdict with no voucher yields exactly `No
  record`; `google.com` yields `No record, vouched by Tranco (rank 1)`.
- The counting rule: no rendered row contains an `n of n` where the two numbers
  are equal.

## Not in this design

- **Signal normalization.** Mapping each source's raw category strings to
  `{ axis: "identity" | "behavior", type }` keyed by `(sourceId, rawCategory)`,
  so `threatTypeOf` stops mistaking a `tor` tag for a behaviour. Agreed in
  principle (render-time, `threat-type.ts` only, no adapter or cache change)
  and parked. This design routes around the bug for the priors row; it does not
  fix `threatTypeOf`, which still feeds `verdict.tsx`'s headline.
- **The VirusTotal IP adapter's missing threat label.** `lib/ti/sources/virustotal.ts`
  sets `categories: attr.tags ?? []` where the hash adapter derives a label
  from `popular_threat_classification`. Rung 3 above makes the flagging
  *visible*, but a real label would need the adapter to parse
  `last_analysis_results`, which is an adapter change and ships separately.
- **Country for domains.** Would need geolocation of `resolvedIps` inside the
  domain pipeline.
- **`ALIAS` / AKA row.** Reverse DNS is genuinely identifying and rap sheets
  carry aliases, but the `HOST CLASSIFICATION` group below the masthead already
  renders the PTR, and a card must not repeat another card.
- **NXDOMAIN vs parked.** `classifyDomainLabel` says `Inactive / parked` for
  both, though `DomainContext.nxdomain` is available and unused. Separate fix.
- **Tranco's `vouched` threshold.** `spamhaus.org` at rank 1025 misses the
  cutoff of 1000 and loses its identity label to `Behind Amazon Web Services`.
  `fromTranco` gates on a flag built for score-floor suppression, a different
  purpose. Separate fix.
