# Cached-permalink Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make cached permalink lookups paint instantly and cut redundant Redis round trips on the result path.

**Architecture:** Two independent changes. (1) `lib/ti/route-handler.ts`: add an edge `Cache-Control` header to cached GET responses and parallelize independent Redis calls. (2) `components/Checker.tsx`: allow the already-cached result to server-render by dropping `ssr:false` from the `CheckResults` dynamic import, after auditing the card tree for SSR safety.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Vitest, Upstash Redis (optional).

## Global Constraints

- Free APIs only; no new dependencies.
- User-facing copy uses commas, not dashes.
- HTTP helpers/caching stay uniform; the streaming POST keeps `no-store`.
- `npm test` and `npm run lint` must pass before a task is done.
- Tests are pure/unit, no network, live at `lib/**/*.test.ts`, import via `@/`.

---

### Task 1: Route-handler edge cache header + parallel Redis reads

Covers spec sections 2 (edge-cache GET) and 3 (parallel Redis). Both edit the
same two functions in one file, so they share a test cycle.

**Files:**
- Modify: `lib/ti/route-handler.ts` (`jsonResult` ~56-76, `streamResult` cached branch ~87-97 and fresh path ~102-110)
- Test: `lib/ti/route-handler.test.ts` (create)

**Interfaces:**
- Consumes: `makeIndicatorRoute<V, R>(config)` returning `{ GET, POST }`; `RouteConfig` fields `paramName`, `label`, `sources`, `validate`, `getCached`, `setCached`, `run`; `IndicatorResult` shape `{ sources, riskScore, verdict, checkedAt }`.
- Produces: unchanged public API. New internal constant `CACHE_HEADERS`. Behaviour: cached GET responses carry `Cache-Control: public, s-maxage=300, stale-while-revalidate=86400`; fresh and error responses do not.

- [ ] **Step 1: Write the failing test**

Create `lib/ti/route-handler.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// In-memory history store shared by the mock, so recordHistory -> getHistory
// ordering is observable without Redis.
const { store } = vi.hoisted(() => ({ store: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/ti/history", () => ({
  recordHistory: async (_k: string, _v: string, snap: Record<string, unknown>) => {
    store.push(snap);
  },
  getHistory: async () => [...store],
}));

import { makeIndicatorRoute } from "@/lib/ti/route-handler";

type Result = {
  sources: never[];
  riskScore: number;
  verdict: "clean";
  checkedAt: string;
};

const RESULT: Result = {
  sources: [],
  riskScore: 10,
  verdict: "clean",
  checkedAt: "2026-01-01T00:00:00Z",
};

function makeRoute(over: Partial<Parameters<typeof makeIndicatorRoute<string, Result>>[0]> = {}) {
  return makeIndicatorRoute<string, Result>({
    paramName: "ip",
    label: "ip",
    sources: [],
    validate: (raw) =>
      raw ? { value: raw } : { error: Response.json({ error: "bad" }, { status: 422 }) },
    getCached: async () => null,
    setCached: async () => {},
    run: async () => RESULT,
    ...over,
  });
}

function get(value = "1.1.1.1") {
  return new NextRequest(`http://localhost/api/check?ip=${value}`);
}

