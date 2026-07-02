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
