import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

/**
 * Which part of the app is asking. Each lane can carry its own API key
 * (`<KEY_ENV>_<LANE>`), so bulk lookups can spend a separate free-tier quota
 * from /check's. With no lane set, the lane is `check`, so the single-lookup
 * path needs no change.
 */
export type Lane = "check" | "bulk" | "scan";

const store = new AsyncLocalStorage<Lane>();

export function withLane<T>(lane: Lane, fn: () => Promise<T>): Promise<T> {
  return store.run(lane, fn);
}

export function currentLane(): Lane {
  return store.getStore() ?? "check";
}

const read = (name: string) => process.env[name]?.trim() || undefined;

export function hasOwnKey(keyEnv: string, lane: Lane): boolean {
  return Boolean(read(`${keyEnv}_${lane.toUpperCase()}`));
}

export function apiKey(keyEnv: string | undefined, lane: Lane = currentLane()): string | undefined {
  if (!keyEnv) return undefined;
  return read(`${keyEnv}_${lane.toUpperCase()}`) ?? read(keyEnv);
}

/** Enough to tell keys apart in Redis, never enough to use one. */
export function keyFingerprint(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}
