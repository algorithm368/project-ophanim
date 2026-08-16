@AGENTS.md

# project-ophanim

A threat-intelligence indicator checker. Paste an **IPv4, domain, or file hash**
(MD5/SHA1/SHA256), and the app fans out to many TI sources in parallel, then
collapses every response into one normalized 0-100 risk score and verdict. Built
on Next.js 16 (App Router) + React 19 + TypeScript. An optional Upstash Redis
cache backs result caching and per-indicator history; without credentials the
app degrades gracefully (no cache, no history) rather than failing.

The README documents the user-facing source list and HTTP API. This file is for
working *in* the codebase: where things live, the conventions, and how to verify.

## Commands

```bash
bun install        # install dependencies (bun.lock is the lockfile)
bun run dev        # next dev (http://localhost:3000)
bun run build      # production build
bun run lint       # eslint (next core-web-vitals + typescript)
bun run typecheck  # tsc --noEmit
bun run test       # vitest run (unit tests, no network, ~0.4s)
bun run test:watch # vitest watch
bun run coverage   # vitest run --coverage, writes coverage/lcov.info for Sonar
```

The toolchain is Bun (package manager + script runner). Next/Vitest/ESLint still
do the actual build/test/lint work, so `bun run <script>` just runs the same
tools. After a fresh install, run `bunx playwright install chromium` once so the
screenshot helpers in `scripts/` have a matching browser.

Use `bun run test`, not `bun test`: the latter invokes Bun's own test runner
(which does not understand the Vitest API) instead of the `test` script. The
deploy uses the Bun runtime for Vercel Functions (`bunVersion` in `vercel.json`),
and `dev`/`build`/`start` run Next under Bun via `bun run --bun`.

## Architecture: the indicator pipeline

All three IOC types share one data model and one execution path. The shape is
deliberately uniform, so the same change usually applies to IP, domain, and hash.

- **Normalized model** lives in `lib/ti/types.ts`. Every source returns a
  `SourceFinding` (`status`, `score` 0-100, `malicious`, `summary`, `categories`,
  `details`, plus optional `geo` / `domainContext` / `hashContext`). The
  orchestrator wraps it into a `SourceResult`, and the per-type result is
  `CheckResult` / `DomainCheckResult` / `HashCheckResult`.
- **A source** implements the `TiSource` interface: `meta` (`SourceMeta`),
  `isEnabled()`, and `check(indicator, signal)`. See `lib/ti/sources/feodo.ts`
  for a clean reference adapter.
- **Orchestration** is shared in `lib/ti/orchestrate.ts`: `runSource` (handles
  skip/timeout/error, drops the `raw` payload before returning), `runAll`
  (parallel, with an `onSettled` callback used for streaming), and `mergeFields`
  (first-non-empty merge of context objects).
- **Per-type orchestrators** wire registry + orchestrate + aggregate:
  `lib/ti/check.ts` (IP), `lib/ti/domain/check.ts`, `lib/ti/hash/check.ts`.
- **Scoring** is in `lib/ti/aggregate.ts`. `aggregateRisk` blends the strongest
  weighted signal (0.6) with the weighted consensus (0.4); any hard `malicious`
  listing sets a floor of 75. `verdictFor` maps score to
  clean/low/suspicious/malicious/unknown.
- **Route factory** `lib/ti/route-handler.ts` (`makeIndicatorRoute`) builds the
  shared GET/POST handlers: GET and plain POST return one JSON result;
  a POST with `Accept: application/x-ndjson` streams per-source progress
  (`start` / `source` / `done` / `error` events). It also reads/writes the cache
  and records history. Each route file (`app/api/check/route.ts`,
  `check-domain`, `check-hash`) only supplies validation + the type-specific
  cache/run functions.
- **IOC detection** `lib/ioc.ts`: `refangIOC` undoes analyst defanging
  (`evil[.]com`, `hxxps://`, etc.); `detectIOC` picks ip/domain/hash so the
  unified `app/check/[ioc]/` route works without a manual mode toggle.

### Directory map

```
lib/ip.ts, lib/domain.ts, lib/hash.ts   parsing + scope/algo detection
lib/ti/types.ts                          shared normalized model + TiSource
lib/ti/orchestrate.ts                    runSource / runAll / mergeFields
lib/ti/aggregate.ts                      risk scoring + verdict
lib/ti/http.ts                           timeout-aware fetch helpers (getJson, isTimeout, errorMessage)
lib/ti/route-handler.ts                  makeIndicatorRoute (GET/POST + streaming)
lib/ti/cache.ts                          Upstash Redis cache (optional)
lib/ti/history.ts                        reputation timeline in Redis (optional)
lib/ti/{sources,domain/sources,hash/sources}/*   one adapter per source
lib/ti/{registry,domain/registry,hash/registry}.ts   the source lists
lib/ti/{check,domain/check,hash/check}.ts            per-type orchestrators
app/api/{check,check-domain,check-hash}/route.ts     indicator routes
app/api/scan-url/route.ts                active scan: POST submits, GET polls
app/page.tsx, app/check/[ioc]/           passive: landing + result (+ OG image)
app/scan/page.tsx, app/scan/[indicator]/ active: landing + scan page
lib/route-mode.ts                        which mode a path is in, for the switch
lib/scan-input.ts                        what the active box makes of an input
components/Checker.tsx, CheckResults.tsx passive UI entry points
components/ScanSearch.tsx                the active landing page's search box
components/ModeSwitch.tsx                passive/active switch, in the banner
components/ImageInspector.tsx            full-screen capture viewer, zoom + pan
components/ScanReport/                   the active scan page's UI
components/ui/                           shadcn primitives
```

