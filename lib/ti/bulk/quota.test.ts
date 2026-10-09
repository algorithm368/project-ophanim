import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceMeta, SourceResult } from "../types";
import { keyFingerprint } from "../keys";

const store = new Map<string, number | string>();
const fake = {
  incrby: vi.fn(async (k: string, n: number) => {
    const v = Number(store.get(k) ?? 0) + n;
    store.set(k, v);
    return v;
  }),
  decrby: vi.fn(async (k: string, n: number) => {
    const v = Number(store.get(k) ?? 0) - n;
    store.set(k, v);
    return v;
  }),
  expire: vi.fn(async () => 1),
  get: vi.fn(async (k: string) => store.get(k) ?? null),
  set: vi.fn(async (k: string, v: string) => {
    store.set(k, v);
    return "OK";
  }),
  mget: vi.fn(async (...keys: string[]) => keys.map((k) => store.get(k) ?? null)),
};
let redis: typeof fake | null = fake;
vi.mock("../cache", () => ({ getRedis: () => redis }));

const q = await import("./quota");
const NOW = new Date("2026-10-07T10:00:30Z");
const D = "2026-10-07";
const VT = `ti:quota:v1:VIRUSTOTAL_API_KEY:${keyFingerprint("vt-shared")}`;
const VT_OWN = `ti:quota:v1:VIRUSTOTAL_API_KEY:${keyFingerprint("vt-own")}`;
const ABUSE = `ti:quota:v1:ABUSEIPDB_API_KEY:${keyFingerprint("ab")}`;

function result(id: string, keyEnv: string | undefined, extra: Partial<SourceResult> = {}): SourceResult {
  const meta: SourceMeta = { id, name: id, url: "", category: "reputation", requiresKey: Boolean(keyEnv), weight: 1, keyEnv };
  return { source: meta, enabled: true, durationMs: 1, status: "ok", ...extra };
}

beforeEach(() => {
  store.clear();
  redis = fake;
  vi.clearAllMocks();
  process.env.VIRUSTOTAL_API_KEY = "vt-shared";
  process.env.ABUSEIPDB_API_KEY = "ab";
});
afterEach(() => {
  for (const k of ["VIRUSTOTAL_API_KEY", "VIRUSTOTAL_API_KEY_BULK", "ABUSEIPDB_API_KEY", "TI_BULK_SHARE", "TI_QUOTA_VIRUSTOTAL_API_KEY_DAILY"]) delete process.env[k];
});

describe("limits", () => {
  it("reads env overrides and clamps the share", () => {
    process.env.TI_QUOTA_VIRUSTOTAL_API_KEY_DAILY = "20";
    expect(q.limitFor("VIRUSTOTAL_API_KEY")).toEqual({ daily: 20, perMinute: 4 });
    process.env.TI_BULK_SHARE = "7";
    expect(q.bulkShare()).toBe(1);
    process.env.TI_BULK_SHARE = "nonsense";
    expect(q.bulkShare()).toBe(0.6);
  });
  it("formats the UTC day and the next-minute wait", () => {
    expect(q.utcDay(NOW)).toBe(D);
    expect(q.msToNextMinute(NOW)).toBe(30_000);
  });
});

describe("reserveBulk", () => {
  it("reserves inside the shared key's bulk share", async () => {
    expect(await q.reserveBulk("ABUSEIPDB_API_KEY", NOW)).toBe("ok");
    expect(store.get(`${ABUSE}:day:${D}`)).toBe(1);
    expect(store.get(`${ABUSE}:bulk:${D}`)).toBe(1);
  });

  it("stops at 60% of a shared key and rolls back", async () => {
    store.set(`${VT}:bulk:${D}`, 300);
    expect(await q.reserveBulk("VIRUSTOTAL_API_KEY", NOW)).toBe("spent");
    expect(store.get(`${VT}:bulk:${D}`)).toBe(300);
  });

  it("gives an own bulk key the whole day, in its own pool", async () => {
    process.env.VIRUSTOTAL_API_KEY_BULK = "vt-own";
    store.set(`${VT_OWN}:bulk:${D}`, 300);
    store.set(`${VT_OWN}:day:${D}`, 300);
    expect(await q.reserveBulk("VIRUSTOTAL_API_KEY", NOW)).toBe("ok");
    expect(store.has(`${VT}:day:${D}`)).toBe(false);
  });

  it("never borrows the shared key when the own key is spent", async () => {
    process.env.VIRUSTOTAL_API_KEY_BULK = "vt-own";
    store.set(`${VT_OWN}:day:${D}`, 500);
    expect(await q.reserveBulk("VIRUSTOTAL_API_KEY", NOW)).toBe("spent");
    expect(store.has(`${VT}:day:${D}`)).toBe(false);
  });

  it("stops when /check has used the shared day", async () => {
    store.set(`${ABUSE}:day:${D}`, 1000);
    expect(await q.reserveBulk("ABUSEIPDB_API_KEY", NOW)).toBe("spent");
  });

  it("asks the caller to wait at the VirusTotal minute cap", async () => {
    const minuteKey = `${VT}:min:${Math.floor(NOW.getTime() / 60_000)}`;
    store.set(minuteKey, 4);
    expect(await q.reserveBulk("VIRUSTOTAL_API_KEY", NOW)).toBe("minute");
    expect(store.get(minuteKey)).toBe(4);
  });

  it("refuses an exhausted pool", async () => {
    await q.markExhausted("ABUSEIPDB_API_KEY", "bulk", NOW);
    expect(await q.reserveBulk("ABUSEIPDB_API_KEY", NOW)).toBe("spent");
  });

  it("reports nokey, and unavailable without Redis or when it throws", async () => {
    expect(await q.reserveBulk("OTX_API_KEY", NOW)).toBe("nokey");
    redis = null;
    expect(await q.reserveBulk("ABUSEIPDB_API_KEY", NOW)).toBe("unavailable");
    redis = fake;
    fake.get.mockRejectedValueOnce(new Error("down"));
    expect(await q.reserveBulk("ABUSEIPDB_API_KEY", NOW)).toBe("unavailable");
  });
});

