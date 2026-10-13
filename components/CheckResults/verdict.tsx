"use client";

import { ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import type { SourceMeta, SourceResult, Verdict } from "@/lib/ti/types";
import { cn } from "@/lib/utils";
import type { IconType } from "./types";

export type VerdictStyle = {
    label: string;
    headline: string;
    icon: IconType;
    text: string;
    bar: string;
    ring: string;
    chip: string;
    wash: string;
    border: string;
};

/**
 * The verdict's colour and label, shared by every component that has to show
 * one. The hero this file used to hold is gone: `panel.tsx` renders the
 * verdict now, once, under the sprite.
 */
export const VERDICT_STYLE: Record<Verdict, VerdictStyle> = {
    malicious: {
        label: "Malicious",
        headline: "Malicious",
        icon: ShieldAlert,
        text: "text-red-600 dark:text-red-400",
        bar: "bg-red-500",
        ring: "stroke-red-500",
        chip: "border-transparent bg-red-500/12 text-red-600 dark:text-red-400",
        wash: "from-red-500/15",
        border: "border-red-500/40",
    },
    suspicious: {
        label: "Suspicious",
        headline: "Suspicious",
        icon: ShieldAlert,
        text: "text-orange-600 dark:text-orange-400",
        bar: "bg-orange-500",
        ring: "stroke-orange-500",
        chip: "border-transparent bg-orange-500/12 text-orange-600 dark:text-orange-400",
        wash: "from-orange-500/15",
        border: "border-orange-500/40",
    },
    low: {
        label: "Low risk",
        headline: "Low risk",
        icon: ShieldQuestion,
        text: "text-amber-600 dark:text-amber-400",
        bar: "bg-amber-500",
        ring: "stroke-amber-500",
        chip: "border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400",
        wash: "from-amber-500/12",
        border: "border-amber-500/40",
    },
    clean: {
        label: "Clean",
        headline: "Clean",
        icon: ShieldCheck,
        text: "text-emerald-600 dark:text-emerald-400",
        bar: "bg-emerald-500",
        ring: "stroke-emerald-500",
        chip: "border-transparent bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
        wash: "from-emerald-500/12",
        border: "border-emerald-500/40",
    },
    unknown: {
        label: "Unknown",
        headline: "Unknown",
        icon: ShieldQuestion,
        text: "text-muted-foreground",
        bar: "bg-muted-foreground",
        ring: "stroke-muted-foreground",
        chip: "border-transparent bg-muted text-muted-foreground",
        wash: "from-foreground/8",
        border: "border-foreground/20",
    },
};

/** One position in the cell bar: a source that has answered, or one that has
 *  not yet. */
type CellSlot = { name?: string; result?: SourceResult };

/**
 * The bar's layout, one slot per source.
 *
 * Given the panel it lays every source out in registry order and fills the
 * slots as answers arrive, so a cell is in its final position from the first
 * frame. Ordering by settle time instead put the readings in arrival order,
 * which reads as noise. Without a panel it keeps the order it was handed and
 * pads.
 */
function cellSlots(
    sources: SourceResult[],
    total: number,
    panel?: SourceMeta[],
): CellSlot[] {
    if (panel && panel.length > 0) {
        const byId = new Map(sources.map((s) => [s.source.id, s] as const));
        return panel.map((m) => ({ name: m.name, result: byId.get(m.id) }));
    }
    const slots: CellSlot[] = sources.map((s) => ({
        name: s.source.name,
        result: s,
    }));
    // Placeholders for sources still out, so the bar is its final width from
    // the first frame rather than growing a cell at a time.
    while (slots.length < total) slots.push({});
    return slots;
}

/**
 * The progress bar, one cell per source.
 *
 * The bar is the panel: how far along is how many cells are filled, and what
 * they said is how they are filled. Grey throughout, adverse included. There
 * is no verdict yet, and three dark cells out of nine are not three out of
 * twenty-seven, so nothing here gets the colour a verdict would.
 *
 * The legend is the count. Each key carries its own number, so the reader
 * matches a fill to a figure without a second line, and assistive tech gets
 * the tally the aria-hidden bar cannot give it. Hover a cell for its source.
 */
export function SourceCells({
    sources,
    total,
    panel,
}: Readonly<{
    sources: SourceResult[];
    total: number;
    /** The registry-ordered panel, while one is known. Given it, an
     *  outstanding source holds its own place rather than trailing the
     *  answered ones. */
    panel?: SourceMeta[];
}>) {
    const slots = cellSlots(sources, total, panel);
    const tally = cellTally(sources);
    const settled = sources.length;
    const of = Math.max(total, slots.length);
    const pct = of > 0 ? Math.round((settled / of) * 100) : 0;

    return (
        <div className="space-y-2.5">
            <div
                role="progressbar"
                aria-label="Threat-intel sources checked"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={of > 0 ? pct : undefined}
                className="flex gap-0.5"
            >
                {slots.length > 0
                    ? slots.map((slot, i) => (
                          <span
                              // Position is the identity here: a pending slot
                              // has no source to take a key from.
                              key={i}
                              title={slot.name}
                              className={cn(
                                  "h-3.5 min-w-0 flex-1 transition-colors duration-150",
                                  slot.result
                                      ? CELL_TONE[cellReading(slot.result)]
                                      : "animate-pulse bg-muted",
                              )}
                          />
                      ))
                    : // Before the panel is known there is nothing to divide
                      // the bar by; hold its height with one empty track.
                      <span className="h-3.5 flex-1 animate-pulse bg-muted" />}
            </div>

            {/* A fixed line from the first frame, zeroes included, so nothing
                below it moves when the first answer lands. */}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 font-mono text-[12px] text-muted-foreground">
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {CELL_KEYS.map((k) => (
                        <span key={k.reading} className="inline-flex items-center gap-1.5">
                            <i aria-hidden className={cn("size-2.5", CELL_TONE[k.reading])} />
                            <b className="font-bold tabular-nums text-foreground">
                                {tally[k.reading]}
                            </b>
                            {k.label}
                        </span>
                    ))}
                </div>
                <span className="tabular-nums">
                    {settled} of {of || "…"} checked
                </span>
            </div>
        </div>
    );
}

/** The three readings a settled source can have. The cell fills and the
 *  counts beside them both go through this, so they cannot come to disagree
 *  about the same source. */
type CellReading = "adverse" | "clean" | "gap";

function cellReading(s: SourceResult): CellReading {
    if (s.status !== "ok") return "gap";
    if (s.malicious === true || (s.score ?? 0) > 0) return "adverse";
    return "clean";
}

/** Fill and weight only, no hue: dark for adverse, mid grey for clean, and a
 *  hatch for a source that never assessed the indicator, the same hatch the
 *  detector tracks use, so a gap in the evidence cannot read as evidence. */
const CELL_TONE: Record<CellReading, string> = {
    adverse: "bg-foreground",
    clean: "bg-foreground/35",
    gap: "bg-[repeating-linear-gradient(45deg,var(--color-muted-foreground)_0_1px,transparent_1px_4px)] ring-1 ring-inset ring-foreground/25",
};

/** The legend, in the order the readings matter. "No answer" is its own key on
 *  purpose: a source that timed out, hit a rate limit or has no key never
 *  looked, and folding it into clean would let a gap pass as a finding. */
const CELL_KEYS: { reading: CellReading; label: string }[] = [
    { reading: "adverse", label: "adverse" },
    { reading: "clean", label: "clean" },
    { reading: "gap", label: "no answer" },
];

/** Counted from exactly the sources the bar renders rather than from
 *  `consensusBuckets`, which covers only the weight-bearing detectors: a
 *  legend sitting under the cells has to describe the cells. */
function cellTally(sources: SourceResult[]): Record<CellReading, number> {
    const tally: Record<CellReading, number> = { adverse: 0, clean: 0, gap: 0 };
    for (const s of sources) tally[cellReading(s)] += 1;
    return tally;
}

/** One cell of the stat strip: a small label over the value it names. */
