import { Redis } from "@upstash/redis";
import type { CheckResult, DomainCheckResult, HashCheckResult } from "./types";

const KEY_PREFIX = "ti:ip:";
const DOMAIN_KEY_PREFIX = "ti:domain:";
const HASH_KEY_PREFIX = "ti:hash:";
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60; // 1 week

function ttlSeconds(): number {
  const raw = Number(process.env.TI_CACHE_TTL_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_TTL_SECONDS;
}

// `undefined` = not yet resolved, `null` = no credentials (cache disabled).
let client: Redis | null | undefined;

function getClient(): Redis | null {
  if (client !== undefined) return client;
  // Accept both the standard Upstash names and the KV_* names that Vercel's
  // Upstash Marketplace integration injects.
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  client = url && token ? new Redis({ url, token }) : null;
  return client;
}

export function cacheEnabled(): boolean {
  return getClient() !== null;
}

/** Shared Redis client (or null when no credentials), reused by history. */
export function getRedis(): Redis | null {
  return getClient();
}

/** Returns the cached result for an IP, or null on miss / when caching is off. */
export async function getCachedResult(ip: string): Promise<CheckResult | null> {
  const redis = getClient();
  if (!redis) return null;
  try {
    return (await redis.get<CheckResult>(KEY_PREFIX + ip)) ?? null;
  } catch (err) {
    console.error("[ti] cache read failed:", err);
    return null;
  }
}

/** Stores a result under its IP with the default TTL. Failures are swallowed. */
export async function setCachedResult(
  ip: string,
  result: CheckResult,
): Promise<void> {
  const redis = getClient();
  if (!redis) return;
  try {
    await redis.set(KEY_PREFIX + ip, result, { ex: ttlSeconds() });
  } catch (err) {
    console.error("[ti] cache write failed:", err);
  }
}

/** Returns the cached result for a domain, or null on miss / when caching is off. */
export async function getCachedDomainResult(
  domain: string,
): Promise<DomainCheckResult | null> {
  const redis = getClient();
  if (!redis) return null;
  try {
    return (
      (await redis.get<DomainCheckResult>(DOMAIN_KEY_PREFIX + domain)) ?? null
    );
  } catch (err) {
    console.error("[ti] cache read failed:", err);
    return null;
  }
}

/** Stores a domain result with the default TTL. Failures are swallowed. */
export async function setCachedDomainResult(
  domain: string,
  result: DomainCheckResult,
): Promise<void> {
  const redis = getClient();
  if (!redis) return;
  try {
    await redis.set(DOMAIN_KEY_PREFIX + domain, result, { ex: ttlSeconds() });
  } catch (err) {
    console.error("[ti] cache write failed:", err);
  }
}

/** Returns the cached result for a hash, or null on miss / when caching is off. */
export async function getCachedHashResult(
  hash: string,
): Promise<HashCheckResult | null> {
  const redis = getClient();
  if (!redis) return null;
  try {
    return (await redis.get<HashCheckResult>(HASH_KEY_PREFIX + hash)) ?? null;
  } catch (err) {
    console.error("[ti] cache read failed:", err);
    return null;
  }
}

/** Stores a hash result with the default TTL. Failures are swallowed. */
export async function setCachedHashResult(
  hash: string,
  result: HashCheckResult,
): Promise<void> {
  const redis = getClient();
  if (!redis) return;
  try {
    await redis.set(HASH_KEY_PREFIX + hash, result, { ex: ttlSeconds() });
  } catch (err) {
    console.error("[ti] cache write failed:", err);
  }
}
