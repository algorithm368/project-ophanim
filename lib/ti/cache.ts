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

/** First value that is set and non-blank; treats "" the same as unset. */
function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function getClient(): Redis | null {
  if (client !== undefined) return client;
  // Accept both the standard Upstash names and the KV_* names that Vercel's
  // Upstash Marketplace integration injects. Empty strings count as unset, so a
  // blank UPSTASH_* var doesn't shadow a populated KV_* one.
  const url = firstNonEmpty(
    process.env.UPSTASH_REDIS_REST_URL,
    process.env.KV_REST_API_URL,
  );
  const token = firstNonEmpty(
    process.env.UPSTASH_REDIS_REST_TOKEN,
    process.env.KV_REST_API_TOKEN,
  );
  if (!url || !token) {
    client = null;
    return client;
  }
  // The REST client needs the https:// endpoint, not the rediss:// connection
  // string (Vercel exposes that one as KV_URL / REDIS_URL). Reject a non-REST
  // URL up front with an actionable hint — and never log the value itself,
  // since a rediss:// string embeds the password.
  if (!/^https:\/\//i.test(url)) {
    console.error(
      "[ti] cache disabled: REST URL must start with https:// — got a " +
        "non-REST URL (likely a rediss:// connection string). Point " +
        "UPSTASH_REDIS_REST_URL / KV_REST_API_URL at the Upstash REST endpoint.",
    );
    client = null;
    return client;
  }
  // Any other malformed URL makes `new Redis` throw; degrade to "no cache"
  // rather than crashing the page. Log only the message head, never the URL.
  try {
    client = new Redis({ url, token });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      "[ti] cache disabled - invalid Redis config:",
      message.replace(/\s*Received:.*/s, ""),
    );
    client = null;
  }
  return client;
}

export function cacheEnabled(): boolean {
  return getClient() !== null;
}

/** Shared Redis client (or null when no credentials), reused by history. */
export function getRedis(): Redis | null {
  return getClient();
}

/** Read a cached value by prefix+key, or null on miss / when caching is off. */
async function getCached<T>(prefix: string, key: string): Promise<T | null> {
  const redis = getClient();
  if (!redis) return null;
  try {
    return (await redis.get<T>(prefix + key)) ?? null;
  } catch (err) {
    console.error("[ti] cache read failed:", err);
    return null;
  }
}

/** Store a value under prefix+key with the default TTL. Failures are swallowed. */
async function setCached<T>(prefix: string, key: string, value: T): Promise<void> {
  const redis = getClient();
  if (!redis) return;
  try {
    await redis.set(prefix + key, value, { ex: ttlSeconds() });
  } catch (err) {
    console.error("[ti] cache write failed:", err);
  }
}

/** Returns the cached result for an IP, or null on miss / when caching is off. */
export function getCachedResult(ip: string): Promise<CheckResult | null> {
  return getCached<CheckResult>(KEY_PREFIX, ip);
}

/** Stores a result under its IP with the default TTL. Failures are swallowed. */
export function setCachedResult(ip: string, result: CheckResult): Promise<void> {
  return setCached(KEY_PREFIX, ip, result);
}

/** Returns the cached result for a domain, or null on miss / when caching is off. */
export function getCachedDomainResult(
  domain: string,
): Promise<DomainCheckResult | null> {
  return getCached<DomainCheckResult>(DOMAIN_KEY_PREFIX, domain);
}

/** Stores a domain result with the default TTL. Failures are swallowed. */
export function setCachedDomainResult(
  domain: string,
  result: DomainCheckResult,
): Promise<void> {
  return setCached(DOMAIN_KEY_PREFIX, domain, result);
}

/** Returns the cached result for a hash, or null on miss / when caching is off. */
export function getCachedHashResult(
  hash: string,
): Promise<HashCheckResult | null> {
  return getCached<HashCheckResult>(HASH_KEY_PREFIX, hash);
}

/** Stores a hash result with the default TTL. Failures are swallowed. */
export function setCachedHashResult(
  hash: string,
  result: HashCheckResult,
): Promise<void> {
  return setCached(HASH_KEY_PREFIX, hash, result);
}
