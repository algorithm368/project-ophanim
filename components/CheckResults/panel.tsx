"use client";

import { Check, Copy, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { buildSubjectRecord, fileThreat } from "@/lib/ti/subject-record";
import { lastSeenLabel, type PanelRung } from "@/lib/ti/panel";
import { geoConfidence, resolveConfidence, scoreConfidence } from "@/lib/ti/confidence";
import { buildResolverBallot, type ResolverBallot } from "@/lib/ti/dns/ballot";
import { buildVoteTable, providerLabel, type VoteTable } from "@/lib/ti/geo/votes";
import { parseDomain } from "@/lib/domain";
import {
    classifyDomainLabel,
    classifyHashLabel,
    classifyIpLabel,
    domainEvidence,
    hashEvidence,
    ipEvidence,
} from "@/lib/ti/indicator-class";
import { relativeTime } from "@/lib/relative-time";
import {
    buildDomainNarrative,
    buildHashNarrative,
    buildNarrative,
    consensusBuckets,
} from "@/lib/ti/narrative";
import {
    type AnyCheckResult,
    isDomainResult,
    isHashResult,
    type SourceResult,
} from "@/lib/ti/types";
import { cn } from "@/lib/utils";
import { Tile } from "./frame";
import { useCopied } from "./primitives";
import { Sprite } from "./sprite";
import { VERDICT_STYLE } from "./verdict";
import { VoteMark } from "./voting";

/**
 * The bestiary entry's tiles: the picture, the name, the summary, and the
 * working behind the score.
 *
 * These used to be one card. They are now partitions of the page's frame, which
 * changes where they sit but not what they are: `frame.tsx` holds the grid and
 * the border, and each export below is one answer inside it.
 *
 * Rules this file exists to hold:
 *
 *  - The verdict is stated once, under the sprite. It is not a stat, it is what
 *    the stats add up to, and listing a total beside its own addends is a
 *    category error.
 *  - The page opens with one picture, one name, and one sentence. It used to
 *    open with five named ladders as well, and four of the five turned out to
 *    restate something the rest of the page says better: see `lib/ti/panel.ts`
 *    for which said what, and where each one lives now.
 *  - Every bar is a named rung, never a fill. A filled width reads as a
 *    quantity and reintroduces the false precision that removing the 0 to 100
 *    number was meant to kill.
 *  - A measured zero (outlined rungs) and an absent measurement (hatched) must
 *    never look alike. That is the panel's load-bearing constraint.
 *  - Colour appears on the sprite and the verdict. Nowhere else.
 */

/** The picture and the one word it resolves to. */
export function RailTile({ result }: Readonly<{ result: AnyCheckResult }>) {
    const record = useMemo(() => buildSubjectRecord(result), [result]);
    const tone = VERDICT_STYLE[result.verdict];
    return (
        // Centred in both axes: the rail is as tall as the hero beside it, so a
        // sprite pinned to the top left the lower half of the column empty.
        <Tile span={3} tone="rail" className="flex flex-col items-center justify-center gap-3 p-4">
            {/* Corner brackets, not a box: an evidence crop rather than an
                illustration frame. */}
            <div
                className={cn(
                    "relative grid min-h-24 place-items-center p-2",
                    tone.text,
                )}
            >
                <span aria-hidden>
                    <span className="absolute top-0 left-0 size-3 border-t-2 border-l-2 border-current" />
                    <span className="absolute top-0 right-0 size-3 border-t-2 border-r-2 border-current" />
                    <span className="absolute bottom-0 left-0 size-3 border-b-2 border-l-2 border-current" />
                    <span className="absolute right-0 bottom-0 size-3 border-r-2 border-b-2 border-current" />
                </span>
                <Sprite spec={record.sprite} px={128} title={record.class.label} />
            </div>
            <div
                className={cn(
                    "text-center font-mono text-[11px] leading-tight font-bold tracking-[0.16em] uppercase",
                    tone.text,
                )}
            >
                {tone.headline}
            </div>
        </Tile>
    );
}

/** The name, and the sentence under it. Nothing qualifies the name: a species
 *  line sat here until the stat bank was removed and left it next to the
 *  record's own "This is a" strip and Country vital, all three saying the same
 *  two things. */
/**
 * The name, and for an address the class it belongs to, set larger than the
 * name itself.
 *
 * The class used to be the second of four equal cells in the vitals strip
 * below, at the same size as the country and the reverse name, which is where
 * "I can't see what kind of thing this is" came from. Putting it here costs
 * nothing to read: the eye already stops on the subject, so it picks the class
 * up on the way down to the summary.
 *
 * The class outranks the address in size on purpose. On the indicator that
 * started this, an anycast front door, "which address" is the question with no
 * useful answer and "what kind of address" is the one that changes what the
 * reader does next. The address stays a full line of selectable monospace above
 * it, because it is still the thing that gets copied into a block list.
 *
 * All three kinds carry one, from their own ladder: an address is classed by
 * how much identity it has, a name by whether it still answers and whose
 * history its age really is, a file by whether anyone has ever seen it.
 */
export function HeroTile({ result }: Readonly<{ result: AnyCheckResult }>) {
    const narrative = useMemo(() => narrativeFor(result), [result]);
    const record = useMemo(() => buildSubjectRecord(result), [result]);
    const klass = useMemo(() => classFor(result), [result]);

    return (
        <Tile span={6} className="flex flex-col">
            <div className="mb-2 border-b border-foreground/12 pb-3">
                <p className="font-mono text-lg break-all text-muted-foreground">
                    {record.subject}
                </p>
                <p className="mt-0.5 font-mono text-[2rem] leading-tight font-bold break-words">
                    {klass.short}
                </p>
                <p className="mt-1.5 font-mono text-xs text-muted-foreground">{klass.caption}</p>
            </div>
            <CopyBox text={narrative} />
        </Tile>
    );
}

function classFor(result: AnyCheckResult) {
    if (isHashResult(result)) {
        return classifyHashLabel(
            hashEvidence(result.context, result.sources, fileThreat(result)),
        );
    }
    if (isDomainResult(result)) {
        return classifyDomainLabel(
            domainEvidence(
                result.domain,
                parseDomain(result.domain)?.registrable,
                result.context,
                result.sources,
            ),
        );
    }
    return classifyIpLabel(ipEvidence(result.geo, result.sources));
}

function narrativeFor(result: AnyCheckResult): string {
    if (isHashResult(result)) return buildHashNarrative(result).join(" ");
    if (isDomainResult(result)) return buildDomainNarrative(result).join(" ");
    return buildNarrative(result).join(" ");
}

/** Four rungs laid flat, for the verdict and the confidence axes. Capped in
 *  width by its container: stretched wide, four rungs stop reading as four
 *  rungs and become a meter, which is the false precision we removed. */
function FlatLadder({
    rung,
    className,
    title,
}: Readonly<{ rung: PanelRung; className?: string; title?: string }>) {
    return (
        <div className={cn("mt-1.5 grid grid-cols-4 gap-1", className)} title={title} aria-label={title}>
            {[0, 1, 2, 3].map((i) => (
                <span
                    key={i}
                    className={cn(
                        "h-1.5 rounded-[1px] border border-foreground/25",
                        rung === null && "bg-[repeating-linear-gradient(45deg,currentColor_0_2px,transparent_2px_4px)] opacity-40",
                        rung !== null && i < rung && "border-current bg-current",
                    )}
                />
            ))}
        </div>
    );
}

/**
 * Where this reading came from, and how to take another.
 *
 * Everything in this column is about the *lookup* rather than about the
 * subject: when it ran, whether it came off the cache, how many times the
 * indicator has been checked before, and when a source last saw it. It is the
 * only place on the card those four belong together, which is why the last of
 * them, the one measurement the removed stat bank carried alone, ended up here
 * as a line rather than as a ladder of its own.
 */
export function ProvenanceTile({
    result,
    onRefresh,
}: Readonly<{ result: AnyCheckResult; onRefresh: () => void }>) {
    return (
        <Tile
            span={3}
            tone="rail"
            title="Checked"
            note={result.cached ? "cached" : "live"}
            className="flex flex-col"
        >
            <Freshness checkedAt={result.checkedAt} />
            <div className="mt-4 grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1.5 border-t border-foreground/12 pt-3.5">
                <span className="font-mono text-[9.5px] tracking-[0.13em] text-muted-foreground uppercase">
                    Priors
                </span>
                <span className="text-right font-mono text-[11.5px]">
                    {priorsLabel(result.history?.length ?? 0)}
                </span>
                <span className="font-mono text-[9.5px] tracking-[0.13em] text-muted-foreground uppercase">
                    Last seen
                </span>
                <span className="text-right font-mono text-[11.5px]">
                    {lastSeenLabel(result)}
                </span>
            </div>
            <button
                type="button"
                onClick={onRefresh}
                className="mt-auto inline-flex w-full items-center justify-center gap-2 rounded border border-foreground/15 bg-background px-3 py-2 font-mono text-[11.5px] tracking-[0.06em] transition-colors hover:border-foreground/40"
            >
                <RefreshCw className="size-3.5" />
                {result.cached ? "Fetch fresh" : "Re-check"}
            </button>
        </Tile>
    );
}

function priorsLabel(n: number): string {
    if (n === 0) return "none";
    return `${n} ${n === 1 ? "check" : "checks"}`;
}

/** "6h ago", ticking. Whether it came off the cache is the tile's note, one
 *  line up, rather than a second line here. */
function Freshness({ checkedAt }: Readonly<{ checkedAt: string }>) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 30_000);
        return () => clearInterval(id);
    }, []);
    return (
        <div
            suppressHydrationWarning
            title={`Checked ${new Date(checkedAt).toLocaleString()}`}
            className="font-mono text-[22px] leading-none font-bold"
        >
            {relativeTime(checkedAt, now)}
        </div>
    );
}

