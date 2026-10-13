"use client";

import { useEffect, useState } from "react";
import { etaBudgetMs, etaLabel } from "@/lib/ti/eta";
import type { PartialLookup } from "@/lib/ti/partial";
import type { SourceMeta, SourceResult } from "@/lib/ti/types";
import { sourceWeight } from "@/lib/ti/weight";
import { cn } from "@/lib/utils";
import { Frame, Tile } from "./frame";
import { SourceCells } from "./verdict";

/**
 * The page before it has answered: a roll call, not a mock of the report.
 *
 * The finished page used to be painted here in grey, every tile at its final
 * span, so nothing moved when the result landed. That held the layout still
 * at the cost of fifteen seconds of placeholder bars, three tallies of the
 * same counts, and real answers kept off screen until the end. This shows
 * only what is true while waiting: which sources have answered, what each one
 * said, and how long it took. The report replaces it whole when the last
 * source is in, and that one jump is the price of not pretending.
 *
 *   hero      what is being checked, and the cell bar
 *   checked   how much longer
 *   roll      every source by name, detectors first, in registry order
 */
export function FrameSkeleton({
    indicator,
    partial,
}: Readonly<{
    /** The name being checked, when the route already knows it. */
    indicator?: string;
    /** Live progress, once the stream has started. Absent on the inert shell a
     *  route paints before it has read anything at all. */
    partial?: PartialLookup | null;
}>) {
    const panel = partial?.metas ?? [];
    return (
        <Frame>
            <Tile span={9}>
                <Hero indicator={indicator} partial={partial} />
            </Tile>

            <Tile span={3} tone="rail" title="Checked">
                {partial ? (
                    <Countdown partial={partial} />
                ) : (
                    <span className="sweep block h-5 w-24 rounded" />
                )}
                <p className="mt-4 border-t border-foreground/12 pt-3.5 text-[12px] leading-relaxed text-muted-foreground">
                    The report appears when the last source answers.
                </p>
            </Tile>

            <Tile span={12}>
                {panel.length > 0 ? (
                    <RollCall panel={panel} sources={partial?.sources ?? []} />
                ) : (
                    <RollPlaceholder />
                )}
            </Tile>
        </Frame>
    );
}

function Hero({
    indicator,
    partial,
}: Readonly<{ indicator?: string; partial?: PartialLookup | null }>) {
    const c = partial?.counts;
    return (
        <>
            {indicator ? (
                <p className="font-mono text-lg break-all text-muted-foreground">{indicator}</p>
            ) : (
                <span className="sweep block h-6 w-56 rounded" />
            )}

            <span className="mt-3 mb-2 block font-mono text-[15px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
                Analyzing
            </span>

            <SourceCells
                sources={partial?.sources ?? []}
                total={c?.total ?? 0}
                panel={partial?.metas}
            />

            <p className="sr-only" role="status" aria-live="polite">
                {c && c.total > 0
                    ? `${c.settled} of ${c.total} sources checked for ${indicator ?? "the indicator"}. Verdict pending.`
                    : `Checking ${indicator ?? "the indicator"}. Verdict pending.`}
            </p>
        </>
    );
}

/**
 * Every source by name, with what it said and how long it took.
 *
 * Split the way the score splits them: detectors can move the verdict, context
 * sources (geolocation and the like) cannot, and an analyst reads a slow
 * detector very differently from a slow geolocation lookup. Registry order
 * within each group, so a row never moves when its answer lands.
 */
function RollCall({
    panel,
    sources,
}: Readonly<{ panel: SourceMeta[]; sources: SourceResult[] }>) {
    const byId = new Map(sources.map((s) => [s.source.id, s] as const));
    const detectors = panel.filter((m) => sourceWeight(m) > 0);
    const context = panel.filter((m) => sourceWeight(m) <= 0);

    return (
        <div className="space-y-4">
            <RollGroup label="Detectors, move the score" metas={detectors} byId={byId} />
            {context.length > 0 && (
                <RollGroup label="Context, no weight" metas={context} byId={byId} />
            )}
        </div>
    );
}

