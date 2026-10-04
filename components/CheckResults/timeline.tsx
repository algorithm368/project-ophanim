"use client";

import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
    buildTimeline,
    EVENT_LABEL,
    PHASE_LABEL,
    phaseSpan,
    type EventKind,
    type Phase,
    type PhaseKind,
    type Timeline,
    type TimelineEvent,
} from "@/lib/ti/timeline";
import type { AnyCheckResult } from "@/lib/ti/types";
import { cn } from "@/lib/utils";
import { Tile } from "./frame";

/**
 * The indicator's life, as a phase strip over a dated ledger.
 *
 * The strip is the shape (sat unused, went live, got listed, still reported)
 * and the ledger is the detail. The strip is decorative to a screen reader:
 * every phase edge is a ledger row, so nothing lives only in the picture.
 * It is a section of the panel's frame, directly above the record, which no
 * longer carries any dates of its own.
 */
export const TimelineTile = memo(function TimelineTile({
    result,
}: Readonly<{ result: AnyCheckResult }>) {
    const timeline = useMemo(() => buildTimeline(result), [result]);
    const [lit, setLit] = useState<readonly EventKind[]>([]);
    const { events, sourceCount } = timeline;
    return (
        <Tile
            span={12}
            id="timeline"
            title="Timeline"
            note={events.length > 0 ? `${plural(events.length, "event")} · ${plural(sourceCount, "source")}` : undefined}
        >
            {events.length === 0 ? (
                <p className="font-mono text-xs text-muted-foreground">No source has dated this indicator</p>
            ) : (
                <>
                    {timeline.phases.length > 0 && <PhaseStrip timeline={timeline} onHover={setLit} />}
                    <Ledger timeline={timeline} lit={lit} />
                </>
            )}
        </Tile>
    );
});

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);

const PHASE_STYLE: Record<PhaseKind, string> = {
    "before-records": "top-[24px] h-px bg-muted-foreground/60",
    dormant:
        "top-[18px] h-3.5 border border-muted-foreground/50 bg-[repeating-linear-gradient(135deg,transparent_0_3px,var(--color-muted-foreground)_3px_4px)] opacity-60",
    live: "top-[18px] h-3.5 bg-muted-foreground/60",
    listed: "top-[18px] h-3.5 bg-red-600 dark:bg-red-400",
    quiet: "top-[18px] h-3.5 border border-muted-foreground/50",
    "paid-to": "top-[18px] h-3.5 border border-dashed border-muted-foreground",
    lapsed: "top-[18px] h-3.5 border-l-2 border-muted-foreground/40",
};

function PhaseStrip({
    timeline,
    onHover,
}: Readonly<{ timeline: Timeline; onHover: (edges: readonly EventKind[]) => void }>) {
    const { events, phases, now } = timeline;
    const start = Math.min(...events.map((e) => dayMs(e.at)), ...phases.map((p) => dayMs(p.from)));
    const end = Math.max(dayMs(now), ...events.map((e) => dayMs(e.at)));
    const span = Math.max(end - start, 86_400_000);
    const pct = (ms: number) => ((ms - start) / span) * 100;
    const years: number[] = [];
    for (let y = new Date(start).getUTCFullYear() + 1; Date.UTC(y, 0, 1) <= end; y++) years.push(y);
    const todayAt = pct(dayMs(now));

    return (
        <div className="relative mb-2 h-14" aria-hidden="true">
            {phases.map((p) => (
                <Segment
                    key={p.kind}
                    phase={p}
                    left={pct(dayMs(p.from))}
                    width={pct(dayMs(p.to)) - pct(dayMs(p.from))}
                    onHover={onHover}
                />
            ))}
            {years.map((y) => (
                <div key={y} className="absolute top-[34px]" style={{ left: `${pct(Date.UTC(y, 0, 1))}%` }}>
                    <span className="block h-1 w-px bg-muted-foreground/60" />
                    <span className="absolute top-1.5 -translate-x-1/2 font-mono text-[9px] text-muted-foreground">
                        {y}
                    </span>
                </div>
            ))}
            <div className="absolute top-2 h-8 border-l border-dashed border-foreground" style={{ left: `${todayAt}%` }}>
                <span
                    className={cn(
                        "absolute -top-2 font-mono text-[8.5px] tracking-[0.1em]",
                        todayAt > 90 ? "right-1" : "left-1",
                    )}
                >
                    TODAY
                </span>
            </div>
        </div>
    );
}

