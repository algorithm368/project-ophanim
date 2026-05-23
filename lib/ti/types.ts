export type SourceCategory =
  | "reputation"
  | "blocklist"
  | "scanner"
  | "dnsbl"
  | "context";

export type Verdict = "clean" | "low" | "suspicious" | "malicious" | "unknown";

export type SourceStatus = "ok" | "error" | "timeout" | "skipped";

export interface SourceMeta {
  id: string;
  name: string;
  url: string;
  category: SourceCategory;
  requiresKey: boolean;
  /** Env var that holds the API key, surfaced in the UI/docs. */
  keyEnv?: string;
}

export interface GeoContext {
  country?: string;
  countryCode?: string;
  region?: string;
  city?: string;
  lat?: number;
  lon?: number;
  asn?: string;
  asnOrg?: string;
  isp?: string;
  org?: string;
  reverse?: string;
  isHosting?: boolean;
  isProxy?: boolean;
  isMobile?: boolean;
}

/** Normalized output produced by a source adapter's check(). */
export interface SourceFinding {
  status: SourceStatus;
  error?: string;
  /** Definitive malicious listing (e.g. present on a botnet C2 blocklist). */
  malicious?: boolean;
  /** Normalized 0-100 risk contribution. */
  score?: number;
  /** 0-100 confidence in the score. */
  confidence?: number;
  categories?: string[];
  lastSeen?: string;
  /** Human-readable one-liner. */
  summary?: string;
  /** Normalized extra fields worth surfacing in the UI. */
  details?: Record<string, unknown>;
  /** Original upstream payload. */
  raw?: unknown;
  /** Geo/ASN context (contributed by context sources like ip-api). */
  geo?: GeoContext;
}

export interface SourceResult extends SourceFinding {
  source: SourceMeta;
  enabled: boolean;
  durationMs: number;
}

export interface CheckStats {
  total: number;
  queried: number;
  flagged: number;
  skipped: number;
  errored: number;
}

export interface CheckResult {
  ip: string;
  checkedAt: string;
  riskScore: number;
  verdict: Verdict;
  geo?: GeoContext;
  sources: SourceResult[];
  stats: CheckStats;
}

export interface TiSource {
  meta: SourceMeta;
  /** True when the source can run (key present, or no key required). */
  isEnabled(): boolean;
  /** Perform the lookup. Must honor the abort signal for timeouts. */
  check(ip: string, signal: AbortSignal): Promise<SourceFinding>;
}