function RollGroup({
    label,
    metas,
    byId,
}: Readonly<{
    label: string;
    metas: SourceMeta[];
    byId: Map<string, SourceResult>;
}>) {
    const answered = metas.filter((m) => byId.has(m.id)).length;
    return (
        <div>
            <div className="mb-1 flex justify-between font-mono text-[9.5px] tracking-[0.13em] text-muted-foreground uppercase">
                <span>{label}</span>
                <span className="tabular-nums">
                    {answered} of {metas.length}
                </span>
            </div>
            <ul className="gap-x-8 md:columns-2 lg:columns-3">
                {metas.map((m) => (
                    <RollRow key={m.id} meta={m} result={byId.get(m.id)} />
                ))}
            </ul>
        </div>
    );
}

function RollRow({
    meta,
    result,
}: Readonly<{ meta: SourceMeta; result?: SourceResult }>) {
    const status = result ? rollStatus(result, sourceWeight(meta) > 0) : null;
    return (
        <li className="grid break-inside-avoid grid-cols-[1fr_auto_3.25rem] items-baseline gap-3 border-b border-dotted border-foreground/15 py-1 font-mono text-[12px]">
            <span className="truncate">{meta.name}</span>
            {status ? (
                <span
                    className={cn(
                        "text-[10.5px] font-bold tracking-[0.08em] uppercase",
                        status.tone === "adverse" && "text-red-600 dark:text-red-400",
                        status.tone === "gap" && "font-normal text-muted-foreground",
                    )}
                >
                    {status.text}
                </span>
            ) : (
                <span className="animate-pulse text-[10.5px] tracking-[0.08em] text-muted-foreground uppercase">
                    waiting
                </span>
            )}
            <span className="text-right tabular-nums text-muted-foreground">
                {result ? `${(result.durationMs / 1000).toFixed(1)}s` : ""}
            </span>
        </li>
    );
}

const GAP_WORD: Record<Exclude<SourceResult["status"], "ok">, string> = {
    error: "error",
    timeout: "timeout",
    skipped: "skipped",
    rate_limited: "rate limited",
};

/** One word for what a source said. The same three readings as the cell bar
 *  above it, with "no record" kept apart from clean: a detector that has never
 *  seen the indicator has not vouched for it. Red is kept for a source that
 *  actually flagged it, as on the finished page; a score below its flagging
 *  threshold is adverse but says so quietly. */
function rollStatus(
    s: SourceResult,
    detector: boolean,
): { text: string; tone?: "adverse" | "gap" } {
    if (s.status !== "ok") return { text: GAP_WORD[s.status], tone: "gap" };
    if (s.malicious === true) {
        return { text: s.score ? `listed ${s.score}` : "listed", tone: "adverse" };
    }
    if ((s.score ?? 0) > 0) return { text: `adverse ${s.score}` };
    if (!detector) return { text: "ok" };
    return { text: s.score === undefined ? "no record" : "clean" };
}

/** Before the stream has said who is on the panel, there are no names to call.
 *  Rows of the same height hold the tile at roughly its working size. */
function RollPlaceholder() {
    const widths = ["w-3/5", "w-1/2", "w-2/3", "w-2/5", "w-1/2", "w-3/5"];
    return (
        <div className="space-y-4">
            <span className="sweep block h-2 w-40 rounded" />
            <div className="grid gap-x-8 md:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 12 }, (_, i) => (
                    <div key={i} className="py-1.5">
                        <span className={cn("sweep block h-3 rounded", widths[i % widths.length])} />
                    </div>
                ))}
            </div>
        </div>
    );
}

function Countdown({ partial }: Readonly<{ partial: PartialLookup }>) {
    const eta = useEta(partial);
    return <div className="font-mono text-[15px] leading-tight font-bold uppercase">{eta}</div>;
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
