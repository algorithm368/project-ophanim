# Back/Forward View Sync — Design Spec

- **Date:** 2026-06-13
- **Status:** Approved design, ready for implementation plan
- **Area:** `components/Checker.tsx` (client navigation behavior)

## Context

The result page lives in a single mounted `Checker` component. Running a check
does **not** trigger a Next navigation — `runCheck` updates the URL with raw
`window.history.pushState(...)` (`Checker.tsx:396`) so the live NDJSON streaming
UI stays in the same component instance. The component's view is driven by React
state (`query`, `mode`, `result`, ...) seeded once from `initialQuery` /
`initialResult` at mount.

The only `popstate` listener (`Checker.tsx:264–277`) scrolls to the top and does
nothing else. So on **Back / Forward** the URL changes but no state does.

### The bug

After checking `1.1.1.1` then `8.8.8.8` and pressing **Back**:

- The search box still reads `8.8.8.8` (it never re-syncs to the URL) — the
  reported symptom.
- The results panel **also** still shows `8.8.8.8`, while the URL bar reads
  `/check/1.1.1.1`. The whole view is stale, not just the box.

Fixing only the search-box text would leave box-vs-results mismatched. The fix is
to **re-sync the full view to the URL on every history navigation**.

## Goals / Non-goals

**Goals**

- On Back/Forward, the search box, detected `mode`, and results panel all follow
  the current URL.
- Restores are **instant** (no network) when the indicator has already been
  checked this session, via an in-memory result cache.
- On a cache **miss** (e.g. after a hard reload, or a Forward into an indicator
  never run in this session), fall back to re-running the lookup for that
  indicator.
- Navigating Back to `/` clears the box and results to the empty state.
- Keep the existing scroll-to-top-on-popstate behavior.

**Non-goals**

- No change to how a check navigates (still `pushState`, no Next router).
- No change to the server-side Redis result cache or history.
- **Bulk geolocation is out of scope** — bulk lookups (`runBulk`) never call
  `pushState`, so they create no history entries and are unaffected by this work.
- No persistence of the client cache across hard reloads (the server-rendered
  `initialResult` re-seeds it; anything else is a cache miss → re-fetch).

## Design

### New component-local state

```ts
// In-memory result cache, keyed by the canonical IOC that appears in
// /check/<ioc> (the decoded path segment). Session-scoped, never serialized.
const resultsCache = useRef<Map<string, CheckResult | DomainCheckResult | HashCheckResult>>(
  new Map(),
);

// The in-flight lookup's controller, so a history navigation can cancel it.
const abortRef = useRef<AbortController | null>(null);
// Set true immediately before a navigation-driven abort so runCheck's catch
// suppresses the "couldn't reach the server" error for a deliberate cancel.
const navAbortRef = useRef(false);
```

### Canonical key

The cache key is the **canonical IOC** — the exact string `runCheck` builds the
URL from: `canonicalFor(value, detected)`, then placed in the path as
`encodeURIComponent(canonical)`. On `popstate` the key is recovered by
`decodeURIComponent`-ing the path segment, so writes and reads agree. For
IPs/domains/hashes `encodeURIComponent` is effectively a no-op (dots and hex
pass through), so the round-trip is exact.

A small pure helper centralizes path parsing and is unit-testable:

```ts
// "/check/8.8.8.8" -> "8.8.8.8"; "/check/evil.com" -> "evil.com";
// "/" or anything else -> null (treated as the home/empty state).
function iocFromPath(pathname: string): string | null;
```

### Seeding the cache

- **On mount:** if `initialResult` is present, `resultsCache.set(initialQuery's
  canonical, initialResult)`.
- **On every completed live lookup:** when `runCheck` resolves a `finalResult`,
  `resultsCache.set(canonical, finalResult)` (canonical is already in scope from
  building the URL).

### Unified `popstate` handler

Replaces the scroll-only effect (keeps the scroll-to-top + `scrollRestoration`
"manual" handling already documented at `Checker.tsx:256–277`). On `popstate`:

