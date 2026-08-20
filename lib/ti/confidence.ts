import type { Confidence, ScoreBreakdown, SourceResult } from "./types";

// Tier cutoffs (inclusive lower bounds), placed on the two natural gaps in a
// sixteen-indicator calibration run rather than picked a priori.
export const HIGH_AT = 0.85;
export const MEDIUM_AT = 0.65;

// Worst-case dispersion: half the weight at 0, half at 100.
export const MAX_DISPERSION = 50;

// Coverage is a ceiling, agreement moves within it. Half the ceiling is granted
// for having asked at all; the other half has to be earned by the sources
// saying the same thing.
export const AGREEMENT_SHARE = 0.5;

// Where the wording of the reason line switches.
const AGREE_AT = 0.8;
const PARTLY_AT = 0.5;

/** The minimal result shape this needs. Every result type satisfies it. */
export type ConfidenceInput = {
  sources: SourceResult[];
  scoreBreakdown?: ScoreBreakdown;
};

export interface ScoreConfidence {
  level: Confidence;
  /** 0-1 blend of coverage and agreement. */
  score: number;
  /** Weighted share of the pool that answered, 0-1. */
  coverage: number;
  /** 1 minus normalized dispersion of the scores, 0-1. */
  agreement: number;
  /** One line, commas not dashes, for the tooltip. */
  reason: string;
}

const weightOf = (s: SourceResult) => s.source.weight ?? 1;
const sumWeight = (list: SourceResult[]) =>
  list.reduce((n, s) => n + weightOf(s), 0);

/**
 * The sources confidence is measured over: scoring adapters only, minus the
 * ones skipped for a missing key.
 *
 * A missing key is a constant of the deployment rather than a fact about this
 * indicator. Counting it would pin every hash lookup to the same value forever
 * (with no keys at all the weighted ceiling for hashes is 28%) and so report
 * nothing. The detectors row already reports that gap separately as "no key".
 *
 * A source that cannot answer for *this* indicator stays in the denominator: an
 * IPv6 address genuinely has less intelligence available than an IPv4 one, and
 * that is a property of the indicator. Errors, timeouts and rate limits stay
 * too, since those are evidence missing from this check that a re-check may
 * recover.
 */
function poolOf(sources: SourceResult[]): SourceResult[] {
  return sources.filter(
    (s) =>
      weightOf(s) > 0 && !(s.status === "skipped" && !s.enabled),
  );
}

/**
 * How closely the sources that answered agree with each other, 0-1.
 *
 * Deliberately blind to whether the scores are high or low. Unanimously clean
 * and unanimously malicious are equally well evidenced, so this measures spread
 * (a weighted mean absolute deviation) and never level. An earlier formulation
 * measured level and turned out to be `weightedAvg / 100` restated, which scored
 * a unanimously clean 8.8.8.8 at 0.01.
 */
export function agreementOf(scored: SourceResult[]): number {
  const total = sumWeight(scored);
  if (total === 0) return 0;
  const mean =
    scored.reduce((n, s) => n + weightOf(s) * (s.score as number), 0) / total;
  const deviation =
    scored.reduce(
      (n, s) => n + weightOf(s) * Math.abs((s.score as number) - mean),
      0,
    ) / total;
  return Math.max(0, 1 - deviation / MAX_DISPERSION);
}

export function levelFor(score: number): Confidence {
  if (score >= HIGH_AT) return "high";
  if (score >= MEDIUM_AT) return "medium";
  return "low";
}

/** Plain-language phrase for how far apart the sources sat. */
function agreementPhrase(agreement: number): string {
  if (agreement >= AGREE_AT) return "sources agree";
  if (agreement >= PARTLY_AT) return "sources partly disagree";
  return "sources disagree sharply";
}

function buildReason(
  responded: number,
  pool: number,
  unsupported: number,
  agreement: number,
): string {
  const parts = [`${responded} of ${pool} detectors responded`];
  // Worth naming, because it is the one coverage gap a re-check cannot close.
  if (unsupported > 0) {
    parts.push(`${unsupported} cannot answer for this indicator`);
  }
  parts.push(agreementPhrase(agreement));
  return parts.join(", ");
}

/**
 * How much the risk score is worth believing, as distinct from how bad it is.
 *
 * Two live IPs motivate this: 103.83.237.2 and 192.227.144.55 both read
 * "malicious 75", but in both cases the 75 is `MALICIOUS_FLOOR` pinned by
 * AbuseIPDB alone while twelve other detectors saw nothing. WannaCry also reads
 * malicious, at 98, with every detector agreeing. The verdict cannot tell those
 * apart; this can.
 *
 * Returns null when there is no scoring source to measure, so the UI renders
 * nothing rather than an unearned tier.
 */
export function scoreConfidence(
  result: ConfidenceInput,
): ScoreConfidence | null {
  const pool = poolOf(result.sources);
  const totalWeight = sumWeight(pool);
  if (totalWeight === 0) return null;

  const responded = pool.filter((s) => s.status === "ok");
  const coverage = sumWeight(responded) / totalWeight;
  const agreement = agreementOf(
    responded.filter((s) => typeof s.score === "number"),
  );

  const unsupported = pool.filter(
    (s) => s.status === "skipped" && s.enabled,
  ).length;
  const reason = buildReason(
    responded.length,
    pool.length,
    unsupported,
    agreement,
  );

  // A forced-benign override means the app has already decided what this file
  // is, so the engines that still flag it are not a live disagreement. EICAR
  // measures 0.46 here and would otherwise render "clean, low confidence" for
  // the one sample the tool is most certain about.
  if (result.scoreBreakdown?.benignOverride) {
    return {
      level: "high",
      score: 1,
      coverage,
      agreement,
      reason: "known benign sample, identified by hash",
    };
  }

  const score = coverage * (AGREEMENT_SHARE + (1 - AGREEMENT_SHARE) * agreement);
  return { level: levelFor(score), score, coverage, agreement, reason };
}
