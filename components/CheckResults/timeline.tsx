"use client";

import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
    buildTimeline,
    PHASE_LABEL,
    phaseSpan,
    type Phase,
    type PhaseKind,
    type ReportActivity,
    type Timeline,
} from "@/lib/ti/timeline";
import type { AnyCheckResult } from "@/lib/ti/types";
import { cn } from "@/lib/utils";
import { Tile } from "./frame";
import { Typed, useLive } from "./live";

/**
 * The indicator's life, as a phase strip: sat unused, went live, got listed,
 * still reported. Each segment's dates are in its tooltip, and the strip as a
 * whole reads to a screen reader as its list of phases. It is a section of the
 * panel's frame, directly above the record.
 */
export const TimelineTile = memo(function TimelineTile({
    result,
}: Readonly<{ result: AnyCheckResult }>) {
    const { pending, typing } = useLive();
    // The strip is the shape of every source's dates together, so it is drawn
    // once they are all in rather than reshaped with each answer.
    const timeline = useMemo(() => (pending ? null : buildTimeline(result)), [pending, result]);
    const events = timeline?.events ?? [];
    const note =
        timeline && events.length > 0
            ? `${plural(events.length, "event")} · ${plural(timeline.sourceCount, "source")}`
            : undefined;
    return (
        <Tile
            span={12}
            id="timeline"
            title="Timeline"
            note={(pending || note) && <Typed text={note} placeholder="16ch" />}
        >
            {!timeline && <div aria-hidden className="h-14 border-b border-dotted border-foreground/30" />}
            {timeline && events.length === 0 && (
                <p className="font-mono text-xs text-muted-foreground">No source has dated this indicator</p>
            )}
            {timeline && events.length > 0 && (
                <div className={cn("space-y-2", typing && "draw-in")}>
                    {timeline.phases.length > 0 && <PhaseStrip timeline={timeline} />}
                    {timeline.activity && <ActivityStrip activity={timeline.activity} now={timeline.now} />}
                </div>
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

const phaseLabel = (p: Phase) =>
    p.kind === "lapsed" ? PHASE_LABEL.lapsed : `${PHASE_LABEL[p.kind]} ${phaseSpan(p.from, p.to)}`;
const phaseTitle = (p: Phase) => `${phaseLabel(p)}, ${p.from} to ${p.to}`;

function PhaseStrip({ timeline }: Readonly<{ timeline: Timeline }>) {
    const { events, phases, now } = timeline;
    const start = Math.min(...events.map((e) => dayMs(e.at)), ...phases.map((p) => dayMs(p.from)));
    const end = Math.max(dayMs(now), ...events.map((e) => dayMs(e.at)));
    const span = Math.max(end - start, 86_400_000);
    const pct = (ms: number) => ((ms - start) / span) * 100;
    const years: number[] = [];
    for (let y = new Date(start).getUTCFullYear() + 1; Date.UTC(y, 0, 1) <= end; y++) years.push(y);
    const todayAt = pct(dayMs(now));

    return (
        <div className="relative h-14" role="img" aria-label={phases.map(phaseTitle).join("; ")}>
            {phases.map((p) => (
                <Segment
                    key={p.kind}
                    phase={p}
                    left={pct(dayMs(p.from))}
                    width={pct(dayMs(p.to)) - pct(dayMs(p.from))}
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

const DAY = 86_400_000;
const WEEK = 7 * DAY;

/**
 * Reports per week across the source's window, on its own axis: on the phase
 * strip's, ninety days of an eight-year life is a sliver. Where the list was
 * cut short, the stretch it did not itemize is hatched rather than left empty,
 * so it never reads as a quiet spell. The bars are decorative; the caption
 * says the same counts in words.
 */
function ActivityStrip({ activity, now }: Readonly<{ activity: ReportActivity; now: string }>) {
    const end = dayMs(now) + DAY;
    const start = dayMs(now) - activity.windowDays * DAY;
    const pct = (ms: number) => ((ms - start) / (end - start)) * 100;
    const peak = Math.max(1, ...activity.weeks.map((w) => w.count));
    const covered = dayMs(activity.covered);
    const untold = activity.total - activity.itemized;
    const months: number[] = [];
    const first = new Date(start);
    for (let m = Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1); m < end; ) {
        months.push(m);
        const d = new Date(m);
        m = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    }
    return (
        <div>
            <div className="relative h-11" aria-hidden="true">
                <span className="absolute top-0.5 left-0 font-mono text-[9px] tracking-[0.06em] text-muted-foreground uppercase">
                    Reports per week, last {activity.windowDays} days
                </span>
                <div className="absolute inset-x-0 top-[14px] h-5 border-b border-foreground/30">
                    {untold > 0 && covered > start && (
                        <div
                            className="absolute inset-y-0 bg-[repeating-linear-gradient(135deg,transparent_0_3px,var(--color-muted-foreground)_3px_4px)] opacity-40"
                            style={{ left: 0, width: `${pct(covered)}%` }}
                        />
                    )}
                    {activity.weeks.map((w) => (
                        <div
                            key={w.from}
                            className="absolute bottom-0 bg-foreground/70"
                            title={`${w.count} from ${shortDay(w.from)}`}
                            style={{
                                left: `${pct(dayMs(w.from))}%`,
                                width: `calc(${pct(dayMs(w.from) + WEEK) - pct(dayMs(w.from))}% - 2px)`,
                                height: `${Math.max(10, (w.count / peak) * 100)}%`,
                            }}
                        />
                    ))}
                </div>
                {months.map((m) => (
                    <span
                        key={m}
                        className="absolute top-[36px] -translate-x-1/2 font-mono text-[9px] text-muted-foreground"
                        style={{ left: `${pct(m)}%` }}
                    >
                        {new Date(m).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}
                    </span>
                ))}
            </div>
            <ActivityCaption activity={activity} />
        </div>
    );
}

const shortDay = (day: string) =>
    new Date(dayMs(day)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** The strip is decorative, so the counts it draws are said here in words. */
function ActivityCaption({ activity }: Readonly<{ activity: ReportActivity }>) {
    const { source, windowDays, itemized, total } = activity;
    const counted =
        itemized < total
            ? `${total} reports in ${windowDays} days, ${itemized} dated back to ${shortDay(activity.covered)}, ${total - itemized} earlier not dated`
            : `${plural(total, "report")} in ${windowDays} days`;
    return (
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
            {source}: {counted}
        </p>
    );
}

function Segment({ phase, left, width }: Readonly<{ phase: Phase; left: number; width: number }>) {
    return (
        <div className="absolute inset-y-0" style={{ left: `${left}%`, width: `${width}%` }} title={phaseTitle(phase)}>
            <FitLabel text={phaseLabel(phase)} adverse={phase.kind === "listed"} />
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
