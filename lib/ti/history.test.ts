import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HistorySnapshot } from "@/lib/ti/types";

// history.ts reaches Redis only through the cache module's shared client, so
// mocking that one function is enough to exercise the whole file without a
// socket. `getRedis()` is called per operation rather than memoized here, so no
// module reset is needed between tests.
const { getRedisMock } = vi.hoisted(() => ({ getRedisMock: vi.fn() }));
vi.mock("@/lib/ti/cache", () => ({ getRedis: getRedisMock }));

const { getHistory, recordHistory } = await import("@/lib/ti/history");

// LPUSH and LTRIM go out as one pipeline, so the chain itself is the thing
// under test: recordHistory calls redis.pipeline().lpush(...).ltrim(...).exec().
const pipeline = {
  lpush: vi.fn(),
  ltrim: vi.fn(),
  exec: vi.fn(),
};

const redis = {
  lrange: vi.fn(),
  lindex: vi.fn(),
  pipeline: vi.fn(() => pipeline),
};

const NOW = new Date("2026-08-26T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

/** A snapshot `agoMs` before the frozen clock. */
const snap = (
  riskScore: number,
  verdict: HistorySnapshot["verdict"],
  agoMs = 0,
): HistorySnapshot => ({
  riskScore,
  verdict,
  checkedAt: new Date(NOW.getTime() - agoMs).toISOString(),
});

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  redis.lrange.mockReset().mockResolvedValue([]);
  redis.lindex.mockReset().mockResolvedValue(null);
  redis.pipeline.mockReset().mockReturnValue(pipeline);
  pipeline.lpush.mockReset().mockReturnValue(pipeline);
  pipeline.ltrim.mockReset().mockReturnValue(pipeline);
  pipeline.exec.mockReset().mockResolvedValue([]);
  getRedisMock.mockReset();
  getRedisMock.mockReturnValue(redis);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  errorSpy.mockRestore();
});

