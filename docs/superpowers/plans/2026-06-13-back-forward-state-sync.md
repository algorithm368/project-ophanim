# Back/Forward View Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On browser Back/Forward, re-sync the Checker's search box, mode, and results panel to the URL — instantly from an in-memory result cache, falling back to a re-fetch on cache miss, and clearing to the empty state at `/`.

**Architecture:** Lookups change the URL with raw `pushState` (no remount), so a single `popstate` handler becomes the one place that reads the URL back into React state. A `useRef<Map>` caches completed results keyed by the canonical IOC; an in-flight lookup is cancelled cleanly on navigation via the `AbortController`'s `signal.reason`. A small pure helper `iocFromPath` parses the URL and is unit-tested.

**Tech Stack:** Next.js 16 (App Router) + React 19 + TypeScript; Vitest (unit); Playwright (e2e walk, via `scripts/`).

**Reference spec:** `docs/superpowers/specs/2026-06-13-back-forward-state-sync-design.md`

---

## File Structure

- `lib/ioc.ts` — **modify**: add the pure `iocFromPath(pathname)` helper next to `detectIOC`/`refangIOC` (its natural home — URL→IOC parsing).
- `lib/ioc.test.ts` — **modify**: add a `describe("iocFromPath", ...)` block.
- `components/Checker.tsx` — **modify**: add the `NAV_ABORT` sentinel + result cache/abort refs; seed the cache on mount; write the cache and wire cancel-on-navigate inside `runCheck`; replace the scroll-only `popstate` effect with the URL-sync handler.
- `scripts/back-forward.mjs` — **create**: a Playwright history-walk that asserts box + results follow the URL.

---

## Task 1: `iocFromPath` URL helper

**Files:**
- Modify: `lib/ioc.ts` (add after `detectIOC`, before `extractIps`)
- Test: `lib/ioc.test.ts` (add a new `describe` block)

- [ ] **Step 1: Write the failing test**

Add to `lib/ioc.test.ts`. First update the import on line 2 to include the new helper:

```ts
import { detectIOC, refangIOC, extractIps, iocFromPath } from "@/lib/ioc";
```

Then append this block at the end of the file:

```ts
describe("iocFromPath", () => {
  it.each([
    ["/check/8.8.8.8", "8.8.8.8"],
    ["/check/evil.com", "evil.com"],
    [
      "/check/275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f",
      "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f",
    ],
    ["/check/%31.%31.%31.%31", "1.1.1.1"], // URL-encoded segment decodes
    ["/check/8.8.8.8/", "8.8.8.8"], // tolerate a trailing slash
  ])("parses %s -> %s", (pathname, expected) => {
    expect(iocFromPath(pathname)).toBe(expected);
  });

  it.each([
    ["/", null],
    ["/check/", null],
    ["/check", null],
    ["/about", null],
    ["", null],
  ])("returns null for %s", (pathname) => {
    expect(iocFromPath(pathname)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- ioc`
Expected: FAIL — `iocFromPath` is not exported (TypeScript/import error or "is not a function").

- [ ] **Step 3: Write the minimal implementation**

In `lib/ioc.ts`, add this function immediately after `detectIOC` (i.e. after its closing `}` near line 47, before the `extractIps` doc comment):

```ts
/**
 * The canonical IOC encoded in a `/check/<ioc>` permalink path, or null for any
 * other path (e.g. the home "/"). Used to re-sync the checker view to the URL on
 * browser Back/Forward. The segment is URL-decoded so it matches the key the
 * lookup cached the result under, and a stray trailing slash is tolerated.
 */
export function iocFromPath(pathname: string): string | null {
  const match = /^\/check\/(.+?)\/?$/.exec(pathname);
  if (!match) return null;
  try {
    const decoded = decodeURIComponent(match[1]);
    return decoded.trim() ? decoded : null;
  } catch {
    // Malformed percent-encoding — treat as "no indicator".
    return null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- ioc`
Expected: PASS (all `iocFromPath` cases green, existing `refangIOC`/`detectIOC`/`extractIps` cases still green).

- [ ] **Step 5: Commit**

```bash
git add lib/ioc.ts lib/ioc.test.ts
git commit -m "feat(ioc): add iocFromPath helper for /check/<ioc> URLs"
```

---

## Task 2: Result cache + cancel-on-navigate plumbing in `Checker`

This task adds the cache and abort wiring `runCheck` owns. It is **behavior-preserving on its own** — nothing reads the cache or aborts with `NAV_ABORT` until Task 3 — so the app behaves exactly as before after this commit.

**Files:**
- Modify: `components/Checker.tsx`

