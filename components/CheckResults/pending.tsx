"use client";

import { useEffect, useState } from "react";
import { etaBudgetMs, etaLabel } from "@/lib/ti/eta";
import type { PartialLookup } from "@/lib/ti/partial";
import type { LookupType } from "@/lib/ioc";
import { cn } from "@/lib/utils";
import { Frame, Tile } from "./frame";
import { SourceDots } from "./verdict";

/**
 * The page before it has answered, in the shape it will answer in.
 *
 * Every tile of the finished frame is here at its final span, so nothing moves
 * when the result lands: the sprite appears in the square already holding its
 * place, the narrative replaces the two grey lines already sitting where it
 * goes, and the detector rows replace the counts that were reporting on them.
 *
 * Three of the tiles are not placeholders at all. While sources are streaming
 * there are real facts to show, and they belong in the tiles that will keep
 * showing them:
 *
 *   hero      what is being checked, how far along, and which sources are in
 *   checked   how much longer, where the freshness will be
 *   evidence  the running tally of what the detectors are saying
 *
 * That last one is the reason the counts moved off the old pending card. They
 * were always a report on the detectors, and the detectors have a tile.
 */
export function FrameSkeleton({
    indicator,
    partial,
    kind,
}: Readonly<{
    /** The name being checked, when the route already knows it. */
    indicator?: string;
    /** Live progress, once the stream has started. Absent on the inert shell a
     *  route paints before it has read anything at all. */
    partial?: PartialLookup | null;
    kind?: LookupType;
}>) {
    return (
        <Frame>
            {/* The same box and the same centring as RailTile, so the sprite
                lands where its placeholder was. */}
            <Tile span={3} tone="rail" className="flex flex-col items-center justify-center p-4">
                <span className="sweep block size-[170px] rounded" />
            </Tile>

            <Tile span={6} className="flex flex-col">
                <HeroProgress indicator={indicator} partial={partial} />
            </Tile>

            <Tile span={3} tone="rail" title="Checked" className="flex flex-col">
                <Waiting partial={partial} />
            </Tile>

            <Tile span={9}>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                    {["w-16", "w-12", "w-20", "w-14"].map((w) => (
                        <div key={w}>
                            <span className={cn("sweep block h-2 rounded", w)} />
                            <span className="sweep mt-2 block h-3.5 w-28 rounded" />
                            <span className="sweep mt-1.5 block h-2 w-20 rounded" />
                        </div>
                    ))}
                </div>
            </Tile>

            <Tile span={3} tone="rail" title="Confidence">
                <Lines widths={["w-full", "w-5/6", "w-2/3"]} />
            </Tile>

            <Tile span={9}>
                {partial ? <Tally partial={partial} /> : <Lines widths={ROWS} />}
            </Tile>

            <Tile span={3} tone="rail" title="Ballots">
                <Lines widths={["w-full", "w-4/5", "w-full", "w-3/4", "w-5/6"]} />
            </Tile>

            <Tile span={12} title="Timeline">
                <span className="sweep mb-5 block h-3.5 w-full rounded" />
                {["w-1/2", "w-2/3", "w-2/5", "w-3/5"].map((w, i) => (
                    <div key={`${w}-${i}`} className="py-1.5">
                        <span className={cn("sweep block h-3 rounded", w)} />
                    </div>
                ))}
            </Tile>

            <Tile span={12} title="Subject record">
                <div className="grid grid-cols-1 gap-x-10 md:grid-cols-2">
                    {RECORD.map((w, i) => (
                        // The widths repeat down the list, so the index is the
                        // only thing distinguishing one placeholder from
                        // another; a width alone collides and React drops rows.
                        <div key={`${w}-${i}`} className="py-1.5">
                            <span className={cn("sweep block h-3 rounded", w)} />
                        </div>
                    ))}
                </div>
            </Tile>

            {kind === "domain" && (
                <Tile span={12} title="Subdomains">
                    <div className="grid grid-cols-2 gap-x-8 lg:grid-cols-4">
                        {RECORD.map((w, i) => (
                            <div key={`${w}-${i}`} className="py-1">
                                <span className={cn("sweep block h-3 rounded", w)} />
                            </div>
                        ))}
                    </div>
                </Tile>
            )}

            <Tile span={5} title="Live intel">
                <div className="flex flex-wrap gap-1.5">
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                        <span key={i} className="sweep block aspect-video w-24 shrink-0 rounded" />
                    ))}
                </div>
            </Tile>

            <Tile span={7} title="Look elsewhere">
                <div className="grid gap-x-10 md:grid-cols-3">
                    {[0, 1, 2].map((c) => (
                        <div key={c}>
                            <Lines widths={["w-1/2", "w-3/4", "w-2/3", "w-4/5"]} />
                        </div>
                    ))}
                </div>
            </Tile>

            <Tile span={12} title="Source breakdown">
                <Lines widths={["w-1/3", "w-2/3", "w-1/2", "w-3/5", "w-2/5"]} />
            </Tile>
        </Frame>
    );
}