describe("markExhausted", () => {
  it("does nothing without a key or Redis, and swallows errors", async () => {
    await q.markExhausted("OTX_API_KEY", "bulk", NOW);
    redis = null;
    await q.markExhausted("ABUSEIPDB_API_KEY", "bulk", NOW);
    redis = fake;
    expect(store.size).toBe(0);
    fake.set.mockRejectedValueOnce(new Error("down"));
    await expect(q.markExhausted("ABUSEIPDB_API_KEY", "bulk", NOW)).resolves.toBeUndefined();
  });
});

describe("isQuotaHit", () => {
  it("matches rate_limited and 429-shaped errors only", () => {
    expect(q.isQuotaHit(result("virustotal", "VIRUSTOTAL_API_KEY", { status: "rate_limited" }))).toBe(true);
    expect(q.isQuotaHit(result("virustotal", "VIRUSTOTAL_API_KEY", { status: "error", error: "HTTP 429" }))).toBe(true);
    expect(q.isQuotaHit(result("abuseipdb", "ABUSEIPDB_API_KEY", { status: "error", error: "Daily rate limit exceeded" }))).toBe(true);
    expect(q.isQuotaHit(result("abuseipdb", "ABUSEIPDB_API_KEY", { status: "error", error: "HTTP 500" }))).toBe(false);
    expect(q.isQuotaHit(result("abuseipdb", "ABUSEIPDB_API_KEY"))).toBe(false);
    expect(q.isQuotaHit(result("abuseipdb", "ABUSEIPDB_API_KEY", { status: "error" }))).toBe(false);
  });
});

describe("recordSpend (check lane)", () => {
  it("counts metered calls by key, including a hash VirusTotal source, and marks hits", async () => {
    await q.recordSpend(
      [
        result("virustotal", "VIRUSTOTAL_API_KEY"),
        result("virustotal-sandbox", "VIRUSTOTAL_API_KEY"),
        result("abuseipdb", "ABUSEIPDB_API_KEY", { status: "rate_limited" }),
        result("greynoise", "GREYNOISE_API_KEY", { status: "skipped" }),
        result("feodo", undefined),
      ],
      NOW,
    );
    expect(store.get(`${VT}:day:${D}`)).toBe(2);
    expect(store.get(`${ABUSE}:exhausted:${D}`)).toBe("1");
    expect([...store.keys()].some((k) => k.includes("GREYNOISE"))).toBe(false);
  });

  it("skips a metered source with no key, is a no-op without Redis, and swallows errors", async () => {
    await q.recordSpend([result("otx", "OTX_API_KEY")], NOW);
    expect(store.size).toBe(0);
    redis = null;
    await expect(q.recordSpend([result("virustotal", "VIRUSTOTAL_API_KEY")], NOW)).resolves.toBeUndefined();
    redis = fake;
    fake.incrby.mockRejectedValueOnce(new Error("down"));
    await expect(q.recordSpend([result("virustotal", "VIRUSTOTAL_API_KEY")], NOW)).resolves.toBeUndefined();
  });
});

describe("remaining", () => {
  it("reports each configured pool and what bulk may still spend", async () => {
    store.set(`${VT}:day:${D}`, 100);
    store.set(`${VT}:bulk:${D}`, 40);
    const rows = await q.remaining(NOW);
    expect(rows?.find((r) => r.keyEnv === "VIRUSTOTAL_API_KEY")).toEqual({ keyEnv: "VIRUSTOTAL_API_KEY", own: false, daily: 500, used: 100, bulkLeft: 260, exhausted: false });
    expect(rows?.some((r) => r.keyEnv === "OTX_API_KEY")).toBe(false);
  });

  it("reports only the pools it is asked about", async () => {
    const rows = await q.remaining(NOW, ["ABUSEIPDB_API_KEY"]);
    expect(rows?.map((r) => r.keyEnv)).toEqual(["ABUSEIPDB_API_KEY"]);
  });

  it("reports an own key at full share, and null without Redis", async () => {
    process.env.VIRUSTOTAL_API_KEY_BULK = "vt-own";
    expect((await q.remaining(NOW))?.find((r) => r.keyEnv === "VIRUSTOTAL_API_KEY")).toMatchObject({ own: true, bulkLeft: 500 });
    redis = null;
    expect(await q.remaining(NOW)).toBeNull();
  });

  it("reports nothing when no metered key is configured", async () => {
    delete process.env.VIRUSTOTAL_API_KEY;
    delete process.env.ABUSEIPDB_API_KEY;
    expect(await q.remaining(NOW)).toEqual([]);
  });
});
