import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BulkRow } from "./types";

const kv = new Map<string, unknown>();
const fake = {
  get: vi.fn(async (k: string) => kv.get(k) ?? null),
  set: vi.fn<(k: string, v: unknown, o: { ex: number }) => Promise<string>>(async (k, v) => {
    kv.set(k, v);
    return "OK";
  }),
};
let redis: typeof fake | null = fake;
const shared = vi.fn();
vi.mock("../cache", () => ({ getRedis: () => redis, getCachedResultFor: (...a: unknown[]) => shared(...a) }));

const rc = await import("./row-cache");
const NOW = new Date("2026-10-07T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const row = (over: Partial<BulkRow>): BulkRow => ({ id: 0, indicator: "1.2.3.4", kind: "ip", state: "full", results: [], pending: [], missing: [], ...over });

beforeEach(() => {
  kv.clear();
  redis = fake;
  shared.mockReset();
  fake.set.mockClear();
});

describe("isFresh", () => {
  it("gives bad verdicts 24h and the rest 7 days", () => {
    expect(rc.isFresh("malicious", hoursAgo(23), NOW)).toBe(true);
    expect(rc.isFresh("suspicious", hoursAgo(25), NOW)).toBe(false);
    expect(rc.isFresh("clean", hoursAgo(24 * 6), NOW)).toBe(true);
    expect(rc.isFresh("low", hoursAgo(24 * 8), NOW)).toBe(false);
  });
});

describe("readSharedFull", () => {
  it("returns a fresh /check result and drops a stale one or a miss", async () => {
    shared.mockResolvedValueOnce({ sources: [], riskScore: 80, verdict: "malicious", checkedAt: hoursAgo(2) });
    expect(await rc.readSharedFull("ip", "1.2.3.4", NOW)).toMatchObject({ riskScore: 80 });
    shared.mockResolvedValueOnce({ sources: [], riskScore: 80, verdict: "malicious", checkedAt: hoursAgo(30) });
    expect(await rc.readSharedFull("ip", "1.2.3.4", NOW)).toBeNull();
    shared.mockResolvedValueOnce(null);
    expect(await rc.readSharedFull("domain", "x.com", NOW)).toBeNull();
  });
});

describe("bulk row cache", () => {
  it("keeps unfinished rows 24h, clean full rows 7 days, bad rows 24h", async () => {
    await rc.writeBulkRow(row({ state: "partial", verdict: "clean" }));
    await rc.writeBulkRow(row({ state: "pass1", verdict: "clean" }));
    await rc.writeBulkRow(row({ state: "full", verdict: "clean" }));
    await rc.writeBulkRow(row({ state: "full", verdict: "malicious" }));
    expect(fake.set.mock.calls.map((c) => c[2].ex)).toEqual([86_400, 86_400, 604_800, 86_400]);
  });

  it("reads back fresh rows only, and any row for resuming", async () => {
    await rc.writeBulkRow(row({ verdict: "clean", checkedAt: hoursAgo(1) }));
    expect(await rc.readBulkRow("ip", "1.2.3.4", NOW)).toMatchObject({ verdict: "clean" });
    kv.set("ti:bulk:v1:row:ip:1.2.3.4", row({ verdict: "malicious", checkedAt: hoursAgo(30) }));
    expect(await rc.readBulkRow("ip", "1.2.3.4", NOW)).toBeNull();
    expect(await rc.readBulkRowAny("ip", "1.2.3.4")).toMatchObject({ verdict: "malicious" });
    kv.set("ti:bulk:v1:row:ip:1.2.3.4", row({}));
    expect(await rc.readBulkRow("ip", "1.2.3.4", NOW)).toBeNull();
    expect(await rc.readBulkRowAny("domain", "never.example")).toBeNull();
  });

  it("degrades without Redis and on Redis errors", async () => {
    redis = null;
    await expect(rc.writeBulkRow(row({}))).resolves.toBeUndefined();
    expect(await rc.readBulkRow("ip", "1.2.3.4", NOW)).toBeNull();
    expect(await rc.readBulkRowAny("ip", "1.2.3.4")).toBeNull();
    redis = fake;
    fake.get.mockRejectedValueOnce(new Error("down"));
    expect(await rc.readBulkRowAny("ip", "1.2.3.4")).toBeNull();
    fake.set.mockRejectedValueOnce(new Error("down"));
    await expect(rc.writeBulkRow(row({ verdict: "clean" }))).resolves.toBeUndefined();
  });
});
