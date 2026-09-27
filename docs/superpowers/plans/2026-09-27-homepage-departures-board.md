# Homepage Departures Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/` into a split screen, headline and search on the left, a rail listing every TI source's recent health on the right, with health recorded passively from real lookups.

**Architecture:** A pure grading module (`lib/ti/health.ts`) and a Redis store (`lib/ti/health-store.ts`) sit beside `history.ts`. The indicator route factory records each fresh run's per-source status next to its cache and history writes. `app/page.tsx` streams a server-rendered rail into a new optional `idleAside` slot on `Checker`, which only `/` fills, so `/check` and `/scan` are untouched.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4, Upstash Redis (`@upstash/redis`), Vitest, Playwright (screenshots), Bun as script runner.

**Spec:** `docs/superpowers/specs/2026-09-27-homepage-departures-board-design.md`

## Global Constraints

- Scope is `/` only. Do not edit `app/check/**`, `app/scan/**`, `components/CheckResults/**`, `components/ScanReport/**`, `components/ScanSearch.tsx`. `components/Checker/index.tsx` only gains the optional `idleAside` prop and a render branch taken when it is set.
- Health window: last **50** runs per source. Key: `ti:health:<type>:<sourceId>`. Entry `{ s, ms, t, e? }`, `e` truncated to **200** chars.
- Grades, first match wins: `no-key` (`isEnabled()` false) → `no-data` (< **5** counted runs) → `failing` (ok share < **50%**) → `degraded` (ok share < **90%**) → `slow` (median ok latency > half of `meta.timeoutMs ?? PER_SOURCE_TIMEOUT_MS`) → `healthy`. `skipped` runs are not counted. `rate_limited` counts as not ok.
- Sort: failing, degraded, slow, healthy, no-data, no-key; then lower ok share first; then name.
- Skin: grey everywhere (chroma 0); colour only for the grade: green `emerald`, amber `amber`, red `red`, hollow grey marker for no-key / no-data. Grade must also read without colour (marker shape + text).
- Copy uses commas, never em/en dashes or " - " as separators. A missing number renders as `—` (a lone dash glyph, not a separator).
- Redis optional: every Redis path is a no-op / null without credentials and swallows + `console.error`s failures, never failing a lookup.
- Run `bun run test`, never `bun test`.
- Dev server for verification goes on **:3001** (`bun run dev -- -p 3001`); never touch :3000. Verify UI at 1280 px wide, light and dark.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_0198Ym7oFCWaB8RwCvhczKJ3
  ```
- Do not push or open a PR; the user asks for that separately.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `scripts/page-shots.mjs` | create | Screenshot a list of paths in light + dark at 1280 px. Used for the before/after boundary check and the homepage checks. |
| `lib/ti/orchestrate.ts` | modify | Export `PER_SOURCE_TIMEOUT_MS`. |
| `lib/ti/health.ts` | create | Pure: health types, `median`, `gradeSource`, `sortHealth`. |
| `lib/ti/health.test.ts` | create | Grading boundaries and sort. |
| `lib/ti/health-store.ts` | create | Redis: `toEntry`, `recordHealth`, `readHealth`, `HEALTH_GROUPS`. |
| `lib/ti/health-store.test.ts` | create | Store with a stubbed Redis. |
| `lib/ti/route-handler.ts` | modify | Call `recordHealth` beside `setCached` + `recordHistory`. |
| `lib/ti/route-handler.test.ts` | modify | Fresh run records health, cache hit does not. |
| `components/Home/source-rail.tsx` | create | Server-renderable rail: `SourceRail`, `SourceRailSkeleton`. |
| `components/Checker/board.tsx` | create | The split layout used when `idleAside` is set. |
| `components/Checker/index.tsx` | modify | `idleAside` prop; render `Board` when idle and set. |
| `app/page.tsx` | modify | Pass the streamed rail as `idleAside`. |

---

### Task 1: Baseline screenshots of `/check` and `/scan`

Captured **before** any UI change so Task 6 can prove those pages did not move.

**Files:**
- Create: `scripts/page-shots.mjs`

**Interfaces:**
- Produces: `node scripts/page-shots.mjs` with env `PATHS` (comma list), `OUT` (dir), `BASE` (default `http://localhost:3001`), writes `<OUT>/<slug>-<theme>.png`.

- [ ] **Step 1: Write the script**

```js
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Shoots each path in light and dark at 1280 px. Used to compare pages
// before and after a change (the /check and /scan boundary check) and to
// look at the homepage. Needs `bun run dev -- -p 3001`, where proxy.ts
// waves every route through, so no session cookie is needed.
const OUT = process.env.OUT || join(tmpdir(), "claude", "page-shots");
const BASE = process.env.BASE || "http://localhost:3001";
const PATHS = (process.env.PATHS || "/").split(",");

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: theme });
  await ctx.addInitScript((t) => localStorage.setItem("theme", t), theme);
  const page = await ctx.newPage();
  for (const path of PATHS) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(1500);
    const slug = path === "/" ? "root" : path.replace(/\W+/g, "_");
    await page.screenshot({ path: join(OUT, `${slug}-${theme}.png`), fullPage: true });
    console.log(`saved ${slug}-${theme}.png`);
  }
  await ctx.close();
}
await browser.close();
```

- [ ] **Step 2: Capture the baseline**

Make sure the dev server is up on :3001 (`bun run dev -- -p 3001`, in the background). Then:

Run: `OUT=/tmp/claude-1000/-home-siriwat-dev-debian-Documents-project-ophanim/1ba0f2e7-b646-4ba6-8afe-7b3465a2a92b/scratchpad/baseline PATHS=/check/8.8.8.8,/scan,/ node scripts/page-shots.mjs`
Expected: six `saved …png` lines. Open `_check_8_8_8_8-dark.png` and confirm it shows a finished result (sprite + verdict), not a loading shell; if it is a shell, rerun once (the first run warms the cache).

