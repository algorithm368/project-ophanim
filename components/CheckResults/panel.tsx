"use client";

import { Check, Copy } from "lucide-react";
import { useMemo } from "react";
import { buildSubjectRecord, fileThreat } from "@/lib/ti/subject-record";
import { longestRun } from "@/lib/ti/identity";
import { scoreConfidence } from "@/lib/ti/confidence";
import { subjectParts } from "@/lib/ti/subject-parts";
import { parseDomain } from "@/lib/domain";
import {
    classifyDomainLabel,
    classifyHashLabel,
    classifyIpLabel,
    domainEvidence,
    hashEvidence,
    ipEvidence,
} from "@/lib/ti/indicator-class";
import { railPlace } from "@/lib/ti/geo/rail-place";
import {
    buildDomainNarrative,
    buildHashNarrative,
    buildNarrative,
} from "@/lib/ti/narrative";
import {
    type AnyCheckResult,
    isDomainResult,
    isHashResult,
    type SourceResult,
} from "@/lib/ti/types";
import { cn } from "@/lib/utils";
import { Tile } from "./frame";
import { markFace } from "./mark-face";
import { useCopied } from "./primitives";
import { RailMap } from "./rail-map";
import { Sprite } from "./sprite";
import { summaryFace } from "./summary-face";
import { VERDICT_STYLE } from "./verdict";
import { sourceWeight } from "@/lib/ti/weight";
import { panelRows, type PanelRow } from "@/lib/ti/panel-rows";
import { Typed, useLive } from "./live";

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
 *  - The verdict is the rail picture's colour, with no word under it. It is
 *    not a stat, it is what the stats add up to, and listing a total beside its
 *    own addends is a category error.
 *  - The page opens with one picture, one name, and one sentence. It used to
 *    open with five named ladders as well, and four of the five turned out to
 *    restate something the rest of the page says better: see `lib/ti/panel.ts`
 *    for which said what, and where each one lives now.
 *  - A measured zero and an absent measurement must never look alike. That is
 *    the panel's load-bearing constraint.
 *  - Colour appears on the rail picture and the verdict. Nowhere else.
 */

/**
 * The picture, in the colour of the verdict: where the subject is, as a globe,
 * for anything a provider placed, and the sprite for what has no place, which
 * is every file and the odd address nobody located.
 */
export function RailTile({ result }: Readonly<{ result: AnyCheckResult }>) {
    const { pending } = useLive();
    const record = useMemo(() => buildSubjectRecord(result), [result]);
    const place = useMemo(() => railPlace(result), [result]);
    // A verdict over half a panel is not a verdict, so the picture stays
    // grey until everyone has answered.
    const tone = pending ? PENDING_TONE : VERDICT_STYLE[result.verdict];
    if (place) {
        return (
            // Full bleed: the globe is the tile, with no padding left round it.
            <Tile span={3} tone="rail" className={cn("relative min-h-[300px] overflow-hidden p-0", tone.text)}>
                <RailMap place={place} />
                <span className="sr-only">{tone.headline}</span>
            </Tile>
        );
    }
    // The sprite is drawn from the class, which waits for the whole panel;
    // until then a rail with no place to show stays an empty tinted column.
    if (pending) {
        return (
            <Tile span={3} tone="rail" className="min-h-[300px]">
                <span className="sr-only">{tone.headline}</span>
            </Tile>
        );
    }
    return (
        // Centred in both axes: the rail is as tall as the hero beside it, so a
        // sprite pinned to the top left the lower half of the column empty.
        <Tile span={3} tone="rail" className="flex flex-col items-center justify-center p-4">
            <div className={cn("grid place-items-center", tone.text)}>
                <Sprite spec={record.sprite} px={170} title={record.class.label} />
            </div>
            {/* The picture's colour carries the verdict on screen; this says it
                for a reader who cannot see the colour. */}
            <span className="sr-only">{tone.headline}</span>
        </Tile>
    );
}

/** The rail's colour while the verdict is withheld. */
const PENDING_TONE = { text: "text-muted-foreground", headline: "Verdict pending" };

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
 * reader does next. The address stays above it as selectable text, because it
 * is still the thing that gets copied into a block list, with the part that
 * names it set strong: the registrable domain, or an address's last octet
 * (`lib/ti/subject-parts.ts`).
 *
 * All three kinds carry one, from their own ladder: an address is classed by
 * how much identity it has, a name by whether it still answers and whose
 * history its age really is, a file by whether anyone has ever seen it.
 */
