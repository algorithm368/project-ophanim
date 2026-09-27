import { gradeSource, type HealthEntry, type SourceHealth } from "../../health";
import { healthKey, newestOf, pushHealth, readEntries } from "../../health-store";
import { errorMessage, getJson } from "../../http";
import type { ScanCredentials } from "./credentials";
import { ENGINE_NAME, type ScanEngine } from "./engines";
import type { ActiveScan } from "./types";
import { VISIBILITY_ORDER } from "./urlscan";

/**
 * How the two scan engines have been doing, for the rail on `/scan`.
 *
 * Recorded passively like source health (health-store.ts), from the scans the
 * team already runs: an engine is judged on whether its scans finish and how
 * long they take. A submission that is still running is not an outcome yet, so
 * only the moment a scan settles is recorded.
 */

export const ENGINES: ScanEngine[] = ["urlscan", "cloudflare"];

/** A scan normally settles in about 30 seconds; past a minute it is slow.
 *  gradeSource calls a source slow past half its timeout, hence the double. */
const SLOW_AFTER_MS = 60_000;
const MAX_ERROR = 200;
const QUOTA_URL = "https://urlscan.io/user/quotas/";
const QUOTA_TIMEOUT_MS = 4000;

const HEALTH_TYPE = "scan";

/** One engine's settled scan, ready to push onto its health list. */
export interface EngineOutcome {
  engine: ScanEngine;
  entry: HealthEntry;
}

function outcomeOf(scan: ActiveScan, submittedAt: string, now: number): HealthEntry | null {
  if (scan.status === "done") {
    const took = now - Date.parse(submittedAt);
    return { s: "ok", ms: Number.isFinite(took) ? Math.max(0, Math.round(took)) : 0, t: now };
  }
  if (scan.status === "error") {
    return { s: "error", ms: 0, t: now, e: (scan.error ?? "Scan failed").slice(0, MAX_ERROR) };
  }
  return null;
}

/**
 * The scans in `after` that settled since `before`, paired by position (the
 * poll maps a batch's scans in order). `before` is null for a fresh
 * submission, where only a refused submit has settled.
 */
export function scanOutcomes(
  before: ActiveScan[] | null,
  after: ActiveScan[],
  submittedAt: string,
  now: number,
): EngineOutcome[] {
  const out: EngineOutcome[] = [];
  after.forEach((scan, i) => {
    if (before?.[i]?.status === scan.status) return;
    const entry = outcomeOf(scan, submittedAt, now);
    if (entry) out.push({ engine: scan.engine, entry });
  });
  return out;
}

export async function recordEngineHealth(outcomes: EngineOutcome[]): Promise<void> {
  await pushHealth(outcomes.map(({ engine, entry }) => ({ key: healthKey(HEALTH_TYPE, engine), entry })));
}

/** One visibility's allowance on urlscan, which is where a scan is spent. */
export interface QuotaLine {
  visibility: string;
  day: { remaining: number; limit: number };
  hour: { remaining: number; limit: number };
}

type Window = { remaining?: unknown; limit?: unknown };

function windowOf(w: Window | undefined): { remaining: number; limit: number } | null {
  return w && typeof w.remaining === "number" && typeof w.limit === "number"
    ? { remaining: w.remaining, limit: w.limit }
    : null;
}

/** The visibilities a scan is submitted at, in the order it tries them. The
 *  payload also names the caller's last IPs; nothing but the counts is kept. */
export function quotaFrom(data: unknown): QuotaLine[] {
  const limits = (data as { limits?: Record<string, { day?: Window; hour?: Window }> } | null)?.limits;
  if (!limits) return [];
  const lines: QuotaLine[] = [];
  for (const visibility of VISIBILITY_ORDER) {
    const day = windowOf(limits[visibility]?.day);
    const hour = windowOf(limits[visibility]?.hour);
    if (day && hour) lines.push({ visibility, day, hour });
  }
  return lines;
}

/** Reading the quota spends none of it. Null when urlscan will not say. */
export async function fetchUrlscanQuota(apiKey: string): Promise<QuotaLine[] | null> {
  try {
    const res = await getJson<unknown>(QUOTA_URL, AbortSignal.timeout(QUOTA_TIMEOUT_MS), {
      "API-Key": apiKey,
    });
    const lines = res.ok ? quotaFrom(res.data) : [];
    return lines.length ? lines : null;
  } catch (err) {
    console.error("[scan] quota read failed:", errorMessage(err));
    return null;
  }
}

export interface EngineHealth extends SourceHealth {
  /** urlscan only, and only when it has a key and answered. */
  quota?: QuotaLine[] | null;
}

export interface EngineBoard {
  engines: EngineHealth[];
  /** False without Redis: the engines are listed, but nothing was recorded. */
  recorded: boolean;
  newestAt: number | null;
}

function enabledFor(engine: ScanEngine, creds: ScanCredentials): boolean {
  return engine === "urlscan" ? Boolean(creds.urlscanKey) : creds.cfReady;
}

export async function readEngineBoard(creds: ScanCredentials): Promise<EngineBoard> {
  const [lists, quota] = await Promise.all([
    readEntries(ENGINES.map((e) => healthKey(HEALTH_TYPE, e))),
    creds.urlscanKey ? fetchUrlscanQuota(creds.urlscanKey) : Promise.resolve(null),
  ]);
  const engines: EngineHealth[] = ENGINES.map((engine, i) => ({
    ...gradeSource({
      meta: { id: engine, name: ENGINE_NAME[engine], timeoutMs: SLOW_AFTER_MS * 2 },
      type: HEALTH_TYPE,
      enabled: enabledFor(engine, creds),
      entries: lists?.[i] ?? [],
    }),
    ...(engine === "urlscan" ? { quota } : {}),
  }));
  return { engines, recorded: lists !== null, newestAt: newestOf(engines) };
}
