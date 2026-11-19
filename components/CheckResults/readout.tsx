"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { geoConfidence, resolveConfidence, scoreConfidence } from "@/lib/ti/confidence";
import { buildResolverBallot } from "@/lib/ti/dns/ballot";
import { type DetectorBar, type DetectorKind, detectorBars, detectorCounts } from "@/lib/ti/detector-bars";
import { buildVoteTable, providerLabel, VOTE_FIELDS, type VoteTable } from "@/lib/ti/geo/votes";
import { relativeTime } from "@/lib/relative-time";
import { etaBudgetMs, etaLabel } from "@/lib/ti/eta";
import type { PartialLookup } from "@/lib/ti/partial";
import { type AnyCheckResult, isDomainResult, isHashResult, type SourceResult } from "@/lib/ti/types";
import { cn } from "@/lib/utils";
import { Tile } from "./frame";
import { Typed, useLive } from "./live";
import { markFace } from "./mark-face";
import { VoteGrid } from "./voting";

/**
 * The right-hand bar: when this reading was taken, and how far each part of
 * it can be trusted.
 *
 * Everything here is about the lookup rather than the subject. It answers in
 * pictures, not sentences: a sentence like "13 of 13 detectors responded,
 * sources agree" makes the reader rebuild a picture the page could have drawn,
 * so the score's detectors are drawn as a skyline and the location's and the
 * resolution's providers as a grid, each under the level it adds up to.
 */
export function ProvenanceTile({
    result,
    onRefresh,
}: Readonly<{ result: AnyCheckResult; onRefresh: () => void }>) {
    const confidence = useMemo(
        () => scoreConfidence({ sources: result.sources, scoreBreakdown: result.scoreBreakdown }),
        [result.sources, result.scoreBreakdown],
    );
    const geoResolution = "geoResolution" in result ? result.geoResolution : undefined;
    // A hash has no location at all, and an address whose providers all failed
    // has none either; both drop the section rather than drawing an empty one.
    const geo = useMemo(() => geoConfidence(geoResolution), [geoResolution]);
    const votes = useMemo(() => (geoResolution ? buildVoteTable(geoResolution) : null), [geoResolution]);
    // Only a domain has a resolution to vote on. `originResolverConsensus` is
    // dnsGeoSource's own rather than dnsSource's: the two are separate fetches
    // and can name a different winning address on an anycast name, and this is
    // the one the location rows were reconciled from.
    const dns = isDomainResult(result) ? result.context?.originResolverConsensus : undefined;
    const resolve = useMemo(() => resolveConfidence(dns), [dns]);
    const ballot = useMemo(() => (dns ? buildResolverBallot(dns) : null), [dns]);
    const { pending } = useLive();

    // While the panel answers, every section the finished rail can have is
    // drawn, its level withheld: a level over half a panel is a guess, and a
    // section that appears at the end would push the button down. The grids
    // themselves are per-provider facts and fill in as the providers land.
    const showResolve = resolve ?? (pending && isDomainResult(result));
    const showGeo = geo ?? (pending && !isHashResult(result));

    return (
        <Tile span={3} rows={2} tone="rail" className="flex flex-col gap-4">
            <Checked checkedAt={result.checkedAt} cached={result.cached} />
            {(confidence || pending) && (
                <Section title="Score confidence" level={pending ? undefined : confidence?.level}>
                    {pending ? <PendingSkyline /> : <Skyline sources={result.sources} />}
                </Section>
            )}
            {/* Resolution above location, because it is upstream of it: the
                address the resolvers settled on is the address the location
                providers were then asked about. */}
            {showResolve && (
                <Section title="Resolution" level={pending ? undefined : resolve?.level}>
                    {ballot && dns && (
                        <VoteGrid
                            rows={dns.perResolver.map((r) => r.resolver)}
                            cols={[{ key: "a", label: "A rec" }]}
                            cell={(row) => ballot.cells[row]}
                            rowLabel={(row) => row}
                        />
                    )}
                </Section>
            )}
            {showGeo && (
                <Section title="Location" level={pending ? undefined : geo?.level}>
                    {votes && <GeoGrid table={votes} />}
                </Section>
            )}
            <div className="mt-auto border-t border-foreground/12 pt-3">
                <button
                    type="button"
                    onClick={onRefresh}
                    disabled={pending}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded border border-foreground/15 bg-background px-2.5 py-2.5 font-mono text-[11px] tracking-[0.06em] uppercase transition-colors hover:border-foreground/40 disabled:pointer-events-none disabled:opacity-50"
                >
                    <RefreshCw className="size-3" />
                    {refreshLabel(pending, result.cached)}
                </button>
            </div>
        </Tile>
    );
}

function refreshLabel(pending: boolean, cached: boolean | undefined): string {
    if (pending) return "Checking";
    return cached ? "Fetch fresh" : "Re-check";
}

export const LABEL = "font-mono text-[9.5px] tracking-[0.13em] text-muted-foreground uppercase";

/**
 * "13H AGO", ticking, in the vitals' face, over the exact time and whether
 * it came off the cache.
 *
 * While the panel answers, the same two lines count down instead: how much
 * longer, and how many have answered. The finished values are typed into the
 * same slots when the last source lands, so the countdown is overwritten
 * rather than replaced.
 */