export function HeroTile({ result }: Readonly<{ result: AnyCheckResult }>) {
    const { pending } = useLive();
    // The class and the summary are both readings of the whole panel, so
    // neither is worked out, let alone shown, until the panel is complete.
    const narrative = useMemo(() => (pending ? undefined : narrativeFor(result)), [pending, result]);
    const parts = useMemo(() => subjectParts(result), [result]);
    const klass = useMemo(() => (pending ? undefined : classFor(result)), [pending, result]);

    return (
        <Tile span={6} className="flex flex-col">
            <div className="@container mb-2 border-b border-foreground/12 pb-3">
                <p className="text-[12.5px] break-all text-muted-foreground">
                    {/* At most one muted part and one strong one, so the
                        weight is a key. */}
                    {parts.map((part) => (
                        <span
                            key={String(part.strong)}
                            className={cn(part.strong && "font-semibold text-foreground")}
                        >
                            {part.text}
                        </span>
                    ))}
                </p>
                <p
                    className={cn(markFace.className, "mt-2 leading-[0.82] tracking-[0.005em] uppercase")}
                    style={{ fontSize: klass ? markSize(klass.short) : PENDING_MARK }}
                >
                    <Typed text={klass?.short} placeholder="caret" />
                </p>
                <p className="mt-1.5 text-[11.5px] leading-3.5 text-muted-foreground">
                    <Typed text={klass?.caption} placeholder="14ch" />
                </p>
            </div>
            <CopyBox text={narrative} />
        </Tile>
    );
}

/** The class mark's size while it is still a caret: the size the mark takes
 *  for a short class, which is most of them. */
const PENDING_MARK = "48px";

/** The class as a mark, sized as the vitals size theirs: as large as the
 *  container allows its longest word, at about half an em per capital. The
 *  scan page's hero sets its class with the same rule. */
export function markSize(text: string): string {
    return `min(56px, calc(100cqi / ${longestRun([{ value: text }]) * 0.5}))`;
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
    /** Undefined while the summary is being withheld: the box then holds its
     *  place as ruled lines, with nothing to copy. */
    text: string | undefined;
    /** What lands on the clipboard, when it is more than what is shown. The
     *  scan page shows one sentence beside rows that state every other fact,
     *  but what is pasted into a ticket has to stand without those rows. */
    copyText?: string;
}>) {
    const [copied, copy] = useCopied();

    const copyUnlessSelecting = () => {
        if (!copyText) return;
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
                "group relative flex-1 rounded-md border border-transparent p-2 transition-colors hover:border-foreground/12 hover:bg-muted/40 has-[button:focus-visible]:border-foreground/12",
                copyText && "cursor-pointer",
                copied && "border-foreground/12 bg-muted/40",
            )}
        >
            <p className={cn(summaryFace.className, "pb-7 text-[0.95rem] leading-relaxed text-foreground/85")}>
                <Typed text={text} lines={5} />
            </p>
            {copyText && (
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
            )}
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
export function EvidenceTile({ result }: Readonly<{ result: AnyCheckResult }>) {
    const { pending } = useLive();
    return pending ? <PendingEvidence sources={result.sources} /> : <SettledEvidence result={result} />;
}

/**
 * The evidence while the panel answers: every detector on it, in registry
 * order, in the two columns the quiet ones finally sit in, each typing in its
 * score as it lands.
 *
 * Registry order rather than loudest first, because loudest first would move
 * rows under the reader every time an answer came in. The tile takes its final
 * shape once, at the end, which is the only movement on the page then.
 */
function PendingEvidence({ sources }: Readonly<{ sources: SourceResult[] }>) {
    const { partial } = useLive();
    const metas = partial?.metas;
    const detectors = useMemo(() => panelRows(metas ?? [], sources).detectors, [metas, sources]);
    const half = Math.ceil(detectors.length / 2);
    return (
        <Tile span={12} id="evidence">
            <div className="grid gap-x-10 md:grid-cols-2">
                {detectors.length > 0 ? (
                    [detectors.slice(0, half), detectors.slice(half)].map((group, i) => (
                        <div key={group[0]?.meta.id ?? i}>
                            {group.map((row) => (
                                <LiveRow key={row.meta.id} row={row} />
                            ))}
                        </div>
                    ))
                ) : (
                    <UnnamedRows />
                )}
            </div>
        </Tile>
    );
}

/** One detector while the panel answers: its name, then its track and score
 *  once it has said something. */
