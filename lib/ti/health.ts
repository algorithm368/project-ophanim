import { PER_SOURCE_TIMEOUT_MS } from "./orchestrate";
import type { SourceMeta, SourceStatus } from "./types";

/**
 * How each TI source has been answering, graded from the runs real lookups
 * already made (see health-store.ts for where they are recorded). Pure, so the
 * thresholds are testable without Redis.
 */

/** One recorded run, stored compactly because there are 50 per source. */
export interface HealthEntry {
  s: SourceStatus;
  ms: number;
  /** Epoch ms the run was recorded. */
  t: number;
  e?: string;
}

export type HealthGrade = "failing" | "degraded" | "slow" | "healthy" | "no-data" | "no-key";

export interface SourceHealth {
  id: string;
  name: string;
  /** The indicator type the source was run for: "ip", "domain" or "hash". */
  type: string;
  grade: HealthGrade;
  /** Share of counted runs that came back ok, 0 to 1; null with no runs. */
  okShare: number | null;
  /** Median latency of the ok runs; null with none. */
  medianMs: number | null;
  /** Counted runs, skipped ones excluded. */
  runs: number;
  lastError?: string;
  lastAt: number | null;
}

/** Fewer counted runs than this and a percentage would be noise. */
export const MIN_RUNS = 5;
const FAILING_BELOW = 0.5;
const DEGRADED_BELOW = 0.9;

const GRADE_ORDER: HealthGrade[] = ["failing", "degraded", "slow", "healthy", "no-data", "no-key"];

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function gradeOf(
  enabled: boolean,
  runs: number,
  okShare: number | null,
  medianMs: number | null,
  timeoutMs: number,
): HealthGrade {
  if (!enabled) return "no-key";
  if (runs < MIN_RUNS || okShare === null) return "no-data";
  if (okShare < FAILING_BELOW) return "failing";
  if (okShare < DEGRADED_BELOW) return "degraded";
  if (medianMs !== null && medianMs > timeoutMs / 2) return "slow";
  return "healthy";
}

/** Grades one source from its entries, newest first. `skipped` runs (the
 *  source declined the input, e.g. a SHA-1 on a SHA-256-only source) are not
 *  held against it and not counted at all. */
export function gradeSource({
  meta,
  type,
  enabled,
  entries,
}: {
  /** Only what grading reads, so a scan engine can be graded as well. */
  meta: Pick<SourceMeta, "id" | "name" | "timeoutMs">;
  type: string;
  enabled: boolean;
  entries: HealthEntry[];
}): SourceHealth {
  const counted = entries.filter((e) => e.s !== "skipped");
  const ok = counted.filter((e) => e.s === "ok");
  const okShare = counted.length ? ok.length / counted.length : null;
  const medianMs = median(ok.map((e) => e.ms));
  const timeoutMs = meta.timeoutMs ?? PER_SOURCE_TIMEOUT_MS;
  return {
    id: meta.id,
    name: meta.name,
    type,
    grade: gradeOf(enabled, counted.length, okShare, medianMs, timeoutMs),
    okShare,
    medianMs,
    runs: counted.length,
    lastError: counted.find((e) => e.e)?.e,
    lastAt: counted.length ? Math.max(...counted.map((e) => e.t)) : null,
  };
}

/** Worst first: by grade, then lower ok share (unknown last), then name. */
export function sortHealth(rows: SourceHealth[]): SourceHealth[] {
  return [...rows].sort(
    (a, b) =>
      GRADE_ORDER.indexOf(a.grade) - GRADE_ORDER.indexOf(b.grade) ||
      (a.okShare ?? 2) - (b.okShare ?? 2) ||
      a.name.localeCompare(b.name),
  );
}
