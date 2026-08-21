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

// A single source at 100 with weight 1.0 contributes 0.6 x 100 = 60 points
// before the consensus term is consulted, which is already past SUSPICIOUS_AT
// and needs a weighted average of only 25 to clear MALICIOUS_AT. Measured over
// nine live indicators, no amount of dissent could pull such a result below
// "suspicious". That is defensible for "suspicious", which means look at this;
// it is not defensible for "malicious", which is a claim.
export const MALICIOUS_MIN_SOURCES = 2;

/**
 * The top band asks for corroboration; the others do not.
 *
 * Withholding "malicious" when one source is alone is a claim about evidence,
 * not about the score, so the score is untouched and the verdict lands one band
 * down. A definitive listing from an authoritative source still reaches
 * "malicious" on its own via the floor, which carries its own weight and quorum
 * gate; this only constrains the blend.
 */
export function verdictFor(
  score: number,
  hasData: boolean,
  corroboration = MALICIOUS_MIN_SOURCES,
): Verdict {
  if (!hasData) return "unknown";
  if (score >= MALICIOUS_AT && corroboration >= MALICIOUS_MIN_SOURCES) {
    return "malicious";
  }
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
// How many independent sources must vouch before an allowlist can hold off an
// authoritative listing. One is not enough: any single feed can be wrong, and a
// compromised major site must stay reportable. Two independent vouches being
// wrong at once is the case worth deferring to.
export const VOUCH_QUORUM = 2;

function computeFloor(results: SourceResult[]): {
  floor: number;
  flooredBy: string;
  highWeight: boolean;
  allowlisted: boolean;
  vouches: number;
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

  // Counted, not weighted. A vouching source is often context-only and
  // therefore weight 0, because `weight` says how much a source's *score*
  // counts and an identification carries no score: GreyNoise naming an address
  // as Shodan, or the scanner identification reading it out of the PTR record,
  // would both contribute nothing to a weighted sum.
  const vouches = results.filter(
    (r) => r.status === "ok" && r.allowlisted === true,
  ).length;

  return {
    floor,
    flooredBy: strongest.source.id,
    highWeight,
    allowlisted: vouches > 0,
    vouches,
  };
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
    // A single vouch holds off a weak floor, as before. A quorum holds off an
    // authoritative one too, which the previous all-or-nothing gate could not
    // express: the digest of a zero-byte file was vouched for by Maltiverse,
    // Hybrid Analysis and a 0/60 VirusTotal, and lost to one URLhaus listing
    // because URLhaus outweighs FLOOR_MIN_WEIGHT.
    const suppress = gate.highWeight
      ? gate.vouches >= VOUCH_QUORUM
      : gate.allowlisted;
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

  // How many sources back the accusation. A floor already required weight or a
  // quorum of its own, so a definitive listing counts as corroborated; only a
  // blend carried by one loud source over the heads of others is held back.
  //
  // Unanimity counts as corroborated whatever the panel size. A single source
  // that is the whole panel has not been contradicted by anyone, and treating
  // it as a lone voice would punish a thin panel for being thin, which is what
  // `scoreConfidence()` is for.
  const flagging = scored.filter(
    (r) => r.malicious === true || (r.score ?? 0) >= FLAG_THRESHOLD,
  ).length;
  const corroboration =
    breakdown.floorApplied || flagging === scored.length
      ? MALICIOUS_MIN_SOURCES
      : flagging;
  const verdict = verdictFor(risk, true, corroboration);
  if (risk >= MALICIOUS_AT && verdict !== "malicious") {
    breakdown.uncorroborated = true;
  }

  return { riskScore: risk, verdict, breakdown };
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
