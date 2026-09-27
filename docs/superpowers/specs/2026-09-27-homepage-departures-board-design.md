# The homepage as a departures board, with source health

Status: 2026-09-27. Designed in interview against rendered mockups, not yet
built. Branch `homepage-bestiary-cover`, which also carries the dark palette
lift (palette B) this design is drawn in. The mockup it was picked from is
`.superpowers/brainstorm/60620-1790515380/content/homepage-v2.html`, option D.

Related: `2026-06-10-monochrome-formal-redesign-design.md` (the skin: grey
throughout, colour only for verdict and status).

## The ask

The homepage (`/`) was two stacked cards: a lookup card and an "IDLE / awaiting
indicator" card explaining what each indicator type returns. All four
complaints raised about it hold:

1. It feels empty. The idle card is boilerplate.
2. It shows no live data.
3. It looks unfinished next to `/check`.
4. The hierarchy is weak; the search is not clearly the focal point.

## Decisions

Settled in interview:

1. **Layout is the "departures board"**: a split screen, a large headline and
   search on the left, a narrow dark rail listing every source on the right.
   Chosen in round 2 over a situation board, a command prompt and a dossier.
   Round 1's "bestiary cover" (reusing the `/check` frame) was rejected.
2. **The one live data set is source health.** Recent lookups, recently
   flagged and workspace stats were offered and declined.
3. **Health is measured passively**, from lookups the team is already running.
   No canary probes, on page load or on a cron: they would spend free-tier
   quota (VirusTotal, AbuseIPDB) for no user.
4. **Source health appears on the homepage at rest only.** Never on
   `/check/<ioc>`, never on `/scan` or `/scan/<indicator>`, and it leaves the
   homepage once a lookup result is on screen.
5. **`/` only.** `/check` and `/scan` are not edited (see Boundary).
6. The idle card and its IP / DOMAIN / HASH explainer list are deleted.

## Page layout

```
┌ banner (unchanged) ───────────────────────────────────────────────────────┐
├ left, fills remaining width ─────────────────────┬ right rail, 330 px ─────┤
│                                                  │ SOURCES      p50 · ok   │
│  Check an IP,                                    │ ● URLhaus     —    12%  │
│  domain, or file hash.                           │ ● OTX        4.1s  71%  │
│                                                  │ ● Triage     0.9s  80%  │
│  Every source is asked in parallel, then the     │ ● Shodan IDB 210ms 100% │
│  answers are folded into one verdict.            │ ...                     │
│                                                  │ ○ Hybrid An.  no key    │
│  [ ⌕ Paste an indicator .................. ↵ ]  │                         │
│  TRY  8.8.8.8  google.com  eicar test hash       │ (scrolls on its own)    │
│  detection hint                                  │                         │
└──────────────────────────────────────────────────┴─────────────────────────┘
```

- **Height.** The split fills the viewport below the banner
  (`min-h-[calc(100dvh-<banner>)]`), so the page never scrolls at rest; the
  rail scrolls inside itself.
- **Left.** Vertically centred, max width about 560 px. Headline "Check an IP,
  domain, or file hash." (the largest type on the page, sans, bold, tight
  tracking), a one-line subline in `text-muted-foreground`, then the existing
  search box, try chips and detection hint from `components/Checker`. This is
  the focal point.
- **Right rail.** A darker surface than the page (one step below
  `--background`, still chroma 0), a hairline left border, monospace
  throughout. Header row: `SOURCES` on the left, `p50 · ok` on the right.
  Then one row per registered source (all three registries, about 59), worst
  first. Row: grade marker, source name, type tag (`IP` / `DOM` / `HASH`) in
  `text-muted-foreground`, median latency, `ok` share. The last error message
  is the row's `title` (hover). No-key and no-data rows are dimmed and show
  `no key` / `no data` in place of the numbers. A footer line reads
  "last 50 runs per source, newest <relative time>".
- **Below `md`** the rail stacks under the search at its natural height.
  Desktop is the verified target.

Colour is used only for the grade (the status family the skin already allows):
green healthy, amber slow / degraded, red failing, hollow grey marker for no key
and no data. Grade is also carried by the marker shape and the text, never by
colour alone.

## Behaviour

- **Submitting a lookup.** `Checker` already stays on `/`, pushes
  `/check/<ioc>` into the URL and renders the result in place. That flow is
  unchanged. `Checker` gains one optional prop, `idle`, a node it renders in
  place of its search card and idle card while nothing has been looked up.
  Only `app/page.tsx` passes it (the split screen). Once a lookup starts,
  `Checker` renders exactly what it renders today, and the rail is gone.
