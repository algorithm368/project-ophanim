# Loading UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a lookup show its shell instantly, fill in evidence as each source answers, and withhold the score until every source is counted.

**Architecture:** Three layers that ship independently. Layer 1 moves the Redis read behind a Suspense boundary so first paint never waits on it. Layer 2 renders the result shell from the first frame and fills it from settled sources, with a pure `lib/ti/partial.ts` that cannot emit a score. Layer 3 tightens the scan page's poll interval and reserves the space cards will occupy.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4, Vitest, Bun.

## Global Constraints

- **Verdicts:** Nothing derived from `aggregateRisk()` may render before the lookup completes. That means `riskScore`, `verdict`, `scoreBreakdown`, confidence, rationale, threat type, and the borderline flag.
- **Counts:** A count shown mid-stream never appears without its denominator. `4 / 9 answered` and `9 still out`, never a bare `4`.
- **Copy style:** user-facing text uses commas, never em-dashes, en-dashes, or `" - "` separators.
- **Tests:** only files under `lib/` are in the coverage scope (`vitest.config.ts` `include: ["lib/**/*.ts"]`, and `sonar.coverage.exclusions` drops `app/**`, `components/**`, `scripts/**`). Every new `lib/` file needs tests in the same commit. Component work is verified in a browser instead.
- **Test command:** `bun run test`, never `bun test` (the latter runs Bun's own runner, which does not understand the Vitest API).
- **Before any commit:** `bun run test && bun run lint && bun run typecheck` must all pass. `.githooks/pre-commit` autofixes and re-stages, then lints.
- **Lint rules that are errors:** `sonarjs/cognitive-complexity` (limit 15) and `no-nested-ternary`.
- **Never touch port 3000.** The developer runs their own `next dev` there. Use `-p 3001` for any verification server.

## Browser verification recipe

Several tasks end with a browser check. This is the procedure they mean; it is
written once here rather than five times below.

The app sits behind a Google sign-in limited to one Workspace domain, and the
machine may have no display (check with `echo $XDG_SESSION_TYPE`; `tty` means
no GUI, so there is no window to log in from). Mint a session cookie instead:
the gate reads a signed JWT and does not care how the cookie was obtained.

```bash
bun run build
AUTH_TRUST_HOST=true bun run start -- -p 3001 &
```

Write `_shot.mjs` **in the repo root**. Node resolves `node_modules` from the
script's own directory, so it cannot live in `/tmp`.

```js
import { chromium } from "playwright";
import { encode } from "next-auth/jwt";
const COOKIE = "authjs.session-token";
const token = await encode({
  token: { name: "Local Preview", email: "preview@local", sub: "preview" },
  secret: process.env.AUTH_SECRET, salt: COOKIE, maxAge: 3600,
});
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 1400 } });
await ctx.addCookies([{ name: COOKIE, value: token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" }]);
const p = await ctx.newPage();
p.on("pageerror", (e) => console.error("PAGE ERROR", String(e)));
await p.goto(`http://127.0.0.1:3001${process.argv[2]}`, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(Number(process.argv[3] ?? 2000));
await p.screenshot({ path: "/tmp/shot.png", fullPage: true });
console.log("url:", p.url(), "title:", await p.title());
await b.close();
```

Run it as `set -a; . ./.env.local; set +a; node ./_shot.mjs /check/1.1.1.1 2000`.
If `url:` shows `/sign-in`, the cookie did not take. If the title carries a
verdict, the result came from cache and the streaming path never ran, so pick a
different indicator.

Afterward: delete `_shot.mjs`, and stop only the server you started
(`ss -tlnp | grep :3001` for its pid). Never kill anything on port 3000.

**Playwright needs a browser once per fresh install:** `bunx playwright install chromium`.

---

## File Structure

**Created**

| File | Responsibility |
| --- | --- |
| `lib/ti/partial.ts` | Pure. Turns settled sources into showable counts and merged context. Carries no score or verdict, by type. |
| `lib/ti/partial.test.ts` | Tests for the above, including that no score key can appear. |
| `lib/scan-poll.ts` | Pure. Maps a scan's age to its next poll interval. |
| `lib/scan-poll.test.ts` | Tests for the above. |
| `components/result-skeleton.tsx` | The inert shell. One component, used by both `loading.tsx` files and both Suspense fallbacks. |
| `app/check/[ioc]/loading.tsx` | Instant state for the passive permalink. |
| `app/scan/[indicator]/loading.tsx` | Instant state for the scan permalink. |
| `components/CheckResults/pending.tsx` | The verdict hero in its streaming state. |

**Modified**

| File | Change |
| --- | --- |
| `app/check/[ioc]/page.tsx` | Move `await fetchCached` into an async child wrapped in `Suspense`. |
| `app/scan/[indicator]/page.tsx` | Same for `getCachedScanBatch`. |
| `components/CheckResults/verdict.tsx` | Add the permanent one-line dot strip under the meter. |
| `components/CheckResults/index.tsx` | Accept a nullable `result` plus a `partial`, render `SectionNav` in both phases. |
| `components/Checker.tsx` | Stop gating `CheckResults` on completion; pass `partial` and `phase`. |
| `components/CheckResults/research.tsx` | Empty-state branch respects `streaming`. |
| `components/CheckResults/sources.tsx` | Same. |
| `components/CheckResults/profile.tsx` | Same. |
| `components/ScanReport/index.tsx` | Adaptive poll interval, plus a progress readout. |

---

# Phase 1, Layer 1: first paint never waits on Redis

Ships on its own. After this phase, clicking a permalink paints immediately even though the result still arrives in a lump.

### Task 1: The shared shell skeleton

The same component backs `loading.tsx` (which, per
`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md`,
"Loading UI components do not accept any parameters") and the in-page Suspense
fallback, which can pass the indicator. Two hand-maintained skeletons drift, and
a skeleton that no longer matches its page is worse than none.

It also draws a placeholder for the `SectionNav` rail. The rail renders only
with results today, so the content column slides sideways when the result lands.
Reserving vertical space while letting the column jump horizontally fixes the
smaller half of the problem.

**Files:**
- Create: `components/result-skeleton.tsx`

**Interfaces:**
- Produces: `ResultSkeleton({ indicator }: { indicator?: string })`, a default-exportless named React component.

- [ ] **Step 1: Write the component**

```tsx
/**
 * The inert shell a route shows before its cached result has been read.
 *
 * Inert is the point. An earlier draft used `<Checker>` itself as the
 * fallback, which starts a live lookup the moment it mounts with an
 * `initialQuery` and no `initialResult`: the request would then be thrown away
 * when the cached result arrived, turning one navigation into two lookups.
 *
 * The left rail is a placeholder for `SectionNav`, which renders only once
 * there are results. Without it here the whole content column shifts sideways
 * at the moment the result lands.
 */
export function ResultSkeleton({
  indicator,
}: Readonly<{ indicator?: string }>) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="flex gap-4">
        {/* Reserves the SectionNav rail's width so the column never moves. */}
        <div aria-hidden className="hidden w-14 shrink-0 lg:block" />

        <div className="min-w-0 flex-1">
          {/* Search box */}
          <div className="sweep h-12 w-full rounded-lg" />

          <div className="mt-5 rounded-lg border border-foreground/12 p-4">
            {indicator ? (
              <p className="font-mono text-lg break-all text-foreground">
                {indicator}
              </p>
            ) : (
              <div className="sweep h-6 w-56 rounded" />
            )}
            <div className="sweep mt-3 h-1.5 w-full rounded-full" />
            <div className="sweep mt-4 h-3 w-11/12 rounded" />
            <div className="sweep mt-2 h-3 w-3/4 rounded" />
          </div>

          <div className="mt-5 rounded-lg border border-foreground/12 p-4">
            <div className="sweep h-3 w-24 rounded" />
            <div className="sweep mt-4 h-3 w-2/3 rounded" />
            <div className="sweep mt-2 h-3 w-1/2 rounded" />
          </div>
        </div>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        Loading {indicator ?? "the indicator"}.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles and lints**

Run: `bun run typecheck && bun run lint`
Expected: both exit 0 with no output beyond the command echo.

- [ ] **Step 3: Commit**

```bash
git add components/result-skeleton.tsx
git commit -m "feat(ui): one inert shell for both loading states"
```

### Task 2: Put the passive permalink's Redis read behind Suspense

`page.tsx` awaits `params` only, which is cheap, and returns the shell at once.
`generateMetadata` is not a factor: streaming metadata is on by default, so it
does not block the initial UI for ordinary browsers.

**Files:**
- Create: `app/check/[ioc]/loading.tsx`
- Modify: `app/check/[ioc]/page.tsx:76-91` (the `CheckPage` component only; leave `fetchCached` and `generateMetadata` exactly as they are)

**Interfaces:**
- Consumes: `ResultSkeleton({ indicator })` from Task 1.

- [ ] **Step 1: Write the route's instant state**

Create `app/check/[ioc]/loading.tsx`:

```tsx
import { ResultSkeleton } from "@/components/result-skeleton";

/** Shown from the click until the server responds. Prefetched by the router,
 *  so it appears even while the function is still cold. It cannot name the
 *  indicator: loading UI components accept no parameters. */
export default function Loading() {
  return (
    <main className="relative min-h-full">
      <ResultSkeleton />
    </main>
  );
}
```

- [ ] **Step 2: Move the cache read into a Suspense child**

In `app/check/[ioc]/page.tsx`, add `Suspense` to the React import at line 2 and
replace the `CheckPage` function at lines 76 to 91 with:

```tsx
/** The half that waits on Redis. Split out so the page itself can return
 *  without awaiting it, which is what lets the shell paint first. */
async function CachedChecker({ decoded }: Readonly<{ decoded: string }>) {
  const initialResult = await fetchCached(decoded);
  return (
    <Checker
      key={decoded}
      initialQuery={decoded}
      initialResult={initialResult}
    />
  );
}

export default async function CheckPage({ params }: Readonly<PageProps>) {
  const { ioc } = await params;
  const decoded = decodeURIComponent(ioc);
  // Only `params` is awaited here. The cache read happens inside the boundary
  // below, so the shell reaches the browser without waiting on Redis. A cached
  // permalink still renders its result server-side; an uncached one falls
  // through to the live streaming lookup in Checker.
  return (
    <main className="relative min-h-full">
      <Suspense fallback={<ResultSkeleton indicator={decoded} />}>
        <CachedChecker decoded={decoded} />
      </Suspense>
    </main>
  );
}
```

Line 2 becomes:

```tsx
import { cache, Suspense } from "react";
```

And add to the imports:

```tsx
import { ResultSkeleton } from "@/components/result-skeleton";
```

- [ ] **Step 3: Verify the whole suite still passes**

Run: `bun run test && bun run lint && bun run typecheck`
Expected: 1224+ tests pass, lint and typecheck silent.

- [ ] **Step 4: Verify in a browser**

Follow the **Browser verification recipe** near the top of this plan, with
`node ./_shot.mjs /check/1.1.1.1 300`. The 300ms delay is the point: the
screenshot has to catch the moment before the cached result resolves. Confirm
`/tmp/shot.png` shows the skeleton shell, with the indicator named, rather than
a blank page or the previous route.

If you cannot run a browser here, say so in the commit message rather than
implying it was checked.

- [ ] **Step 5: Commit**

```bash
git add "app/check/[ioc]/loading.tsx" "app/check/[ioc]/page.tsx"
git commit -m "perf(ui): paint the check permalink before Redis answers"
```

### Task 3: The same for the scan permalink

**Files:**
- Create: `app/scan/[indicator]/loading.tsx`
- Modify: `app/scan/[indicator]/page.tsx` (the `ScanPage` component, from the `const initialBatch = await getCachedScanBatch(decoded);` line onward)

**Interfaces:**
- Consumes: `ResultSkeleton({ indicator })` from Task 1.

- [ ] **Step 1: Write the route's instant state**

Create `app/scan/[indicator]/loading.tsx`:

```tsx
import { ResultSkeleton } from "@/components/result-skeleton";

/** Shown from the click until the server responds. See the note in
 *  app/check/[ioc]/loading.tsx: this file cannot name the indicator. */
export default function Loading() {
  return (
    <main className="relative min-h-full">
      <ResultSkeleton />
    </main>
  );
}
```

- [ ] **Step 2: Move the batch read into a Suspense child**

The early return for a hash or an unparseable indicator stays exactly where it
is, above the boundary: it does not touch Redis and must not be delayed.

Replace everything from `const initialBatch = await getCachedScanBatch(decoded);`
to the end of `ScanPage` with:

```tsx
/** The half that waits on Redis, so the page itself need not. */
async function CachedScanReport({
  decoded,
  kind,
}: Readonly<{ decoded: string; kind: IOCType }>) {
  const initialBatch = await getCachedScanBatch(decoded);
  return (
    <ScanReport indicator={decoded} kind={kind} initialBatch={initialBatch} />
  );
}
```

and, in `ScanPage`, the final return becomes:

```tsx
  return (
    // Same container as Checker on /check, so the scan page and the result page
    // are the same width and the banner rule lines up across both.
    <main className="mx-auto w-full max-w-5xl px-4 py-6">
      <Suspense fallback={<ResultSkeleton indicator={decoded} />}>
        <CachedScanReport decoded={decoded} kind={kind} />
      </Suspense>
    </main>
  );
```

Add these imports at the top of the file:

```tsx
import { Suspense } from "react";
import { ResultSkeleton } from "@/components/result-skeleton";
```

`IOCType` is already imported via `detectIOC`'s module; if TypeScript reports it
missing, add `import type { IOCType } from "@/lib/ioc";`.

- [ ] **Step 3: Verify**

Run: `bun run test && bun run lint && bun run typecheck`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add "app/scan/[indicator]/loading.tsx" "app/scan/[indicator]/page.tsx"
git commit -m "perf(ui): paint the scan permalink before Redis answers"
```

---

# Phase 2, Layer 2: evidence flows, the score does not

### Task 4: The partial lookup, pure and unable to leak a score

This is the load-bearing unit and the only one in the coverage scope, so it is
written test-first. The rule from the spec is enforced by the type rather than
by every call site remembering it: `PartialLookup` simply has no field to put a
score in.

Counting matches `consensusBuckets` in `lib/ti/narrative.ts:725` so the numbers
do not contradict each other across the two phases: only weighted sources count
as detectors, and "adverse" means `malicious === true` or a score above zero,
which is broader than "flagged".

**Files:**
- Create: `lib/ti/partial.ts`
- Test: `lib/ti/partial.test.ts`

**Interfaces:**
- Consumes: `mergeFields` from `lib/ti/orchestrate.ts`, `SourceResult` and `GeoContext` from `lib/ti/types.ts`.
- Produces:
  - `interface PartialCounts { total: number; settled: number; answered: number; adverse: number; clean: number; gaps: number; stillOut: number }`
  - `interface PartialLookup { counts: PartialCounts; sources: SourceResult[]; geo?: GeoContext }`
  - `function buildPartial(total: number, settled: SourceResult[]): PartialLookup`

- [ ] **Step 1: Write the failing tests**

Create `lib/ti/partial.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildPartial } from "@/lib/ti/partial";
import type { SourceResult } from "@/lib/ti/types";

