import { mergeFields } from "./orchestrate";
import type { GeoContext, SourceResult } from "./types";

/**
 * What a half-finished lookup is allowed to say about itself.
 *
 * Every field here is something one source observed or a tally of who has
 * answered. Nothing here needs the whole panel, which is the line the spec
 * draws: a count is honest while incomplete, a score is not.
 */
export interface PartialCounts {
  /** Size of the panel, from the stream's `start` event. */
  total: number;
  /** Sources that have come back, whatever they said. */
  settled: number;
  /** Settled weighted sources that actually returned an assessment. */
  answered: number;
  /** Answered sources with something adverse to say. */
  adverse: number;
  /** Answered sources that have no record of this indicator at all. Kept apart
   *  from `clean`, because "we have never seen this file" and "we looked and it
   *  is fine" are different answers and an analyst treats them differently.
   *  VirusTotal's 404 path is exactly this: `{ status: "ok" }` with no score. */
  noRecord: number;
  /** Answered sources that looked and found nothing wrong. */
  clean: number;
  /** Settled weighted sources that could not answer at all. */
  gaps: number;
  /** How many are still out. Never negative. */
  stillOut: number;
}

/**
 * A lookup in progress.
 *
 * There is deliberately no `riskScore`, `verdict` or `scoreBreakdown` field.
 * The withholding rule is then enforced by the compiler rather than by every
 * call site remembering it, which is the difference between a rule and a hope.
 */
export interface PartialLookup {
  counts: PartialCounts;
  /** The settled sources themselves, for the per-source rows. */
  sources: SourceResult[];
  /** First-non-empty merge of whatever geolocation has arrived. */
  geo?: GeoContext;
}

/** Adverse means "reported something against this indicator", which is broader
 *  than "cleared the flagging threshold". Kept identical to consensusBuckets()
 *  so the streaming and completed numbers cannot disagree. */
function isAdverse(s: SourceResult): boolean {
  return s.malicious === true || (s.score ?? 0) > 0;
}

/** No score at all means the source has no record of this indicator, which is
 *  not the same as having looked and found it clean. Same predicate as
 *  consensusBuckets(), for the same reason. */
function isNoRecord(s: SourceResult): boolean {
  return s.score === undefined && s.malicious !== true;
}

export function buildPartial(
  total: number,
  settled: SourceResult[],
): PartialLookup {
  // Context-only sources (weight 0) cannot flag anything, so they are not
  // detectors. Counting them here would disagree with the completed strip.
  const scoring = settled.filter((s) => (s.source.weight ?? 1) > 0);
  const answered = scoring.filter((s) => s.status === "ok");
  const adverse = answered.filter(isAdverse).length;
  const noRecord = answered.filter(isNoRecord).length;

  const geo = mergeFields(
    settled
      .map((s) => s.geo)
      .filter((g): g is GeoContext => g !== undefined && g !== null),
  );

  return {
    counts: {
      total,
      settled: settled.length,
      answered: answered.length,
      adverse,
      noRecord,
      // Same arithmetic as consensusBuckets(), floor included: a source with no
      // record is neither adverse nor clean, and lumping it into clean would
      // make the streaming strip disagree with the completed one.
      clean: Math.max(0, answered.length - adverse - noRecord),
      gaps: scoring.length - answered.length,
      stillOut: Math.max(0, total - settled.length),
    },
    sources: settled,
    ...(geo ? { geo } : {}),
  };
}
