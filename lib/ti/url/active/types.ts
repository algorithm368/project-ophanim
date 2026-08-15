import type { ScanCapability } from "./capability";
import type { ScanDetail } from "./detail";
import type { ScanEngine } from "./engines";

/** Visibility the submission was accepted at. Never "public": a public scan is
 *  searchable by anyone, including whoever sent the phish. */
export type ScanVisibility = "private" | "unlisted";

/**
 * Where a submission stands.
 *
 * `running` is not a failure. The scan is on the provider's queue and the quota
 * is already spent, so a poll that times out must keep the uuid and say so,
 * never report an error that invites the analyst to submit again.
 */
export type ScanStatus = "running" | "done" | "error";

/** What one scanned URL turned into. */
export interface ActiveScan {
  /** The URL that was submitted, canonical and without userinfo. */
  target: string;
  /** Which scanner produced this record. A batch holds one per engine per
   *  target, so every consumer must read this rather than assume urlscan. */
  engine: ScanEngine;
  status: ScanStatus;
  /** Provider's scan id, kept even on a poll timeout so it can be resumed. */
  uuid?: string;
  visibility?: ScanVisibility;
  /** Human-facing result page on the provider. */
  resultUrl?: string;
  /** Populated once the scan completes. */
  verdict?: ActiveVerdict;
  /** The teardown, distilled. Drives the dedicated scan page; the inline card
   *  reads only `verdict`. */
  detail?: ScanDetail;
  /** What the captured page can do. Computed once, server-side, when the scan
   *  completes, because the DOM does not change afterwards and re-reading it on
   *  every page view would cost a round trip for no new information. */
  capability?: ScanCapability;
  error?: string;
}

/** The provider's own reading of the page, kept separate from the passive
 *  score: it arrives after the fact and must not rewrite a cached verdict. */
export interface ActiveVerdict {
  malicious: boolean;
  score?: number;
  categories?: string[];
  /** Final URL after redirects, which is often the actual destination. */
  finalUrl?: string;
  /** Domains the page contacted while loading. */
  contactedDomains?: string[];
  screenshot?: string;
  ip?: string;
  asn?: string;
  server?: string;
}

/** One submission batch: an indicator, and the scans it produced. */
export interface ActiveScanBatch {
  indicator: string;
  submittedAt: string;
  scans: ActiveScan[];
}