1. `const ioc = iocFromPath(window.location.pathname);`
2. **`ioc === null` (home `/`)** → clear to empty state:
   `setQuery("")`, `setResult(null)`, `setError(null)`, `setLoading(false)`,
   `setProgress(null)`, `setBulkRows(null)`, `setIsBulk(false)`.
3. **`ioc !== null`** → `setQuery(ioc)`, `setMode(detectIOC(ioc) ?? mode)`, then:
   - **cache hit** → cancel any in-flight lookup (see below), then
     `setResult(cached)` and reset `error/loading/progress/bulk` to the settled
     state. No network.
   - **cache miss** → cancel any in-flight lookup, then `runCheck(ioc)`. The
     existing `window.location.pathname !== url` guard (`Checker.tsx:395`) means
     `runCheck` will **not** push a duplicate history entry for the URL we are
     already on.
4. Always scroll to top (preserve current behavior).

### Cancel-on-navigate

`runCheck` assigns its `AbortController` to `abortRef.current` (in addition to the
local `controller`). The popstate handler, before restoring, does:

```ts
if (abortRef.current) {
  navAbortRef.current = true;
  abortRef.current.abort();
}
```

`runCheck`'s `catch` checks `navAbortRef`: if a navigation triggered the abort, it
clears the flag and returns without calling `setError` (the navigation handler
owns the next state). Its `finally` still resets `loading/progress` and clears
`abortRef.current`. This prevents two hazards:

- A cache-miss `runCheck(ioc)` being a no-op because the old lookup still held
  `loading === true` (the `if (loading) return` guard at `Checker.tsx:358`).
- A late `finalResult` from the abandoned lookup clobbering the restored result.

### Why a client cache (not `history.state`)

We considered stashing each result into `pushState`'s state argument and reading
`event.state` on `popstate`. Rejected: TI results can be tens of KB with nested
`details`, and serializing them into the history entry risks the browser's
`history.state` size limits and adds a serialization round-trip. An in-memory
`Map` keeps object references, has no size ceiling beyond session memory, and is
simpler. The trade-off — cache lost on hard reload — is already handled by the
server-rendered `initialResult` re-seed plus the miss→re-fetch fallback.

## Edge cases

- **In-flight lookup + Back:** cancelled cleanly via `abortRef`/`navAbortRef`; no
  error toast; the restore (hit or miss) applies.
- **Forward into a never-run indicator:** cache miss → `runCheck` re-fetches and
  shows the streaming UI (the accepted fallback).
- **Unchecked edits then Back:** typed-but-unsubmitted text never pushed a history
  entry, so Back goes to the prior real entry and replaces the box — expected.
- **Permalink session (first load `/check/x`):** that history entry has no `/`
  before it, so Back never reaches the empty home state in that session; cache is
  seeded from `initialResult` for `x`.
- **Cache growth:** bounded by checks-per-session (small). No eviction needed; the
  Map dies with the page. (A soft cap can be added later if ever warranted — not
  in scope.)

## Testing

- **Unit (Vitest, colocated `*.test.ts`):** `iocFromPath` — `/check/8.8.8.8` →
  `8.8.8.8`, `/check/evil.com` → `evil.com`, encoded segments decode correctly,
  `/` and non-check paths → `null`. Extract the helper to a small module (e.g.
  alongside `lib/ioc.ts` or a local helper) so it is importable without the React
  component.
- **Playwright (`scripts/`):** end-to-end history walk —
  1. check A, then check B;
  2. **Back** → assert search box value === A **and** results header/indicator === A;
  3. **Forward** → assert box + results === B;
  4. (home-origin session) **Back** past A → assert empty state, box cleared.
  Run against no-key sources (e.g. two routable IPs) so the pipeline works without
  credentials.

## Acceptance criteria

- After check A → check B, pressing Back shows A in **both** the search box and
  the results panel, with no full-page reload; Forward returns to B.
- Cache-hit restores perform no network request (verified via the absence of a new
  streaming/progress UI and no new `/api/check*` call).
- Cache-miss navigations re-run the lookup for the URL's indicator.
- Back to `/` clears the box and shows the empty state.
- An in-flight lookup interrupted by Back/Forward does not surface an error.
- `npm test` and `npm run lint` pass.
