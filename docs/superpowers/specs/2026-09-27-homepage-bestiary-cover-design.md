# The homepage as a bestiary cover, with source health

Status: 2026-09-27. Designed in interview against a rendered wireframe, not yet
built. Branch `homepage-bestiary-cover`, which also carries the dark palette
lift (palette B) this design is drawn in.

Related: `2026-09-13-bestiary-panel-design.md` (the `/check` frame this page
borrows), `2026-06-10-monochrome-formal-redesign-design.md` (the skin: grey
throughout, colour only for verdict and status).

## The ask

The homepage (`/`) was two stacked cards: a lookup card and an "IDLE / awaiting
indicator" card explaining what each indicator type returns. All four
complaints raised about it hold:

1. It feels empty. The idle card is boilerplate.
2. It shows no live data.
3. It does not look like `/check`, which is now a bestiary entry.
4. The hierarchy is weak; the search is not clearly the focal point.

## Decisions

Settled in interview:

1. **Layout is the "bestiary cover"** (chosen over a console board and a
   focused centred search). The homepage at rest is the same `Frame` / `Tile`
   grid as `/check`, so it is the same object, not a lookalike.
2. **The one live data set is source health.** Recent lookups, recently
   flagged and workspace stats were offered and declined.
3. **Health is measured passively**, from lookups the team is already running.
   No canary probes, on page load or on a cron: they would spend free-tier
   quota (VirusTotal, AbuseIPDB) for no user.
4. **Source health appears on the homepage at rest only.** Never on
   `/check/<ioc>`, never on `/scan` or `/scan/<indicator>`, and it leaves the
   homepage once a lookup result is on screen.
5. The idle card and its IP / DOMAIN / HASH explainer list are deleted. The
   detection hint and the "try" chips cover the same ground.

## Page layout

```
┌ rail 3 ──────┬ hero 6 ─────────────────────────┬ rail 3 ─────────┐
│  [unknown    │ AWAITING INDICATOR               │ SOURCES         │
│   sprite,    │ Check an IP, domain, or file hash│ 37 / 40         │
│   grey]      │ [ search box ................ ⌕] │ answering       │
│ UNIDENTIFIED │ detect hint · TRY 8.8.8.8 ...    │ normally        │
│              │                                  │ ● 2 slow        │
│              │                                  │ ● 1 failing     │
│              │                                  │ ○ 3 no key      │
├ 12 ──────────┴──────────────────────────────────┴─────────────────┤
│ SOURCE HEALTH           last 50 runs per source · newest 3 min ago│
│ AlienVault OTX  IP   ▓▓▓▓▓░░  71%  4.1s  │ URLhaus  DOM ▓░░ 12% err│
│ ... two columns, worst first ...                                  │
└───────────────────────────────────────────────────────────────────┘
```

- **Left rail (span 3, `tone="rail"`)**: the existing `unknown` sprite spec
  from `lib/ti/sprite.ts`, in `text-muted-foreground` (no verdict, so no
  colour), captioned `UNIDENTIFIED`. Same box and centring as `RailTile`, so
  the sprite sits where the result's sprite will.
- **Hero (span 6)**: eyebrow `AWAITING INDICATOR`, heading "Check an IP,
  domain, or file hash", the existing search box, detection hint and try chips.
  This is the focal point: the largest type on the page and the only input.
- **Right rail (span 3, `tone="rail"`, title `SOURCES`)**: the health summary.
  Headline `healthy / total`, the line "answering normally", then one line per
  non-healthy grade that has a nonzero count.
- **Health tile (span 12, title `SOURCE HEALTH`)**: one row per source in two
  columns, worst first. Row: source name, type tag (`IP` / `DOM` / `HASH`), a
  bar of the `ok` share, the percentage, the median latency, and the last error
  message as the row's `title` (hover). The header's right side reads
  "last 50 runs per source · newest <relative time>".

Colour is used only for the grade (the status family the skin already allows):
green healthy, amber slow / degraded, red failing, hollow grey marker for no key
and no data. Grade is also carried by the marker shape and the text, never by
colour alone.

## Behaviour