function Checked({ checkedAt, cached }: Readonly<{ checkedAt: string; cached?: boolean }>) {
    const { pending, partial } = useLive();
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 30_000);
        return () => clearInterval(id);
    }, []);
    // Both lines depend on the clock and the time zone, which the server and
    // the browser need not share.
    return (
        <div>
            <span className={LABEL}>Checked</span>
            <div
                suppressHydrationWarning
                className={cn(markFace.className, "mt-1 text-[44px] leading-[0.85] uppercase")}
            >
                {pending && <Countdown partial={partial} />}
                <Typed text={pending ? undefined : relativeTime(checkedAt, now)} placeholder="none" />
            </div>
            <p suppressHydrationWarning className="mt-1.5 text-[11.5px] text-muted-foreground">
                {pending && answeredLine(partial)}
                <Typed
                    text={pending ? undefined : `${stamp(checkedAt)}, ${cached ? "from cache" : "live"}`}
                    placeholder="none"
                />
            </p>
        </div>
    );
}

/** "16 of 27 answered", or a rule before the stream has named the panel. */
function answeredLine(partial: PartialLookup | null): React.ReactNode {
    const total = partial?.counts.total ?? 0;
    if (total === 0) return <span className="pending-rule w-24" />;
    return `${partial?.counts.settled ?? 0} of ${total} answered`;
}

function Countdown({ partial }: Readonly<{ partial: PartialLookup | null }>) {
    const eta = useEta(partial);
    return eta ?? <span className="type-caret type-caret-blink" />;
}

/**
 * How much longer this is likely to take, ticking down.
 *
 * An analyst waiting twenty seconds is owed an estimate. The budget is the
 * longest timeout among the sources still out, so it shrinks as slow sources
 * land and can never grow; the elapsed side only rises. The countdown therefore
 * never ticks up, and when the estimate runs out it says so instead of counting
 * into negatives. Null until the stream has named the panel, since there is no
 * budget to count down from before that.
 */
function useEta(partial: PartialLookup | null): string | null {
    const [startedAt] = useState(() => Date.now());
    const [now, setNow] = useState(() => Date.now());

    const metas = partial?.metas ?? [];
    const settledIds = (partial?.sources ?? []).map((s) => s.source.id);
    const budgetMs = etaBudgetMs(metas, settledIds);
    // Nothing left to count down to once the last source is in.
    const finished = metas.length === 0 || budgetMs === 0;

    useEffect(() => {
        if (finished) return;
        const id = setInterval(() => setNow(Date.now()), 500);
        return () => clearInterval(id);
    }, [finished]);

    if (metas.length === 0) return null;
    return etaLabel(budgetMs - (now - startedAt));
}

export function stamp(iso: string): string {
    return new Date(iso).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    });
}

/** One trust axis: its name, the level it comes to, and the picture of why. */
export function Section({
    title,
    level,
    children,
}: Readonly<{
    title: string;
    /** Undefined while the level is withheld, which draws a rule in its place. */
    level: string | undefined;
    children?: React.ReactNode;
}>) {
    return (
        <div className="border-t border-foreground/12 pt-3">
            <div className="flex items-baseline justify-between">
                <span className={LABEL}>{title}</span>
                <span className={cn(markFace.className, "text-[26px] leading-none uppercase")}>
                    <Typed text={level} placeholder="3.5ch" />
                </span>
            </div>
            {children && <div className="mt-3">{children}</div>}
        </div>
    );
}

const KIND_STYLE: Record<DetectorKind, string> = {
    flagged: "bg-foreground",
    clean: "bg-foreground/35",
    failed: "bg-[repeating-linear-gradient(45deg,currentColor_0_1.5px,transparent_1.5px_3.5px)] opacity-40",
    "n/a": "border border-dashed border-foreground/35 opacity-40",
};

/** A clean source that scored zero still answered, so its bar keeps a stub at
 *  the baseline: an empty slot would read as a source that said nothing. */
const STUB = 12;

/** One bar per detector, as tall as its score, under a legend of counts. */
function Skyline({ sources }: Readonly<{ sources: SourceResult[] }>) {
    const { typing } = useLive();
    const bars = useMemo(() => detectorBars(sources), [sources]);
    if (bars.length === 0) return null;
    return (
        <div>
            <div className="flex h-11 items-end gap-[3px] border-b border-foreground/25">
                {bars.map((b) => (
                    <span
                        key={b.id}
                        title={`${b.name}: ${b.score ?? b.kind}`}
                        className={cn("flex-1 rounded-t-[1px]", KIND_STYLE[b.kind], typing && "grow-up")}
                        style={{ height: `${heightOf(b)}%` }}
                    />
                ))}
            </div>
            <div className="mt-2 flex gap-x-3 font-mono text-[9.5px] text-muted-foreground">
                {detectorCounts(bars).map(({ kind, count }) => (
                    <span key={kind} className="inline-flex items-center gap-1">
                        <span className={cn("inline-block size-2", KIND_STYLE[kind])} />
                        <span className="text-foreground tabular-nums">{count}</span>
                        {kind}
                    </span>
                ))}
            </div>
        </div>
    );
}

/** The skyline's footprint while it is withheld: the baseline it will stand
 *  on and the line its legend will take. */
function PendingSkyline() {
    return (
        <div aria-hidden className="text-muted-foreground">
            <div className="h-11 border-b border-dotted border-foreground/30" />
            <span className="pending-rule mt-2 w-36 text-[9.5px]" />
        </div>
    );
}

/** A bar with no answer stands full height, faint, so the gap it marks is as
 *  visible as the answers either side of it. */
function heightOf(b: DetectorBar): number {
    return b.score === null ? 100 : Math.max(STUB, b.score);
}

function GeoGrid({ table }: Readonly<{ table: VoteTable }>) {
    return (
        <VoteGrid
            rows={table.providers}
            cols={VOTE_FIELDS.map((f) => ({ key: f.key, label: f.short }))}
            cell={(row, col) => table.fields.find((f) => f.key === col)?.cells[row]}
            rowLabel={providerLabel}
        />
    );
}