/**
 * The whole paragraph copies on click.
 *
 * Three rules, all load bearing. A drag that ends inside the box is a selection
 * and must not copy, or the summary stops being readable text. The mark stays a
 * real button, so the control exists for a keyboard and a screen reader; the
 * box click is a convenience on top of it, never a replacement. And the copy
 * goes through `useCopied`, which falls back to a hidden textarea when
 * `navigator.clipboard` is missing and only flashes Copied once something
 * actually reached the clipboard. Writing through the Clipboard API directly
 * meant every non-secure context (the dev server over http://<LAN-IP>, a
 * browser with the API withheld) confirmed a copy that never happened.
 */
export function CopyBox({
    text,
    copyText = text,
}: Readonly<{
    text: string;
    /** What lands on the clipboard, when it is more than what is shown. The
     *  scan page shows one sentence beside rows that state every other fact,
     *  but what is pasted into a ticket has to stand without those rows. */
    copyText?: string;
}>) {
    const [copied, copy] = useCopied();

    const copyUnlessSelecting = () => {
        if ((window.getSelection()?.toString() ?? "").length > 0) return;
        void copy(copyText);
    };

    return (
        // A click handler on a div is not the control: the button inside it
        // is, and that is what a keyboard and a screen reader reach. This is a
        // convenience for a pointer that is already over the text.
        <div
            onClick={copyUnlessSelecting}
            className={cn(
                "group relative flex-1 cursor-pointer rounded-md border border-transparent p-2 transition-colors hover:border-foreground/12 hover:bg-muted/40 has-[button:focus-visible]:border-foreground/12",
                copied && "border-foreground/12 bg-muted/40",
            )}
        >
            <p className="pb-7 text-[0.95rem] leading-relaxed text-foreground/85">{text}</p>
            <button
                type="button"
                onClick={(event) => {
                    // The button is the real control, so it copies whether or
                    // not there is a selection. Stopping the event keeps the
                    // box's handler from running a second copy on top of it.
                    event.stopPropagation();
                    void copy(copyText);
                }}
                aria-label="Copy summary"
                className={cn(
                    "absolute bottom-1 left-1 inline-flex items-center gap-1.5 rounded-sm px-1.5 py-1 font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase transition-colors group-hover:text-foreground",
                    copied && "text-foreground",
                )}
            >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                <span className={cn("hidden group-hover:inline", copied && "inline")}>
                    {copied ? "Copied" : "Copy"}
                </span>
            </button>
        </div>
    );
}