- **Loading.** The left side renders immediately. The rail's rows sit inside a
  `Suspense` boundary whose fallback is the rail at full size with `sweep`
  rows, so a slow Redis never delays the search and nothing shifts when health
  arrives.
- **Without Redis.** The rail shows its header and a single line, "Health
  tracking needs the Redis cache." The page otherwise works.

## Data: recording health

- **Where.** `lib/ti/route-handler.ts` already writes the cache and history
  together, only after a fresh run. `recordHealth(type, results)` joins that
  `Promise.all`. Cache hits record nothing: a cached answer did not contact any
  source.
- **What.** One Redis pipeline per fresh lookup. For each `SourceResult`,
  `LPUSH ti:health:<type>:<sourceId>` a compact JSON entry
  `{ s: status, ms: durationMs, t: epochMs, e?: error }` (error truncated to
  200 chars), then `LTRIM 0 49`. About 30 commands per lookup.
- **Failure.** Like `cache.ts` and `history.ts`: a no-op when Redis is not
  configured, and a Redis error is swallowed and logged, never failing the
  lookup.

## Data: reading and grading

- **Read.** `app/page.tsx` becomes an async server component. Inside the
  Suspense boundary a server component calls `getSourceHealth()`, which reads
  every registered source's list (IP, domain and hash registries) in one
  pipeline: about 59 `LRANGE`s per homepage view. Well within Upstash's free
  500K commands a month at team scale.
- **Grade.** A pure function in `lib/ti/health.ts`, over one source's entries
  plus its `SourceMeta` and `isEnabled()`. Rules are checked top to bottom
  and the first match wins:

  | Grade | Rule |
  |---|---|
  | `no-key` | `isEnabled()` is false (key-gated, env var unset) |
  | `no-data` | fewer than 5 counted runs |
  | `failing` | `ok` share < 50% |
  | `degraded` | `ok` share 50 to < 90% (rate limits count as not `ok`) |
  | `slow` | `ok` share ≥ 90% and median `ok` latency > half the source's timeout (`meta.timeoutMs ?? PER_SOURCE_TIMEOUT_MS`, which `orchestrate.ts` exports for this) |
  | `healthy` | otherwise |

  `skipped` runs are not counted at all (the source declined the input, e.g. a
  SHA-1 on a SHA-256-only source). Sort order: failing, degraded, slow,
  healthy, no-data, no-key; within a grade, lower `ok` share first, then name.

## Boundary: `/` only

This change is the homepage and nothing else. `/check/<ioc>`, `/scan` and
`/scan/<indicator>` must render and behave exactly as before.

- `app/check/**`, `app/scan/**`, `components/CheckResults/**`,
  `components/ScanReport/**` and `components/ScanSearch.tsx` are not edited.
  The homepage imports nothing from them.
- `components/Checker/index.tsx` is edited only to add the optional `idle`
  prop. `/check/<ioc>` does not pass it, so its render path is untouched.
- `lib/ti/route-handler.ts` gains the `recordHealth` write. That is backend
  plumbing every lookup passes through (the homepage cannot measure health
  otherwise); it changes no response and nothing either page renders.

## Out of scope

Any change to `/check` or `/scan`; recent lookups, flagged lists and stats; probing sources actively; a dedicated
`/sources` page.

## Testing

- `lib/ti/health.test.ts`: every grade's boundary (exactly 50%, exactly 90%,
  exactly half the timeout, exactly 5 runs), `skipped` excluded, `rate_limited`
  counted as not `ok`, per-source timeout override, sort order.
- `recordHealth` with a stubbed Redis, as `history.test.ts` does: key shape,
  entry fields, error truncation, trim to 50, no-op without Redis, swallowed
  Redis error.
- `lib/ti/route-handler.test.ts`: a fresh run records health for every source;
  a cache hit records none.
- These cover the new `lib/` lines for Sonar's 80% new-coverage gate.
- UI, at 1280 px in light and dark: homepage at rest, homepage with the rail
  held pending, homepage after submitting a lookup (health gone).
- `/check/8.8.8.8` and `/scan` shot before and after the change and compared:
  they must be pixel-identical, apart from live data.
- `scripts/verify-loading.mjs` against a production build: zero layout shift
  on the homepage when health resolves.
- `bun run typecheck`, `bun run lint`, `bun run test` all pass.
