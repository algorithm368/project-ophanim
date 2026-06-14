"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { Confidence, GeoResolution, ResolvedField } from "@/lib/ti/types";
import { ScoreRing } from "./primitives";

const TONE: Record<Confidence, string> = {
  high: "border-emerald-600/40 text-emerald-700 dark:text-emerald-400",
  medium: "border-amber-600/40 text-amber-700 dark:text-amber-400",
  low: "border-foreground/25 text-muted-foreground",
};

const LABEL: Record<Confidence, string> = {
  high: "high confidence, providers agree",
  medium: "medium confidence, contested",
  low: "low confidence, single provider or split",
};

/** Small inline chip indicating how trustworthy a reconciled field is. */
export function ConfidenceChip({ confidence }: { confidence: Confidence }) {
  return (
    <span
      title={LABEL[confidence]}
      className={cn(
        "ml-2 inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 align-middle text-[10px] uppercase tracking-wide",
        TONE[confidence],
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {confidence}
    </span>
  );
}

/** Monochrome confidence indicator: filled disc (high), half disc (medium),
 *  ring (low). Grayscale only, color stays reserved for the verdict. Always
 *  shown next to the tier word so the level is never ambiguous. */
export function ConfidenceDot({ confidence }: { confidence: Confidence }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn(
        "size-2.5 shrink-0",
        confidence === "low" ? "text-muted-foreground" : "text-foreground",
      )}
      aria-hidden
    >
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {confidence === "high" && <circle cx="8" cy="8" r="6" fill="currentColor" />}
      {confidence === "medium" && <path d="M8 2 A6 6 0 0 1 8 14 Z" fill="currentColor" />}
    </svg>
  );
}

/** Compact radial gauge for the overall geo-confidence score (0-1 -> 0-100),
 *  monochrome via the foreground stroke. */
export function OverallGauge({
  overall,
}: {
  overall: { score: number; confidence: Confidence };
}) {
  const pct = Math.round(overall.score * 100);
  return (
    <div className="relative size-12 shrink-0" title={LABEL[overall.confidence]}>
      <ScoreRing value={pct} stroke="stroke-foreground" />
      <span className="absolute inset-0 flex items-center justify-center font-mono text-sm font-semibold tabular-nums text-foreground">
        {pct}
      </span>
    </div>
  );
}

/** One-line, comma-separated explanation of the geo confidence (house style:
 *  commas, no dashes). */
export function geoConfidenceReason(res: GeoResolution): string {
  const parts: string[] = [
    `${res.providerCount} provider${res.providerCount === 1 ? "" : "s"}`,
  ];
  if (res.country && res.country.sources.length > 1) {
    parts.push(`${res.country.sources.length} agree on country`);
  }
  if (res.city && res.city.confidence !== "low") {
    parts.push("city corroborated");
  }
  if (res.coordinates && res.coordinates.sources.length > 1) {
    parts.push(
      res.coordinates.confidence === "high"
        ? "coordinates tightly clustered"
        : "coordinates loosely clustered",
    );
  }
  return parts.join(", ");
}

/** Tappable disclosure of which providers disagreed on a field. */
export function Disagreement<T>({ field }: { field: ResolvedField<T> }) {
  const [open, setOpen] = useState(false);
  const alts = field.alternatives;
  if (!alts || alts.length === 0) return null;
  const dissenters = alts.reduce((n, a) => n + a.sources.length, 0);

  return (
    <span className="ml-2 align-middle text-[11px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="underline decoration-dotted underline-offset-2 text-muted-foreground transition-colors hover:text-foreground"
      >
        {field.sources.length} agree · {dissenters} disagree
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5 text-muted-foreground">
          {alts.map((a, i) => (
            <li key={i}>
              {String(a.value)}, {a.sources.join(", ")}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
