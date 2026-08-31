import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// In-memory history store shared by the mock, so recordHistory's write is
// observable without Redis. recordHistory returns what it wrote, which is
// what lets the route append locally instead of calling getHistory again;
// getHistory is a spy so tests can assert how many round trips it took.
const { store, getHistorySpy } = vi.hoisted(() => ({
  store: [] as Array<Record<string, unknown>>,
  getHistorySpy: vi.fn(),
}));
vi.mock("@/lib/ti/history", () => ({
  recordHistory: async (_k: string, _v: string, snap: Record<string, unknown>) => {
    store.push(snap);
    return snap;
  },
  getHistory: getHistorySpy,
  MAX_SNAPSHOTS: 30,
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

function streamPost(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/check", {
    method: "POST",
    headers: { accept: "application/x-ndjson" },
    body: JSON.stringify(body),
  });
}

type NdjsonEvent = { type: string; result?: { cached: boolean } };

/** Reads an NDJSON response body to completion and parses each line. */
async function readEvents(res: Response): Promise<NdjsonEvent[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as NdjsonEvent);
}

beforeEach(() => {
  store.length = 0;
  getHistorySpy.mockReset().mockImplementation(async () => [...store]);
});

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

  it("does not set Cache-Control on a cached POST hit, which no CDN caches", async () => {
    const { POST } = makeRoute({ getCached: async () => RESULT });
    const res = await POST(
      new NextRequest("http://localhost/api/check", {
        method: "POST",
        body: JSON.stringify({ ip: "1.1.1.1" }),
      }),
    );
    const body = (await res.json()) as { cached: boolean };
    expect(body.cached).toBe(true);
    expect(res.headers.get("cache-control")).toBeNull();
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
    const { GET } = makeRoute();
    const res = await GET(get("9.9.9.9"));
    const body = (await res.json()) as { history: Array<{ riskScore: number }> };
    expect(body.history.at(-1)?.riskScore).toBe(10);
  });

  // #53: a normal miss reads history once, before the fan-out, and appends
  // the freshly recorded point locally rather than reading it back.
  it("reads history once on a normal miss, not once per phase", async () => {
    const { GET } = makeRoute();
    await GET(get("9.9.9.9"));
    expect(getHistorySpy).toHaveBeenCalledTimes(1);
  });

  // A forced refresh skips the pre-fan-out read entirely, so there is nothing
  // to append onto locally; the post-write read is the only one available.
  it("still reads history after a forced refresh, with nothing to append onto", async () => {
    const { GET } = makeRoute();
    const res = await GET(
      new NextRequest("http://localhost/api/check?ip=9.9.9.9&refresh=1"),
    );
    expect(getHistorySpy).toHaveBeenCalledTimes(1);
    const body = (await res.json()) as { history: Array<{ riskScore: number }> };
    expect(body.history.at(-1)?.riskScore).toBe(10);
  });
});

// #65: nothing verified the NDJSON event contract Checker.tsx's view state is
// inferred from. A cache hit sending only `done`, with no `start`, is legal
// under this contract and is exactly what #64 fixed the client for; pinning
// the sequence here is what would have caught the gap before it shipped.
describe("makeIndicatorRoute streaming POST", () => {
  it("sends only done, with cached true, on a cache hit", async () => {
    const { POST } = makeRoute({ getCached: async () => RESULT });
    const res = await POST(streamPost({ ip: "1.1.1.1" }));
    const events = await readEvents(res);
    expect(events.map((e) => e.type)).toEqual(["done"]);
    expect(events[0].result?.cached).toBe(true);
  });

  it("sends start, one source per settle, then done on a fresh compute", async () => {
    const { POST } = makeRoute({
      sources: [
        {
          meta: { id: "a", name: "A" },
          isEnabled: () => true,
          check: async () => ({ status: "ok" }),
        },
      ] as never,
      run: async (_v, onSettled) => {
        onSettled?.({
          status: "ok",
          source: { id: "a" },
          enabled: true,
          durationMs: 1,
        } as never);
        return RESULT;
      },
    });
    const res = await POST(streamPost({ ip: "1.1.1.1" }));
    const events = await readEvents(res);
    expect(events.map((e) => e.type)).toEqual(["start", "source", "done"]);
  });

  it("sends start even against a warm cache when refresh is requested", async () => {
    const { POST } = makeRoute({ getCached: async () => RESULT });
    const res = await POST(streamPost({ ip: "1.1.1.1", refresh: true }));
    const events = await readEvents(res);
    expect(events.map((e) => e.type)).toEqual(["start", "done"]);
    expect(events.at(-1)?.result?.cached).toBe(false);
  });

  it("sends start then error when a source throws", async () => {
    const { POST } = makeRoute({
      run: async () => {
        throw new Error("boom");
      },
    });
    const res = await POST(streamPost({ ip: "1.1.1.1" }));
    const events = await readEvents(res);
    expect(events.map((e) => e.type)).toEqual(["start", "error"]);
  });
});
