import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HistorySnapshot } from "@/lib/ti/types";

// history.ts reaches Redis only through the cache module's shared client, so
// mocking that one function is enough to exercise the whole file without a
// socket. `getRedis()` is called per operation rather than memoized here, so no
// module reset is needed between tests.
const { getRedisMock } = vi.hoisted(() => ({ getRedisMock: vi.fn() }));
vi.mock("@/lib/ti/cache", () => ({ getRedis: getRedisMock }));

const { getHistory, recordHistory } = await import("@/lib/ti/history");

const redis = {
  lrange: vi.fn(),
  lindex: vi.fn(),
  lpush: vi.fn(),
  ltrim: vi.fn(),
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
  for (const fn of Object.values(redis)) fn.mockReset();
  redis.lrange.mockResolvedValue([]);
  redis.lindex.mockResolvedValue(null);
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
    ).resolves.toBeUndefined();
    expect(redis.lpush).not.toHaveBeenCalled();
  });

  it("appends to an empty timeline and trims it to 30", async () => {
    const point = snap(90, "malicious");
    await recordHistory("ip", "1.1.1.1", point);
    expect(redis.lpush).toHaveBeenCalledWith("ti:hist:ip:1.1.1.1", point);
    expect(redis.ltrim).toHaveBeenCalledWith("ti:hist:ip:1.1.1.1", 0, 29);
  });

  it("reads the newest entry to compare against", async () => {
    await recordHistory("ip", "1.1.1.1", snap(90, "malicious"));
    expect(redis.lindex).toHaveBeenCalledWith("ti:hist:ip:1.1.1.1", 0);
  });

  // The dedupe rule: re-checking the same indicator repeatedly must not flood
  // the timeline with identical points.
  it("skips a point identical to a recent one", async () => {
    redis.lindex.mockResolvedValue(snap(90, "malicious", 30 * 60 * 1000));
    await recordHistory("ip", "1.1.1.1", snap(90, "malicious"));
    expect(redis.lpush).not.toHaveBeenCalled();
    expect(redis.ltrim).not.toHaveBeenCalled();
  });

  it("compares against a latest entry stored as a JSON string too", async () => {
    redis.lindex.mockResolvedValue(
      JSON.stringify(snap(90, "malicious", 30 * 60 * 1000)),
    );
    await recordHistory("ip", "1.1.1.1", snap(90, "malicious"));
    expect(redis.lpush).not.toHaveBeenCalled();
  });

  // Dedupe requires score AND verdict AND recency to all match. Each of these
  // is the one thing that differs, so each must still record a point.
  it("records when the score moved", async () => {
    redis.lindex.mockResolvedValue(snap(80, "malicious", 5 * 60 * 1000));
    await recordHistory("ip", "1.1.1.1", snap(90, "malicious"));
    expect(redis.lpush).toHaveBeenCalled();
  });

  it("records when only the verdict moved", async () => {
    redis.lindex.mockResolvedValue(snap(90, "suspicious", 5 * 60 * 1000));
    await recordHistory("ip", "1.1.1.1", snap(90, "malicious"));
    expect(redis.lpush).toHaveBeenCalled();
  });

  it("records an identical reading once the window has passed", async () => {
    redis.lindex.mockResolvedValue(snap(90, "malicious", 2 * HOUR_MS));
    await recordHistory("ip", "1.1.1.1", snap(90, "malicious"));
    expect(redis.lpush).toHaveBeenCalled();
  });

  // The window is exclusive: exactly an hour old is no longer "recent".
  it("records at exactly the one-hour boundary", async () => {
    redis.lindex.mockResolvedValue(snap(90, "malicious", HOUR_MS));
    await recordHistory("ip", "1.1.1.1", snap(90, "malicious"));
    expect(redis.lpush).toHaveBeenCalled();
  });

  it("skips just inside the boundary", async () => {
    redis.lindex.mockResolvedValue(snap(90, "malicious", HOUR_MS - 1));
    await recordHistory("ip", "1.1.1.1", snap(90, "malicious"));
    expect(redis.lpush).not.toHaveBeenCalled();
  });

  // An entry whose timestamp will not parse cannot be shown to be recent, so
  // the point is recorded rather than silently dropped.
  it("records when the stored timestamp is unparseable", async () => {
    redis.lindex.mockResolvedValue({ riskScore: 90, verdict: "malicious", checkedAt: "whenever" });
    await recordHistory("ip", "1.1.1.1", snap(90, "malicious"));
    expect(redis.lpush).toHaveBeenCalled();
  });

  it("records when the stored entry is unreadable", async () => {
    redis.lindex.mockResolvedValue("{not json");
    await recordHistory("ip", "1.1.1.1", snap(90, "malicious"));
    expect(redis.lpush).toHaveBeenCalled();
  });

  it("swallows a failed write", async () => {
    redis.lpush.mockRejectedValue(new Error("quota exceeded"));
    await expect(
      recordHistory("ip", "1.1.1.1", snap(90, "malicious")),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });

  // A trim that fails after a successful push leaves the list long but intact;
  // it must not surface to the caller either.
  it("swallows a failed trim", async () => {
    redis.ltrim.mockRejectedValue(new Error("quota exceeded"));
    await expect(
      recordHistory("ip", "1.1.1.1", snap(90, "malicious")),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });
});