- [ ] **Step 1: Add the `NAV_ABORT` sentinel at module scope**

In `components/Checker.tsx`, find the `SLOW_THRESHOLD_S` constant (around line 191):

```ts
const SLOW_THRESHOLD_S = 5;
```

Add directly below it:

```ts
/** abort() reason used when a history navigation cancels an in-flight lookup, so
 *  runCheck's catch can tell a deliberate Back/Forward from a real failure. */
const NAV_ABORT = "nav-abort";
```

- [ ] **Step 2: Add the cache and abort refs**

Find the ref declarations near the end of the state block (around line 236):

```ts
  // Captures the mount-time runCheck so the init effect can fire it once without
  // listing the (re-created-each-render) function as a dependency.
  const runCheckRef = useRef(runCheck);
  const didInit = useRef(false);
```

Add immediately after `const didInit = useRef(false);`:

```ts
  // Session-scoped client cache of completed results, keyed by the canonical IOC
  // that appears in /check/<ioc> (the decoded path segment). Lets Back/Forward
  // restore a prior result instantly with no network; seeded from initialResult
  // and written on every completed lookup.
  const resultsCache = useRef<
    Map<string, CheckResult | DomainCheckResult | HashCheckResult>
  >(new Map());
  // The in-flight lookup's AbortController, so a history navigation can cancel it.
  const abortRef = useRef<AbortController | null>(null);
```

- [ ] **Step 3: Seed the cache from `initialResult` on mount**

Find the mount init effect's first branch (around lines 245–248):

```ts
    if (initialResult) {
      // Cached permalink: the result is already on screen. Warm the lazy chunk
      // so it paints instantly; the user can still re-check via refresh.
      void loadCheckResults();
    } else if (initialQuery && detectIOC(initialQuery)) {
```

Replace that `if (initialResult) { ... }` branch with:

```ts
    if (initialResult) {
      // Cached permalink: the result is already on screen. Seed the client cache
      // (initialQuery is the canonical IOC from the URL) so Back/Forward to this
      // indicator restores instantly, and warm the lazy chunk so it paints fast;
      // the user can still re-check via refresh.
      if (initialQuery) resultsCache.current.set(initialQuery, initialResult);
      void loadCheckResults();
    } else if (initialQuery && detectIOC(initialQuery)) {
```

- [ ] **Step 4: Register the controller in `abortRef` inside `runCheck`**

Find the AbortController creation in `runCheck` (around line 426):

```ts
    const controller = new AbortController();
    let watchdog: ReturnType<typeof setTimeout> | undefined;
```

Replace with:

```ts
    const controller = new AbortController();
    abortRef.current = controller;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
```

- [ ] **Step 5: Write the completed result into the cache**

Find the success branch after the stream loop (around lines 509–519):

```ts
      if (streamError) {
        setError({ kind: "request", message: streamError });
      } else if (finalResult) {
        setResult(finalResult);
      } else {
```

Replace with:

```ts
      if (streamError) {
        setError({ kind: "request", message: streamError });
      } else if (finalResult) {
        // Cache the completed result so Back/Forward to this indicator restores
        // instantly — `canonical` is the exact key the URL was built from.
        resultsCache.current.set(canonical, finalResult);
        setResult(finalResult);
      } else {
```

- [ ] **Step 6: Suppress the nav-abort error and guard the `finally`**

Find the `catch`/`finally` at the end of `runCheck` (around lines 520–532):

```ts
    } catch {
      // Network drop or the watchdog firing because the stream stalled.
      setError({
        kind: "request",
        message: controller.signal.aborted
          ? "This check is taking longer than expected. Please try again."
          : "Couldn't reach the server. Check your connection and try again.",
      });
    } finally {
      if (watchdog) clearTimeout(watchdog);
      setLoading(false);
      setProgress(null);
    }
```

Replace with:

```ts
    } catch {
      // A history navigation aborted this lookup (signal.reason === NAV_ABORT):
      // the popstate handler owns the next state, so don't surface an error.
      // Otherwise it's a network drop or the watchdog firing on a stalled stream.
      if (controller.signal.reason !== NAV_ABORT) {
        setError({
          kind: "request",
          message: controller.signal.aborted
            ? "This check is taking longer than expected. Please try again."
            : "Couldn't reach the server. Check your connection and try again.",
        });
      }
    } finally {
      if (watchdog) clearTimeout(watchdog);
      // Only clear shared lookup state if a newer lookup hasn't taken over: a
      // navigation may have aborted this one and started another, which now owns
      // abortRef/loading/progress.
      if (abortRef.current === controller) {
        abortRef.current = null;
        setLoading(false);
        setProgress(null);
      }
    }
```