describe("getHistory", () => {
  // Without credentials the whole feature is absent, which is a supported
  // configuration: an empty timeline, not an error.
  it("returns an empty timeline when there is no Redis", async () => {
    getRedisMock.mockReturnValue(null);
    await expect(getHistory("ip", "1.1.1.1")).resolves.toEqual([]);
    expect(redis.lrange).not.toHaveBeenCalled();
  });

  it("reads one namespaced key, bounded to the 30 most recent", async () => {
    await getHistory("domain", "evil.com");
    expect(redis.lrange).toHaveBeenCalledWith("ti:hist:domain:evil.com", 0, 29);
  });

  it("keeps each kind in its own namespace", async () => {
    await getHistory("ip", "same");
    await getHistory("hash", "same");
    expect(redis.lrange.mock.calls.map((c) => c[0])).toEqual([
      "ti:hist:ip:same",
      "ti:hist:hash:same",
    ]);
  });

  // The list is stored newest-first (lpush), but a timeline reads left to
  // right, so the order has to be flipped on the way out.
  it("returns oldest to newest, reversing the stored order", async () => {
    const newest = snap(90, "malicious");
    const oldest = snap(10, "clean", 2 * HOUR_MS);
    redis.lrange.mockResolvedValue([newest, oldest]);
    await expect(getHistory("ip", "1.1.1.1")).resolves.toEqual([oldest, newest]);
  });

  // Upstash normally hands back parsed objects, but a raw JSON string is a
  // shape it has been known to return, so both are accepted.
  it("accepts entries stored as raw JSON strings", async () => {
    const point = snap(42, "suspicious");
    redis.lrange.mockResolvedValue([JSON.stringify(point)]);
    await expect(getHistory("ip", "1.1.1.1")).resolves.toEqual([point]);
  });

  // A single unreadable entry must not take the timeline down with it.
  it.each([
    ["unparseable JSON", "{not json"],
    ["a bare string", "hello"],
    ["null", null],
    ["a number", 7],
    ["a missing riskScore", { checkedAt: NOW.toISOString() }],
    ["a non-numeric riskScore", { riskScore: "90", checkedAt: NOW.toISOString() }],
    ["a missing checkedAt", { riskScore: 90 }],
    ["a non-string checkedAt", { riskScore: 90, checkedAt: 1_724_000_000 }],
  ])("drops an entry with %s while keeping the good ones", async (_label, bad) => {
    const good = snap(50, "low");
    redis.lrange.mockResolvedValue([bad, good]);
    await expect(getHistory("ip", "1.1.1.1")).resolves.toEqual([good]);
  });

  // Same reasoning as the cache: a timeline is an extra, so a failed read
  // degrades to "no history" rather than failing the lookup around it.
  it("treats a failed read as an empty timeline", async () => {
    redis.lrange.mockRejectedValue(new Error("upstream down"));
    await expect(getHistory("ip", "1.1.1.1")).resolves.toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("recordHistory", () => {
  it("does nothing when there is no Redis", async () => {
    getRedisMock.mockReturnValue(null);
    await expect(
      recordHistory("ip", "1.1.1.1", snap(90, "malicious")),
    ).resolves.toBeNull();
    expect(redis.pipeline).not.toHaveBeenCalled();
  });

  // Returning the written snapshot (rather than void) is what lets a caller
  // holding the pre-write history extend it locally instead of re-reading it.
  it("appends to an empty timeline, trims it to 30, and returns what it wrote", async () => {
    const point = snap(90, "malicious");
    await expect(recordHistory("ip", "1.1.1.1", point)).resolves.toEqual(point);
    expect(pipeline.lpush).toHaveBeenCalledWith("ti:hist:ip:1.1.1.1", point);
    expect(pipeline.ltrim).toHaveBeenCalledWith("ti:hist:ip:1.1.1.1", 0, 29);
    expect(pipeline.exec).toHaveBeenCalled();
  });

  it("reads the newest entry to compare against", async () => {
    await recordHistory("ip", "1.1.1.1", snap(90, "malicious"));
    expect(redis.lindex).toHaveBeenCalledWith("ti:hist:ip:1.1.1.1", 0);
  });

  // The dedupe rule: re-checking the same indicator repeatedly must not flood
  // the timeline with identical points.
  it("skips a point identical to a recent one", async () => {
    redis.lindex.mockResolvedValue(snap(90, "malicious", 30 * 60 * 1000));
    await expect(
      recordHistory("ip", "1.1.1.1", snap(90, "malicious")),
    ).resolves.toBeNull();
    expect(redis.pipeline).not.toHaveBeenCalled();
  });

  it("compares against a latest entry stored as a JSON string too", async () => {
    redis.lindex.mockResolvedValue(
      JSON.stringify(snap(90, "malicious", 30 * 60 * 1000)),
    );
    await expect(
      recordHistory("ip", "1.1.1.1", snap(90, "malicious")),
    ).resolves.toBeNull();
  });

  // Dedupe requires score AND verdict AND recency to all match. Each of these
  // is the one thing that differs, so each must still record a point.
  it("records when the score moved", async () => {
    redis.lindex.mockResolvedValue(snap(80, "malicious", 5 * 60 * 1000));
    await recordHistory("ip", "1.1.1.1", snap(90, "malicious"));
    expect(pipeline.lpush).toHaveBeenCalled();
  });

  it("records when only the verdict moved", async () => {
    redis.lindex.mockResolvedValue(snap(90, "suspicious", 5 * 60 * 1000));
    await recordHistory("ip", "1.1.1.1", snap(90, "malicious"));
    expect(pipeline.lpush).toHaveBeenCalled();
  });

  it("records an identical reading once the window has passed", async () => {
    redis.lindex.mockResolvedValue(snap(90, "malicious", 2 * HOUR_MS));
    await recordHistory("ip", "1.1.1.1", snap(90, "malicious"));
    expect(pipeline.lpush).toHaveBeenCalled();
  });

  // The window is exclusive: exactly an hour old is no longer "recent".
  it("records at exactly the one-hour boundary", async () => {
    redis.lindex.mockResolvedValue(snap(90, "malicious", HOUR_MS));
    await recordHistory("ip", "1.1.1.1", snap(90, "malicious"));
    expect(pipeline.lpush).toHaveBeenCalled();
  });

  it("skips just inside the boundary", async () => {
    redis.lindex.mockResolvedValue(snap(90, "malicious", HOUR_MS - 1));
    await expect(
      recordHistory("ip", "1.1.1.1", snap(90, "malicious")),
    ).resolves.toBeNull();
  });

  // An entry whose timestamp will not parse cannot be shown to be recent, so
  // the point is recorded rather than silently dropped.
  it("records when the stored timestamp is unparseable", async () => {
    redis.lindex.mockResolvedValue({ riskScore: 90, verdict: "malicious", checkedAt: "whenever" });
    await recordHistory("ip", "1.1.1.1", snap(90, "malicious"));
    expect(pipeline.lpush).toHaveBeenCalled();
  });

  it("records when the stored entry is unreadable", async () => {
    redis.lindex.mockResolvedValue("{not json");
    await recordHistory("ip", "1.1.1.1", snap(90, "malicious"));
    expect(pipeline.lpush).toHaveBeenCalled();
  });

  // A pipelined write fails as one unit: either command erroring rejects the
  // same exec() call, so there is one failure mode to swallow, not two.
  it("swallows a failed pipelined write", async () => {
    pipeline.exec.mockRejectedValue(new Error("quota exceeded"));
    await expect(
      recordHistory("ip", "1.1.1.1", snap(90, "malicious")),
    ).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });
});
