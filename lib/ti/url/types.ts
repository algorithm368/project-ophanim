import type {
  AnyCheckResult,
  CheckStats,
  HistorySnapshot,
  ScoreBreakdown,
  SourceResult,
  Verdict,
} from "../types";

/** The three things a URL is checked against, most specific first. */
export type LayerKind = "url" | "domain" | "ip";

/**
 * Why a layer has no verdict. `unavailable` means it should have run and could
 * not (the host did not resolve); `not-applicable` means there was nothing to
 * check (a URL that addresses an IP directly has no host layer). Neither is
 * `clean`, and the distinction is the point: silence is not evidence of safety.
 */
export type LayerStatus = "ok" | "unavailable" | "not-applicable";

/** One layer of a URL check: its own panel, its own verdict, its own age. */
export interface UrlLayer {
  kind: LayerKind;
  /** The URL, host, or address this layer actually checked. */
  indicator: string;
  status: LayerStatus;
  /** Why it is unavailable or not applicable, rendered in place of a verdict. */
  reason?: string;
  riskScore: number;
  verdict: Verdict;
  sources: SourceResult[];
  stats: CheckStats;
  scoreBreakdown?: ScoreBreakdown;
  /** Set when this layer was served from its own per-type cache, so the UI can
   *  show how old the reading is and offer to refresh just this layer. */
  cachedAt?: string;
}

/**
 * A URL result is three verdicts and one headline, never one flattened number.
 * A clean URL on a malicious host and a malicious URL on a clean host are
 * different findings, and pooling them into a single score destroys exactly the
 * distinction an analyst is looking for.
 */
export interface UrlCheckResult {
  url: string;
  checkedAt: string;
  /** Headline score, copied from the worst layer that ran. */
  riskScore: number;
  /** Headline verdict, copied from the worst layer that ran. */
  verdict: Verdict;
  /** Which layer the headline came from. Always rendered alongside it. */
  headlineLayer: LayerKind;
  layers: UrlLayer[];
  /** Addresses the host resolved to that were NOT checked, so a multi-homed
   *  host does not read as though every address had been cleared. */
  otherAddresses?: string[];
  /** Every layer's rows concatenated, so the shared route factory and the
   *  history writer need no knowledge of layering. */
  sources: SourceResult[];
  stats: CheckStats;
  history?: HistorySnapshot[];
  cached?: boolean;
}

/**
 * A URL result is the only one carrying layers, so the presence of both fields
 * identifies it. Kept here rather than in the component so callers that only
 * need the narrowing do not pull in React.
 */
export function isUrlResult(
  result: AnyCheckResult | UrlCheckResult,
): result is UrlCheckResult {
  return "layers" in result && "headlineLayer" in result;
}
