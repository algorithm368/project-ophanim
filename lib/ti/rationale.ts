import {
  CONSENSUS_WEIGHT,
  LOW_AT,
  MALICIOUS_AT,
  MAX_SIGNAL_WEIGHT,
  SUSPICIOUS_AT,
} from "./aggregate";
import { BENIGN_REASON, type BenignReason } from "./benign";
import type { ScoreBreakdown, SourceResult } from "./types";

/**
 * One labelled number from the arithmetic behind the score.
 *
 * Every fact here is a row. There is deliberately no prose: an analyst who can
 * read `consensus 22` does not need to be told that the verdict rests on one
 * source, and a sentence saying so both repeats the row above it and editorial-
 * ises on top of it.
 */
export interface RationaleTerm {
  label: string;
  /** A string only where the fact genuinely is not a number. */
  value: number | string;
  note?: string;
  /** A result rather than an input, ruled off above. */
  derived?: boolean;
}

export interface ScoreRationale {
  terms: RationaleTerm[];
  /** The one case a number cannot carry: a verdict decided by fiat. */
  note?: string;
}

export type RationaleInput = {
  riskScore: number;
  sources: SourceResult[];
  scoreBreakdown?: ScoreBreakdown;
};

const CUTOFFS: [number, string][] = [
  [LOW_AT, "low"],
  [SUSPICIOUS_AT, "suspicious"],
  [MALICIOUS_AT, "malicious"],
];

/**
 * The weighted average of every scoring source except the dominant one.
 *
 * `weightedAvg` includes the dominant source, so it overstates the agreement:
 * on 103.83.237.2 the average including AbuseIPDB's 100 is 22, and without it,
 * 11. Both rows are shown, because the gap between them is the whole question.
 */
function withoutDominant(
  sources: SourceResult[],
  dominantId: string | undefined,
): { average: number; count: number } | null {
  const rest = sources.filter(
    (s) =>
      s.status === "ok" &&
      typeof s.score === "number" &&
      (s.source.weight ?? 1) > 0 &&
      s.source.id !== dominantId,
  );
  const weight = rest.reduce((n, s) => n + (s.source.weight ?? 1), 0);
  if (weight === 0) return null;
  const sum = rest.reduce(
    (n, s) => n + (s.source.weight ?? 1) * (s.score as number),
    0,
  );
  return { average: Math.round(sum / weight), count: rest.length };
}

/** The verdict boundary nearest a score. */
function nearestCutoff(score: number): { at: number; label: string } {
  let best = CUTOFFS[0];
  for (const c of CUTOFFS) {
    if (Math.abs(score - c[0]) < Math.abs(score - best[0])) best = c;
  }
  return { at: best[0], label: best[1] };
}

function nameOf(sources: SourceResult[], id: string | undefined) {
  return id ? sources.find((s) => s.source.id === id)?.source.name : undefined;
}

const times = (w: number) => `×${Math.round(w * 100)}%`;

/**
 * How the score was reached, as arithmetic and nothing else.
 *
 * The prose version this replaces never printed the weighted average, which is
 * the number separating a corroborated verdict from a lone one, and it credited
 * the floor for outcomes the floor barely touched: measured over nine live
 * indicators the floor moves the score 2 to 7 points, while the strongest
 * single signal supplies 60 of a typical 75 before the floor is consulted.
 *
 * Returns null when nothing scored.
 */
export function scoreRationale(
  result: RationaleInput,
): ScoreRationale | null {
  const bd = result.scoreBreakdown;

  const benign = bd?.benignOverride;
  if (benign && benign in BENIGN_REASON) {
    return {
      terms: [{ label: "final", value: result.riskScore, derived: true }],
      note: BENIGN_REASON[benign as BenignReason],
    };
  }

  const scored = result.sources.filter(
    (s) =>
      s.status === "ok" &&
      typeof s.score === "number" &&
      (s.source.weight ?? 1) > 0,
  );
  if (!bd || scored.length === 0) return null;

  const dominant = bd.dominantSourceId
    ? result.sources.find((s) => s.source.id === bd.dominantSourceId)
    : undefined;
  const dominantName = dominant?.source.name ?? "strongest source";
  const blend = Math.round(
    MAX_SIGNAL_WEIGHT * bd.effectiveMax + CONSENSUS_WEIGHT * bd.weightedAvg,
  );

  const terms: RationaleTerm[] = [
    {
      label: "strongest",
      value: dominant?.score ?? bd.effectiveMax,
      note: `${dominantName}, weight ${dominant?.source.weight ?? 1}, ${times(MAX_SIGNAL_WEIGHT)}`,
    },
    {
      label: "consensus",
      value: bd.weightedAvg,
      note: `${scored.length} sources, ${times(CONSENSUS_WEIGHT)}`,
    },
  ];

  const rest = withoutDominant(result.sources, bd.dominantSourceId);
  if (rest) {
    terms.push({
      label: "others",
      value: rest.average,
      note: `${rest.count} sources, excluding ${dominantName}`,
    });
  }

  if (bd.floorApplied && bd.floorValue) {
    terms.push({ label: "blend", value: blend, derived: true });
    terms.push({
      label: "floor",
      value: bd.floorValue,
      note: nameOf(result.sources, bd.flooredBy),
    });
  }
  if (bd.allowlistSuppressed) {
    terms.push({ label: "floor", value: "withheld", note: "allowlisted" });
  }

  terms.push({ label: "final", value: result.riskScore, derived: true });

  if (bd.borderline) {
    const near = nearestCutoff(result.riskScore);
    const gap = result.riskScore - near.at;
    terms.push({
      label: "boundary",
      value: near.at,
      note: `${near.label}, ${gap >= 0 ? "+" : ""}${gap}`,
    });
  }

  return { terms };
}