/** A settled source, shaped like the ones runSource() returns. */
function src(
  id: string,
  over: Partial<SourceResult> & { weight?: number } = {},
): SourceResult {
  const { weight = 1, ...rest } = over;
  return {
    source: { id, name: id, weight },
    status: "ok",
    ...rest,
  } as SourceResult;
}

describe("buildPartial", () => {
  it("counts detectors, adverse and clean off the settled sources", () => {
    const p = buildPartial(10, [
      src("a", { score: 80 }),
      src("b", { score: 0 }),
      src("c", { malicious: true }),
      src("d", { score: 0 }),
    ]);
    expect(p.counts.total).toBe(10);
    expect(p.counts.settled).toBe(4);
    expect(p.counts.answered).toBe(4);
    expect(p.counts.adverse).toBe(2);
    expect(p.counts.clean).toBe(2);
    expect(p.counts.stillOut).toBe(6);
  });

  // Matches consensusBuckets: a Spamhaus ZEN listing scores 38, under the
  // flagging threshold of 40, and is still evidence against the indicator.
  it("counts any score above zero as adverse, not just flagged ones", () => {
    const p = buildPartial(2, [src("zen", { score: 38 })]);
    expect(p.counts.adverse).toBe(1);
    expect(p.counts.clean).toBe(0);
  });

  // Context-only sources (weight 0, e.g. geolocation) cannot flag, so counting
  // them as detectors would disagree with the completed strip.
  it("ignores context-only sources when counting detectors", () => {
    const p = buildPartial(5, [
      src("geo", { weight: 0, score: 0 }),
      src("abuse", { score: 90 }),
    ]);
    expect(p.counts.answered).toBe(1);
    expect(p.counts.adverse).toBe(1);
  });

  // VirusTotal's 404 path returns `{ status: "ok" }` with no score at weight 1,
  // and its own comment says that is not a clean result. Counting it as clean
  // here would make the streaming strip say "3 clean" and the completed strip
  // say "2 clean, 1 no record" for the same lookup.
  it("separates a source with no record from one that found nothing wrong", () => {
    const p = buildPartial(4, [
      src("vt", {}), // status ok, no score at all
      src("otx", { score: 0 }),
      src("abuse", { score: 70 }),
    ]);
    expect(p.counts.noRecord).toBe(1);
    expect(p.counts.clean).toBe(1);
    expect(p.counts.adverse).toBe(1);
    expect(p.counts.answered).toBe(3);
  });

  it("collects every way of not answering into gaps", () => {
    const p = buildPartial(6, [
      src("a", { status: "error" }),
      src("b", { status: "timeout" }),
      src("c", { status: "rate_limited" }),
      src("d", { status: "skipped" }),
      src("e", { score: 0 }),
    ]);
    expect(p.counts.gaps).toBe(4);
    expect(p.counts.answered).toBe(1);
  });

  it("never reports a negative outstanding count", () => {
    const p = buildPartial(1, [src("a"), src("b"), src("c")]);
    expect(p.counts.stillOut).toBe(0);
  });

  it("merges context first-non-empty across settled sources", () => {
    const p = buildPartial(3, [
      src("a", { geo: { country: "", city: "Berlin" } } as Partial<SourceResult>),
      src("b", { geo: { country: "Germany", city: "Munich" } } as Partial<SourceResult>),
    ]);
    expect(p.geo?.city).toBe("Berlin");
    expect(p.geo?.country).toBe("Germany");
  });

  // The whole point of the type. A score shown mid-stream can be wrong, and
  // this is a threat-intel tool where people act on what they read.
  it("carries no score, verdict or breakdown, whatever the sources said", () => {
    const p = buildPartial(2, [src("a", { score: 99, malicious: true })]);
    const keys = Object.keys(p);
    expect(keys).not.toContain("riskScore");
    expect(keys).not.toContain("verdict");
    expect(keys).not.toContain("scoreBreakdown");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test lib/ti/partial.test.ts`
Expected: FAIL, "Failed to resolve import ... lib/ti/partial".

- [ ] **Step 3: Write the implementation**

Create `lib/ti/partial.ts`:

```ts
import { mergeFields } from "./orchestrate";
import type { GeoContext, SourceResult } from "./types";

/**
 * What a half-finished lookup is allowed to say about itself.
 *
 * Every field here is something one source observed or a tally of who has
 * answered. Nothing here needs the whole panel, which is the line the spec
 * draws: a count is honest while incomplete, a score is not.
 */
export interface PartialCounts {
  /** Size of the panel, from the stream's `start` event. */
  total: number;
  /** Sources that have come back, whatever they said. */
  settled: number;
  /** Settled weighted sources that actually returned an assessment. */
  answered: number;
  /** Answered sources with something adverse to say. */
  adverse: number;
  /** Answered sources that have no record of this indicator at all. Kept apart
   *  from `clean`, because "we have never seen this file" and "we looked and it
   *  is fine" are different answers and an analyst treats them differently.
   *  VirusTotal's 404 path is exactly this: `{ status: "ok" }` with no score. */
  noRecord: number;
  /** Answered sources that looked and found nothing wrong. */
  clean: number;
  /** Settled weighted sources that could not answer at all. */
  gaps: number;
  /** How many are still out. Never negative. */
  stillOut: number;
}

/**
 * A lookup in progress.
 *
 * There is deliberately no `riskScore`, `verdict` or `scoreBreakdown` field.
 * The withholding rule is then enforced by the compiler rather than by every
 * call site remembering it, which is the difference between a rule and a hope.
 */
export interface PartialLookup {
  counts: PartialCounts;
  /** The settled sources themselves, for the per-source rows. */
  sources: SourceResult[];
  /** First-non-empty merge of whatever geolocation has arrived. */
  geo?: GeoContext;
}

/** Adverse means "reported something against this indicator", which is broader
 *  than "cleared the flagging threshold". Kept identical to consensusBuckets()
 *  so the streaming and completed numbers cannot disagree. */
function isAdverse(s: SourceResult): boolean {
  return s.malicious === true || (s.score ?? 0) > 0;
}

/** No score at all means the source has no record of this indicator, which is
 *  not the same as having looked and found it clean. Same predicate as
 *  consensusBuckets(), for the same reason. */
function isNoRecord(s: SourceResult): boolean {
  return s.score === undefined && s.malicious !== true;
}

export function buildPartial(
  total: number,
  settled: SourceResult[],
): PartialLookup {
  // Context-only sources (weight 0) cannot flag anything, so they are not
  // detectors. Counting them here would disagree with the completed strip.
  const scoring = settled.filter((s) => (s.source.weight ?? 1) > 0);
  const answered = scoring.filter((s) => s.status === "ok");
  const adverse = answered.filter(isAdverse).length;
  const noRecord = answered.filter(isNoRecord).length;

  const geo = mergeFields(
    settled
      .map((s) => s.geo)
      .filter((g): g is GeoContext => g !== undefined && g !== null),
  );

  return {
    counts: {
      total,
      settled: settled.length,
      answered: answered.length,
      adverse,
      noRecord,
      // Same arithmetic as consensusBuckets(), floor included: a source with no
      // record is neither adverse nor clean, and lumping it into clean would
      // make the streaming strip disagree with the completed one.
      clean: Math.max(0, answered.length - adverse - noRecord),
      gaps: scoring.length - answered.length,
      stillOut: Math.max(0, total - settled.length),
    },
    sources: settled,
    ...(geo ? { geo } : {}),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test lib/ti/partial.test.ts`
Expected: PASS, 7 tests.

If the `geo` merge test fails on types, check `GeoContext` in `lib/ti/types.ts` and
adjust the test fixture's field names to real ones; do not loosen the
implementation to accommodate a wrong fixture.

- [ ] **Step 5: Confirm coverage of the new file**

Run: `node scripts/new-coverage.mjs`
Expected: 100% of new lines in `lib/`. The PR gate floor is 80%.

- [ ] **Step 6: Commit**

```bash
git add lib/ti/partial.ts lib/ti/partial.test.ts
git commit -m "feat(ti): let a half-finished lookup say what it knows, and nothing more"
```

### Task 5: The verdict hero's streaming state

The risk meter and the progress bar are the same element. `VerdictHero` already
draws an `h-1.5 rounded-full` meter whose fill is the score; streaming fills the
same bar by progress instead. There is no second bar and nothing to swap.

The threat-type slot is held from the first frame. The verdict word is not what
makes the row jump, the words vary in length anyway (`CLEAN` against
`SUSPICIOUS`), what reflows the row is `· ANONYMIZER` arriving at the end.

**Files:**
- Create: `components/CheckResults/pending.tsx`

**Interfaces:**
- Consumes: `PartialLookup` from `lib/ti/partial.ts` (Task 4).
- Produces: `PendingHero({ indicator, partial }: { indicator: string; partial: PartialLookup })`.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { Clock } from "lucide-react";
import type { PartialLookup } from "@/lib/ti/partial";
import { Card, CardContent } from "@/components/ui/card";
import { SourceDots } from "./verdict";

/**
 * The hero while the panel is still answering.
 *
 * It occupies the same slots the completed hero does, so completion changes
 * the contents of the card and never its shape: the verdict word replaces
 * "ANALYZING", the meter's fill switches from progress to score, and the held
 * threat slot receives the threat type.
 *
 * Counts never appear without their denominator. Five of twenty-seven sources
 * in, three of them adverse, reads as "3 adverse" to anyone glancing at it,
 * which is alarming; the same three out of a finished twenty-seven is mild.
 */
export function PendingHero({
  indicator,
  partial,
}: Readonly<{ indicator: string; partial: PartialLookup }>) {
  const c = partial.counts;
  const pct = c.total > 0 ? Math.round((c.settled / c.total) * 100) : 0;

  return (
    <Card className="sketch-shadow rounded-lg border border-foreground/12">
      <CardContent className="space-y-4">
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono text-2xl font-bold leading-none tracking-tight uppercase text-muted-foreground sm:text-3xl">
                Analyzing
              </span>
              {/* Held for the threat type, which is what actually reflows this
                  row when it arrives. */}
              <span className="inline-flex h-4 min-w-[6.5rem] items-center">
                <span className="sweep h-2.5 w-full rounded" />
              </span>
            </span>
            <span className="font-mono font-bold uppercase leading-none text-muted-foreground">
              <span className="text-2xl sm:text-3xl tabular-nums">
                {c.settled}
                <span className="text-base">/{c.total || "…"}</span>
              </span>
              <span className="text-base font-medium"> sources</span>
            </span>
          </div>

          {/* The same meter the score will fill. */}
          <div
            role="progressbar"
            aria-label="Threat-intel sources checked"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={c.total > 0 ? pct : undefined}
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-foreground transition-[width] duration-200 ease-linear"
              style={{ width: `${Math.max(pct, 3)}%` }}
            />
          </div>

          <SourceDots sources={partial.sources} total={c.total} />
        </div>

        {/* Where the narrative will land. */}
        <div className="space-y-2">
          <div className="sweep h-3 w-11/12 rounded" />
          <div className="sweep h-3 w-2/3 rounded" />
        </div>

        <dl className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-x-4 gap-y-3 border-t border-foreground/12 pt-3">
          <Cell label="Confidence">
            <span className="sweep inline-block h-3 w-14 rounded align-middle" />
          </Cell>
          <Cell label="Detectors">
            {c.answered}{" "}
            <span className="text-muted-foreground">of {c.total || "…"}</span>
          </Cell>
          <Cell label="Adverse" wide>
            {c.adverse}{" "}
            <span className="text-muted-foreground">
              / {c.answered} answered
            </span>
          </Cell>
          <Cell label="Clean" wide>
            {c.clean}{" "}
            <span className="text-muted-foreground">
              / {c.answered} answered
            </span>
          </Cell>
          {c.gaps > 0 && <Cell label="Gaps">{c.gaps}</Cell>}
          <Cell label="Still out" emphatic>
            {c.stillOut}
          </Cell>
        </dl>

        <div className="font-mono text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="size-3" />
            verdict pending, {c.settled} of {c.total || "…"} in
          </span>
        </div>

        <p className="sr-only" role="status" aria-live="polite">
          {c.settled} of {c.total} sources checked for {indicator}. Verdict
          pending.
        </p>
      </CardContent>
    </Card>
  );
}

/** One cell of the strip, matching the completed hero's dt/dd shape. */
function Cell({
  label,
  children,
  wide,
  emphatic,
}: Readonly<{
  label: string;
  children: React.ReactNode;
  wide?: boolean;
  emphatic?: boolean;
}>) {
  return (
    <div className={wide ? "col-span-2 min-w-0" : "min-w-0"}>
      <dt className="font-mono text-[10px] uppercase leading-none tracking-[0.14em] text-muted-foreground">
        {label}
      </dt>
      <dd
        className={`mt-1.5 font-mono text-[13px] leading-snug break-words text-foreground${
          emphatic ? " font-bold" : ""
        }`}
      >
        {children}
      </dd>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `bun run typecheck`
Expected: one error, `SourceDots` is not exported from `./verdict`. Task 6 adds
it. Do not commit this task alone; complete Task 6 and commit both together.

### Task 6: The permanent one-line dot strip

Which sources have answered is the most wanted thing on screen while waiting,
and `SourceBreakdown` sits at the bottom of the page where it cannot serve that.
Moving it up while streaming and back down at the end would violate the rule
against shifting content, so the strip lives under the meter in *both* phases
and nothing moves. It does not duplicate `SourceBreakdown`, which carries
per-source scores and summaries rather than liveness.

**Files:**
- Modify: `components/CheckResults/verdict.tsx` (add `SourceDots`, and render it under the meter in `VerdictShell`)

**Interfaces:**
- Produces: `export function SourceDots({ sources, total }: { sources: SourceResult[]; total: number })`, consumed by Task 5.

- [ ] **Step 1: Add the component to verdict.tsx**

Add near the other small helpers, and export it:

```tsx
/**
 * One dot per source, on one line, under the meter.
 *
 * Present in both phases on purpose. While streaming it is the liveness
 * readout; once complete it is a glanceable health overview, and because it
 * never appears or disappears, nothing on the page moves when the result
 * lands. Hover names the source.
 */
export function SourceDots({
  sources,
  total,
}: Readonly<{ sources: SourceResult[]; total: number }>) {
  // Placeholders for sources still out, so the strip is its final width from
  // the first frame rather than growing a dot at a time.
  const pending = Math.max(0, total - sources.length);

  return (
    <div className="flex flex-wrap gap-1" aria-hidden>
      {sources.map((s) => (
        <span
          key={s.source.id}
          title={s.source.name}
          className={cn("size-1.5 rounded-full", dotTone(s))}
        />
      ))}
      {Array.from({ length: pending }, (_, i) => (
        <span
          key={`pending-${i}`}
          className="size-1.5 animate-pulse rounded-full bg-foreground/15"
        />
      ))}
    </div>
  );
}

/** The same three readings the progress list uses: adverse, gap, clean. */
function dotTone(s: SourceResult): string {
  if (s.status === "ok" && (s.malicious === true || (s.score ?? 0) > 0)) {
    return "bg-red-600 dark:bg-red-400";
  }
  if (s.status !== "ok") return "bg-amber-500";
  return "bg-emerald-600 dark:bg-emerald-400";
}
```

`cn` and `SourceResult` are already imported in this file; confirm before adding
duplicate imports.

- [ ] **Step 2: Render it in the completed hero**

In `VerdictShell`, immediately after the closing `</div>` of the `role="meter"`
element, add:

```tsx
<SourceDots sources={result.sources} total={result.sources.length} />
```

- [ ] **Step 3: Verify**

Run: `bun run test && bun run lint && bun run typecheck`
Expected: all pass, and the `SourceDots` error from Task 5 is gone.

- [ ] **Step 4: Commit both tasks**

```bash
git add components/CheckResults/pending.tsx components/CheckResults/verdict.tsx
git commit -m "feat(ui): a hero that can say it is still working, and a strip that never moves"
```

### Task 7: Render the result shell from the first frame, for IP

The swap this removes is `components/Checker.tsx:1011`, where `!loading &&
result` throws the progress card away and mounts a full page of results in its
place.

Scope this task to the IP path only. Domain, hash and URL follow in Task 8, and
keeping them separate means a reviewer can reject one without the other.

**Files:**
- Modify: `components/CheckResults/index.tsx` (the `Results` component for `CheckResult`, and the dispatcher)
- Modify: `components/Checker.tsx:1001-1018`

**Interfaces:**
- Consumes: `buildPartial` (Task 4), `PendingHero` (Task 5).
- Produces: `CheckResults` accepts `result: AnyCheckResult | UrlCheckResult | null`, `partial: PartialLookup | null`, `indicator: string`, and `kind: IOCType | "url"`.

- [ ] **Step 1: Give the dispatcher a way to choose without a result**

The dispatcher at the bottom of `components/CheckResults/index.tsx` picks the
per-type component with type guards on `result`. While streaming there is no
result to guard on, so the caller has to say which type it is. Replace the
dispatcher with:

```tsx
export default function CheckResults({
    result,
    partial,
    indicator,
    kind,
    onRefresh,
    onPivot,
    research,
}: Readonly<{
    result: AnyCheckResult | UrlCheckResult | null;
    /** Set while the panel is still answering; null once `result` arrives. */
    partial: PartialLookup | null;
    indicator: string;
    /** Which per-type view to render. Needed because the type guards below
     *  have nothing to read while `result` is still null. */
    kind: IOCType | "url";
    onRefresh: () => void;
    /** Launch a fresh check for a related indicator clicked within the result. */
    onPivot?: (value: string) => void;
    /** Progressive live-research state, fetched in parallel with the main check. */
    research: ResearchStreamState;
}>) {
    // A URL result is checked first: it is the most specific shape, and the
    // other guards would not recognize it. The guards still run when a result
    // is present, so a mismatched `kind` cannot render the wrong view.
    //
    // An if/else ladder rather than chained ternaries: `no-nested-ternary` is
    // an error in this project, not a warning.
    let shape: IOCType | "url";
    if (result === null) shape = kind;
    else if (isUrlResult(result)) shape = "url";
    else if (isHashResult(result)) shape = "hash";
    else if (isDomainResult(result)) shape = "domain";
    else shape = "ip";

    const common = { partial, indicator, onRefresh, research };
    let body: React.ReactNode;
    if (shape === "url") {
        body = <UrlResults result={result as UrlCheckResult | null} {...common} />;
    } else if (shape === "hash") {
        body = <HashResults result={result as HashCheckResult | null} {...common} />;
    } else if (shape === "domain") {
        body = <DomainResults result={result as DomainCheckResult | null} {...common} />;
    } else {
        body = <Results result={result as CheckResult | null} {...common} />;
    }
    return (
        <PivotContext.Provider value={onPivot ?? null}>
            {body}
        </PivotContext.Provider>
    );
}
```

Add the imports:

```tsx
import type { IOCType } from "@/lib/ioc";
import type { PartialLookup } from "@/lib/ti/partial";
import { PendingHero } from "./pending";
```

- [ ] **Step 2: Teach the IP Results component both phases**

In `components/CheckResults/index.tsx`, change the IP `Results` signature to
accept a nullable result plus the partial, and render `PendingHero` in place of
`VerdictHero` while streaming. `SectionNav` renders in both phases so the rail,
and therefore the content column's left edge, never moves:

```tsx
function Results({
    result,
    partial,
    indicator,
    onRefresh,
    research,
}: Readonly<{
    result: CheckResult | null;
    partial: PartialLookup | null;
    indicator: string;
    onRefresh: () => void;
    research: ResearchStreamState;
}>) {
    const streaming = result === null;
    return (
        <div className="mt-5 space-y-5">
            {result && <SourceHealthNotice result={result} />}
            {result ? (
                <VerdictHero result={result} onRefresh={onRefresh} />
            ) : (
                partial && <PendingHero indicator={indicator} partial={partial} />
            )}
            {/* Rendered in both phases: it draws the left rail, and a rail that
                appears only with results slides the whole column sideways. */}
            <SectionNav items={IP_SECTIONS} />
            <Section id="dossier">
                <IpDossierCard result={result} streaming={streaming} />
            </Section>
            <Section id="dns">
                <PassiveDnsCard result={result} streaming={streaming} />
            </Section>
            <Section id="related">
                <ConnectionsCard result={result} streaming={streaming} />
            </Section>
            <Section id="research">
                <ResearchCard result={result} research={research} streaming={streaming} />
            </Section>
            <Section id="scan">
                {/* Takes an indicator, not a result: it reports whether a scan
                    already exists, which does not depend on this lookup. */}
                <ActiveScanCard indicator={indicator} kind="ip" />
            </Section>
            <Section id="sources">
                <SourceBreakdown
                    sources={result?.sources ?? partial?.sources ?? []}
                    indicator={indicator}
                    kind="ip"
                    streaming={streaming}
                />
            </Section>
        </div>
    );
}
```

`SourceBreakdown` reads from `partial.sources` while streaming, so the
per-source rows fill in as each answers rather than waiting for the end.

Cards already tolerate missing data, because a source that errors or lacks a key
produces the same shape as one that has not answered yet. Give each card a
`result: CheckResult | null` and a `streaming: boolean`; a card with a null
result renders only its skeleton. Task 9 handles the empty-state copy.

- [ ] **Step 3: Stop gating on completion in Checker**

`activeKind` already exists in `Checker.tsx` around line 904 and holds the
detected IOC type for the in-flight or settled indicator; it is what feeds the
new `kind` prop. Replace `components/Checker.tsx` lines 1001 to 1018 with:

```tsx
      {loading && isBulk && <BulkProgress count={bulkPending} />}

      {!loading && !error && !result && !bulkRows && (
        <EmptyState detected={detected} />
      )}

      {!loading && bulkRows && <BulkGeoResults rows={bulkRows} />}

      {/* One tree from the first frame to the last. The progress readout is
          not a card that gets discarded, it is the score's placeholder, so
          there is nothing to unmount when the lookup finishes. */}
      {!isBulk && (result || (loading && progress)) && (
        <CheckResults
          result={result}
          partial={
            result
              ? null
              : buildPartial(
                  progress?.total ?? 0,
                  Object.values(progress?.settled ?? {}),
                )
          }
          indicator={pending || query}
          kind={activeKind ?? "ip"}
          onRefresh={refresh}
          onPivot={pivot}
          research={research}
        />
      )}
```

Delete the now-unused `SearchProgress` render at the old line 1001. Keep the
`SearchProgress` function itself for now; Task 11 mirrors its markup on the scan
page, and deleting it here would lose the reference.

Add the import:

```tsx
import { buildPartial } from "@/lib/ti/partial";
```

- [ ] **Step 4: Verify**

Run: `bun run test && bun run lint && bun run typecheck`
Expected: all pass. If `sonarjs/cognitive-complexity` fires on `Results`, split
the section list into a small `sections` array rather than raising the limit.

- [ ] **Step 5: Verify in a browser**

Follow the **Browser verification recipe**, loading an IP that is not cached so
the streaming path actually runs. A cached one renders server-side and skips the
path entirely, which proves nothing; the recipe explains how to tell from the
page title.

Run it twice, `node ./_shot.mjs /check/<fresh-ip> 2000` and then `... 25000`,
and compare the two images. Confirm that at 2s the hero says "ANALYZING" with a
held threat slot, the dossier is already filling, the counts carry their
denominators, and the left rail is present; and that at 25s the verdict has
landed **without the page having moved**. The real panel is 27 sources and takes
roughly fifteen to twenty-five seconds, so 2s and 25s bracket it.

- [ ] **Step 6: Commit**

```bash
git add components/CheckResults/index.tsx components/Checker.tsx
git commit -m "feat(ui): keep one result tree from the first source to the last"
```

### Task 8: The same for domain, hash and URL

**Files:**
- Modify: `components/CheckResults/index.tsx` (the `DomainResults`, `HashResults` and URL result components)

- [ ] **Step 1: Convert HashResults**

Written out in full, because the three conversions differ in their section
lists and card sets and a reviewer may reach this task without having read the
last one. `HashResults` becomes:

```tsx
function HashResults({
    result,
    partial,
    indicator,
    onRefresh,
    research,
}: Readonly<{
    result: HashCheckResult | null;
    partial: PartialLookup | null;
    indicator: string;
    onRefresh: () => void;
    research: ResearchStreamState;
}>) {
    const streaming = result === null;
    return (
        <div className="mt-5 space-y-5">
            {result && <SourceHealthNotice result={result} />}
            {result ? (
                <VerdictHero result={result} onRefresh={onRefresh} />
            ) : (
                partial && <PendingHero indicator={indicator} partial={partial} />
            )}
            {/* Both phases: the rail draws the left column's edge, and a rail
                that appears only with results slides the page sideways. */}
            <SectionNav items={HASH_SECTIONS} />
            <Section id="origin">
                <HashProfileCard result={result} streaming={streaming} />
            </Section>
            <Section id="related">
                <ConnectionsCard result={result} streaming={streaming} />
            </Section>
            <Section id="dist">
                <DistributionUrlsCard result={result} streaming={streaming} />
            </Section>
            <Section id="research">
                <ResearchCard result={result} research={research} streaming={streaming} />
            </Section>
            <Section id="sources">
                <SourceBreakdown
                    sources={result?.sources ?? partial?.sources ?? []}
                    indicator={indicator}
                    kind="hash"
                    streaming={streaming}
                />
            </Section>
        </div>
    );
}
```

Note `SourceBreakdown` reads from `partial.sources` while streaming, so the
per-source rows fill in as each answers rather than waiting for the end.

- [ ] **Step 2: Convert DomainResults**

Identical treatment, with `DOMAIN_SECTIONS` and the domain card set already in
that component: `DomainProfileCard` under `origin`, `CertificatesCard` under
`certs`, `PassiveDnsCard` under `dns`, `ConnectionsCard` under `related`,
`ResearchCard` under `research`, `ActiveScanCard` under `scan`, and
`SourceBreakdown` under `sources` with `kind="domain"`. `ActiveScanCard` takes
an indicator rather than a result, so pass `indicator` directly and leave it
untouched by `streaming`: it reports whether a scan already exists, which is
independent of this lookup.

- [ ] **Step 3: Convert UrlResults**

Identical treatment, with the URL section list already defined at the top of the
file. `LayerStack` under `layers` takes `result` and `onRefresh`; give it
`result={result}` and `streaming={streaming}` and let it render its own skeleton
when the result is null. The per-layer `SourceBreakdown` calls inside the
`sources` section iterate `result.layers`, which does not exist while streaming,
so guard that block with `{result && ...}` and let the section render empty
until the result lands.

- [ ] **Step 4: Verify**

Run: `bun run test && bun run lint && bun run typecheck`
Expected: all pass.

- [ ] **Step 5: Verify each type in a browser**

Load one uncached domain, one uncached hash, and one uncached URL. Confirm each
shows the pending hero and a stable left rail. A hash is the useful edge case
here: several sources skip it outright, so it exercises the `gaps` count.

- [ ] **Step 6: Commit**

```bash
git add components/CheckResults/index.tsx
git commit -m "feat(ui): stream the domain, hash and URL results the same way"
```

### Task 9: Stop the cards claiming they found nothing

`research.tsx:451` says "Nothing found", `sources.tsx:94` says "No data", and
`profile.tsx:316` says "No registration or DNS context was returned for this
domain." All three are correct when a lookup is finished and false while it is
running. The truth mid-stream is "not asked yet", and for a threat-intel tool
the difference matters: "not found in passive DNS" is a finding an analyst acts
on, so rendering it before the question has been asked is worse than rendering
nothing.

**Files:**
- Modify: `components/CheckResults/research.tsx:447-455`
- Modify: `components/CheckResults/sources.tsx:93-96`
- Modify: `components/CheckResults/profile.tsx:314-317`

- [ ] **Step 1: Thread `streaming` to each empty-state branch**

For `profile.tsx`, the existing JSX is a two-way ternary on `ctx`. It needs a
third case, and `no-nested-ternary` is an **error** in this project, so the
choice moves into a variable above the `return` rather than becoming a chained
`? :`:

```tsx
    // Three cases, not two. "Nothing was returned" is an answer, and while the
    // panel is still being asked, the honest state is that nobody has answered
    // yet: an analyst acts on "no DNS context", so it must not appear early.
    let body: React.ReactNode;
    if (ctx) {
        body = (
            <div className="...">{/* the existing populated branch, verbatim */}</div>
        );
    } else if (streaming) {
        body = (
            <div className="space-y-2">
                <div className="sweep h-3 w-2/3 rounded" />
                <div className="sweep h-3 w-1/2 rounded" />
            </div>
        );
    } else {
        body = (
            <p className="text-sm text-muted-foreground">
                No registration or DNS context was returned for this domain.
            </p>
        );
    }
```

Then the JSX becomes `{body}` where the ternary used to be. Move the existing
populated branch across verbatim; do not retype it.

For `research.tsx`, `noteFor` at line 448 currently maps a lane's status to a
phrase. Give it the phase, so an unfinished lane says nothing rather than
claiming a result:

```tsx
/** The header note: what the lane says about itself in one phrase. Empty and
 *  failed runs still report, quietly, so the user knows the lane ran.
 *
 *  While the lookup is still streaming a lane that has not reported yet says
 *  nothing at all: "Nothing found" is an answer, and the lane has not been
 *  asked. */
function noteFor(result: ResearchResult, streaming: boolean): string {
    const { status, summary, error } = result;
    if (status === "ok") return summary ?? "";
    if (status === "empty") return streaming ? "" : (summary ?? "Nothing found");
    if (status === "timeout") return "Timed out";
    return error ?? "Unavailable";
}
```

For `sources.tsx`, `noSummaryReason` at line 93 does the same job for a source
row:

```tsx
function noSummaryReason(
    skipped: boolean,
    streaming: boolean,
    keyEnv?: string,
): string {
    // Not asked yet is not the same as asked and silent.
    if (streaming && !skipped) return "";
    if (!skipped) return "No data";
    return keyEnv ? `Set ${keyEnv} to enable` : "Disabled";
}
```

Update both call sites to pass the flag. Where the returned string is now empty,
render `<span className="sweep inline-block h-3 w-20 rounded" />` in its place
rather than leaving a bare gap, so the row still reads as occupied.

- [ ] **Step 2: Verify**

Run: `bun run test && bun run lint && bun run typecheck`
Expected: all pass, and no `no-nested-ternary` errors.

- [ ] **Step 3: Verify in a browser**

Load an uncached indicator and confirm that at no point does any card say
"Nothing found", "No data", or "No registration or DNS context" while the
progress readout still shows sources outstanding.

- [ ] **Step 4: Commit**

```bash
git add components/CheckResults/research.tsx components/CheckResults/sources.tsx components/CheckResults/profile.tsx
git commit -m "fix(ui): do not report an unasked question as an empty answer"
```

---

# Phase 3, Layer 3: the scan page

### Task 10: Poll on a schedule that matches the work

`POLL_MS = 6000` means a target that finished at second 1 is not shown until
second 6. On a thirty second job that is up to a fifth of the wait spent looking
at a screen that has already gone stale. The interval widens with the age of the
scan, not with the number of polls taken.

**Files:**
- Create: `lib/scan-poll.ts`
- Test: `lib/scan-poll.test.ts`
- Modify: `components/ScanReport/index.tsx:20` and the poll effect at lines 161-165

**Interfaces:**
- Produces: `function pollIntervalFor(ageMs: number): number`

- [ ] **Step 1: Write the failing tests**

Create `lib/scan-poll.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pollIntervalFor } from "@/lib/scan-poll";

describe("pollIntervalFor", () => {
  it("polls tightly while the scan is young", () => {
    expect(pollIntervalFor(0)).toBe(1500);
    expect(pollIntervalFor(9_000)).toBe(1500);
  });

  it("widens once most targets should have landed", () => {
    expect(pollIntervalFor(10_000)).toBe(3000);
    expect(pollIntervalFor(29_000)).toBe(3000);
  });

  it("backs off to the old interval past the expected finish", () => {
    expect(pollIntervalFor(30_000)).toBe(6000);
    expect(pollIntervalFor(120_000)).toBe(6000);
  });

  // A clock that jumps backwards must not produce a zero or negative delay,
  // which would spin the poll loop.
  it("treats a negative age as brand new", () => {
    expect(pollIntervalFor(-5_000)).toBe(1500);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test lib/scan-poll.test.ts`
Expected: FAIL, cannot resolve `@/lib/scan-poll`.

- [ ] **Step 3: Write the implementation**

Create `lib/scan-poll.ts`:

```ts
/**
 * How long to wait before asking the scan route again.
 *
 * The interval widens with the age of the scan rather than with the number of
 * polls taken, because what changes is how likely another target is to have
 * landed, not how many times we have asked. Most targets finish early, so a
 * tight interval late is paid for and wasted; a flat six seconds meant a
 * target that finished at second one went unseen until second six.
 */

/** Under this, targets are landing steadily. */
const YOUNG_MS = 10_000;
/** A scan takes roughly this long, so past it there is little left to catch. */
const EXPECTED_MS = 30_000;

export function pollIntervalFor(ageMs: number): number {
  if (ageMs < YOUNG_MS) return 1500;
  if (ageMs < EXPECTED_MS) return 3000;
  return 6000;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test lib/scan-poll.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Use it in the poll effect**

In `components/ScanReport/index.tsx`, delete the `POLL_MS` constant at line 20
and its comment, then replace the effect at lines 161 to 165. `setInterval` has
a fixed period, so a widening interval needs a self-rescheduling `setTimeout`:

```tsx
  // Re-poll while anything is queued, tightening early and widening as the
  // scan ages. See lib/scan-poll.ts for why the interval is a function of age.
  useEffect(() => {
    if (!pending) return;
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    function tick() {
      timer = setTimeout(() => {
        if (cancelled) return;
        void poll().finally(() => {
          if (!cancelled) tick();
        });
      }, pollIntervalFor(Date.now() - startedAt));
    }
    tick();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pending, poll]);
```

Add the import:

```tsx
import { pollIntervalFor } from "@/lib/scan-poll";
```

- [ ] **Step 6: Verify**

Run: `bun run test && bun run lint && bun run typecheck && node scripts/new-coverage.mjs`
Expected: all pass, new-code coverage at or above 80%.

- [ ] **Step 7: Commit**

```bash
git add lib/scan-poll.ts lib/scan-poll.test.ts components/ScanReport/index.tsx
git commit -m "perf(ui): poll the scan on a schedule that matches when targets land"
```

### Task 11: Give the scan page the progress readout the lookup already has

`ScanStatus` is `running | done | error`, which is exactly enough to colour a
dot.

**Files:**
- Modify: `components/ScanReport/index.tsx` (the `pending` block at lines 276-282)

- [ ] **Step 1: Replace the spinner line with a bar, a count and dots**

The existing block is a `Loader2` spinner and a sentence. Replace it with the
markup `SearchProgress` uses in `components/Checker.tsx:1218`, so the two
waits look like the same product rather than two visual languages for one idea.
Keep the existing sentence's two facts, that a scan takes about thirty seconds
and that leaving the page does not cancel it: neither is visible from a bar and
both are things a reader needs.

```tsx
{pending && (
  <div className="space-y-2">
    <div
      role="progressbar"
      aria-label="Scan targets completed"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={scanPct}
      className="h-0.5 w-full overflow-hidden rounded-full bg-border"
    >
      <div
        className="h-full bg-foreground/70 transition-[width] duration-200 ease-linear"
        style={{ width: `${Math.max(scanPct, 2)}%` }}
      />
    </div>
    <div className="flex items-center justify-between font-mono text-xs tabular-nums text-muted-foreground">
      <span>
        {scanDone} / {scanTotal} targets
      </span>
      <span>about thirty seconds</span>
    </div>
    <div className="flex flex-wrap gap-1" aria-hidden>
      {(batch?.scans ?? []).map((s) => (
        <span
          key={`${s.target}-${s.engine ?? "scan"}`}
          title={s.target}
          className={cn(
            "size-1.5 rounded-full",
            s.status === "done" && "bg-emerald-600 dark:bg-emerald-400",
            s.status === "error" && "bg-amber-500",
            s.status === "running" && "animate-pulse bg-foreground/30",
          )}
        />
      ))}
    </div>
    <p className="text-xs text-foreground/60">
      Sections fill in as each engine finishes, and leaving this page does not
      cancel it.
    </p>
  </div>
)}
```

Derive the three numbers just above the return:

```tsx
  const scanTotal = batch?.scans.length ?? 0;
  const scanDone = batch?.scans.filter((s) => s.status !== "running").length ?? 0;
  const scanPct = scanTotal > 0 ? Math.round((scanDone / scanTotal) * 100) : 0;
```

Check the real key fields on `ActiveScan` in `lib/ti/url/active/types.ts` before
writing the `key`; use whatever pair is actually unique there rather than
assuming `engine` exists. Remove the now-unused `Loader2` import if nothing else
in the file uses it, or lint will fail.

- [ ] **Step 2: Verify**

Run: `bun run test && bun run lint && bun run typecheck`
Expected: all pass.

- [ ] **Step 3: Verify in a browser**

Start a real scan from `/scan/<domain>` and confirm the bar advances and targets
turn as they land.

- [ ] **Step 4: Commit**

```bash
git add components/ScanReport/index.tsx
git commit -m "feat(ui): show an active scan's progress the way a lookup shows its own"
```

---

## Verification before opening a PR

- [ ] `bun run test` passes
- [ ] `bun run lint` passes
- [ ] `bun run typecheck` passes
- [ ] `bun run build` passes
- [ ] `node scripts/new-coverage.mjs` reports at or above 80%
- [ ] A browser check of an **uncached** indicator of each type. A cached one renders server-side and never exercises the streaming path, so it proves nothing here.
- [ ] `next-env.d.ts` flip-flops between `.next/types` and `.next/dev/types` depending on whether `build` or `dev` ran last. Either is fine, `tsc --noEmit` passes with no `.next` at all, which is the state CI typechecks in. Just do not leave it half-staged.
- [ ] If a browser check did not happen, say so explicitly in the PR rather than implying it did.
