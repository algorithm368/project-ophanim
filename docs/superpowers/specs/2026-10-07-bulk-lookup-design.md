# Bulk lookup: tiered escalation under a shared quota budget

Status: 2026-10-07, revision 2. Design agreed in conversation, question by
question, with cost and accuracy as the two axes. Revision 2 follows two real
input files the user supplied (`IPSVI.txt`, `DNSIOCSVI.txt`), which broke the
first revision's assumption that runs are small. Not yet built.

## Why

An analyst often holds more than one indicator: an alert with a dozen IPs, a
report appendix of domains, a feed export with hundreds of thousands of rows.
Today each one is a separate `/check` visit. Bulk lookup takes a pasted list
(or, from the CLI, a file) and returns one row per indicator with a score, a
verdict, and **how deep it was checked**.

Running the existing pipeline N times does not work, because one lookup is not
one call. An IP fans out to 27 sources and a domain to 19. Vercel compute is
not what limits us. The free-tier quotas are, and they also happen to be on
the highest-weighted sources:

| Key env | Sources | Weight | Free quota (approx.) |
|---|---|---|---|
| `VIRUSTOTAL_API_KEY` | VT ip, VT domain, VT hash, VT sandbox | 1.0 | 4/min, 500/day, **one pool for all four** |
| `ABUSEIPDB_API_KEY` | AbuseIPDB | 1.0 | 1,000/day |
| `GREYNOISE_API_KEY` | GreyNoise Community | 0.8 | tight daily cap (already 429s, #37) |
| `OTX_API_KEY` | OTX | 0.85 | generous, but metered |
| `GOOGLE_SAFE_BROWSING_API_KEY` | Safe Browsing | 1.0 | 10,000/day |

A naive bulk run uses up VirusTotal's minute budget on the second indicator.
Every row after that comes back `rate_limited`, and because `aggregateRisk`
only counts sources that returned `ok`, those rows score from a thinner panel
without saying so. That makes the cost problem an accuracy problem as well.

### What the real input looks like

Measured on 2026-10-07:

- **IPSVI.txt:** 846,232 CRLF lines, **423,260 unique**: 419,555 IPv4, 3,704
  IPv6, 1 CIDR (`216.126.237.0/24`), 11 non-routable, and 9 written with
  leading zeros (`15.03.05.16`). Against four public feeds: ipsum 15,371 (6,554
  at level 3 or above), Spamhaus DROP 5,081, ET Open 27, Feodo 3. **19,888
  (4.74%) hit any feed, and 11,444 hit strongly.**
- **DNSIOCSVI.txt:** 134 lines, 114 unique after case folding. It contains
  case variants (`Gvaq70s7he.ru`), trailing spaces, a Thai IDN (`หีหอม.com`,
  which `parseDomain` rejects today), **13 internal Active Directory hostnames**
  (`*.dc01.fujixerox.net`), plain infrastructure (`accounts.google.com`,
  `cdn.bootcdn.net`) and typosquats (`fyAA.mlcrosoft.win`,
  `raw.githubsercontent.com`).
- `detectIOC("216.126.237.0/24")` returns `url`, and `parseIP("15.03.05.16")`
  silently returns `15.3.5.16`.

At free-tier rates, giving VirusTotal all 419k IPs would take about 840 days,
and giving them to AbuseIPDB about 420 days. Full depth for every row is not on
the table. The design instead makes depth explicit per row.

## Decisions from the conversation

1. **Shape: mostly small pastes, plus occasional very large files. IP and
   domain only.** Revision 1 assumed "survive the occasional big one". The real
   file is 423k rows, so large runs get their own mode (decision 8).
2. **Tiered escalation.** Pass 1 runs every row on the unmetered sources. Pass 2
   spends metered quota only where it can change the answer. A row that never
   got pass 2 is labelled `partial`, never shown as plain `clean`.
3. **Quota is shared with `/check`, with a reservation and a confirmation.**
   When bulk uses the same key as `/check`, bulk may spend only its share (60%)
   of each daily quota. Small runs escalate on their own inside that share. A
   run whose pass 2 would cost more than a threshold of metered calls shows the
   cost and asks first.
4. **Cache: read the shared one, write only our own, and a 24h freshness limit
   on bad verdicts.** Bulk reuses a cached `/check` result for free, since a
   `/check` result is always complete. Bulk **never writes** to the shared
   cache: a bulk row lacks the weight-0 context sources (geo, passive DNS,
   RDAP) that `/check` renders. Bulk keeps its own row cache. A `suspicious` or
   `malicious` verdict counts as stale after 24h in both caches, since listings
   expire.
5. **Escalation order B, then C, then A. D is skipped.** See *Buckets*.
6. **Same repo, two runners, one engine.** A `/bulk` page for runs up to 1,000
   rows, driven by the browser. A `bun scripts/bulk.ts` CLI for anything,
   including large runs. Both call one engine in `lib/ti/bulk/`. A separate
   app was rejected: it would share the quota ledger, the cache and its
   `SCHEMA_VERSION` anyway, and would need a copy of the adapters.
7. **The run record is the source of truth, not React state.** Reloading the
   page resumes. Web runs keep the record in Redis. CLI runs keep it in a
   directory on disk (decision 12).
8. **Large runs (more than 1,000 rows) start with pass 0, CLI only.** Pass 0
   checks every IP against the downloaded feeds, in memory, at no quota cost.
   Only IPs with a **strong** feed hit go on to pass 1. Every other IP ends at
   depth `feed`, with the verdict column reading `Not in feeds, unchecked`, or
   `Weak listing, unchecked` when it hit only weakly. `--include-weak` sends the
   weak hits on as well.
9. **API keys per lane.** Each keyed source looks up `<KEY_ENV>_<LANE>` first
   (for example `VIRUSTOTAL_API_KEY_BULK`), then `<KEY_ENV>`. Quota counters
   are per key, so a bulk-only key has its own pool at 100%, and `/check`'s key
   is untouched. **When the bulk key's quota is spent, bulk stops.** It never
   borrows the shared key. Remaining rows are `partial` with
   `bulk key quota reached`, and `--resume` continues the next day.
10. **Internal names are never sent out, in bulk.** Names under a configured
    suffix (`TI_INTERNAL_SUFFIXES`), single-label names, and internal-use TLDs
    become state `internal`, with the note `Internal name, not sent to any
    source`. This applies to bulk only. `/check` and `/scan` keep their current
    behaviour (see *Out of scope*).
11. **Leading zeros are read as decimal, with a note.** `15.03.05.16` becomes
    `15.3.5.16`, noted `Read as 15.3.5.16, written with leading zeros`.
12. **CLI runs live on disk, not in Redis.** The directory is
    `~/.ophanim/bulk/<runId>/`, outside the repo so customer IOCs can never be
    committed. `--out-dir` overrides it. The user had no preference, so this is
    the default and can be changed later.

13. **Tranco from a local list, and popular parents vouch for bucketing only.**
    Added after a five-indicator spike on 2026-10-07. Tranco's per-domain API
    returned `429` on the second query, and `accounts.google.com` got no vouch
    even on the first, because Tranco ranks registrable domains only. Both
    sent rows that should be D into C, where they spend VirusTotal quota. See
    *Tranco in bulk*.

## Depth

Every row says how far it was checked. This is the honesty mechanism: a row is
never quieter than the evidence behind it.

| Depth | Meaning | Verdict shown |
|---|---|---|
| `none` | Not looked up: internal, invalid | the reason |
| `feed` | Pass 0 only (large runs) | `Not in feeds, unchecked` or `Weak listing, unchecked` |
| `free` | Pass 1 done, pass 2 not needed (bucket D), not yet run, or partly run | the verdict, plus `partial` if pass 2 was wanted |
| `full` | Pass 2 done with every wanted metered source answering, or a fresh `/check` result | the verdict |

## Buckets

After pass 1, each row falls into exactly one bucket. The classifier is a pure
function of the `SourceResult[]` and `aggregateRisk`'s output.

| Bucket | Rule | Pass 2? |
|---|---|---|
| **A** hard-listed | `breakdown.floorApplied` | Last, only from leftover budget |
| **B** suspicious or mixed | not clean or unknown, or `borderline`, or `uncorroborated` | **First** |
| **C** quiet | `clean` or `unknown` and settled, no vouch | **Second**, because free blocklists miss fresh brute force and scanning |
| **D** vouched | an `ok` result with `allowlisted: true`, or a Tranco parent vouch, and no malicious listing | Never |

Per-row metered order:

- **ip, bucket C:** AbuseIPDB, GreyNoise, OTX, then VirusTotal.
- **ip, buckets A and B:** VirusTotal, AbuseIPDB, GreyNoise, OTX.
- **domain:** Safe Browsing, then VirusTotal.

## Source profiles

**Pass 0** (IP only, large runs): `feodo`, `et-open`, `ipsum`, `spamhaus-drop`.
Each adapter already downloads its whole feed once and answers per IP from
memory. A hit is **strong** when any of them returns `ok` with
`malicious: true` or `score >= 30` (ipsum scores 10 per list, so this is level
3 or above). `scanner-id` cannot be in pass 0, because it does a reverse DNS
query per IP. So large runs have no bucket D until pass 1. Pass 0 keeps only a
compact summary per IP (score, verdict, listed-by ids). Escalated rows rerun
the feeds in pass 1, where they are free in-memory lookups.

**Pass 1:** the bulk profile minus metered sources. A source is excluded from
bulk only when it cannot change `aggregateRisk`: `weight === 0` and never sets
`allowlisted`. The vouching sources are `scanner-id`, `tranco`, `abuseipdb`
and `greynoise`. A test enforces the rule against the live registries and the
adapter source text.

**Pass 2:** the metered sources (`virustotal`, `abuseipdb`, `greynoise`,
`otx`, `safebrowsing`).

**Accuracy invariant:** `aggregateRisk(bulk profile results)` equals
`aggregateRisk(full registry results)` for the same upstream answers. A
fixture test pins this per bucket.

## Tranco in bulk

`lib/ti/domain/tranco-list.ts` downloads the top 1,000 once a day: one
request to `https://tranco-list.eu/api/lists/date/latest` for the list id, and
one to `https://tranco-list.eu/download/<id>/1000`, which returns plain
`rank,domain` CSV. Both were probed on 2026-10-07 (list `26Y29`). It is cached
at module level like the other feeds. 1,000 is `VOUCH_RANK`, so this is
exactly the set that can vouch.

In the `bulk` lane the Tranco adapter makes **no per-domain API call**:

1. **Exact match** in the top 1,000 sets `allowlisted: true`, which is the same
   answer `/check` gets from the API, so the accuracy invariant still holds.
2. **Parent match:** the domain's registrable parent, computed with `tldts`
   `getDomain(host, { allowPrivateDomains: true })`, is in the top 1,000 and is
   not shared hosting. This sets `details.parentVouch = { parent, rank }` and
   **not** `allowlisted`. `classify` treats a parent vouch as bucket D only
   when nothing lists the row. It never reaches `aggregateRisk`, so it cannot
   suppress a floor, and bulk scores stay equal to `/check` scores.
3. Otherwise `ok` with no rank. Ranks between 1,000 and 1M are weight-0
   context, so losing them in bulk costs nothing in score.

The `check` lane keeps calling the API as today.

**Shared hosting is never a parent.** The Public Suffix List's private section
already makes `x.pages.dev`, `x.workers.dev`, `x.vercel.app`,
`x.azurewebsites.net`, `d1.cloudfront.net`, `x.s3.amazonaws.com` and
`storage.googleapis.com` their own registrable domains (checked with `tldts`
on 2026-10-07). It misses two popular ones that the user's file contains:
`b-cdn.net` (Tranco 103, `adsninjacdn.b-cdn.net`) and `tencent-cloud.net`
(Tranco 445, `ins-9hkazpwd.ias.tencent-cloud.net`). A hand-kept list in
`tranco-list.ts` adds those, extendable with `TI_SHARED_HOSTING_SUFFIXES`.
`tldts` is a new dependency. The repo already carries `tldts-icann`
transitively, but that is the ICANN section only, without the private
suffixes this rule needs.

A known limit: a parent vouch means `sites.google.com` and `docs.google.com`
skip pass 2. At domain granularity that costs nothing, because VirusTotal
does not list Google's own hostnames either. The abuse lives in the URL path,
and URLs are out of scope for bulk.

## API keys per lane

`lib/ti/keys.ts`:

- `type Lane = "check" | "bulk" | "scan"`. `withLane(lane, fn)` sets the lane
  in an `AsyncLocalStorage`, like `request-memo`. With no lane set, the lane
  is `check`, so `/check` needs no change.
- `apiKey(keyEnv)` returns `process.env[`${keyEnv}_${LANE}`]` if set, otherwise
  `process.env[keyEnv]`.
- `keyFingerprint(key)` is the first 8 hex characters of its sha256. The key
  itself is never stored or logged.
- The six adapters bulk uses with metered keys read their key through
  `apiKey()`, in `check()` and in `isEnabled()`: `sources/virustotal.ts`,
  `sources/abuseipdb.ts`, `sources/greynoise.ts`, `sources/otx.ts`,
  `domain/sources/virustotal.ts`, `domain/sources/safebrowsing.ts`. Other
  adapters keep reading `process.env` directly. In the `check` lane the two
  are identical, so there is nothing to gain from touching them.

New env names go in `.env.example` with no value: `VIRUSTOTAL_API_KEY_BULK`,
`ABUSEIPDB_API_KEY_BULK`, `GREYNOISE_API_KEY_BULK`, `OTX_API_KEY_BULK`,
`GOOGLE_SAFE_BROWSING_API_KEY_BULK`. Before adding a second account, check the
provider's terms. A teammate's own account, or an organisation account, is
the safe route.

## Quota ledger

`lib/ti/bulk/quota.ts`. **Pools are per key**, identified by
`<keyEnv>:<fingerprint>`, because one VirusTotal key serves four sources.

- `ti:quota:v1:<pool>:day:<YYYY-MM-DD UTC>`: all calls on this key today. TTL 48h.
- `ti:quota:v1:<pool>:bulk:<YYYY-MM-DD UTC>`: bulk's calls on this key today. TTL 48h.
- `ti:quota:v1:<pool>:min:<epochMinute>`: VirusTotal only. TTL 120s.
- `ti:quota:v1:<pool>:exhausted:<YYYY-MM-DD UTC>`: set on a provider quota hit. TTL 48h.

Bulk's allowance on a pool:

- **Own key** (`<keyEnv>_BULK` set): share 1.0 of that key's daily limit.
- **Shared key:** share `TI_BULK_SHARE` (default 0.6). It is also capped by
  what the day has left after `/check`'s spend.

`reserveBulk(keyEnv)` returns `ok`, `minute` (wait for the next minute),
`spent`, `nokey`, or `unavailable` (no Redis, or Redis failed). `/check` takes
part through a fire-and-forget `recordSpend(results)` after the IP, domain
**and hash** fan-outs. It counts every result whose source has a metered
`keyEnv` and actually made a request, and it never gates `/check`.

A quota hit is `status === "rate_limited"`, or an `error` whose message
matches `/\b429\b|quota|rate.?limit|limit exceeded/i`. It marks that pool
exhausted for the rest of the UTC day, because the provider's count wins over
ours.

Default daily limits, each overridable by `TI_QUOTA_<KEYENV>_DAILY`:
VirusTotal 500 (and 4/min), AbuseIPDB 1000, GreyNoise 50, OTX 5000, Safe
Browsing 10000.

## Input parsing

`lib/ti/bulk/parse.ts`. Tokens are split on whitespace, commas and
semicolons, so CRLF and trailing spaces disappear. Each token goes through
these steps, in order:

1. `refangIOC`.
2. **CIDR** (`/^[0-9a-f:.]+\/\d{1,3}$/i`) is reported invalid as `CIDR range,
   not expanded`. Revision 2 first proposed a feed-overlap answer for CIDRs.
   That was dropped as not worth its code for 1 row in 423k.
3. Non-ASCII goes through `domainToASCII` (punycode). The original is kept as
   `display`.
4. `detectIOC`. `hash` and `url` are invalid, noted `Not supported in bulk,
   <kind>`.
5. **ip:** `parseIP`. Non-routable addresses are invalid with the route's
   reason. If the written form differs from the canonical one by leading
   zeros, the item gets the decision 11 note.
6. **domain:** `parseDomain`, then lowercase. Special-use names are invalid. A
   name that `isInternalName` matches becomes state `internal`.
7. Dedupe on `kind:canonical`, counting duplicates.

`lib/ti/bulk/internal.ts`: `isInternalName(domain)` is true for a suffix match
on a label boundary against `TI_INTERNAL_SUFFIXES` (comma-separated,
case-insensitive), for single-label names, and for the TLDs `internal`,
`corp`, `lan`, `intranet` and `home.arpa`. The suffix should be as narrow as
the internal zone (`dc01.fujixerox.net`, not `fujixerox.net`, which is a real
public domain).

Invalid input is summarised by reason (`11 non-routable`, `1 CIDR range`;
leading zeros are a note, not an invalid). The page shows the first 50. The
CLI writes all of them to `invalid.csv`.

## Run lifecycle

```
input ─► parse ─► create run
      ─► [large runs only] pass 0 on IPs ─► strong? ─no─► depth feed (final)
      ─► pass 1 (cache-first, chunks of 25, or --concurrency on the CLI)
      ─► classify A/B/C/D
      ─► estimate metered calls per pool, against what bulk may spend
      ─► confirm if the estimate is above TI_BULK_CONFIRM_AT (default 50)
      ─► pass 2: B, then C, then A, paced, stops at the pool's allowance
      ─► done: CSV and JSON export
```

## Storage

- **Web runs (1,000 rows or fewer):** the run record in Redis
  `ti:bulk:v1:run:<id>` (7d) holds **row summaries only**: indicator, display,
  kind, state, bucket, verdict, score, pending, missing, listed-by, note. That
  is about 200 bytes a row. Each row's `SourceResult[]` lives in the bulk row
  cache `ti:bulk:v1:row:<kind>:<indicator>`, which pass 2 reads back. The cache
  is written on every pass 2 step, including a minute-cap pause. If the entry
  has expired, the row reruns pass 1.
- **CLI runs, any size:** the run lives in a directory, never in a Redis run
  record. Revision 1 let the web and the CLI resume each other's runs. That was
  dropped, because it made the CLI keep two storage paths for no case the user
  named. Pass 0 (runs over 1,000 rows) touches no Redis. Redis is used only for
  escalated rows (shared-cache read, bulk row cache) and for the quota ledger.
  That keeps a 419k-IP run to tens of thousands of Redis commands rather than
  about a million. The directory holds:
  - `state.json`: phase, options (`--include-weak`, `--concurrency`), confirmation, invalid list, counts.
  - `input.jsonl`: the parsed items, numbered.
  - `rows.jsonl`: append-only, one line per settled row. The last line for an id wins.
  - `results.csv` (every row, with a `depth` column), `hits.csv` (rows with any
    listing or a non-clean verdict), `invalid.csv`, `summary.txt`.
  - Resume with `--resume <runId>` (looked up under `~/.ophanim/bulk/`) or `--resume <dir>`.

## Wire surface (web, small runs)

- `POST /api/bulk` with `{ input }` returns `{ runId, rows, invalid, duplicates, internal }`.
  It answers 413 above 1,000 rows with the CLI command, and 503 without Redis.
- `POST /api/bulk/<runId>/pass1` with `{ rowIds }` (at most 25) streams NDJSON `row` events.
- `GET /api/bulk/<runId>` returns the record, the estimate per pool, and the quota left per pool.
- `POST /api/bulk/<runId>/pass2` with `{ rowIds, confirmed }` (at most 4)
  streams `row` and `wait` events. It answers 409 with the estimate when
  confirmation is needed.
- `GET /api/bulk/<runId>/export?format=csv|json`.

Every event carries `v: 1`. All routes check the session, and runs are visible
only to their owner (session email). Pass 1 and pass 2 run inside
`withLane("bulk", ...)`.

## The page

`/bulk` is a passive reading, so `modeRouteFor` treats it as the passive
landing page. It is linked as `Bulk lookup` under the box on `/`. House style
applies: monochrome, colour only on verdict, commas rather than dashes.

- A textarea and a parse line:
  `48 indicators, 31 IP, 17 domain, 3 duplicates, 2 internal, 2 not supported`.
- A results table: indicator (punycode with the Unicode `display` beneath),
  kind, verdict, score, depth, note, and a link to `/check/<ioc>` (not for
  `internal` rows).
- The confirm bar, per pool:
  `Enrichment needs 38 VirusTotal (bulk key) and 12 AbuseIPDB (shared) lookups. Bulk has 412 and 480 left today.`
- A quota strip per pool, used today and bulk allowance left.
- Sort by verdict, filter by depth, export CSV or JSON.

## Out of scope for v1

- Hash and URL bulk. CIDR expansion or overlap.
- **Internal-name protection on `/check` and `/scan`.** By the user's choice,
  those two still send whatever is typed into them. `/scan` is the more
  exposed of the two, because it makes urlscan visit the name. Revisit if an
  internal name is ever pasted there.
- A durable server-side runner. Large runs use the CLI.
- Borrowing the shared key when a bulk key is spent.
- A UI for editing `TI_INTERNAL_SUFFIXES`.

## Testing

All under `lib/ti/bulk/*.test.ts` and `lib/ti/keys.test.ts`. No network, and
`lib/` stays at 100%:

- `profile`: exclusion rule against the registries and adapter text; pass 0 ids.
- `classify` and `invariant`: buckets (including parent vouch), and bulk score equals `/check` score.
- `tranco-list`: CSV parse, exact and parent match, private suffixes, the shared-hosting list, the bulk-lane adapter path making no API call.
- `keys`: lane resolution, fallback, fingerprint, default lane.
- `quota`: per-pool keys, own key at 100% versus shared at 60%, minute cap,
  exhaustion, `nokey`, no Redis, `recordSpend` for a hash VirusTotal result.
- `parse` and `internal`: every row of the *What the real input looks like*
  list, as fixtures.
- `pass0`: strong, weak, none, and the IPv6 path.
- `row-cache`, `engine`, `run-store`, `export`, `api`.
- The CLI is checked by running it on a slice of `IPSVI.txt` (Task 14).