- [ ] **Step 3: Commit**

```bash
git add scripts/page-shots.mjs
git commit -m "chore: add a light/dark page screenshot script

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0198Ym7oFCWaB8RwCvhczKJ3"
```

---

### Task 2: Grading (`lib/ti/health.ts`)

**Files:**
- Modify: `lib/ti/orchestrate.ts:3`
- Create: `lib/ti/health.ts`
- Test: `lib/ti/health.test.ts`

**Interfaces:**
- Consumes: `SourceMeta`, `SourceStatus` from `@/lib/ti/types`.
- Produces:
  - `export const PER_SOURCE_TIMEOUT_MS = 8000` (from `orchestrate.ts`)
  - `export interface HealthEntry { s: SourceStatus; ms: number; t: number; e?: string }`
  - `export type HealthGrade = "failing" | "degraded" | "slow" | "healthy" | "no-data" | "no-key"`
  - `export interface SourceHealth { id: string; name: string; type: string; grade: HealthGrade; okShare: number | null; medianMs: number | null; runs: number; lastError?: string; lastAt: number | null }`
  - `export const MIN_RUNS = 5`
  - `export function median(xs: number[]): number | null`
  - `export function gradeSource(input: { meta: SourceMeta; type: string; enabled: boolean; entries: HealthEntry[] }): SourceHealth` (entries newest first)
  - `export function sortHealth(rows: SourceHealth[]): SourceHealth[]` (returns a new array)

- [ ] **Step 1: Export the timeout**

In `lib/ti/orchestrate.ts` change line 3 from `const PER_SOURCE_TIMEOUT_MS = 8000;` to:

```ts
// Exported for lib/ti/health.ts, which grades a source "slow" against the
// same budget the orchestrator aborts it at.
export const PER_SOURCE_TIMEOUT_MS = 8000;
```

- [ ] **Step 2: Write the failing tests**

`lib/ti/health.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { gradeSource, median, MIN_RUNS, sortHealth, type HealthEntry, type SourceHealth } from "@/lib/ti/health";
import type { SourceMeta } from "@/lib/ti/types";

const meta = (over: Partial<SourceMeta> = {}): SourceMeta =>
  ({ id: "src", name: "Source", url: "https://x", category: "reputation", requiresKey: false, weight: 1, ...over }) as SourceMeta;

/** `ok` runs at `ms`, then `bad` runs of `status`, newest first. */
function runs(ok: number, bad = 0, ms = 100, status: HealthEntry["s"] = "error"): HealthEntry[] {
  const out: HealthEntry[] = [];
  for (let i = 0; i < bad; i++) out.push({ s: status, ms: 50, t: 1000 - i, e: `boom ${i}` });
  for (let i = 0; i < ok; i++) out.push({ s: "ok", ms, t: 900 - i });
  return out;
}

const grade = (entries: HealthEntry[], over: Partial<Parameters<typeof gradeSource>[0]> = {}) =>
  gradeSource({ meta: meta(), type: "ip", enabled: true, entries, ...over });

describe("median", () => {
  it("is null for no values", () => expect(median([])).toBeNull());
  it("picks the middle of an odd count", () => expect(median([5, 1, 3])).toBe(3));
  it("averages the middle pair of an even count", () => expect(median([4, 1, 3, 2])).toBe(2.5));
});

describe("gradeSource", () => {
  it("is no-key when the source is disabled, whatever its history", () => {
    expect(grade(runs(50), { enabled: false }).grade).toBe("no-key");
  });

  it(`is no-data under ${MIN_RUNS} counted runs`, () => {
    expect(grade(runs(MIN_RUNS - 1)).grade).toBe("no-data");
    expect(grade(runs(MIN_RUNS)).grade).toBe("healthy");
  });

  it("does not count skipped runs at all", () => {
    const entries = [...runs(0, 40, 0, "skipped"), ...runs(10)];
    const h = grade(entries);
    expect(h.runs).toBe(10);
    expect(h.okShare).toBe(1);
    expect(h.grade).toBe("healthy");
  });

  it("is failing below 50% ok, degraded at exactly 50%", () => {
    expect(grade(runs(49, 51)).grade).toBe("failing");
    expect(grade(runs(50, 50)).grade).toBe("degraded");
  });

  it("is degraded below 90% ok, healthy at exactly 90%", () => {
    expect(grade(runs(89, 11)).grade).toBe("degraded");
    expect(grade(runs(90, 10)).grade).toBe("healthy");
  });

  it("counts rate limits as not ok", () => {
    expect(grade(runs(40, 10, 100, "rate_limited")).grade).toBe("degraded");
  });

  it("is slow when the median ok latency passes half the default 8s timeout", () => {
    expect(grade(runs(10, 0, 4000)).grade).toBe("healthy");
    expect(grade(runs(10, 0, 4001)).grade).toBe("slow");
  });

  it("measures slow against the source's own timeout when it sets one", () => {
    expect(grade(runs(10, 0, 1001), { meta: meta({ timeoutMs: 2000 }) }).grade).toBe("slow");
  });

  it("takes the median over ok runs only", () => {
    const entries: HealthEntry[] = [{ s: "timeout", ms: 8000, t: 3 }, ...runs(9, 0, 200)];
    expect(grade(entries).medianMs).toBe(200);
  });

  it("reports the newest error and the newest run time", () => {
    const h = grade(runs(10, 2));
    expect(h.lastError).toBe("boom 0");
    expect(h.lastAt).toBe(1000);
  });

  it("has null share and median with no counted runs", () => {
    const h = grade([]);
    expect(h).toMatchObject({ grade: "no-data", okShare: null, medianMs: null, runs: 0, lastAt: null });
  });
});

describe("sortHealth", () => {
  const row = (name: string, grade: SourceHealth["grade"], okShare: number | null): SourceHealth =>
    ({ id: name, name, type: "ip", grade, okShare, medianMs: null, runs: 10, lastAt: null });

  it("orders by grade, then lower ok share, then name", () => {
    const sorted = sortHealth([
      row("h", "healthy", 1),
      row("k", "no-key", null),
      row("d2", "degraded", 0.8),
      row("f", "failing", 0.2),
      row("n", "no-data", null),
      row("s", "slow", 0.95),
      row("d1", "degraded", 0.6),
      row("b", "healthy", 1),
    ]);
    expect(sorted.map((r) => r.name)).toEqual(["f", "d1", "d2", "s", "b", "h", "n", "k"]);
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `bun run test lib/ti/health.test.ts`
Expected: FAIL, cannot resolve `@/lib/ti/health`.

- [ ] **Step 4: Implement**

`lib/ti/health.ts`:

```ts
import { PER_SOURCE_TIMEOUT_MS } from "./orchestrate";
import type { SourceMeta, SourceStatus } from "./types";