const ROWS = ["w-full", "w-11/12", "w-4/5", "w-3/4", "w-2/3", "w-1/2"];
const RECORD = [
    "w-full", "w-4/5", "w-2/3", "w-3/4", "w-1/2", "w-5/6",
    "w-3/5", "w-2/3", "w-4/5", "w-1/2", "w-3/4", "w-5/6",
];

/** A stack of sweeping rules, for a tile whose real content is a list. */
function Lines({ widths }: Readonly<{ widths: string[] }>) {
    return (
        <div className="space-y-2.5">
            {widths.map((w, i) => (
                <span key={`${w}-${i}`} className={cn("sweep block h-3 rounded", w)} />
            ))}
        </div>
    );
}

/**
 * The hero while the panel is still answering.
 *
 * Counts never appear without their denominator. Five of twenty-seven sources
 * in, three of them adverse, reads as "3 adverse" to anyone glancing at it,
 * which is alarming; the same three out of a finished twenty-seven is mild.
 */
function HeroProgress({
    indicator,
    partial,
}: Readonly<{ indicator?: string; partial?: PartialLookup | null }>) {
    const c = partial?.counts;
    const pct = c && c.total > 0 ? Math.round((c.settled / c.total) * 100) : 0;

    // Every kind gets a class headline larger than the name itself once the
    // sources land, so the name is set small and quiet from the start and the
    // headline's line box is held open under it. Without that the name would
    // shrink and everything below it would jump on the first result.
    return (
        <>
            <div className="mb-2 border-b border-foreground/12 pb-3">
                {indicator ? (
                    <p className="font-mono text-lg break-all text-muted-foreground">
                        {indicator}
                    </p>
                ) : (
                    // h-6, not h-7: `font-mono text-lg` is a 1.5rem line box, and
                    // a placeholder taller than it moves the tile when the name
                    // arrives.
                    <span className="sweep block h-6 w-56 rounded" />
                )}
                {/* The class, at 2rem: a 2.5rem line box. */}
                <span className="sweep mt-0.5 block h-10 w-44 rounded" />
                <span className="sweep mt-1.5 block h-4 w-60 rounded" />
            </div>

            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="font-mono text-[15px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
                    Analyzing
                </span>
                {c && (
                    <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
                        {c.settled} of {c.total || "…"} sources
                    </span>
                )}
            </div>

            {/* The same meter the score will fill. */}
            <div
                role="progressbar"
                aria-label="Threat-intel sources checked"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={c && c.total > 0 ? pct : undefined}
                className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"
            >
                <div
                    className="h-full rounded-full bg-foreground transition-[width] duration-200 ease-linear"
                    style={{ width: `${Math.max(pct, 3)}%` }}
                />
            </div>

            {partial && (
                <div className="mt-3">
                    <SourceDots
                        sources={partial.sources}
                        total={partial.counts.total}
                        panel={partial.metas}
                    />
                </div>
            )}

            {/* Where the narrative will land. */}
            <div className="mt-4 space-y-2">
                <span className="sweep block h-3 w-11/12 rounded" />
                <span className="sweep block h-3 w-2/3 rounded" />
            </div>

            <p className="sr-only" role="status" aria-live="polite">
                {c && c.total > 0
                    ? `${c.settled} of ${c.total} sources checked for ${indicator ?? "the indicator"}. Verdict pending.`
                    : `Checking ${indicator ?? "the indicator"}. Verdict pending.`}
            </p>
        </>
    );
}

