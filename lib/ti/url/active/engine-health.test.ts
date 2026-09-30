import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveScan } from "@/lib/ti/url/active/types";

// Redis is reached only through the cache module's getRedis(), and the quota
// only through http's getJson, so mocking those two is enough.
const { getRedisMock, getJsonMock } = vi.hoisted(() => ({ getRedisMock: vi.fn(), getJsonMock: vi.fn() }));
vi.mock("@/lib/ti/cache", () => ({ getRedis: getRedisMock }));
vi.mock("@/lib/ti/http", async (orig) => ({
  ...(await orig<typeof import("@/lib/ti/http")>()),
  getJson: getJsonMock,
}));

const { quotaFrom, readEngineBoard, recordEngineHealth, scanOutcomes } = await import(
  "@/lib/ti/url/active/engine-health"
);

const pipeline = { lpush: vi.fn(), ltrim: vi.fn(), lrange: vi.fn(), exec: vi.fn() };
const redis = { pipeline: vi.fn(() => pipeline) };

const SUBMITTED = "2026-09-27T12:00:00.000Z";
const NOW = Date.parse(SUBMITTED) + 34_000;

const scan = (engine: ActiveScan["engine"], status: ActiveScan["status"], error?: string): ActiveScan => ({
  target: "https://example.org/",
  engine,
  status,
  ...(error ? { error } : {}),
});

const window = (remaining: number, limit: number) => ({ remaining, limit, used: limit - remaining, percent: 0 });

const QUOTA = {
  scope: "user",
  limits: {
    search: { day: window(1000, 1000), hour: window(1000, 1000) },
    private: { day: window(48, 50), hour: window(9, 10), lastIP: "203.0.113.9" },
    unlisted: { day: window(990, 1000), hour: window(100, 100) },
  },
};

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  for (const fn of [pipeline.lpush, pipeline.ltrim, pipeline.lrange]) fn.mockReset().mockReturnValue(pipeline);
  pipeline.exec.mockReset().mockResolvedValue([]);
  redis.pipeline.mockReset().mockReturnValue(pipeline);
  getRedisMock.mockReset().mockReturnValue(redis);
  getJsonMock.mockReset().mockResolvedValue({ ok: true, status: 200, data: QUOTA, text: "" });
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => errorSpy.mockRestore());

describe("scanOutcomes", () => {
  it("records only a refused submission, since a running scan has not settled", () => {
    const out = scanOutcomes(null, [scan("urlscan", "running"), scan("cloudflare", "error", "HTTP 403")], SUBMITTED, NOW);
    expect(out).toEqual([{ engine: "cloudflare", entry: { s: "error", ms: 0, t: NOW, e: "HTTP 403" } }]);
  });

  it("records a scan finishing with the time since submission", () => {
    const out = scanOutcomes([scan("urlscan", "running")], [scan("urlscan", "done")], SUBMITTED, NOW);
    expect(out).toEqual([{ engine: "urlscan", entry: { s: "ok", ms: 34_000, t: NOW } }]);
  });

  it("records nothing for a scan whose status did not change", () => {
    expect(scanOutcomes([scan("urlscan", "done")], [scan("urlscan", "done")], SUBMITTED, NOW)).toEqual([]);
    expect(scanOutcomes([scan("urlscan", "running")], [scan("urlscan", "running")], SUBMITTED, NOW)).toEqual([]);
  });

  it("records nothing for a finish first seen long after nobody was watching", () => {
    const nextDay = Date.parse(SUBMITTED) + 24 * 3_600_000;
    expect(scanOutcomes([scan("urlscan", "running")], [scan("urlscan", "done")], SUBMITTED, nextDay)).toEqual([]);
    const [late] = scanOutcomes([scan("urlscan", "running")], [scan("urlscan", "error")], SUBMITTED, nextDay);
    expect(late.entry.s).toBe("error");
  });

  it("names an error without a message and caps a long one", () => {
    const [bare] = scanOutcomes([scan("urlscan", "running")], [scan("urlscan", "error")], SUBMITTED, NOW);
    expect(bare.entry.e).toBe("Scan failed");
    const [long] = scanOutcomes(null, [scan("urlscan", "error", "x".repeat(500))], SUBMITTED, NOW);
    expect(long.entry.e).toHaveLength(200);
  });

  it("keeps a finish with an unreadable submission time rather than dropping it", () => {
    const [out] = scanOutcomes([scan("urlscan", "running")], [scan("urlscan", "done")], "garbage", NOW);
    expect(out.entry).toEqual({ s: "ok", ms: 0, t: NOW });
  });
});

