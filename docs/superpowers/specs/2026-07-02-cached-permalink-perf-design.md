# Cached-permalink performance

Date: 2026-07-02
Status: Approved

## Goal

Make cached permalink lookups feel instant, and cut redundant work on the
result path. Three focused changes, all scoped to the cached case:

1. Server-render cached results so the verdict paints in the initial HTML
   instead of after a client-only download-and-hydrate.
2. Edge-cache the GET JSON API for cached hits.
3. Run independent Redis reads in parallel.

Primary driver is perceived speed. SEO/indexing is a side benefit, not a
requirement.

## Background

- The result page `app/check/[ioc]/page.tsx` reads the cached result on the
  server (`fetchCached`, memoized per request) and passes it to `<Checker>` as
  `initialResult`.
- `Checker` is a client component. It seeds `result` state from `initialResult`
  (`Checker.tsx:234`) and, on mount, does not re-run the lookup when a result is
  already present (`Checker.tsx:259-266`).
- `CheckResults` is loaded via `dynamic(loadCheckResults, { ssr: false })`
  (`Checker.tsx:199`). Because `Checker` itself is a client component, Next
  already SSRs it; only `CheckResults` is excluded from SSR by `ssr:false`. So a
  cached permalink today ships an HTML shell, then downloads the `Checker` +
  `CheckResults` chunks, then renders the verdict client-side.
- The GET handler (`lib/ti/route-handler.ts`, `jsonResult`) returns
  `Response.json(...)` with no cache headers. The streaming POST correctly uses
  `no-store`.
- The GET/stream responses embed `history`, an append-only per-indicator
  timeline read from Redis.

## Design

### 1. SSR cached results

Drop `ssr:false` from the `CheckResults` dynamic import in `Checker.tsx`; keep
the `dynamic()` call so it stays code-split on the client.

Behaviour after the change:

- **Home page** (`result === null`): `CheckResults` renders nothing, so there is
  no meaningful added SSR or initial-bundle cost.
- **Cached permalink**: `page.tsx` supplies `initialResult`, seeded into
  `useState`, so the server render emits the full verdict + cards as HTML. The
  client hydrates the same prop (no mismatch), and the lookup does not re-run
  because `result` is already set.
- **Interactivity** (`onRefresh`, `onPivot`, research stream, map tiles)
  activates on hydration exactly as today. The map's tile fetch stays behind its
  `IntersectionObserver` in `useEffect`, which is SSR-safe.

Required audit: check every card under `components/CheckResults/` for
render-time browser access (`window`, `document`, `IntersectionObserver`, etc.).
Only `location-map.tsx` touches the DOM today, and it is already guarded inside
`useEffect`. Anything unsafe found during the audit gets moved into `useEffect`
or behind a mount guard.

### 2. Edge-cache the GET API

Add `Cache-Control: public, s-maxage=300, stale-while-revalidate=86400` to
**cached GET hits only** in `jsonResult`:

- The cached branch (a cache hit, non-refresh) sets the header.
- The fresh-compute branch and the error (502) branch stay uncached.
- The streaming POST keeps `no-store` (unchanged).
- `?refresh=1` already forces a fresh compute, so it bypasses the cached header
  naturally.

Rationale: a cached result is deterministic for the TTL window, so Vercel's edge
can serve repeat API lookups without hitting the function or Redis. The embedded
`history` can be at most `s-maxage` (5 min) stale, acceptable for an append-only
timeline.

Scope: this is the documented HTTP API path only. The user-facing page reads
Redis directly (not via GET) and is out of scope here.

### 3. Parallel Redis reads

In `lib/ti/route-handler.ts`:

- **Read path** (`jsonResult` non-refresh, and the stream's cached branch):
  today `getCached` runs first, and only on a hit do we then read `getHistory`,
  two serial round trips on the hot cached path. Speculatively fire both with
  `Promise.all`: on a hit, use both results (one RTT saved); on a miss, discard
  the history read and fall through to a fresh compute. The wasted read on a miss
  is a single cheap Redis call, and a miss already pays for a full source run, so
  the trade is worth the saved RTT on every cache hit.
- **Fresh path**: `recordHistory` must complete before `getHistory` (the new
  snapshot must appear in the returned timeline), but `setCached` is independent
  of both. Run `setCached` concurrently with the `recordHistory -> getHistory`
  chain via `Promise.all`.

## Testing

- **Unit (Vitest, no network):** a `makeIndicatorRoute` test with a fake config
  asserting:
  - a cached GET response carries `Cache-Control` with `s-maxage`, while
    fresh-compute and error responses do not;
  - the fresh path still returns the just-recorded history snapshot (ordering
    preserved despite parallelism).
- **Manual:** `npm run dev`, load a cached permalink, confirm the verdict is in
  the initial HTML (view-source or JS disabled) and hydration is warning-free;
  confirm the home page still renders and its behaviour is unchanged.
- **Gates:** `npm test` and `npm run lint` both green.

## Non-goals (possible follow-ups)

- Page-level caching of `app/check/[ioc]`.
- Splitting the `Checker` bundle (idea #2).
- PPR / Next 16 Cache Components (idea #C).