/**
 * Every detector as a row, loudest first, on a shared 0 to 100 track.
 *
 * Reading down the column of marks shows the outlier structure directly: on a
 * floor-pinned address one mark sits hard right and the rest are bunched left,
 * and that gap is the whole story of the score. Five ledger layouts were drawn
 * before this one and all of them showed the values of the arithmetic instead
 * of its mechanism, which only means something to a reader who already knows
 * the formula.
 */
/**
 * Whether the narrow lane has a ballot to put beside the evidence.
 *
 * A hash has neither a location nor a resolution to vote on, so the lane would
 * be an empty tinted column running the height of the detector list. The
 * evidence takes the full twelve instead: a tile that has nothing to say should
 * not leave a hole where it would have been.
 */
export function hasBallots(result: AnyCheckResult): boolean {
    const geo = "geoResolution" in result ? result.geoResolution : undefined;
    const dns = isDomainResult(result) ? result.context?.originResolverConsensus : undefined;
    return Boolean(geo?.country || dns?.perResolver?.length);
}

export function EvidenceTile({
    result,
    span = 9,
}: Readonly<{ result: AnyCheckResult; span?: 9 | 12 }>) {
    const rows = useMemo(() => detectorRows(result.sources), [result.sources]);
    const confidence = useMemo(
        () => scoreConfidence({ sources: result.sources, scoreBreakdown: result.scoreBreakdown }),
        [result.sources, result.scoreBreakdown],
    );
    if (rows.length === 0 || !confidence) return null;

    // A source that found nothing has already said everything it has to say in
    // its own zero. Eight rows of "not a known botnet C2, not a Tor relay, not
    // observed scanning" is the sound of nothing happening, and spelling each
    // one out costs the same ink as the two rows that decided the verdict.
    // The same tally the narrative and the confidence table use, rather than a
    // fourth count of the same thing computed from these rows.
    const buckets = consensusBuckets(result);
    const spoke = rows.filter((r) => r.score !== 0);
    const silent = rows.filter((r) => r.score === 0);
    const half = Math.ceil(silent.length / 2);

    return (
        <Tile
            span={span}
            id="evidence"
            title="Evidence"
            note={`${buckets.flagged} of ${buckets.responded} flagged`}
        >
            {spoke.map((row) => (
                <DetectorRow key={row.id} row={row} />
            ))}
            {silent.length > 0 && (
                <>
                    <SubLabel>Nothing found, {silent.length}</SubLabel>
                    <div className="grid gap-x-10 md:grid-cols-2">
                        {[silent.slice(0, half), silent.slice(half)].map((group, i) => (
                            <div key={group[0]?.id ?? i}>
                                {group.map((row) => (
                                    <SilentRow key={row.id} row={row} />
                                ))}
                            </div>
                        ))}
                    </div>
                </>
            )}
        </Tile>
    );
}

