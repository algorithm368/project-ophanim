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
 * Weighted toward the worst signal (max) while still rewarding consensus (avg).
 * A definitive malicious listing sets a floor so a single strong hit can't be
 * diluted by many "clean" context sources.
 */
export function aggregateRisk(results: SourceResult[]): {
  riskScore: number;
  verdict: Verdict;
} {
  const scored = results.filter(
    (r) => r.status === "ok" && typeof r.score === "number",
  );
  const scores = scored.map((r) => r.score as number);

  if (scores.length === 0) {
    return { riskScore: 0, verdict: "unknown" };
  }

  const max = Math.max(...scores);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  let risk = Math.round(0.65 * max + 0.35 * avg);

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
