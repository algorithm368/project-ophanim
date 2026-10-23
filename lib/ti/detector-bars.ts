import { FLAG_THRESHOLD } from "./aggregate";
import type { SourceResult } from "./types";
import { sourceWeight } from "./weight";

/**
 * The score's detectors as a skyline: one bar per source that can move the
 * score, as tall as what it scored.
 *
 * It replaces a sentence ("13 of 13 detectors responded, sources agree") with
 * the thing the sentence summarised. Even bars are agreement, ragged bars are
 * a split, and a gap in the row is a source that did not answer. That last
 * one is why the kinds are kept apart rather than folded into a score: a
 * source that failed and a source that cannot answer for this kind of
 * indicator are both missing a bar, for different reasons, and neither is a
 * zero.
 */

export const DETECTOR_KINDS = ["flagged", "clean", "failed", "n/a"] as const;
export type DetectorKind = (typeof DETECTOR_KINDS)[number];

export interface DetectorBar {
  id: string;
  name: string;
  kind: DetectorKind;
  /** What it scored, 0 to 100. Null for a source with no answer. */
  score: number | null;
}

/** Scoring sources only, flagged first, then clean, then the silent ones,
 *  loudest first within each, so the row reads as a falling skyline. */
export function detectorBars(sources: SourceResult[]): DetectorBar[] {
  return sources
    .filter((s) => sourceWeight(s.source) > 0)
    .map((s) => {
      const kind = kindOf(s);
      const answered = kind === "flagged" || kind === "clean";
      return { id: s.source.id, name: s.source.name, kind, score: answered ? (s.score ?? 0) : null };
    })
    .sort((a, b) => rank(a) - rank(b) || (b.score ?? 0) - (a.score ?? 0));
}

/** How many of each kind, in the skyline's order, leaving out kinds with none. */
export function detectorCounts(bars: DetectorBar[]): { kind: DetectorKind; count: number }[] {
  return DETECTOR_KINDS.map((kind) => ({ kind, count: bars.filter((b) => b.kind === kind).length }))
    .filter((c) => c.count > 0);
}

function kindOf(s: SourceResult): DetectorKind {
  if (s.status === "skipped") return "n/a";
  if (s.status !== "ok") return "failed";
  // The same test the stats' flagged count uses, so the two never disagree.
  return s.malicious === true || (s.score ?? 0) >= FLAG_THRESHOLD ? "flagged" : "clean";
}

function rank(b: DetectorBar): number {
  return DETECTOR_KINDS.indexOf(b.kind);
}