type DetectorRow = {
    id: string;
    name: string;
    score: number | null;
    loud: boolean;
    /** What the source said, in its own words. The same line the Source
     *  breakdown prints; the number alone is the half nobody can act on. */
    why?: string;
};

/** Scoring sources that settled, loudest first. A source that did not answer
 *  keeps a hatched track, so a gap in the evidence cannot read as evidence. */
function detectorRows(sources: SourceResult[]): DetectorRow[] {
    return sources
        .filter((s) => (s.source.weight ?? 1) > 0)
        .map((s) => ({
            id: s.source.id,
            name: s.source.name,
            score: s.status === "ok" ? (s.score ?? 0) : null,
            loud: s.malicious === true,
            why: s.status === "ok" ? s.summary : (s.error ?? s.summary),
        }))
        .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

/** A source with something to say: name, track, score, and the reason. */
function DetectorRow({ row }: Readonly<{ row: DetectorRow }>) {
    return (
        <div className="grid grid-cols-[8rem_5.5rem_1.9rem_1fr] items-center gap-x-3.5 border-b border-foreground/12 py-1.5 last:border-b-0">
            <span
                title={row.name}
                className={cn(
                    "truncate font-mono text-[11.5px]",
                    row.loud && "text-red-600 dark:text-red-400",
                    row.score === null && "text-muted-foreground",
                )}
            >
                {row.name}
            </span>
            <Track row={row} />
            <span
                className={cn(
                    "text-right font-mono text-[11.5px] font-bold tabular-nums",
                    row.loud && "text-red-600 dark:text-red-400",
                    row.score === null && "font-normal text-muted-foreground",
                )}
            >
                {row.score ?? "—"}
            </span>
            <span
                title={row.why}
                className="truncate font-mono text-[10.5px] text-muted-foreground"
            >
                {row.why}
            </span>
        </div>
    );
}

/** A source that found nothing: name and its zero, and no more. */
function SilentRow({ row }: Readonly<{ row: DetectorRow }>) {
    return (
        <div className="grid grid-cols-[1fr_5.5rem_1.9rem] items-center gap-x-3.5 border-b border-foreground/12 py-1.5 last:border-b-0">
            <span title={row.name} className="truncate font-mono text-[11.5px] text-muted-foreground">
                {row.name}
            </span>
            <Track row={row} />
            <span className="text-right font-mono text-[11.5px] tabular-nums text-muted-foreground">
                0
            </span>
        </div>
    );
}

/** The shared 0 to 100 track. Reading down the column of marks shows the
 *  outlier structure directly: on a floor-pinned address one mark sits hard
 *  right and the rest are bunched left, and that gap is the whole story of the
 *  score. A source that did not answer keeps a hatched track, so a gap in the
 *  evidence cannot read as evidence. */
function Track({ row }: Readonly<{ row: DetectorRow }>) {
    return (
        <span
            className={cn(
                "relative h-1.5 border border-foreground/12 bg-muted",
                row.score === null &&
                    "border-transparent bg-[repeating-linear-gradient(45deg,var(--color-muted-foreground)_0_2px,transparent_2px_4px)] opacity-50",
            )}
        >
            {row.score !== null && (
                <i
                    className={cn(
                        "absolute -top-1 -bottom-1 -ml-px w-0.5 bg-foreground",
                        row.loud && "w-[3px] bg-red-600 dark:bg-red-400",
                    )}
                    style={{ left: `${row.score}%` }}
                />
            )}
        </span>
    );
}

/**
 * How each provider voted, as the frame's narrow lane.
 *
 * Two ballots can appear here and their order is the order of the questions:
 * which address the name resolves to, then where that address is. A hash has
 * neither and the tile does not render.
 */
export function BallotsTile({ result }: Readonly<{ result: AnyCheckResult }>) {
    const votes = useMemo(() => {
        const res = "geoResolution" in result ? result.geoResolution : undefined;
        return res ? buildVoteTable(res) : null;
    }, [result]);
    // Only a domain has a resolution to vote on. `originResolverConsensus` is
    // dnsGeoSource's own rather than dnsSource's: the two are separate fetches
    // and can name a different winning address on an anycast name, and this is
    // the one the location rows beside it were reconciled from.
    const dns = isDomainResult(result) ? result.context?.originResolverConsensus : undefined;
    const ballot = useMemo(() => (dns ? buildResolverBallot(dns) : null), [dns]);
    if (!votes && !ballot) return null;

    return (
        <Tile span={3} tone="rail" title="Ballots">
            {ballot && (
                <>
                    <SubLabel className="mt-0">Resolvers, on {ballot.winner}</SubLabel>
                    <ResolverVotes ballot={ballot} order={dns!.perResolver} />
                </>
            )}
            {votes && (
                <>
                    <SubLabel className={ballot ? undefined : "mt-0"}>Location</SubLabel>
                    <GeoVotes table={votes} />
                </>
            )}
        </Tile>
    );
}

/** The two axes behind every tier on the page, in one table. */
export function ConfidenceTile({ result }: Readonly<{ result: AnyCheckResult }>) {
    const confidence = useMemo(
        () => scoreConfidence({ sources: result.sources, scoreBreakdown: result.scoreBreakdown }),
        [result.sources, result.scoreBreakdown],
    );
    // A hash has no location at all, and an address whose providers all failed
    // has none either; both drop the row rather than drawing an empty one.
    const geo = useMemo(
        () => geoConfidence("geoResolution" in result ? result.geoResolution : undefined),
        [result],
    );
    const dns = isDomainResult(result) ? result.context?.originResolverConsensus : undefined;
    const resolve = useMemo(() => resolveConfidence(dns), [dns]);
    if (!confidence) return null;

    return (
        <Tile span={3} tone="rail" title="Confidence">
            <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2.5">
                <ConfidenceRow
                    title="Score"
                    coverage={confidence.coverage}
                    agreement={confidence.agreement}
                    level={confidence.level}
                />
                {/* Resolution above location, because it is upstream of it:
                    the address the resolvers settled on is the address the
                    location providers were then asked about. */}
                {resolve && (
                    <ConfidenceRow
                        title="Resolution"
                        coverage={resolve.coverage}
                        agreement={resolve.agreement}
                        level={resolve.level}
                    />
                )}
                {geo && (
                    <ConfidenceRow
                        title="Location"
                        coverage={geo.coverage}
                        agreement={geo.agreement}
                        level={geo.level}
                    />
                )}
            </div>
        </Tile>
    );
}

/** The small label that names a run of rows inside a tile. */
function SubLabel({
    children,
    className,
}: Readonly<{ children: React.ReactNode; className?: string }>) {
    return (
        <div
            className={cn(
                "mt-4 mb-2 font-mono text-[9.5px] tracking-[0.13em] text-muted-foreground uppercase",
                className,
            )}
        >
            {children}
        </div>
    );
}

/**
 * How each location provider voted, in the frame's narrow lane.
 *
 * One column, not two. The ballot used to be halved to fit a full-width
 * section; in a three-column tile the providers read straight down in their
 * fixed order, which is the order they were meant to be found in, and the
 * column headers are stated once.
 */
function GeoVotes({ table }: Readonly<{ table: VoteTable }>) {
    const cols = `minmax(0,1fr) repeat(${table.fields.length}, 1.6rem)`;
    return (
        <div>
            <div
                className="grid items-center gap-x-2 border-b border-foreground/12 py-1"
                style={{ gridTemplateColumns: cols }}
            >
                <span />
                {table.fields.map((f) => (
                    <span
                        key={f.key}
                        title={f.label}
                        className="truncate text-center font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase"
                    >
                        {f.label.slice(0, 4)}
                    </span>
                ))}
            </div>
            {table.providers.map((id) => (
                <div
                    key={id}
                    className="grid items-center gap-x-2 border-b border-foreground/12 py-1 last:border-b-0"
                    style={{ gridTemplateColumns: cols }}
                >
                    <span className="truncate font-mono text-[11px]">{providerLabel(id)}</span>
                    {table.fields.map((f) => (
                        <span key={f.key} className="flex justify-center">
                            <VoteMark cell={f.cells[id]} compact />
                        </span>
                    ))}
                </div>
            ))}
        </div>
    );
}

/**
 * How each resolver answered.
 *
 * The same shape as the location ballot above it, with one column instead of
 * four: every resolver was asked the one question, and what it said is either
 * the winning answer set or a different one. A dissenting resolver prints what
 * it returned, since on an anycast or GeoDNS name that value *is* the finding
 * rather than an error.
 *
 * The fixed resolver order comes from the consensus rather than the ballot's
 * keyed cells, because object key order is not a contract and the reader is
 * meant to find a resolver in the same place every time.
 */
function ResolverVotes({
    ballot,
    order,
}: Readonly<{ ballot: ResolverBallot; order: { resolver: string }[] }>) {
    return (
        <div>
            {order.map(({ resolver }) => (
                <div
                    key={resolver}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 border-b border-foreground/12 py-1 last:border-b-0"
                >
                    <span className="truncate font-mono text-[11px]">{resolver}</span>
                    <span className="flex min-w-0 justify-end font-mono text-[10.5px]">
                        <VoteMark cell={ballot.cells[resolver]} compact />
                    </span>
                </div>
            ))}
        </div>
    );
}

/**
 * One row of the confidence table: a name, two ladders, the tier they add up to.
 *
 * Score, resolution and location share the table, which is the point. They are
 * different measurements of different things, but they answer the same two
 * questions, how much was measured and how much it agrees, so stacking them
 * makes the comparison the layout rather than something the reader assembles.
 *
 * Both ladders survive the move into a three-column tile, at the cost of the
 * words that used to name each rung. Coverage and agreement are deliberately
 * independent: wide coverage with low agreement means everyone looked and they
 * disagree, narrow coverage with high agreement means the two that answered
 * happened to concur, and collapsing them into one meter loses the distinction
 * this table exists to draw. The words move to the title attribute, where a
 * reader who wants the rung named can still get it.
 */
function ConfidenceRow({
    title,
    coverage,
    agreement,
    level,
}: Readonly<{ title: string; coverage: number; agreement: number; level: string }>) {
    return (
        <>
            <span className="font-mono text-[9.5px] font-bold tracking-[0.12em] uppercase">
                {title}
            </span>
            <span className="flex items-center gap-3">
                <FlatLadder
                    rung={rungOf(coverage)}
                    className="mt-0 w-11 shrink-0"
                    title={`Coverage: ${coverageWord(coverage)}`}
                />
                <FlatLadder
                    rung={rungOf(agreement)}
                    className="mt-0 w-11 shrink-0"
                    title={`Agreement: ${agreementWord(agreement)}`}
                />
            </span>
            <span className="text-right font-mono text-[13px] font-bold uppercase">{level}</span>
        </>
    );
}

/** A 0 to 1 share as one of the four rungs. */
function rungOf(share: number): PanelRung {
    if (share >= 0.85) return 4;
    if (share >= 0.65) return 3;
    if (share >= 0.4) return 2;
    if (share > 0) return 1;
    return 0;
}

function coverageWord(share: number): string {
    if (share >= 0.85) return "Nearly all";
    if (share >= 0.65) return "Most";
    if (share >= 0.4) return "Some";
    if (share > 0) return "Few";
    return "None";
}

function agreementWord(share: number): string {
    if (share >= 0.85) return "Near total";
    if (share >= 0.65) return "Broad";
    if (share >= 0.4) return "Split";
    return "Divided";
}