The two readings are two modes, and each mode is two pages: a landing page with
a search box (`/` and `/scan`) and a page for one indicator (`/check/<ioc>` and
`/scan/<indicator>`). Passive is assembled from records others keep; active is
the only thing in the app that visits the indicator, and `/scan/<indicator>` is
the only place a scan can be started. `ModeSwitch` in the banner (beside the
theme toggle) moves between them, carrying the indicator when there is one, and
renders nothing on a path in neither mode. The card on `/check` is an entry
point: it reports whether a scan already exists and links across, it never
scans. `readScanInput` in `lib/scan-input.ts` is the boundary the active box
enforces, deliberately the same one `/api/scan-url` applies, so the box never
accepts what the route would refuse.

## Conventions

- **Adding a source** is the most common extension. Create an adapter under the
  right `sources/` dir implementing `TiSource`, then register it in that type's
  `registry.ts`. Mirror `feodo.ts`: catch errors and return
  `{ status: isTimeout(err) ? "timeout" : "error", error: errorMessage(err) }`
  rather than throwing; honor the `AbortSignal`; set a `weight` reflecting how
  authoritative the source is (context-only sources use `0` so they do not move
  the score). Key-gated sources set `requiresKey: true` + `keyEnv` and gate
  `isEnabled()` on the env var.
- **HTTP**: use the helpers in `lib/ti/http.ts`, not bare `fetch`, so timeouts
  and errors are uniform.
- **Tests**: Vitest, files are `lib/**/*.test.ts` (colocated next to source).
  They are pure/unit (no network) and use the `@/` alias. Run `bun run test`
  before declaring work done. Parsing, scoring, and refang are all covered; add cases
  there when you touch that logic.
- **Untrusted input** is validated at the boundary: route `validate` functions
  reject bad/non-routable indicators (see `validateIp` rejecting private/reserved
  ranges with 422). Keep validation at these edges.
- **Env / secrets**: `.env.local` wins over `.env` (Next.js loads both, with
  `.env.local` taking priority). `.env*` files are gitignored; never commit keys.
  The cache reads either `UPSTASH_REDIS_REST_*` or the `KV_REST_API_*` names that
  Vercel's Upstash integration injects.

## Verifying changes

1. `bun run test` and `bun run lint` should both pass.
2. For lookup/source logic, the no-key sources (ip-api, Shodan InternetDB,
   DNSBLs, Feodo, etc.) work without any credentials, so you can exercise the
   real pipeline end-to-end against a known-bad and a known-clean indicator.
3. For UI changes, run `bun run dev` and check the feature in a browser. There
   are Playwright screenshot helpers in `scripts/` (e.g. `node scripts/shot.mjs`)
   used for visual checks. If you cannot verify the UI, say so explicitly.

## Automation

`.github/workflows/ci.yml` runs on every push and pull request. The `check` job
is `typecheck`, `lint`, `test`, `build`, in that order because the first three
localize a failure better than a build log does. The `sonar` job is separate and
not gated on `check`: analysis of broken code is still worth having.

Sonar analyses this repo as `algorithm368_project-ophanim`. Two things about it
are easy to get wrong:

- **`sonar-project.properties` is not optional.** A local `sonar` scan without it
  auto-provisions a second project under a bare key, whose issue list then
  diverges from CI's without ever saying so.
- **SonarCloud Automatic Analysis must stay off.** It and CI analysis are
  mutually exclusive, and SonarCloud refuses the CI scan rather than yielding.
  The `sonar` job skips with a warning when `SONAR_TOKEN` is unset, so a missing
  secret reads as skipped rather than as clean.

Coverage comes from `bun run coverage`; the vitest coverage settings live in
`vitest.config.ts` and are scoped to `lib/`, which is where the tests and the
logic are. The scanner reads `coverage/lcov.info` as it analyses, so a missing
report is silently 0%.

`.githooks/pre-commit` autofixes and re-stages staged source files, then lints
the project. `bun install` wires it up via the `prepare` script; if hooks are not
firing, run `git config core.hooksPath .githooks`. The Claude Code hooks in
`.claude/settings.json` run the Sonar secret scanner over reads and prompts, and
skip quietly when the `sonar` CLI is missing or logged out.