function LiveRow({ row }: Readonly<{ row: PanelRow }>) {
    const r = row.result;
    const answered = r !== undefined;
    const score = r?.status === "ok" ? (r.score ?? 0) : null;
    const loud = r?.malicious === true;
    return (
        <div className={ROW}>
            <span
                title={row.meta.name}
                className={cn(
                    "truncate font-mono text-[11.5px]",
                    (!answered || score === null) && "text-muted-foreground",
                    loud && "text-red-600 dark:text-red-400",
                )}
            >
                {row.meta.name}
            </span>
            {answered ? (
                <Track row={{ score, loud }} arriving />
            ) : (
                <span className="block h-1.5 border border-dotted border-foreground/25" />
            )}
            <span
                className={cn(
                    "text-right font-mono text-[11.5px] tabular-nums",
                    loud && "font-bold text-red-600 dark:text-red-400",
                    !loud && "text-muted-foreground",
                )}
            >
                <Typed text={answered ? String(score ?? "—") : undefined} placeholder="1.5ch" />
            </span>
        </div>
    );
}

/** Rows before the stream has named the panel, at the height the named rows
 *  will take, so the tile does not grow when they arrive. */
function UnnamedRows() {
    return [0, 1].map((col) => (
        <div key={col}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className={cn(ROW, "text-muted-foreground")}>
                    <span className="pending-rule w-28" />
                    <span className="block h-1.5 border border-dotted border-foreground/25" />
                    <span className="pending-rule ml-auto w-[1.5ch]" />
                </div>
            ))}
        </div>
    ));
}

function SettledEvidence({ result }: Readonly<{ result: AnyCheckResult }>) {
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
    const spoke = rows.filter((r) => r.score !== 0);
    const silent = rows.filter((r) => r.score === 0);
    const half = Math.ceil(silent.length / 2);

    return (
        <Tile span={12} id="evidence">
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
    /** The source's own labels, as the short answer to "why": the list it is
     *  on, the malware family, "tor-exit". The sentence stays on hover. */
    keywords: string[];
};

const MAX_KEYWORDS = 2;

function keywordsFor(categories: string[] | undefined): string[] {
    return [...new Set((categories ?? []).filter(Boolean))].slice(0, MAX_KEYWORDS);
}

/** Scoring sources that settled, loudest first. A source that did not answer
 *  keeps a hatched track, so a gap in the evidence cannot read as evidence. */
function detectorRows(sources: SourceResult[]): DetectorRow[] {
    return sources
        .filter((s) => sourceWeight(s.source) > 0)
        .map((s) => ({
            id: s.source.id,
            name: s.source.name,
            score: s.status === "ok" ? (s.score ?? 0) : null,
            loud: s.malicious === true,
            why: s.status === "ok" ? s.summary : (s.error ?? s.summary),
            keywords: s.status === "ok" ? keywordsFor(s.categories) : [],
        }))
        .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

/** A source with something to say: name, track, score, and the reason. */
function DetectorRow({ row }: Readonly<{ row: DetectorRow }>) {
    return (
        <div className="grid grid-cols-[8rem_minmax(0,1fr)_5.5rem_1.9rem] items-center gap-x-3.5 border-b border-foreground/12 py-1.5 last:border-b-0">
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
            {row.keywords.length > 0 ? (
                <span title={row.why} className="flex min-w-0 justify-end gap-1.5">
                    {row.keywords.map((k) => (
                        <span
                            key={k}
                            className="truncate border border-foreground/20 px-1.5 font-mono text-[10px] leading-[1.15rem]"
                        >
                            {k}
                        </span>
                    ))}
                </span>
            ) : (
                <span
                    title={row.why}
                    className="truncate text-right font-mono text-[10.5px] text-muted-foreground"
                >
                    {row.why}
                </span>
            )}
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
        </div>
    );
}

/** A quiet row's grid: name, track, score. Shared with the pending rows, so
 *  a row keeps its measure when the tile takes its final shape. */
const ROW =
    "grid grid-cols-[1fr_5.5rem_1.9rem] items-center gap-x-3.5 border-b border-foreground/12 py-1.5 last:border-b-0";

/** A source that found nothing: name and its zero, and no more. */
function SilentRow({ row }: Readonly<{ row: DetectorRow }>) {
    return (
        <div className={ROW}>
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
function Track({
    row,
    arriving = false,
}: Readonly<{
    row: Pick<DetectorRow, "score" | "loud">;
    /** The score has just landed: its mark travels out from zero. */
    arriving?: boolean;
}>) {
    const { typing } = useLive();
    return (
        <span
            className={cn(
                "relative block h-1.5 border border-foreground/12 bg-muted",
                row.score === null &&
                    "border-transparent bg-[repeating-linear-gradient(45deg,var(--color-muted-foreground)_0_2px,transparent_2px_4px)] opacity-50",
            )}
        >
            {row.score !== null && (
                <i
                    className={cn(
                        "absolute -top-1 -bottom-1 -ml-px w-0.5 bg-foreground",
                        row.loud && "w-[3px] bg-red-600 dark:bg-red-400",
                        arriving && typing && "track-mark-in",
                    )}
                    style={{ left: `${row.score}%` }}
                />
            )}
        </span>
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