/**
 * How each TI source has been answering, graded from the runs real lookups
 * already made (see health-store.ts for where they are recorded). Pure, so the
 * thresholds are testable without Redis.
 */

/** One recorded run, stored compactly because there are 50 per source. */
export interface HealthEntry {
  s: SourceStatus;
  ms: number;
  /** Epoch ms the run was recorded. */
  t: number;
  e?: string;
}

export type HealthGrade = "failing" | "degraded" | "slow" | "healthy" | "no-data" | "no-key";

export interface SourceHealth {
  id: string;
  name: string;
  /** The indicator type the source was run for: "ip", "domain" or "hash". */
  type: string;
  grade: HealthGrade;
  /** Share of counted runs that came back ok, 0 to 1; null with no runs. */
  okShare: number | null;
  /** Median latency of the ok runs; null with none. */
  medianMs: number | null;
  /** Counted runs, skipped ones excluded. */
  runs: number;
  lastError?: string;
  lastAt: number | null;
}

/** Fewer counted runs than this and a percentage would be noise. */
export const MIN_RUNS = 5;
const FAILING_BELOW = 0.5;
const DEGRADED_BELOW = 0.9;

const GRADE_ORDER: HealthGrade[] = ["failing", "degraded", "slow", "healthy", "no-data", "no-key"];

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function gradeOf(
  enabled: boolean,
  runs: number,
  okShare: number | null,
  medianMs: number | null,
  timeoutMs: number,
): HealthGrade {
  if (!enabled) return "no-key";
  if (runs < MIN_RUNS || okShare === null) return "no-data";
  if (okShare < FAILING_BELOW) return "failing";
  if (okShare < DEGRADED_BELOW) return "degraded";
  if (medianMs !== null && medianMs > timeoutMs / 2) return "slow";
  return "healthy";
}

/** Grades one source from its entries, newest first. `skipped` runs (the
 *  source declined the input, e.g. a SHA-1 on a SHA-256-only source) are not
 *  held against it and not counted at all. */
export function gradeSource({
  meta,
  type,
  enabled,
  entries,
}: {
  meta: SourceMeta;
  type: string;
  enabled: boolean;
  entries: HealthEntry[];
}): SourceHealth {
  const counted = entries.filter((e) => e.s !== "skipped");
  const ok = counted.filter((e) => e.s === "ok");
  const okShare = counted.length ? ok.length / counted.length : null;
  const medianMs = median(ok.map((e) => e.ms));
  const timeoutMs = meta.timeoutMs ?? PER_SOURCE_TIMEOUT_MS;
  return {
    id: meta.id,
    name: meta.name,
    type,
    grade: gradeOf(enabled, counted.length, okShare, medianMs, timeoutMs),
    okShare,
    medianMs,
    runs: counted.length,
    lastError: counted.find((e) => e.e)?.e,
    lastAt: counted.length ? Math.max(...counted.map((e) => e.t)) : null,
  };
}

