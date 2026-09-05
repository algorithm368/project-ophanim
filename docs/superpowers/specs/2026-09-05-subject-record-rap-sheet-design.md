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
   count descending, top three named, the rest summarised:

   ```
   PRIORS      Web app attack ×70, hacking ×49, brute force ×18, +8 more
               abuseipdb, 148 reports
   ```

   The report count comes from `details.totalReports`, not from summing the
   per-category counts. The two do not match and are not meant to: one report
   can carry several categories, so this payload's counts sum to 173 across 148
   reports. Rendering the sum would overstate the record.

2. **Uncounted fallback.** The existing `threatTypeOf` result, rendered as it
   is today. This keeps every indicator that has a behaviour type but no
   AbuseIPDB answer working exactly as before.

3. **Flagged with no charges.** When the verdict is malicious or suspicious and
   neither rung above answered, name who flagged it, from
   `scoreBreakdown.flooredBy` if a floor was applied, else
   `scoreBreakdown.dominantSourceId`, with that source's own summary count:

   ```
   PRIORS      No categorised reports. Flagged by VirusTotal, 15 of 91 vendors.
               virustotal
   ```

   This is the row that fixes the `45.155.205.233` contradiction.

4. **No record.** When the verdict is clean or unknown, `No record`, with the
   vouching source when one exists (`tranco` rank, `hashlookup` known-good).

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
- `PRIORS` rung 1 shows `abuseipdb, 148 reports`, not `148 reports from 62
  reporters`. The report count carries weight; the reporter count is a second
  number that does not change the reading.
- Two counts stay, because in both the number *is* the substance of the row:
  `Flagged by VirusTotal, 15 of 91 vendors` (a 15/91 minority reads very
  differently from 80/91, and this row exists precisely to explain a verdict a
  reader is questioning) and the existing hash `DETECTIONS 66 of 68 engines`.

## Type changes

`lib/ti/subject-record.ts`:

```ts
export type Prior = { label: string; count: number };

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
  priors?: Claim & { items?: Prior[]; more?: number };  // replaces reportedFor
  detections?: { malicious: number; total: number };
  seen?: { first?: string; last?: string };
  sprite: SpriteSpec;
};
```

`reportedFor` is removed. Rung 2 populates `priors` with a `label` and no
`items`, so the renderer has one shape to handle either way.

## Worked results

`185.220.101.42`:

```
SUBJECT     185.220.101.42
CLASS       Tor exit node
            tor-project
ORIGIN      Germany (DE), Berlin
HOSTED ON   Non-Profit, Zwiebelfreunde
            peeringdb
PRIORS      Web app attack ×70, hacking ×49, brute force ×18, +8 more
            abuseipdb, 148 reports
RECORD      2020-03-20 to 2026-09-05
```

`45.155.205.233`:

```
SUBJECT     45.155.205.233
CLASS       Hosting / Datacenter
            geo flags
ORIGIN      Russia (RU), Moscow
PRIORS      No categorised reports. Flagged by VirusTotal, 15 of 91 vendors.
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
edit    lib/ti/subject-record.ts        Origin + Prior types, priorsOf(),
                                        originOf(), reportedFor removed
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
- `priorsOf` rung 1: AbuseIPDB's real `185.220.101.42` payload yields
  `Web app attack ×70` first and `more: 8`, and the string `anonymizer` appears
  nowhere in the row.
- `priorsOf` rung 2: with `abuseipdb` absent, the `threatTypeOf` label renders
  as it does today.
- `priorsOf` rung 3: a malicious verdict with `floorApplied` and no categories
  names the flooring source, covering `45.155.205.233`.
- `priorsOf` rung 4: a clean verdict yields `No record`; `google.com` yields it
  with the Tranco voucher.
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