describe("recordEngineHealth", () => {
  it("pushes each outcome onto its engine's list", async () => {
    await recordEngineHealth([{ engine: "urlscan", entry: { s: "ok", ms: 1, t: 2 } }]);
    expect(pipeline.lpush).toHaveBeenCalledWith("ti:health:scan:urlscan", { s: "ok", ms: 1, t: 2 });
    expect(pipeline.ltrim).toHaveBeenCalledWith("ti:health:scan:urlscan", 0, 49);
  });

  it("does not open a pipeline for nothing", async () => {
    await recordEngineHealth([]);
    expect(redis.pipeline).not.toHaveBeenCalled();
  });
});

describe("quotaFrom", () => {
  it("keeps the visibilities a scan is submitted at, in order, and only the counts", () => {
    expect(quotaFrom(QUOTA)).toEqual([
      { visibility: "private", day: { remaining: 48, limit: 50 }, hour: { remaining: 9, limit: 10 } },
      { visibility: "unlisted", day: { remaining: 990, limit: 1000 }, hour: { remaining: 100, limit: 100 } },
    ]);
  });

  it("is empty for anything it does not recognise", () => {
    expect(quotaFrom(null)).toEqual([]);
    expect(quotaFrom({ limits: { private: { day: { remaining: "a" } } } })).toEqual([]);
  });
});

describe("readEngineBoard", () => {
  const ok = Array.from({ length: 10 }, (_, i) => ({ s: "ok", ms: 30_000, t: NOW - i }));

  it("grades both engines and attaches urlscan's quota", async () => {
    pipeline.exec.mockResolvedValue([ok, []]);
    const board = await readEngineBoard({ urlscanKey: "k", cfReady: false, any: true });
    expect(pipeline.lrange.mock.calls.map((c) => c[0])).toEqual(["ti:health:scan:urlscan", "ti:health:scan:cloudflare"]);
    expect(board.recorded).toBe(true);
    expect(board.newestAt).toBe(NOW);
    const [urlscan, cloudflare] = board.engines;
    expect(urlscan).toMatchObject({ id: "urlscan", name: "urlscan.io", grade: "healthy", medianMs: 30_000 });
    expect(urlscan.quota?.[0].visibility).toBe("private");
    expect(getJsonMock.mock.calls[0][2]).toEqual({ "API-Key": "k" });
    expect(cloudflare).toMatchObject({ id: "cloudflare", grade: "no-key" });
    expect(cloudflare).not.toHaveProperty("quota");
  });

  it("grades a scan slow past a minute", async () => {
    pipeline.exec.mockResolvedValue([ok.map((e) => ({ ...e, ms: 61_000 })), []]);
    const board = await readEngineBoard({ urlscanKey: "k", cfReady: true, any: true });
    expect(board.engines[0].grade).toBe("slow");
    expect(board.engines[1].grade).toBe("no-data");
  });

  it("still lists the engines and the quota without Redis", async () => {
    getRedisMock.mockReturnValue(null);
    const board = await readEngineBoard({ urlscanKey: "k", cfReady: false, any: true });
    expect(board.recorded).toBe(false);
    expect(board.engines[0]).toMatchObject({ grade: "no-data", runs: 0 });
    expect(board.engines[0].quota).toHaveLength(2);
  });

  it("does not ask for a quota without a urlscan key", async () => {
    await readEngineBoard({ cfReady: true, any: true });
    expect(getJsonMock).not.toHaveBeenCalled();
  });

  it("treats a refused or failed quota read as unknown", async () => {
    getJsonMock.mockResolvedValueOnce({ ok: false, status: 401, data: null, text: "" });
    expect((await readEngineBoard({ urlscanKey: "k", cfReady: false, any: true })).engines[0].quota).toBeNull();
    getJsonMock.mockRejectedValueOnce(new Error("down"));
    expect((await readEngineBoard({ urlscanKey: "k", cfReady: false, any: true })).engines[0].quota).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });
});
