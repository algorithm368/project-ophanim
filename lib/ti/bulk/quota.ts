import { getRedis } from "../cache";
import { apiKey, currentLane, hasOwnKey, keyFingerprint, type Lane } from "../keys";
import type { SourceResult } from "../types";
import { METERED_KEY_ENVS, type MeteredKeyEnv } from "./types";

export interface QuotaLimit {
  daily: number;
  perMinute?: number;
}

const DEFAULT_LIMITS: Record<MeteredKeyEnv, QuotaLimit> = {
  VIRUSTOTAL_API_KEY: { daily: 500, perMinute: 4 },
  ABUSEIPDB_API_KEY: { daily: 1000 },
  GREYNOISE_API_KEY: { daily: 50 },
  OTX_API_KEY: { daily: 5000 },
  GOOGLE_SAFE_BROWSING_API_KEY: { daily: 10000 },
};

const DEFAULT_SHARE = 0.6;
const DAY_TTL = 48 * 60 * 60;
const MINUTE_TTL = 120;

const METERED: ReadonlySet<string> = new Set(METERED_KEY_ENVS);
export function isMeteredKeyEnv(x: string | undefined): x is MeteredKeyEnv {
  return x !== undefined && METERED.has(x);
}

export function limitFor(keyEnv: MeteredKeyEnv): QuotaLimit {
  const raw = Number(process.env[`TI_QUOTA_${keyEnv}_DAILY`]);
  const base = DEFAULT_LIMITS[keyEnv];
  return Number.isFinite(raw) && raw > 0 ? { ...base, daily: Math.floor(raw) } : base;
}

export function bulkShare(): number {
  const raw = Number(process.env.TI_BULK_SHARE);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_SHARE;
  return Math.min(raw, 1);
}

export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function msToNextMinute(now: Date = new Date()): number {
  return 60_000 - (now.getTime() % 60_000);
}

/** One pool per key: the same VirusTotal key serves VT ip, domain, hash and
 *  sandbox, and a bulk-only key is a separate account with its own quota. */
function poolOf(keyEnv: MeteredKeyEnv, lane: Lane): string | null {
  const key = apiKey(keyEnv, lane);
  return key ? `ti:quota:v1:${keyEnv}:${keyFingerprint(key)}` : null;
}

const dayKey = (pool: string, day: string) => `${pool}:day:${day}`;
const bulkKey = (pool: string, day: string) => `${pool}:bulk:${day}`;
const exhaustedKey = (pool: string, day: string) => `${pool}:exhausted:${day}`;
const minuteKey = (pool: string, now: Date) => `${pool}:min:${Math.floor(now.getTime() / 60_000)}`;

const QUOTA_TEXT = /\b429\b|quota|rate.?limit|limit exceeded/i;

/** Only GreyNoise maps 429 to `rate_limited` today, so the message match
 *  catches the others. */
export function isQuotaHit(r: SourceResult): boolean {
  if (r.status === "rate_limited") return true;
  return r.status === "error" && QUOTA_TEXT.test(r.error ?? "");
}

function allowance(keyEnv: MeteredKeyEnv): number {
  const { daily } = limitFor(keyEnv);
  return hasOwnKey(keyEnv, "bulk") ? daily : Math.floor(daily * bulkShare());
}

export type Reservation = "ok" | "minute" | "spent" | "nokey" | "unavailable";

/** Take one call of bulk's allowance on this key. Never borrows another pool. */
export async function reserveBulk(keyEnv: MeteredKeyEnv, now: Date = new Date()): Promise<Reservation> {
  const pool = poolOf(keyEnv, "bulk");
  if (!pool) return "nokey";
  const redis = getRedis();
  if (!redis) return "unavailable";
  const day = utcDay(now);
  const limit = limitFor(keyEnv);
  try {
    if (await redis.get(exhaustedKey(pool, day))) return "spent";
    const keys = [dayKey(pool, day), bulkKey(pool, day)];
    if (limit.perMinute) keys.push(minuteKey(pool, now));
    const [used, bulkUsed, minuteUsed] = await Promise.all(keys.map((k) => redis.incrby(k, 1)));
    await Promise.all(keys.map((k, i) => redis.expire(k, i === 2 ? MINUTE_TTL : DAY_TTL)));
    const overDay = used > limit.daily || bulkUsed > allowance(keyEnv);
    const overMinute = limit.perMinute !== undefined && minuteUsed > limit.perMinute;
    if (!overDay && !overMinute) return "ok";
    await Promise.all(keys.map((k) => redis.decrby(k, 1)));
    return overDay ? "spent" : "minute";
  } catch (err) {
    console.error("[bulk] quota reserve failed:", err);
    return "unavailable";
  }
}

export async function markExhausted(keyEnv: MeteredKeyEnv, lane: Lane, now: Date = new Date()): Promise<void> {
  const pool = poolOf(keyEnv, lane);
  const redis = getRedis();
  if (!pool || !redis) return;
  try {
    await redis.set(exhaustedKey(pool, utcDay(now)), "1", { ex: DAY_TTL });
  } catch (err) {
    console.error("[bulk] quota mark failed:", err);
  }
}

/** /check's side of the ledger: count what its fan-out spent. Never gates. */
export async function recordSpend(results: SourceResult[], now: Date = new Date()): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const lane = currentLane();
  const day = utcDay(now);
  try {
    for (const r of results) {
      const keyEnv = r.source.keyEnv;
      if (!isMeteredKeyEnv(keyEnv) || r.status === "skipped") continue;
      const pool = poolOf(keyEnv, lane);
      if (!pool) continue;
      await redis.incrby(dayKey(pool, day), 1);
      await redis.expire(dayKey(pool, day), DAY_TTL);
      if (limitFor(keyEnv).perMinute) {
        await redis.incrby(minuteKey(pool, now), 1);
        await redis.expire(minuteKey(pool, now), MINUTE_TTL);
      }
      if (isQuotaHit(r)) await markExhausted(keyEnv, lane, now);
    }
  } catch (err) {
    console.error("[bulk] quota record failed:", err);
  }
}

export interface QuotaRemaining {
  keyEnv: MeteredKeyEnv;
  /** True when bulk has its own key for this source. */
  own: boolean;
  daily: number;
  used: number;
  bulkLeft: number;
  exhausted: boolean;
}

export async function remaining(now: Date = new Date()): Promise<QuotaRemaining[] | null> {
  const redis = getRedis();
  if (!redis) return null;
  const day = utcDay(now);
  const pools = METERED_KEY_ENVS.flatMap((keyEnv) => {
    const pool = poolOf(keyEnv, "bulk");
    return pool ? [{ keyEnv, pool }] : [];
  });
  if (pools.length === 0) return [];
  const values = await redis.mget<(string | number | null)[]>(
    ...pools.flatMap(({ pool }) => [dayKey(pool, day), bulkKey(pool, day), exhaustedKey(pool, day)]),
  );
  return pools.map(({ keyEnv }, i) => {
    const { daily } = limitFor(keyEnv);
    const used = Number(values[i * 3] ?? 0);
    const bulkUsed = Number(values[i * 3 + 1] ?? 0);
    const bulkLeft = Math.max(0, Math.min(allowance(keyEnv) - bulkUsed, daily - used));
    return { keyEnv, own: hasOwnKey(keyEnv, "bulk"), daily, used, bulkLeft, exhausted: Boolean(values[i * 3 + 2]) };
  });
}