/** The Checked tile before there is anything to be freshly checked: how much
 *  longer, where the age will be. */
function Waiting({ partial }: Readonly<{ partial?: PartialLookup | null }>) {
    if (!partial) {
        return (
            <>
                <span className="sweep block h-6 w-24 rounded" />
                <div className="mt-4 border-t border-foreground/12 pt-3.5">
                    <Lines widths={["w-full", "w-3/4"]} />
                </div>
            </>
        );
    }
    return <Countdown partial={partial} />;
}

function Countdown({ partial }: Readonly<{ partial: PartialLookup }>) {
    const eta = useEta(partial);
    const c = partial.counts;
    return (
        <>
            <div className="font-mono text-[15px] leading-tight font-bold uppercase">{eta}</div>
            <div className="mt-4 grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1.5 border-t border-foreground/12 pt-3.5">
                <span className="font-mono text-[9.5px] tracking-[0.13em] text-muted-foreground uppercase">
                    Still out
                </span>
                <span className="text-right font-mono text-[11.5px] font-bold tabular-nums">
                    {c.total > 0 ? c.stillOut : "…"}
                </span>
                <span className="font-mono text-[9.5px] tracking-[0.13em] text-muted-foreground uppercase">
                    Gaps
                </span>
                <span className="text-right font-mono text-[11.5px] tabular-nums">{c.gaps}</span>
            </div>
        </>
    );
}

/**
 * What the detectors are saying so far, in the tile that will hold their rows.
 *
 * Every count carries its denominator, and the denominator is the detectors
 * rather than the whole panel: most of the panel is context-only, geolocation
 * and the like, which can never answer for or against the indicator.
 */
function Tally({ partial }: Readonly<{ partial: PartialLookup }>) {
    const c = partial.counts;
    return (
        <>
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
                <Cell label="Detectors">
                    {c.answered}{" "}
                    <span className="text-muted-foreground">of {c.detectors || "…"}</span>
                </Cell>
                <Cell label="Adverse">
                    {c.adverse}{" "}
                    <span className="text-muted-foreground">of {c.answered} answered</span>
                </Cell>
                <Cell label="Clean">
                    {c.clean}{" "}
                    <span className="text-muted-foreground">of {c.answered} answered</span>
                </Cell>
                {/* A third answer, not a shade of clean: a source that has never
                    seen the indicator has not vouched for it. */}
                <Cell label="No record">{c.noRecord}</Cell>
            </div>
            <div className="mt-4 border-t border-foreground/12 pt-3">
                <Lines widths={ROWS.slice(0, 4)} />
            </div>
        </>
    );
}

function Cell({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
    return (
        <div className="min-w-0">
            <div className="font-mono text-[9.5px] tracking-[0.13em] text-muted-foreground uppercase">
                {label}
            </div>
            <div className="mt-1.5 font-mono text-[13px] leading-snug wrap-break-word">
                {children}
            </div>
        </div>
    );
}

/**
 * How much longer this is likely to take, ticking down.
 *
 * An analyst waiting twenty seconds is owed an estimate. The budget is the
 * longest timeout among the sources still out, so it shrinks as slow sources
 * land and can never grow; the elapsed side only rises. The countdown therefore
 * never ticks up, and when the estimate runs out it says so instead of counting
 * into negatives.
 */
function useEta(partial: PartialLookup): string {
    const [startedAt] = useState(() => Date.now());
    const [now, setNow] = useState(() => Date.now());

    const settledIds = partial.sources.map((s) => s.source.id);
    const budgetMs = etaBudgetMs(partial.metas, settledIds);
    // Nothing left to count down to once the last source is in.
    const finished = budgetMs === 0;

    useEffect(() => {
        if (finished) return;
        const id = setInterval(() => setNow(Date.now()), 500);
        return () => clearInterval(id);
    }, [finished]);

    return etaLabel(budgetMs - (now - startedAt));
}
