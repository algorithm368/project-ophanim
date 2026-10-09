import type { SourceResult, Verdict } from "../types";

export type BulkKind = "ip" | "domain";

/** A: hard-listed, B: suspicious or mixed, C: quiet, D: vouched. See the spec. */
export type Bucket = "A" | "B" | "C" | "D";

/**
 * `pending` not started. `pass1` waiting for pass 2. `full` finished.
 * `partial` a wanted metered source could not run. `cached` a fresh /check
 * result. `internal` never sent out. `feed-only` pass 0 was the last step.
 */
export type RowState = "pending" | "pass1" | "full" | "partial" | "cached" | "internal" | "feed-only";

/** How far a row was checked. A row is never quieter than its evidence. */
export type Depth = "none" | "feed" | "free" | "full";

export const METERED_IDS = ["virustotal", "abuseipdb", "greynoise", "otx", "safebrowsing"] as const;
export type MeteredId = (typeof METERED_IDS)[number];

export const METERED_KEY_ENVS = [
  "VIRUSTOTAL_API_KEY",
  "ABUSEIPDB_API_KEY",
  "GREYNOISE_API_KEY",
  "OTX_API_KEY",
  "GOOGLE_SAFE_BROWSING_API_KEY",
] as const;
export type MeteredKeyEnv = (typeof METERED_KEY_ENVS)[number];

export interface BulkRow {
  id: number;
  indicator: string;
  /** The Unicode form, when the indicator was converted to punycode. */
  display?: string;
  kind: BulkKind;
  state: RowState;
  bucket?: Bucket;
  riskScore?: number;
  verdict?: Verdict;
  /** Every result so far, with `raw` already dropped. */
  results: SourceResult[];
  /** Metered sources still to ask. */
  pending: MeteredId[];
  /** Metered sources that were wanted but could not run. */
  missing: MeteredId[];
  /** Pass 0 feeds that listed this IP. */
  listedBy?: string[];
  /** Why the row is the way it is, in user-facing copy. */
  note?: string;
  checkedAt?: string;
}

/** What a run record keeps per row: everything but the results. */
export type RowSummary = Omit<BulkRow, "results">;

export interface InvalidInput {
  input: string;
  reason: string;
}

export interface BulkRun {
  v: 1;
  id: string;
  owner: string;
  createdAt: string;
  rows: RowSummary[];
  invalid: InvalidInput[];
  duplicates: number;
  confirmed?: boolean;
}

export function depthOf(row: RowSummary): Depth {
  if (row.state === "internal" || row.state === "pending") return "none";
  if (row.state === "feed-only") return "feed";
  if (row.state === "cached") return "full";
  if (row.state === "full" && row.bucket !== "D") return "full";
  return "free";
}