- **Submitting a lookup.** `Checker` already stays on `/`, pushes
  `/check/<ioc>` into the URL and renders the result in place. That flow is
  unchanged. `Checker` gains one optional prop, `idle`, a node it renders in
  place of its search card and idle card while nothing has been looked up.
  Only `app/page.tsx` passes it (the cover). Once a lookup starts, `Checker`
  renders exactly what it renders today. The cover and the result frame share
  geometry, so the swap reads as the panel filling in. The health tile and the
  rail summary are not rendered in any non-idle state.
- **Loading.** The frame, sprite and search render immediately. The right rail
  count and the health tile sit inside one `Suspense` boundary whose fallback is
  the `sweep` placeholder at final size, so a slow Redis never delays the search
  and nothing shifts when health arrives.
- **Without Redis.** The rail shows `—` and the health tile a single line,
  "Health tracking needs the Redis cache." The page otherwise works.

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
  pipeline: about 40 `LRANGE`s per homepage view. Well within Upstash's free
  500K commands a month at team scale.
- **Grade.** A pure function in `lib/ti/health.ts`, over one source's entries
  plus its `SourceMeta` and `isEnabled()`. Rules are checked top to bottom
  and the first match wins:

  | Grade | Rule |
  |---|---|
  | `no-key` | `isEnabled()` is false (key-gated, env var unset) |
  | `no-data` | fewer than 5 counted runs |
  | `failing` | `ok` share < 50% |
  | `degraded` | `ok` share 50 to < 90%, or `rate_limited` is the most common non-`ok` status |
  | `slow` | `ok` share ≥ 90% and median `ok` latency > half the source's timeout (`meta.timeoutMs ?? PER_SOURCE_TIMEOUT_MS`, which `orchestrate.ts` exports for this) |
  | `healthy` | otherwise |

  `skipped` runs are not counted at all (the source declined the input, e.g. a
  SHA-1 on a SHA-256-only source). Sort order: failing, degraded, slow,
  healthy, no-data, no-key; within a grade, lower `ok` share first, then name.
- The summary for the rail is derived from the same graded list, so the rail
  and the tile can never disagree.

## Boundary: `/` only

This change is the homepage and nothing else. `/check/<ioc>`, `/scan` and
`/scan/<indicator>` must render and behave exactly as before.

- `app/check/**`, `app/scan/**`, `components/CheckResults/**`,
  `components/ScanReport/**` and `components/ScanSearch.tsx` are not edited.
  The cover imports `Frame`, `Tile` and `Sprite` from `CheckResults` as they
  are, including `Frame`'s current `foreground/12` rules.
- `components/Checker/index.tsx` is edited only to add the optional `idle`
  prop. `/check/<ioc>` does not pass it, so its render path is untouched.
- `lib/ti/route-handler.ts` gains the `recordHealth` write. That is backend
  plumbing every lookup passes through (the homepage cannot measure health
  otherwise); it changes no response and nothing either page renders.

## Out of scope

Any change to `/check` or `/scan`, including the dimmer `Frame` rules noted
above;
recent lookups, flagged lists and stats; probing sources actively; a dedicated
`/sources` page.

## Testing

- `lib/ti/health.test.ts`: every grade's boundary (exactly 50%, exactly 90%,
  exactly half the timeout, exactly 5 runs), `skipped` excluded, rate-limit
  dominance, per-source timeout override, sort order, summary counts.
- `recordHealth` with a stubbed Redis, as `history.test.ts` does: key shape,
  entry fields, error truncation, trim to 50, no-op without Redis, swallowed
  Redis error.
- `lib/ti/route-handler.test.ts`: a fresh run records health for every source;
  a cache hit records none.
- These cover the new `lib/` lines for Sonar's 80% new-coverage gate.
- UI, at 1280 px in light and dark: homepage at rest, homepage with health
  held pending, homepage after submitting a lookup (health gone).
- `/check/8.8.8.8` and `/scan` shot before and after the change and compared:
  they must be pixel-identical, apart from live data.
- `scripts/verify-loading.mjs` against a production build: zero layout shift
  on the homepage when health resolves.
- `bun run typecheck`, `bun run lint`, `bun run test` all pass.