/** Worst first: by grade, then lower ok share (unknown last), then name. */
export function sortHealth(rows: SourceHealth[]): SourceHealth[] {
  return [...rows].sort(
    (a, b) =>
      GRADE_ORDER.indexOf(a.grade) - GRADE_ORDER.indexOf(b.grade) ||
      (a.okShare ?? 2) - (b.okShare ?? 2) ||
      a.name.localeCompare(b.name),
  );
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `bun run test lib/ti/health.test.ts`
Expected: PASS, all tests.

- [ ] **Step 6: Commit**

```bash
git add lib/ti/orchestrate.ts lib/ti/health.ts lib/ti/health.test.ts
git commit -m "feat(ti): grade source health from recorded runs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0198Ym7oFCWaB8RwCvhczKJ3"
```

---

### Task 3: Health store (`lib/ti/health-store.ts`)

**Files:**
- Create: `lib/ti/health-store.ts`
- Test: `lib/ti/health-store.test.ts`

**Interfaces:**
- Consumes: `getRedis` from `./cache`; `HealthEntry`, `SourceHealth`, `gradeSource`, `sortHealth` from `./health`; `sources` from `./registry`, `domainSources` from `./domain/registry`, `hashSources` from `./hash/registry`; `SourceResult`, `TiSource` from `./types`.
- Produces:
  - `export const HEALTH_WINDOW = 50`
  - `export function healthKey(type: string, id: string): string`
  - `export function toEntry(r: SourceResult, now: number): HealthEntry`
  - `export async function recordHealth(type: string, results: SourceResult[]): Promise<void>`
  - `export interface HealthGroup { type: string; sources: TiSource[] }`
  - `export const HEALTH_GROUPS: HealthGroup[]`
  - `export interface HealthBoard { rows: SourceHealth[]; newestAt: number | null }`
  - `export async function readHealth(groups: HealthGroup[]): Promise<HealthBoard | null>` (null when Redis is off or the read failed)

- [ ] **Step 1: Write the failing tests**

`lib/ti/health-store.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceResult, TiSource } from "@/lib/ti/types";

// Same approach as history.test.ts: health-store reaches Redis only through
// the cache module's getRedis(), so mocking that is enough.
const { getRedisMock } = vi.hoisted(() => ({ getRedisMock: vi.fn() }));
vi.mock("@/lib/ti/cache", () => ({ getRedis: getRedisMock }));

const { healthKey, readHealth, recordHealth, toEntry } = await import("@/lib/ti/health-store");

const pipeline = { lpush: vi.fn(), ltrim: vi.fn(), lrange: vi.fn(), exec: vi.fn() };
const redis = { pipeline: vi.fn(() => pipeline) };

const NOW = new Date("2026-09-27T12:00:00.000Z").getTime();

const result = (id: string, over: Partial<SourceResult> = {}): SourceResult =>
  ({ source: { id, name: id.toUpperCase() }, enabled: true, durationMs: 123.6, status: "ok", ...over }) as SourceResult;

const source = (id: string, enabled = true): TiSource =>
  ({ meta: { id, name: id.toUpperCase() }, isEnabled: () => enabled, check: vi.fn() }) as unknown as TiSource;

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  for (const fn of [pipeline.lpush, pipeline.ltrim, pipeline.lrange]) fn.mockReset().mockReturnValue(pipeline);
  pipeline.exec.mockReset().mockResolvedValue([]);
  redis.pipeline.mockReset().mockReturnValue(pipeline);
  getRedisMock.mockReset().mockReturnValue(redis);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  errorSpy.mockRestore();
});

describe("toEntry", () => {
  it("keeps status, rounded latency and time", () => {
    expect(toEntry(result("a"), NOW)).toEqual({ s: "ok", ms: 124, t: NOW });
  });

  it("truncates a long error to 200 characters", () => {
    const e = toEntry(result("a", { status: "error", error: "x".repeat(500) }), NOW);
    expect(e.e).toHaveLength(200);
  });
});

describe("recordHealth", () => {
  it("pushes one entry per source and trims each list to 50, in one pipeline", async () => {
    await recordHealth("ip", [result("a"), result("b", { status: "timeout" })]);
    expect(redis.pipeline).toHaveBeenCalledTimes(1);
    expect(pipeline.lpush).toHaveBeenCalledWith(healthKey("ip", "a"), { s: "ok", ms: 124, t: NOW });
    expect(pipeline.lpush).toHaveBeenCalledWith("ti:health:ip:b", { s: "timeout", ms: 124, t: NOW });
    expect(pipeline.ltrim).toHaveBeenCalledWith("ti:health:ip:a", 0, 49);
    expect(pipeline.exec).toHaveBeenCalledTimes(1);
  });

  it("does not record skipped runs, which would only evict real ones", async () => {
    await recordHealth("hash", [result("a", { status: "skipped" })]);
    expect(redis.pipeline).not.toHaveBeenCalled();
  });

  it("is a no-op without Redis", async () => {
    getRedisMock.mockReturnValue(null);
    await expect(recordHealth("ip", [result("a")])).resolves.toBeUndefined();
    expect(redis.pipeline).not.toHaveBeenCalled();
  });

  it("swallows a Redis failure", async () => {
    pipeline.exec.mockRejectedValue(new Error("down"));
    await expect(recordHealth("ip", [result("a")])).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("readHealth", () => {
  const groups = [
    { type: "ip", sources: [source("a"), source("k", false)] },
    { type: "domain", sources: [source("a")] },
  ];

  it("is null without Redis", async () => {
    getRedisMock.mockReturnValue(null);
    await expect(readHealth(groups)).resolves.toBeNull();
  });

  it("reads every source's list in one pipeline and grades them worst first", async () => {
    const good = Array.from({ length: 10 }, (_, i) => ({ s: "ok", ms: 100, t: NOW - i }));
    const bad = Array.from({ length: 10 }, (_, i) => ({ s: "error", ms: 100, t: NOW - 5000 - i, e: "503" }));
    // The domain list comes back as raw JSON strings, which Upstash sometimes does.
    pipeline.exec.mockResolvedValue([good, [], bad.map((b) => JSON.stringify(b))]);
    const board = await readHealth(groups);
    expect(pipeline.lrange.mock.calls.map((c) => c[0])).toEqual([
      "ti:health:ip:a",
      "ti:health:ip:k",
      "ti:health:domain:a",
    ]);
    expect(pipeline.lrange).toHaveBeenCalledWith("ti:health:ip:a", 0, 49);
    expect(board?.rows.map((r) => [r.type, r.id, r.grade])).toEqual([
      ["domain", "a", "failing"],
      ["ip", "a", "healthy"],
      ["ip", "k", "no-key"],
    ]);
    expect(board?.newestAt).toBe(NOW);
  });

  it("drops entries it cannot parse", async () => {
    pipeline.exec.mockResolvedValue([["not json", { s: "ok", ms: 1, t: 1 }], [], []]);
    const board = await readHealth(groups);
    expect(board?.rows.find((r) => r.type === "ip" && r.id === "a")?.runs).toBe(1);
  });

  it("is null when the read fails", async () => {
    pipeline.exec.mockRejectedValue(new Error("down"));
    await expect(readHealth(groups)).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `bun run test lib/ti/health-store.test.ts`
Expected: FAIL, cannot resolve `@/lib/ti/health-store`.

- [ ] **Step 3: Implement**

`lib/ti/health-store.ts`:

```ts
import { getRedis } from "./cache";
import { domainSources } from "./domain/registry";
import { gradeSource, sortHealth, type HealthEntry, type SourceHealth } from "./health";
import { hashSources } from "./hash/registry";
import { sources as ipSources } from "./registry";
import type { SourceResult, TiSource } from "./types";

/**
 * Where source health lives in Redis. Written by the indicator routes after
 * each fresh run (a cache hit contacted no source, so it records nothing),
 * read by the homepage's source rail. Optional like the rest of the cache:
 * without Redis the write is a no-op and the read is null.
 */

export const HEALTH_WINDOW = 50;
const PREFIX = "ti:health:";
const MAX_ERROR = 200;

export function healthKey(type: string, id: string): string {
  return `${PREFIX}${type}:${id}`;
}

export function toEntry(r: SourceResult, now: number): HealthEntry {
  const entry: HealthEntry = { s: r.status, ms: Math.round(r.durationMs), t: now };
  if (r.error) entry.e = r.error.slice(0, MAX_ERROR);
  return entry;
}

/** One pipeline per lookup: LPUSH + LTRIM for every source that actually ran. */
export async function recordHealth(type: string, results: SourceResult[]): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const ran = results.filter((r) => r.status !== "skipped");
  if (ran.length === 0) return;
  try {
    const now = Date.now();
    const p = redis.pipeline();
    for (const r of ran) {
      const k = healthKey(type, r.source.id);
      p.lpush(k, toEntry(r, now)).ltrim(k, 0, HEALTH_WINDOW - 1);
    }
    await p.exec();
  } catch (err) {
    console.error("[ti] health write failed:", err);
  }
}

