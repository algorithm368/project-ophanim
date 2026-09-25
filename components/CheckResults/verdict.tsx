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

/** One position in the dot strip: a source that has answered, or one that has
 *  not yet. */
type DotSlot = { name?: string; result?: SourceResult };

/**
 * The strip's layout, one slot per source.
 *
 * Given the panel it lays every source out in registry order and fills the
 * slots as answers arrive, so a dot is in its final position from the first
 * frame. Ordering by settle time instead put the colours in arrival order,
 * which then visibly reshuffled into registry order when the completed hero
 * took over. Without a panel (the completed hero, which has the real sources
 * already in registry order) it keeps the order it was handed and pads.
 */
function dotSlots(
    sources: SourceResult[],
    total: number,
    panel?: SourceMeta[],
): DotSlot[] {
    if (panel && panel.length > 0) {
        const byId = new Map(sources.map((s) => [s.source.id, s] as const));
        return panel.map((m) => ({ name: m.name, result: byId.get(m.id) }));
    }
    const slots: DotSlot[] = sources.map((s) => ({
        name: s.source.name,
        result: s,
    }));
    // Placeholders for sources still out, so the strip is its final width from
    // the first frame rather than growing a dot at a time.
    while (slots.length < total) slots.push({});
    return slots;
}

/**
 * One dot per source, on one line, under the meter.
 *
 * Present in both phases on purpose. While streaming it is the liveness
 * readout; once complete it is a glanceable health overview, and because it
 * never appears, disappears or reorders, nothing on the page moves when the
 * result lands. Hover names the source.
 */
export function SourceDots({
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
    const tally = dotTally(sources, total);
    return (
        // The min-height holds the row at caption height from the first frame.
        // The dots are 6px and the caption ~17px, so a caption that appears once
        // the panel is known (the first frame has no totals to count) would
        // otherwise grow the row under everything below it.
        <div className="flex min-h-[1.125rem] flex-wrap items-center gap-x-3 gap-y-1.5">
            <div className="flex flex-wrap gap-1" aria-hidden>
                {dotSlots(sources, total, panel).map((slot, i) => (
                    <span
                        // Position is the identity here: a pending slot has
                        // no source to take a key from.
                        key={i}
                        title={slot.name}
                        className={cn(
                            "size-1.5 rounded-full",
                            slot.result
                                ? DOT_TONE[dotReading(slot.result)]
                                : "animate-pulse bg-foreground/15",
                        )}
                    />
                ))}
            </div>
            {/* The legend the strip never had. Twenty-five 6px dots with one of
                them a different hue is a chart with no key: nothing on the page
                said what a dot stood for, what the odd colour meant, or how many
                there were of each — and a reader who cannot separate red from
                green got no reading at all, since the strip is aria-hidden and
                hue was the only channel carrying it. Counting in text puts the
                figure in a second channel and gives assistive tech the summary
                instead of nothing. The strip itself keeps registry order, which
                is deliberate; see `dotSlots`. */}
            {tally.length > 0 && (
                <p className="font-mono text-[11px] text-muted-foreground">
                    {tally.map((part, i) => (
                        <span key={part.key}>
                            {i > 0 && <span aria-hidden> · </span>}
                            <span className={part.tone}>{part.text}</span>
                        </span>
                    ))}
                </p>
            )}
        </div>
    );
}

/** The three readings a settled source can have. `dotTone` and the caption
 *  beneath the strip both go through this, so the colours and the counts
 *  cannot come to disagree about the same source. */
type DotReading = "adverse" | "gap" | "clean";

function dotReading(s: SourceResult): DotReading {
    if (s.status !== "ok") return "gap";
    if (s.malicious === true || (s.score ?? 0) > 0) return "adverse";
    return "clean";
}

const DOT_TONE: Record<DotReading, string> = {
    adverse: "bg-red-600 dark:bg-red-400",
    gap: "bg-amber-500",
    clean: "bg-emerald-600 dark:bg-emerald-400",
};

/** The caption's parts, in the order they matter, zeroes omitted.
 *
 *  Counted from exactly the sources the strip renders rather than from
 *  `consensusBuckets`, which covers only the weight-bearing detectors: a
 *  caption sitting under the dots has to describe the dots, not a different
 *  and smaller population that happens to be nearby on the card. */
function dotTally(
    sources: SourceResult[],
    total: number,
): { key: string; text: string; tone?: string }[] {
    let adverse = 0;
    let gap = 0;
    let clean = 0;
    for (const s of sources) {
        const reading = dotReading(s);
        if (reading === "adverse") adverse += 1;
        else if (reading === "gap") gap += 1;
        else clean += 1;
    }
    const waiting = Math.max(0, total - sources.length);

    const parts: { key: string; text: string; tone?: string }[] = [];
    if (adverse > 0) {
        parts.push({
            key: "adverse",
            text: `${adverse} adverse`,
            tone: "text-red-600 dark:text-red-400",
        });
    }
    // "No answer" is its own reading on purpose: a source that timed out, hit a
    // rate limit or has no key never assessed the indicator, and folding it in
    // with the ones that looked and found nothing would let a gap in the
    // evidence read as evidence.
    if (gap > 0) parts.push({ key: "gap", text: `${gap} no answer` });
    if (clean > 0) parts.push({ key: "clean", text: `${clean} clean` });
    if (waiting > 0) parts.push({ key: "waiting", text: `${waiting} waiting` });
    return parts;
}

/** One cell of the stat strip: a small label over the value it names. */
