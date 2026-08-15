import { Redis } from "@upstash/redis";
import type { CheckResult, DomainCheckResult, HashCheckResult } from "./types";
import type { UrlCheckResult } from "./url/types";
import type { ActiveScanBatch } from "./url/active/types";

/**
 * Bump when a stored result's *shape or meaning* changes, so entries written by
 * the previous code are missed rather than rendered under the new reading. v2:
 * geo coordinates became a cluster vote, which repurposed
 * `geoResolution.coordinates.alternatives` from "every point, when scattered" to
 * "the losing clusters". A v1 entry read as v2 reports every provider as an
 * outlier. Entries under the old prefix are simply left to their TTL.
 */
const SCHEMA_VERSION = "v2:";

const KEY_PREFIX = `ti:ip:${SCHEMA_VERSION}`;
const DOMAIN_KEY_PREFIX = "ti:domain:";
const HASH_KEY_PREFIX = "ti:hash:";
// URL entries are versioned from the start, since the layered envelope is new
// and its shape is the thing most likely to move.
const URL_KEY_PREFIX = "ti:url:v1:";
// The active lane keys separately from the passive result on purpose: a scan
// arrives after the fact and must not rewrite a verdict already cached or
// already written to the history timeline.
const SCAN_KEY_PREFIX = "ti:urlscan:v1:";
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60; // 1 week

function ttlSeconds(): number {
  const raw = Number(process.env.TI_CACHE_TTL_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_TTL_SECONDS;
}

// `undefined` = not yet resolved, `null` = no credentials (cache disabled).
let client: Redis | null | undefined;

/**
 * Cut an Upstash config error at its "Received: <the url>" tail. That tail is
 * the part that must never reach the log, because a rediss:// string embeds the
 * password.
 *
 * Exported for its test. It replaces a regex that matched an optional leading
 * whitespace run before the literal, then everything after it. Scanned from
 * every offset, that leading run costs quadratic time on a long message with no
 * tail (typescript:S8786); indexOf does the same job in one pass.
 */
export function truncateAtReceived(message: string): string {
  const at = message.indexOf("Received:");
  return at === -1 ? message : message.slice(0, at).trimEnd();
}

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
      truncateAtReceived(message),
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

/** Returns the cached result for a URL, or null on miss / when caching is off.
 *  The key is the canonical URL, so one resource has one entry. */
export function getCachedUrlResult(
  url: string,
): Promise<UrlCheckResult | null> {
  return getCached<UrlCheckResult>(URL_KEY_PREFIX, url);
}

/** Stores a URL result with the default TTL. Failures are swallowed. */
export function setCachedUrlResult(
  url: string,
  result: UrlCheckResult,
): Promise<void> {
  return setCached(URL_KEY_PREFIX, url, result);
}

/** Returns the stored active-scan batch for an indicator, or null on miss. */
export function getCachedScanBatch(
  indicator: string,
): Promise<ActiveScanBatch | null> {
  return getCached<ActiveScanBatch>(SCAN_KEY_PREFIX, indicator);
}

/** Stores an active-scan batch, so a reload resumes polling instead of
 *  submitting the same page again and spending the quota twice. */
export function setCachedScanBatch(
  indicator: string,
  batch: ActiveScanBatch,
): Promise<void> {
  return setCached(SCAN_KEY_PREFIX, indicator, batch);
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