export interface HealthGroup {
  type: string;
  sources: TiSource[];
}

export const HEALTH_GROUPS: HealthGroup[] = [
  { type: "ip", sources: ipSources },
  { type: "domain", sources: domainSources },
  { type: "hash", sources: hashSources },
];

export interface HealthBoard {
  rows: SourceHealth[];
  /** Newest recorded run across every source, for the "as of" line. */
  newestAt: number | null;
}

/** Upstash usually returns parsed objects, but tolerate raw JSON strings too. */
function toHealthEntry(raw: unknown): HealthEntry | null {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const e = obj as HealthEntry | null;
  return e && typeof e.s === "string" && typeof e.ms === "number" && typeof e.t === "number" ? e : null;
}

export async function readHealth(groups: HealthGroup[]): Promise<HealthBoard | null> {
  const redis = getRedis();
  if (!redis) return null;
  const pairs = groups.flatMap((g) => g.sources.map((s) => ({ type: g.type, source: s })));
  try {
    const p = redis.pipeline();
    for (const { type, source } of pairs) p.lrange(healthKey(type, source.meta.id), 0, HEALTH_WINDOW - 1);
    const lists = (await p.exec()) as unknown[][];
    const rows = pairs.map(({ type, source }, i) =>
      gradeSource({
        meta: source.meta,
        type,
        enabled: source.isEnabled(),
        entries: (lists[i] ?? []).map(toHealthEntry).filter((e): e is HealthEntry => e !== null),
      }),
    );
    const times = rows.map((r) => r.lastAt).filter((t): t is number => t !== null);
    return { rows: sortHealth(rows), newestAt: times.length ? Math.max(...times) : null };
  } catch (err) {
    console.error("[ti] health read failed:", err);
    return null;
  }
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `bun run test lib/ti/health-store.test.ts`
Expected: PASS, all tests. (`ti:health:ip:k` reads `[]` and grades `no-key` because its `isEnabled()` is false; `domain:a` has 10 errors so grades `failing`.)

- [ ] **Step 5: Commit**

```bash
git add lib/ti/health-store.ts lib/ti/health-store.test.ts
git commit -m "feat(ti): record and read per-source health in Redis

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0198Ym7oFCWaB8RwCvhczKJ3"
```

---

### Task 4: Record health on every fresh lookup

**Files:**
- Modify: `lib/ti/route-handler.ts` (imports at top; both `Promise.all` write sites, in `jsonResult` and `streamResult`)
- Test: `lib/ti/route-handler.test.ts`

**Interfaces:**
- Consumes: `recordHealth(type: string, results: SourceResult[]): Promise<void>` from Task 3.

- [ ] **Step 1: Write the failing tests**

In `lib/ti/route-handler.test.ts`, extend the `vi.hoisted` block and add a mock right after the existing `vi.mock("@/lib/ti/history", …)`:

```ts
const { recordHealthSpy } = vi.hoisted(() => ({ recordHealthSpy: vi.fn() }));
vi.mock("@/lib/ti/health-store", () => ({ recordHealth: recordHealthSpy }));
```

Add `recordHealthSpy.mockReset().mockResolvedValue(undefined);` as a line inside the file's existing top-level `beforeEach` (around line 74), then append:

```ts
describe("source health", () => {
  it("records every source of a fresh JSON run", async () => {
    await makeRoute().GET(get());
    expect(recordHealthSpy).toHaveBeenCalledWith("ip", RESULT.sources);
  });

  it("records every source of a fresh streamed run", async () => {
    await readEvents(await makeRoute().POST(streamPost({ ip: "1.1.1.1" })));
    expect(recordHealthSpy).toHaveBeenCalledWith("ip", RESULT.sources);
  });

  it("records nothing for a cache hit, which contacted no source", async () => {
    const route = makeRoute({ getCached: async () => RESULT });
    await route.GET(get());
    await readEvents(await route.POST(streamPost({ ip: "1.1.1.1" })));
    expect(recordHealthSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `bun run test lib/ti/route-handler.test.ts`
Expected: the two "records every source" tests FAIL (spy never called); the rest pass.

- [ ] **Step 3: Implement**

In `lib/ti/route-handler.ts` add the import under the history import:

```ts
import { recordHealth } from "./health-store";
```

Then change **both** write sites. In `jsonResult`:

```ts
      // setCached, the history write and the health write are independent;
      // overlap them.
      const [, written] = await Promise.all([
        config.setCached(value, result),
        recordHistory(config.label, histKey, snapshotOf(result)),
        recordHealth(config.label, result.sources),
      ]);
```

and in `streamResult`, the same three-element `Promise.all` (keep its indentation and replace its one-line comment with the same two-line comment).

- [ ] **Step 4: Run the whole suite**

Run: `bun run test`
Expected: PASS, all files.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/route-handler.ts lib/ti/route-handler.test.ts
git commit -m "feat(ti): record source health after every fresh lookup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0198Ym7oFCWaB8RwCvhczKJ3"
```

---

### Task 5: The source rail and the split homepage

**Files:**
- Create: `components/Home/source-rail.tsx`
- Create: `components/Checker/board.tsx`
- Modify: `components/Checker/index.tsx` (props; the non-compact branch; `EmptyState` gate)
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `HealthBoard`, `readHealth`, `HEALTH_GROUPS` (Task 3); `SourceHealth`, `HealthGrade` (Task 2); `relativeTime(when, now)` from `@/lib/relative-time`; `cn` from `@/lib/utils`.
- Produces:
  - `SourceRail({ board, now }: { board: HealthBoard | null; now: number })` server-renderable, no hooks.
  - `SourceRailSkeleton()`.
  - `Board({ search, hint, chips, error, aside }: { search: ReactNode; hint: ReactNode; chips: ReactNode; error: ReactNode; aside: ReactNode })`.
  - `Checker` prop `idleAside?: React.ReactNode`.

- [ ] **Step 1: Write the rail**

`components/Home/source-rail.tsx`:

```tsx
import type { HealthBoard } from "@/lib/ti/health-store";
import type { HealthGrade, SourceHealth } from "@/lib/ti/health";
import { relativeTime } from "@/lib/relative-time";
import { cn } from "@/lib/utils";

/**
 * The homepage's departures board: every TI source, worst first, graded from
 * its last 50 real runs. Colour is the grade and nothing else; the marker's
 * shape and the numbers carry it too, so it reads in greyscale.
 */

const TYPE_TAG: Record<string, string> = { ip: "IP", domain: "DOM", hash: "HASH" };

const MARK: Record<HealthGrade, { dot: string; text: string; hollow?: boolean }> = {
  failing: { dot: "bg-red-600 dark:bg-red-400", text: "text-red-700 dark:text-red-400" },
  degraded: { dot: "bg-amber-500 dark:bg-amber-400", text: "text-amber-700 dark:text-amber-400" },
  slow: { dot: "bg-amber-500 dark:bg-amber-400", text: "text-amber-700 dark:text-amber-400" },
  healthy: { dot: "bg-emerald-600 dark:bg-emerald-400", text: "text-muted-foreground" },
  "no-data": { dot: "", text: "text-muted-foreground", hollow: true },
  "no-key": { dot: "", text: "text-muted-foreground", hollow: true },
};

function ms(v: number | null): string {
  if (v === null) return "—";
  return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`;
}

