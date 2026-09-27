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