- [ ] **Step 7: Verify the build and existing tests still pass**

Run: `npm run lint && npm test`
Expected: PASS (no behavior change yet; this is plumbing only).

- [ ] **Step 8: Commit**

```bash
git add components/Checker.tsx
git commit -m "feat(checker): add result cache + abort wiring for history nav"
```

---

## Task 3: URL-sync `popstate` handler

Replaces the scroll-only `popstate` effect with the handler that reads the URL back into state. This is the task that fixes the bug.

**Files:**
- Modify: `components/Checker.tsx`

- [ ] **Step 1: Import `iocFromPath`**

Find the IOC import (line 35):

```ts
import { detectIOC, refangIOC, extractIps } from "@/lib/ioc";
```

Replace with:

```ts
import { detectIOC, refangIOC, extractIps, iocFromPath } from "@/lib/ioc";
```

- [ ] **Step 2: Replace the `popstate` effect**

Find the existing scroll-only effect (around lines 264–277):

```ts
  useEffect(() => {
    if (!("scrollRestoration" in window.history)) return;
    const prev = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    function onPopState() {
      window.scrollTo({ top: 0 });
      requestAnimationFrame(() => window.scrollTo({ top: 0 }));
    }
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.history.scrollRestoration = prev;
    };
  }, []);
```

Replace the whole effect (keep the existing explanatory comment block above it as-is, or replace it with the comment below) with:

```ts
  // Lookups change the URL via pushState, so browser Back/Forward only swaps the
  // URL — the page never remounts. Re-sync the whole view to the URL on popstate:
  // restore the box, mode, and result from the in-memory cache (instant), re-fetch
  // on a miss, or clear to the empty state at "/". We also land the user at the
  // top: the browser's "auto" scroll restoration re-applies the old position one
  // frame after popstate (and Next resets the flag to "auto" on cross-route hops),
  // so we set "manual" and re-assert top on the next frame as a fallback.
  useEffect(() => {
    const prevRestoration =
      "scrollRestoration" in window.history
        ? window.history.scrollRestoration
        : undefined;
    if (prevRestoration !== undefined) {
      window.history.scrollRestoration = "manual";
    }

    function onPopState() {
      // Cancel any in-flight lookup so it can't error or clobber the restore.
      if (abortRef.current) {
        abortRef.current.abort(NAV_ABORT);
        abortRef.current = null;
      }

      const ioc = iocFromPath(window.location.pathname);
      if (ioc === null) {
        // Back to the home page: clear to the empty state.
        setQuery("");
        setResult(null);
        setError(null);
        setLoading(false);
        setProgress(null);
        setBulkRows(null);
        setIsBulk(false);
      } else {
        setQuery(ioc);
        const detected = detectIOC(ioc);
        if (detected) setMode(detected);
        const cached = resultsCache.current.get(ioc);
        if (cached) {
          // Cache hit: restore instantly, no network.
          setResult(cached);
          setError(null);
          setLoading(false);
          setProgress(null);
          setBulkRows(null);
          setIsBulk(false);
        } else {
          // Cache miss (e.g. after a hard reload): re-fetch this indicator. The
          // pathname === url guard in runCheck means it won't push a duplicate
          // history entry for the URL we're already on.
          runCheckRef.current(ioc);
        }
      }

      window.scrollTo({ top: 0 });
      requestAnimationFrame(() => window.scrollTo({ top: 0 }));
    }

    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      if (prevRestoration !== undefined) {
        window.history.scrollRestoration = prevRestoration;
      }
    };
  }, []);
```

> Note: the effect's `[]` deps are correct — it reads only stable refs
> (`abortRef`, `resultsCache`, `runCheckRef`), stable state setters, the
> `NAV_ABORT` module const, and the pure imports `iocFromPath`/`detectIOC`. No
> reactive value is captured, so there is no staleness.

- [ ] **Step 3: Verify lint and tests**

Run: `npm run lint && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/Checker.tsx
git commit -m "fix(checker): sync search box + results to URL on Back/Forward"
```

---

## Task 4: Playwright history-walk + end-to-end verification

**Files:**
- Create: `scripts/back-forward.mjs`

- [ ] **Step 1: Write the Playwright walk**

Create `scripts/back-forward.mjs` with exactly:

```js
import { chromium } from "playwright";

// Drives a real Back/Forward walk and asserts the box AND results follow the URL.
// Assumes the dev server is already running on :3000 (do not start/kill it here).
const BASE = process.env.BASE || "http://localhost:3000";
const A = "8.8.8.8";
const B = "1.1.1.1";

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exitCode = 1;
    throw new Error(msg);
  }
  console.log(`ok: ${msg}`);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const input = () => page.getByLabel("IOC to check");

async function runCheck(value) {
  await input().fill(value);
  await page.getByRole("button", { name: "Check" }).click();
  // The results panel renders a "risk" readout once the lookup completes.
  await page
    .getByText("risk", { exact: false })
    .first()
    .waitFor({ timeout: 45000 });
}

try {
  await page.goto(BASE, { waitUntil: "networkidle" });

  await runCheck(A);
  await page.waitForURL(`**/check/${A}`);
  await runCheck(B);
  await page.waitForURL(`**/check/${B}`);

  // Back -> A restores in the URL, the box, AND the results.
  await page.goBack();
  await page.waitForURL(`**/check/${A}`);
  assert((await input().inputValue()) === A, `box shows ${A} after Back`);
  assert((await page.content()).includes(A), `results mention ${A} after Back`);

  // Forward -> B restores.
  await page.goForward();
  await page.waitForURL(`**/check/${B}`);
  assert((await input().inputValue()) === B, `box shows ${B} after Forward`);

  // Back to A, then Back again -> home, empty box.
  await page.goBack();
  await page.waitForURL(`**/check/${A}`);
  await page.goBack();
  await page.waitForURL((url) => url.pathname === "/");
  assert((await input().inputValue()) === "", "box cleared at home after Back");

  console.log("\nback/forward walk passed");
} finally {
  await browser.close();
}
```

- [ ] **Step 2: Run the walk against the running dev server**

Make sure `npm run dev` is running on `http://localhost:3000` (the user runs their own server — do **not** start a second one or kill theirs). Then:

Run: `node scripts/back-forward.mjs`
Expected output ends with `back/forward walk passed` and a zero exit code; every `ok:` line prints and no `FAIL:` line appears.

- [ ] **Step 3: Manual spot-check (cache-hit = no network)**

In the browser at `http://localhost:3000`, open DevTools → Network. Check `8.8.8.8`, then `1.1.1.1`, then press Back. Confirm:
- the search box reads `8.8.8.8` and the results show `8.8.8.8`;
- **no** new `POST /api/check` request fires on Back (cache hit), and the streaming progress UI does **not** reappear;
- pressing Forward returns to `1.1.1.1`;
- pressing Back again returns to the empty home state.

If you cannot run the browser, say so explicitly rather than claiming this step passed.

- [ ] **Step 4: Final verification**

Run: `npm run lint && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/back-forward.mjs
git commit -m "test(checker): Playwright Back/Forward history-walk"
```

---

## Self-Review

**Spec coverage** (each spec requirement → task):
- Box/mode/results follow the URL on Back/Forward → Task 3 (`popstate` handler).
- Instant restore via in-memory cache → Task 2 (refs + write + seed), Task 3 (read).
- Re-fetch on cache miss → Task 3 (`runCheckRef.current(ioc)` miss branch).
- Back to `/` clears to empty state → Task 3 (`ioc === null` branch).
- Keep scroll-to-top on popstate → Task 3 (retained `scrollTo` + `scrollRestoration`).
- Cancel in-flight lookup without an error toast → Task 2 (`NAV_ABORT` suppression + `finally` guard), Task 3 (`abort(NAV_ABORT)`).
- Canonical key consistency (write vs read) → Task 2 writes `canonical`; Task 1's `iocFromPath` decodes the same segment the URL was built from; seed uses `initialQuery` (== decoded URL segment).
- Unit test for `iocFromPath` → Task 1; Playwright walk → Task 4.

**Placeholder scan:** none — every code step shows complete code; no TBD/TODO/"handle edge cases".

**Type/name consistency:** `iocFromPath` (Task 1) imported/used identically in Task 3; `NAV_ABORT` defined (Task 2 Step 1) and used in Task 2 Step 6 + Task 3 Step 2; `resultsCache`/`abortRef` defined (Task 2 Step 2) and read in Task 3; the cache value type matches the `result` state union `CheckResult | DomainCheckResult | HashCheckResult`; `canonical` is the in-scope variable in `runCheck` used as the write key.

**Concurrency check:** the `finally` guard (`abortRef.current === controller`) prevents a superseded (navigation-aborted) lookup from nulling a newer lookup's controller or stomping its `loading`/`progress`; the per-controller `signal.reason === NAV_ABORT` check avoids the cross-lookup race a shared boolean flag would introduce.