function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

/** The surface both the live rail and its skeleton share, so the swap from
 *  one to the other moves nothing. */
function RailShell({ children, footer }: Readonly<{ children: React.ReactNode; footer?: React.ReactNode }>) {
  return (
    <aside
      aria-label="Source health"
      className="relative border-t border-border bg-[oklch(0.955_0_0)] font-mono md:border-t-0 md:border-l dark:bg-[oklch(0.15_0_0)]"
    >
      <div className="flex flex-col md:absolute md:inset-0">
        <div className="flex items-baseline justify-between border-b border-border px-4 py-3">
          <span className="text-[11px] font-bold tracking-[0.14em] uppercase">Sources</span>
          <span className="text-[10px] tracking-[0.14em] text-muted-foreground uppercase">p50 · ok</span>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="border-t border-border px-4 py-2 text-[10.5px] text-muted-foreground">{footer}</div>}
      </div>
    </aside>
  );
}

function Row({ row }: Readonly<{ row: SourceHealth }>) {
  const mark = MARK[row.grade];
  const off = row.grade === "no-key" || row.grade === "no-data";
  return (
    <li
      title={row.lastError}
      className="grid grid-cols-[10px_1fr_auto_52px_40px] items-center gap-2 border-b border-border/60 px-4 py-1.5 text-[11.5px]"
    >
      <span
        aria-hidden
        className={cn("size-2 rounded-full", mark.hollow ? "border border-muted-foreground" : mark.dot)}
      />
      <span className={cn("truncate", off && "text-muted-foreground")}>{row.name}</span>
      <span className="text-[10px] text-muted-foreground">{TYPE_TAG[row.type] ?? row.type}</span>
      {off ? (
        <span className="col-span-2 text-right text-muted-foreground">{row.grade === "no-key" ? "no key" : "no data"}</span>
      ) : (
        <>
          <span className="text-right text-muted-foreground tabular-nums">{ms(row.medianMs)}</span>
          <span className={cn("text-right tabular-nums", mark.text)}>{pct(row.okShare)}</span>
        </>
      )}
      <span className="sr-only">{row.grade}</span>
    </li>
  );
}