describe("makeIndicatorRoute GET caching", () => {
  it("sets Cache-Control on a cached hit", async () => {
    const { GET } = makeRoute({ getCached: async () => RESULT });
    const res = await GET(get());
    expect(res.headers.get("cache-control")).toContain("s-maxage=300");
    const body = (await res.json()) as { cached: boolean };
    expect(body.cached).toBe(true);
  });

  it("does not set Cache-Control on a fresh compute", async () => {
    const { GET } = makeRoute();
    const res = await GET(get());
    expect(res.headers.get("cache-control")).toBeNull();
    const body = (await res.json()) as { cached: boolean };
    expect(body.cached).toBe(false);
  });

  it("does not set Cache-Control on an error", async () => {
    const { GET } = makeRoute({
      run: async () => {
        throw new Error("boom");
      },
    });
    const res = await GET(get());
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBeNull();
  });

  it("fresh path returns the just-recorded history snapshot", async () => {
    store.length = 0;
    const { GET } = makeRoute();
    const res = await GET(get("9.9.9.9"));
    const body = (await res.json()) as { history: Array<{ riskScore: number }> };
    expect(body.history.at(-1)?.riskScore).toBe(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- route-handler`
Expected: FAIL. The two "does not set Cache-Control" cases pass by accident, but "sets Cache-Control on a cached hit" FAILS (`cache-control` is null today).

- [ ] **Step 3: Implement the header + parallelism**

In `lib/ti/route-handler.ts`, add the constant next to `STREAM_HEADERS`:

```ts
const CACHE_HEADERS = {
  // A cached result is deterministic for the TTL window, so let the edge serve
  // repeat lookups. Embedded history can be at most s-maxage stale (acceptable
  // for an append-only timeline). Fresh and error responses stay uncached.
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400",
};
```

Replace `jsonResult` with:

```ts
  async function jsonResult(value: V, refresh: boolean): Promise<Response> {
    const histKey = String(value);
    if (!refresh) {
      // Speculatively read cache + history together; discard history on a miss.
      const [cached, history] = await Promise.all([
        config.getCached(value),
        getHistory(config.label, histKey),
      ]);
      if (cached) {
        return Response.json(
          { ...cached, cached: true, history },
          { headers: CACHE_HEADERS },
        );
      }
    }

    try {
      const result = await config.run(value);
      // setCached is independent of the history write/read; overlap them.
      const [, history] = await Promise.all([
        config.setCached(value, result),
        recordHistory(config.label, histKey, snapshotOf(result)).then(() =>
          getHistory(config.label, histKey),
        ),
      ]);
      return Response.json({ ...result, cached: false, history });
    } catch (err) {
      console.error(`[ti] ${config.label} check failed:`, err);
      return Response.json({ error: GENERIC_ERROR }, { status: 502 });
    }
  }
```

Replace the `streamResult` cached branch (the `if (!refresh) { ... }` block):

```ts
          if (!refresh) {
            const [cached, history] = await Promise.all([
              config.getCached(value),
              getHistory(config.label, histKey),
            ]);
            if (cached) {
              send({
                type: "done",
                result: { ...cached, cached: true, history },
              });
              return;
            }
          }
```

Replace the `streamResult` fresh tail (from `await config.setCached` through the `send({ type: "done" ... })`):

```ts
          const [, history] = await Promise.all([
            config.setCached(value, result),
            recordHistory(config.label, histKey, snapshotOf(result)).then(() =>
              getHistory(config.label, histKey),
            ),
          ]);
          send({ type: "done", result: { ...result, cached: false, history } });
```

- [ ] **Step 4: Run tests + lint**

Run: `npm test -- route-handler`
Expected: PASS (4 passing).
Run: `npm test`
Expected: whole suite PASS.
Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/route-handler.ts lib/ti/route-handler.test.ts
git commit -m "perf(route): edge-cache cached GET, parallelize Redis reads"
```

---

### Task 2: Server-render cached results

Covers spec section 1. Enables SSR of the already-cached result so a permalink
paints the verdict in the initial HTML.

**Files:**
- Modify: `components/Checker.tsx:199` (the `CheckResults` dynamic import)
- Audit (read, modify only if unsafe): `components/CheckResults/*.tsx`

**Interfaces:**
- Consumes: `page.tsx` already passes `initialResult`, seeded into Checker's `result` state (`Checker.tsx:234`); the mount effect does not re-run the lookup when a result is present (`Checker.tsx:259-266`).
- Produces: cached permalinks server-render `CheckResults`; home page (`result === null`) renders nothing extra. `CheckResults` stays code-split on the client.

- [ ] **Step 1: Audit the card tree for render-time browser access**

Run: `grep -rn "window\|document\|localStorage\|navigator\|IntersectionObserver\|matchMedia" components/CheckResults`
Expected: every hit is inside a `useEffect`/event handler (SSR-safe), like `location-map.tsx`'s `IntersectionObserver`. If any hit is at render/module top level, wrap it in a mount guard (`const [m, setM] = useState(false); useEffect(() => setM(true), [])`) or move it into `useEffect` before proceeding.

- [ ] **Step 2: Enable SSR on the dynamic import**

In `components/Checker.tsx`, change line 199 from:

```ts
const CheckResults = dynamic(loadCheckResults, { ssr: false });
```

to:

```ts
// SSR enabled so a cached permalink paints its verdict in the initial HTML;
// still code-split via dynamic() so the home page pays nothing for it.
const CheckResults = dynamic(loadCheckResults);
```

Leave `BulkGeoResults` (line 201) as `{ ssr: false }` (bulk results are never server-seeded).

- [ ] **Step 3: Type-check + lint + unit tests**

Run: `npm run lint`
Expected: no errors.
Run: `npm test`
Expected: PASS (unchanged; no unit test covers this client render).

- [ ] **Step 4: Manual SSR verification**

Run: `npm run build && npm run dev` (user runs their own dev server on :3000 behind ngrok; do not pkill it, ask them to restart if needed).
Then, for a permalink whose result is cached in Redis (or seed one by checking an IOC once):
- `curl -s http://localhost:3000/check/1.1.1.1 | grep -c "verdict"` (or the verdict label) → expect the verdict text present in server HTML, i.e. non-zero.
- Load the page in a browser with the devtools console open → expect no hydration warnings.
- Load the home page `/` → expect it still renders and the empty state is unchanged.

If Redis is not configured locally, SSR cannot be exercised end-to-end; say so explicitly and rely on build + lint + the code review instead.

- [ ] **Step 5: Commit**

```bash
git add components/Checker.tsx components/CheckResults
git commit -m "perf(ui): server-render cached permalink results"
```

---

## Self-Review

- **Spec coverage:** section 1 -> Task 2; section 2 -> Task 1 (header); section 3 -> Task 1 (parallelism); testing section -> Task 1 unit tests + Task 2 manual. All covered.
- **Placeholders:** none; all code shown.
- **Type consistency:** `CACHE_HEADERS` defined and used once; `getHistory`/`recordHistory`/`snapshotOf` names match `route-handler.ts`; test uses `makeIndicatorRoute<string, Result>` matching the exported generic.
- **Note:** the mocked `getHistory`/`recordHistory` in the test replace the real Redis-backed module so ordering is observable without network.
