import type { CheckStats, SourceResult, Verdict } from "./types";

const FLAG_THRESHOLD = 40;

export function verdictFor(score: number, hasData: boolean): Verdict {
  if (!hasData) return "unknown";
  if (score >= 70) return "malicious";
  if (score >= 40) return "suspicious";
  if (score >= 15) return "low";
  return "clean";
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
 * scored sources. A definitive malicious listing still sets a floor.
 */
export function aggregateRisk(results: SourceResult[]): {
  riskScore: number;
  verdict: Verdict;
} {
  const scored = results.filter(
    (r) =>
      r.status === "ok" &&
      typeof r.score === "number" &&
      (r.source.weight ?? 1) > 0,
  );

  if (scored.length === 0) {
    return { riskScore: 0, verdict: "unknown" };
  }

  let weightSum = 0;
  let weightedScoreSum = 0;
  let effectiveMax = 0;
  for (const r of scored) {
    const weight = r.source.weight ?? 1;
    const score = r.score as number;
    weightSum += weight;
    weightedScoreSum += score * weight;
    effectiveMax = Math.max(effectiveMax, score * weight);
  }

  const weightedAvg = weightSum > 0 ? weightedScoreSum / weightSum : 0;
  let risk = Math.round(0.6 * effectiveMax + 0.4 * weightedAvg);

  const hasHardMalicious = results.some(
    (r) => r.status === "ok" && r.malicious === true,
  );
  if (hasHardMalicious) risk = Math.max(risk, 75);

  risk = Math.min(100, Math.max(0, risk));
  return { riskScore: risk, verdict: verdictFor(risk, true) };
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
  };
}
