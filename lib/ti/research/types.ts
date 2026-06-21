import type { IOCType } from "@/lib/ioc";

/**
 * Live research providers fetch *context* from free public APIs and render it
 * inline, unlike the outbound links in links.ts. They deliberately sit OFF the
 * scoring path: nothing here moves the risk score, it only helps an analyst
 * pivot. The shape mirrors the TiSource/SourceResult split so the runner can
 * reuse the same skip/timeout/error discipline, but the payload is a typed,
 * per-provider union so each card can render richly (e.g. a screenshot grid).
 */

export type ResearchStatus = "ok" | "empty" | "error" | "timeout" | "skipped";

/** One URLScan submission referencing the indicator. */
export interface UrlScanItem {
  /** Result page on urlscan.io. */
  scanUrl: string;
  /** The page that was scanned. */
  pageUrl: string;
  /** Screenshot image URL, when the scan produced one. */
  screenshot?: string;
  /** Scan time (ISO). */
  time?: string;
  /** Resolved page IP. */
  ip?: string;
  /** Two-letter country code of the serving host. */
  country?: string;
  /** Autonomous system, e.g. "AS13335". */
  asn?: string;
}

/** One archived snapshot from the Wayback Machine. */
export interface WaybackSnapshot {
  /** Playback URL, https://web.archive.org/web/<ts>/<original>. */
  url: string;
  /** Capture time (ISO). */
  time: string;
}

/** One certificate-transparency record (crt.sh). */
export interface ResearchCert {
  issuer: string;
  commonName?: string;
  notBefore?: string;
  notAfter?: string;
}

/** Per-provider typed payload, discriminated by `type` (matches provider id). */
export type ResearchData =
  | { type: "urlscan"; scans: UrlScanItem[] }
  | {
      type: "wayback";
      firstSeen?: string;
      lastSeen?: string;
      snapshots: WaybackSnapshot[];
    }
  | { type: "crtsh"; certs: ResearchCert[]; subdomains: string[] };

export interface ResearchProviderMeta {
  id: ResearchData["type"];
  name: string;
  /** Provider homepage, for attribution. */
  url: string;
  /** Per-provider request budget (ms). Slow CT logs and the Wayback CDX need
   *  longer than the default; falls back to the runner default when unset. */
  timeoutMs?: number;
}

/** Normalized output of a provider's check(), before the runner stamps timing. */
export interface ResearchFinding {
  status: ResearchStatus;
  error?: string;
  /** Human-readable one-liner, e.g. "3 recent scans". */
  summary?: string;
  /** Outbound deep link to the full results on the provider. */
  link?: string;
  data?: ResearchData;
}

/** A finding plus the provider it came from and how long it took. */
export interface ResearchResult extends ResearchFinding {
  provider: ResearchProviderMeta;
  durationMs: number;
}

export interface ResearchProvider {
  meta: ResearchProviderMeta;
  /** IOC types this provider can research; the runner filters on it. */
  supports: IOCType[];
  isEnabled(): boolean;
  /** Perform the lookup. Must honor the abort signal for timeouts. */
  check(
    indicator: string,
    kind: IOCType,
    signal: AbortSignal,
  ): Promise<ResearchFinding>;
}