export function SourceRail({ board, now }: Readonly<{ board: HealthBoard | null; now: number }>) {
  if (!board) {
    return (
      <RailShell>
        <p className="px-4 py-3 text-[11.5px] text-muted-foreground">Health tracking needs the Redis cache.</p>
      </RailShell>
    );
  }
  const footer = board.newestAt
    ? `last 50 runs per source, newest ${relativeTime(board.newestAt, now)}`
    : "no runs recorded yet";
  return (
    <RailShell footer={footer}>
      <ul>
        {board.rows.map((r) => (
          <Row key={`${r.type}:${r.id}`} row={r} />
        ))}
      </ul>
    </RailShell>
  );
}

export function SourceRailSkeleton() {
  return (
    <RailShell footer={<span className="sweep block h-2 w-40 rounded" />}>
      <ul>
        {Array.from({ length: 14 }, (_, i) => (
          <li key={i} className="flex items-center gap-2 border-b border-border/60 px-4 py-[9px]">
            <span className="sweep block size-2 rounded-full" />
            <span className="sweep block h-2 flex-1 rounded" />
            <span className="sweep block h-2 w-16 rounded" />
          </li>
        ))}
      </ul>
    </RailShell>
  );
}
```

- [ ] **Step 2: Write the split layout**

`components/Checker/board.tsx`:

```tsx
/**
 * The homepage at rest: headline and search on the left, `aside` (the source
 * rail) on the right. Only rendered when `Checker` is given an `idleAside`,
 * which only `/` does, so /check never takes this path.
 */