function Segment({
    phase,
    left,
    width,
    onHover,
}: Readonly<{
    phase: Phase;
    left: number;
    width: number;
    onHover: (edges: readonly EventKind[]) => void;
}>) {
    const label = phase.kind === "lapsed" ? PHASE_LABEL.lapsed : `${PHASE_LABEL[phase.kind]} ${phaseSpan(phase.from, phase.to)}`;
    return (
        <div
            className="absolute inset-y-0"
            style={{ left: `${left}%`, width: `${width}%` }}
            title={`${label}, ${phase.from} to ${phase.to}`}
            onMouseEnter={() => onHover(phase.edges)}
            onMouseLeave={() => onHover([])}
        >
            <FitLabel text={label} adverse={phase.kind === "listed"} />
            <div className={cn("absolute inset-x-0", PHASE_STYLE[phase.kind])} />
        </div>
    );
}

/** A phase name that shows only when it fits its segment, so two labels can
 *  never overlap; a hidden one is still in the segment's tooltip. */
function FitLabel({ text, adverse }: Readonly<{ text: string; adverse: boolean }>) {
    const ref = useRef<HTMLSpanElement>(null);
    const [fits, setFits] = useState(true);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const check = () => setFits(el.scrollWidth <= el.clientWidth);
        check();
        const observer = new ResizeObserver(check);
        observer.observe(el);
        return () => observer.disconnect();
    }, [text]);
    return (
        <span
            ref={ref}
            className={cn(
                "absolute inset-x-0 top-0.5 overflow-hidden whitespace-nowrap pr-1 font-mono text-[9px] tracking-[0.06em] uppercase",
                adverse ? "text-red-600 dark:text-red-400" : "text-muted-foreground",
                !fits && "invisible",
            )}
        >
            {text}
        </span>
    );
}

function Ledger({ timeline, lit }: Readonly<{ timeline: Timeline; lit: readonly EventKind[] }>) {
    const gapAfter = new Map(timeline.gaps.map((g) => [g.after, g.months]));
    const rows: React.ReactNode[] = [];
    let year = "";
    for (const e of timeline.events) {
        const y = e.at.slice(0, 4);
        if (y !== year) {
            year = y;
            rows.push(
                <li key={`y${y}`} className="col-span-4 pt-3 pb-0.5 font-mono text-[10px] tracking-[0.1em] text-muted-foreground">
                    {y}
                </li>,
            );
        }
        rows.push(<Row key={e.kind} event={e} lit={lit.includes(e.kind)} />);
        const months = gapAfter.get(e.kind);
        if (months) {
            rows.push(
                <li key={`g${e.kind}`} className="col-span-4 py-1 pl-[calc(3.5rem+14px+1.5rem)] font-mono text-[10px] italic text-muted-foreground">
                    · {months} months quiet ·
                </li>,
            );
        }
    }
    return <ol className="grid list-none grid-cols-[3.5rem_14px_1fr_auto] gap-x-3">{rows}</ol>;
}

const DOT: Record<TimelineEvent["tone"], string> = {
    neutral: "border-foreground bg-foreground",
    adverse: "border-red-600 bg-red-600 dark:border-red-400 dark:bg-red-400",
    future: "border-dashed border-muted-foreground bg-card",
};

function Row({ event, lit }: Readonly<{ event: TimelineEvent; lit: boolean }>) {
    const cell = cn("border-b border-foreground/8 py-1.5", lit && "bg-muted/60");
    const also = event.also.map((a) => `${a.source} ${a.at}`).join("\n");
    return (
        <li className={cn("contents", event.tone === "future" && "text-muted-foreground")}>
            <span className={cn(cell, "font-mono text-xs text-muted-foreground")}>{event.at.slice(5)}</span>
            <span className={cn(cell, "relative flex justify-center")}>
                <span className="absolute inset-y-0 left-1/2 border-l border-foreground/15" />
                <span className={cn("relative mt-1 size-[7px] rounded-full border", DOT[event.tone])} />
            </span>
            <span className={cn(cell, "text-sm")}>
                <b className={cn("font-semibold", event.tone === "adverse" && "text-red-600 dark:text-red-400")}>
                    {EVENT_LABEL[event.kind]}
                </b>
                {event.detail && <span className="text-muted-foreground"> {event.detail}</span>}
            </span>
            <span className={cn(cell, "text-right font-mono text-[10px] text-muted-foreground")} title={also || undefined}>
                {event.source}
                {event.also.length > 0 && ` +${event.also.length}`}
            </span>
        </li>
    );
}
