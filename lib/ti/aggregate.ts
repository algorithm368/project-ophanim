import type { CheckStats, ScoreBreakdown, SourceResult, Verdict } from "./types";

export const FLAG_THRESHOLD = 40;

// Verdict cutoffs (inclusive lower bounds).
export const MALICIOUS_AT = 70;
export const SUSPICIOUS_AT = 40;
export const LOW_AT = 15;

// Blend: lean on the strongest weighted signal, leavened by the consensus.
export const MAX_SIGNAL_WEIGHT = 0.6;
export const CONSENSUS_WEIGHT = 0.4;

// Hard-listing floors and the gate that admits them.
export const MALICIOUS_FLOOR = 75; // one high-weight definitive listing
export const QUORUM_FLOOR = 50; // two or more weak listings agreeing
export const FLOOR_MIN_WEIGHT = 0.7; // authoritative enough to pin alone

// How close to a cutoff still counts as borderline.
export const BORDERLINE_BAND = 5;

const CUTOFFS = [LOW_AT, SUSPICIOUS_AT, MALICIOUS_AT];

export function verdictFor(score: number, hasData: boolean): Verdict {
  if (!hasData) return "unknown";
  if (score >= MALICIOUS_AT) return "malicious";
  if (score >= SUSPICIOUS_AT) return "suspicious";
  if (score >= LOW_AT) return "low";
  return "clean";
}

function emptyBreakdown(): ScoreBreakdown {
  return {
    effectiveMax: 0,
    weightedAvg: 0,
    floorApplied: false,
    borderline: false,
    allowlistSuppressed: false,
  };
}

/**
 * Decide the hard-listing floor a result qualifies for, if any. Only `ok`,
 * weighted, `malicious===true` sources count. A single high-weight listing pins
 * "malicious" (75); two or more weak ones reach "suspicious" (50); a single weak
 * one pins nothing. Returns the candidate floor plus the facts the caller needs
 * to apply the allowlist-suppression policy.
 */
function computeFloor(results: SourceResult[]): {
  floor: number;
  flooredBy: string;
  highWeight: boolean;
  allowlisted: boolean;
} | null {
  const malicious = results.filter(
    (r) =>
      r.status === "ok" && (r.source.weight ?? 1) > 0 && r.malicious === true,
  );
  if (malicious.length === 0) return null;

  // Seeded with the first element rather than left bare. The guard above
  // already makes the empty case unreachable, so this changes no behaviour, but
  // a bare reduce() throws on an empty array and that guard is one edit away
  // from someone else's refactor.
  const strongest = malicious.reduce(
    (a, b) => ((b.source.weight ?? 1) > (a.source.weight ?? 1) ? b : a),
    malicious[0],
  );
  const highWeight = (strongest.source.weight ?? 1) >= FLOOR_MIN_WEIGHT;

  let floor: number | null = null;
  if (highWeight) floor = MALICIOUS_FLOOR;
  else if (malicious.length >= 2) floor = QUORUM_FLOOR;
  if (floor === null) return null;

  const allowlisted = results.some(
    (r) => r.status === "ok" && r.allowlisted === true,
  );
  return { floor, flooredBy: strongest.source.id, highWeight, allowlisted };
}

/**
 * Combine per-source scores into a single 0-100 risk value.
 *
 * Each source carries a `weight` (0-1) reflecting how authoritative it is for
 * IP maliciousness. A source's effective signal is `score * weight`, so a hit
 * on a highly trusted feed counts for more than the same score on a weak one.
 *
 * The result blends the strongest single signal (so one strong, trusted hit
 * isn't diluted by many quiet sources) with the weighted consensus across all
 * scored sources. A definitive malicious listing still sets a floor, gated on
 * the listing source's weight (or a quorum) so one weak feed cannot pin a
 * verdict, and an explicit allowlist can withhold a weak floor.
 */
export function aggregateRisk(results: SourceResult[]): {
  riskScore: number;
  verdict: Verdict;
  breakdown: ScoreBreakdown;
} {
  const scored = results.filter(
    (r) =>
      r.status === "ok" &&
      typeof r.score === "number" &&
      (r.source.weight ?? 1) > 0,
  );

  if (scored.length === 0) {
    return { riskScore: 0, verdict: "unknown", breakdown: emptyBreakdown() };
  }

  let weightSum = 0;
  let weightedScoreSum = 0;
  let effectiveMax = 0;
  let dominant = scored[0];
  for (const r of scored) {
    const weight = r.source.weight ?? 1;
    const score = r.score as number;
    weightSum += weight;
    weightedScoreSum += score * weight;
    const eff = score * weight;
    if (eff > effectiveMax) {
      effectiveMax = eff;
      dominant = r;
    }
  }

  const weightedAvg = weightSum > 0 ? weightedScoreSum / weightSum : 0;
  let risk = Math.round(
    MAX_SIGNAL_WEIGHT * effectiveMax + CONSENSUS_WEIGHT * weightedAvg,
  );

  const breakdown: ScoreBreakdown = {
    effectiveMax: Math.round(effectiveMax),
    weightedAvg: Math.round(weightedAvg),
    dominantSourceId: dominant.source.id,
    floorApplied: false,
    borderline: false,
    allowlistSuppressed: false,
  };

  const gate = computeFloor(results);
  if (gate && gate.floor > risk) {
    const suppress = gate.allowlisted && !gate.highWeight;
    if (suppress) {
      breakdown.allowlistSuppressed = true;
    } else {
      risk = gate.floor;
      breakdown.floorApplied = true;
      breakdown.flooredBy = gate.flooredBy;
      breakdown.floorValue = gate.floor;
    }
  }

  risk = Math.min(100, Math.max(0, risk));
  breakdown.borderline = CUTOFFS.some(
    (c) => Math.abs(risk - c) <= BORDERLINE_BAND,
  );

  return { riskScore: risk, verdict: verdictFor(risk, true), breakdown };
}

export function computeStats(results: SourceResult[]): CheckStats {
  return {
    total: results.length,
    queried: results.filter(
      (r) => r.status === "ok" || r.status === "error" || r.status === "timeout",
    ).length,
    flagged: results.filter(
      (r) =>
        r.status === "ok" &&
        (r.malicious === true || (r.score ?? 0) >= FLAG_THRESHOLD),
    ).length,
    skipped: results.filter((r) => r.status === "skipped").length,
    errored: results.filter(
      (r) => r.status === "error" || r.status === "timeout",
    ).length,
    rateLimited: results.filter((r) => r.status === "rate_limited").length,
  };
}