export function Board({
  search,
  hint,
  chips,
  error,
  aside,
}: Readonly<{
  search: React.ReactNode;
  hint: React.ReactNode;
  chips: React.ReactNode;
  error: React.ReactNode;
  aside: React.ReactNode;
}>) {
  return (
    <div className="grid w-full flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_330px]">
      <div className="flex flex-col justify-center px-4 py-12 md:px-10">
        <div className="w-full max-w-[560px]">
          <h1 className="text-3xl leading-[1.1] font-bold tracking-[-0.02em] sm:text-[2rem]">
            Check an IP,
            <br />
            domain, or file hash.
          </h1>
          <p className="mt-2.5 mb-6 max-w-[420px] text-[0.95rem] text-muted-foreground">
            Every source is asked in parallel, then the answers are folded into one verdict.
          </p>
          {search}
          <div className="mt-3 flex flex-wrap items-center gap-2">{chips}</div>
          <div className="mt-2 min-h-7 text-sm">{hint}</div>
          {error}
        </div>
      </div>
      {aside}
    </div>
  );
}
```

- [ ] **Step 3: Wire `Checker`**

In `components/Checker/index.tsx`:

1. Add `import { Board } from "./board";` beside `import { BulkProgress, EmptyState, ErrorState } from "./states";`.
2. Add the prop to the signature and its type:

```tsx
export default function Checker({
  initialQuery,
  initialResult,
  idleAside,
}: Readonly<{
  initialQuery?: string;
  /** A server-fetched cached result for a permalink (/check/<ioc>). When present
   *  it is shown immediately on first paint, skipping the client lookup. */
  initialResult?: AnyCheckResult | null;
  /** The homepage's source rail. When set, the idle page renders as the
   *  split `Board` instead of the lookup card; only `/` passes it. */
  idleAside?: React.ReactNode;
}>) {
```

3. Right after the `searchBox` const, pull the hint, the chips and the error into consts so both layouts share them, and branch:

```tsx
  const detectionHint = (
    <DetectionHint
      trimmed={trimmed}
      bulkCount={bulkPreview?.length}
      detected={detected}
      canonical={canonical}
    />
  );

  const exampleChips = (
    <>
      <span className="font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
        Try
      </span>
      {EXAMPLE_CHIPS.map(({ value, label, icon: ChipIcon }) => (
        <button
          key={value}
          type="button"
          onClick={() => {
            setQuery(value);
            runCheck(value);
          }}
          className="group inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 font-mono text-xs text-foreground/80 transition-colors hover:border-foreground/40 hover:text-foreground"
        >
          <ChipIcon className="size-3.5 text-muted-foreground transition-colors group-hover:text-foreground" />
          {label}
        </button>
      ))}
    </>
  );

  const errorState = error && (
    <ErrorState
      error={error}
      examples={EXAMPLES}
      onRetry={() => runCheck(query)}
      onExample={(s) => {
        setQuery(s);
        runCheck(s);
      }}
    />
  );

  if (idleAside && !showCompact && !isBulk && !bulkRows) {
    return (
      <Board
        search={searchBox}
        hint={detectionHint}
        chips={exampleChips}
        error={errorState}
        aside={idleAside}
      />
    );
  }
```

4. In the existing return, replace the inline `<DetectionHint … />` with `{detectionHint}`, the chip `<span>Try</span>` + `EXAMPLE_CHIPS.map(…)` children of the `border-t` div with `{exampleChips}`, and the `{error && (<ErrorState … />)}` block with `{errorState}`. The markup produced must be identical to before; nothing else in that return changes.

If `bun run lint` then reports `sonarjs/cognitive-complexity` on `Checker`, move the `idleAside && …` condition into a const (`const boardIdle = Boolean(idleAside) && !showCompact && !isBulk && !bulkRows;`) and branch on `boardIdle`; if it still reports, move the `exampleChips` JSX into a small `ExampleChips({ onPick })` component in `board.tsx` and use it in both layouts.

- [ ] **Step 4: Wire the page**

`app/page.tsx`:

```tsx
import { Suspense } from "react";
import { connection } from "next/server";
import Checker from "@/components/Checker";
import { SourceRail, SourceRailSkeleton } from "@/components/Home/source-rail";
import { HEALTH_GROUPS, readHealth } from "@/lib/ti/health-store";

export default function Home() {
  return (
    <main className="relative flex min-h-full flex-1 flex-col">
      <Checker
        idleAside={
          <Suspense fallback={<SourceRailSkeleton />}>
            <LiveSourceRail />
          </Suspense>
        }
      />
    </main>
  );
}

/** Streams in after the search is already on screen. `connection()` keeps the
 *  page from being prerendered at build time with that moment's health. */
async function LiveSourceRail() {
  await connection();
  const board = await readHealth(HEALTH_GROUPS);
  return <SourceRail board={board} now={Date.now()} />;
}
```

- [ ] **Step 5: Static checks**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: all three pass. Fix any lint finding per Step 3's note.

- [ ] **Step 6: Look at it**

With the dev server on :3001, run a few lookups first so there is data (fresh ones, `?refresh=1`):

```bash
for q in "check?ip=8.8.8.8" "check-domain?domain=google.com" "check-hash?hash=44d88612fea8a8f36de82e1278abb02f"; do curl -s "http://localhost:3001/api/$q&refresh=1" -o /dev/null; done
```

Run: `OUT=/tmp/claude-1000/-home-siriwat-dev-debian-Documents-project-ophanim/1ba0f2e7-b646-4ba6-8afe-7b3465a2a92b/scratchpad/after PATHS=/ node scripts/page-shots.mjs`
Expected: `root-light.png` and `root-dark.png` show headline + search on the left, the rail with graded rows on the right, no page scroll at 900 px tall. Compare against option D in `.superpowers/brainstorm/60620-1790515380/content/homepage-v2.html`.

- [ ] **Step 7: Commit**

```bash
git add components/Home/source-rail.tsx components/Checker/board.tsx components/Checker/index.tsx app/page.tsx
git commit -m "feat(ui): the homepage as a departures board of source health

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0198Ym7oFCWaB8RwCvhczKJ3"
```

---

### Task 6: Verify the boundary and the behaviour

No new code unless a check fails.

- [ ] **Step 1: `/check` and `/scan` did not move**

Run: `OUT=/tmp/claude-1000/-home-siriwat-dev-debian-Documents-project-ophanim/1ba0f2e7-b646-4ba6-8afe-7b3465a2a92b/scratchpad/after PATHS=/check/8.8.8.8,/scan node scripts/page-shots.mjs`

Then compare against Task 1's baseline:

```bash
S=/tmp/claude-1000/-home-siriwat-dev-debian-Documents-project-ophanim/1ba0f2e7-b646-4ba6-8afe-7b3465a2a92b/scratchpad
python3 - "$S" <<'EOF'
import sys
from PIL import Image, ImageChops
s = sys.argv[1]
for n in ["_check_8_8_8_8-light", "_check_8_8_8_8-dark", "_scan-light", "_scan-dark"]:
    a, b = Image.open(f"{s}/baseline/{n}.png").convert("RGB"), Image.open(f"{s}/after/{n}.png").convert("RGB")
    if a.size != b.size:
        print(n, "SIZE DIFFERS", a.size, b.size); continue
    box = ImageChops.difference(a, b).getbbox()
    print(n, "identical" if box is None else f"differs in {box}")
EOF
```

Expected: `/scan` identical. `/check/8.8.8.8` identical, or differing only inside the "Checked" rail's relative time or the prior-checks count (live data). Anything else is a regression: fix it before continuing.

- [ ] **Step 2: Health leaves once a lookup starts**

Write `scripts/.home-submit.mjs` (deleted after), run it, look at the three shots:

```js
import { chromium } from "playwright";
const OUT = process.argv[2];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
// Hold the rail's data so its skeleton can be photographed.
await p.goto("http://localhost:3001/", { waitUntil: "commit" });
await p.screenshot({ path: `${OUT}/home-pending.png` });
await p.waitForLoadState("networkidle");
await p.getByText("Every source is asked in parallel").waitFor();
await p.getByLabel("IOC to check").click();
await p.keyboard.type("8.8.8.8");
await p.keyboard.press("Enter");
await p.locator('[aria-label="Risk score"]').first().waitFor({ timeout: 60000 });
await p.screenshot({ path: `${OUT}/home-after-submit.png`, fullPage: true });
console.log("rail present after submit:", await p.getByLabel("Source health").count());
await b.close();
```

Run: `node scripts/.home-submit.mjs /tmp/claude-1000/-home-siriwat-dev-debian-Documents-project-ophanim/1ba0f2e7-b646-4ba6-8afe-7b3465a2a92b/scratchpad/after && rm scripts/.home-submit.mjs`
Expected: `rail present after submit: 0`; `home-after-submit.png` looks like `/check/8.8.8.8`. `home-pending.png` may already show the live rail on a fast Redis; that is fine, the no-shift check below is the one that matters.

- [ ] **Step 3: No layout shift when the rail resolves**

`scripts/verify-loading.mjs` does not visit `/`, so measure it directly. Under
`next dev` the Suspense boundary still streams, which is the only thing this
checks. Write `scripts/.home-cls.mjs` (deleted after):

```js
import { chromium } from "playwright";
const b = await chromium.launch();
for (const theme of ["light", "dark"]) {
  const p = await b.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: theme });
  await p.addInitScript(() => {
    window.__cls = 0;
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  await p.goto("http://localhost:3001/", { waitUntil: "networkidle" });
  await p.waitForTimeout(1000);
  console.log(theme, "CLS", await p.evaluate(() => window.__cls));
  await p.close();
}
await b.close();
```

Run: `node scripts/.home-cls.mjs && rm scripts/.home-cls.mjs`
Expected: `CLS 0` for both themes (anything under 0.01 is acceptable and must be reported as the number, not rounded away).

- [ ] **Step 4: Full checks**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: all pass.

- [ ] **Step 5: Report**

Send the user `root-light.png`, `root-dark.png` and `home-after-submit.png`, and state the boundary-diff output verbatim. Do not push.
