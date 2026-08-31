"use client";

import {
    Clock,
    RefreshCw,
    ShieldAlert,
    ShieldCheck,
    ShieldQuestion,
} from "lucide-react";
import {
    type AnyCheckResult,
    isDomainResult,
    isHashResult,
    type SourceMeta,
    type SourceResult,
    type Verdict,
} from "@/lib/ti/types";
import { useEffect, useMemo, useState } from "react";
import {
    buildDomainNarrative,
    buildHashNarrative,
    buildNarrative,
    consensusBuckets,
    type ResultLike,
} from "@/lib/ti/narrative";
import { scoreRationale } from "@/lib/ti/rationale";
import { threatTypeOf } from "@/lib/ti/threat-type";
import { scoreConfidence } from "@/lib/ti/confidence";
import { isNewlyFlagged, reputationTrend } from "@/lib/ti/trend";
import { relativeTime } from "@/lib/relative-time";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CopyableSummary } from "./primitives";
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

// Qualitative risk level shown in place of the numeric score. The verdict word
// already carries the meaning and the color, so the level stays monochrome and
// coarser (a plain band), mirroring how the old score read as a bare number.
const RISK_LEVEL: Record<Verdict, string> = {
    malicious: "High",
    suspicious: "Medium",
    low: "Low",
    clean: "Minimal",
    unknown: "Unknown",
};

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

function VerdictShell({
    result,
    onRefresh,
    narrative,
}: Readonly<{
    result: ResultLike;
    onRefresh: () => void;
    narrative: string;
}>) {
    const style = VERDICT_STYLE[result.verdict];
    // What kind of threat, as opposed to how bad. A C2, a spam bot, a Tor exit
    // and a research scanner all read "malicious 75", and the analyst does
    // something different with each one.
    const threat = threatTypeOf(result.sources, {
        verdict: result.verdict,
        benignOverride: result.scoreBreakdown?.benignOverride,
    });

    return (
        <Card className="sketch-shadow rounded-lg border border-foreground/12">
            <CardContent className="space-y-4">
                {/* Verdict + risk level. The verdict word is the focal point and
                    the only element that carries color; the level reads as a plain
                    monochrome band over a monochrome meter. */}
                <div className="space-y-2.5">
                    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
                        <span className="flex flex-wrap items-baseline gap-x-2">
                            <span
                                className={cn(
                                    "font-mono text-2xl font-bold leading-none tracking-tight uppercase sm:text-3xl",
                                    style.text,
                                )}
                            >
                                {style.headline}
                            </span>
                            {threat && (
                                <span
                                    title={`Reported by ${threat.sources.join(", ")}${
                                        threat.also.length
                                            ? `. Also described as ${threat.also.join(", ")}.`
                                            : ""
                                    }`}
                                    className="font-mono text-base font-bold uppercase leading-none tracking-tight text-muted-foreground"
                                >
                                    · {threat.type}
                                </span>
                            )}
                        </span>
                        <span className="font-mono font-bold uppercase leading-none text-foreground">
                            <span className="text-2xl sm:text-3xl">
                                {RISK_LEVEL[result.verdict]}
                            </span>
                            <span className="text-base font-medium text-muted-foreground">
                                {" "}
                                risk
                            </span>
                        </span>
                    </div>
                    <div
                        role="meter"
                        aria-label="Risk score"
                        aria-valuenow={Math.round(result.riskScore)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                    >
                        <div
                            className="h-full rounded-full bg-foreground"
                            style={{
                                width: `${Math.max(0, Math.min(100, result.riskScore))}%`,
                            }}
                        />
                    </div>
                    <SourceDots sources={result.sources} total={result.sources.length} />
                </div>

                <CopyableSummary text={narrative} />

                <ScoreRationale result={result} />

                <ConsensusLine result={result} />

                {/* Meta: one chip, not three. How fresh the result is and where
                    it came from are the same fact from two angles, and a stamp
                    spelled out to the second ("8/21/2026, 7:54:16 AM") answers
                    a question nobody asks that precisely. The exact stamp is on
                    hover, so nothing is lost. */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                    <CheckedAt
                        checkedAt={result.checkedAt}
                        cached={result.cached}
                    />
                    <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="ml-auto gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground"
                        onClick={onRefresh}
                    >
                        <RefreshCw className="size-3" />
                        {result.cached ? "fetch fresh" : "re-check"}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}

/**
 * "2m ago, cached", ticking.
 *
 * A cached permalink renders this card on the server and then hydrates it in
 * the browser, so two clocks produce the label. They agree to well within the
 * resolution of anything `relativeTime` returns, and the effect below re-runs
 * with the browser's own clock on mount regardless; `suppressHydrationWarning`
 * covers the once-a-minute render that straddles a boundary, and the
 * locale-formatted title, which is the server's locale until mount.
 */
function CheckedAt({
    checkedAt,
    cached,
}: Readonly<{ checkedAt: string; cached?: boolean }>) {
    const [now, setNow] = useState(() => Date.now());

    // A result that was two minutes old when the tab was opened is not two
    // minutes old an hour later, and this line is the only thing that says so.
    // The tick is also what reconciles the server's clock with the browser's,
    // which is why there is no synchronous correction on mount: the two are a
    // second apart at worst, well inside the resolution of any label this
    // renders, so waiting for the first tick costs nothing.
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 30_000);
        return () => clearInterval(id);
    }, []);

    return (
        <span
            suppressHydrationWarning
            title={`Checked ${new Date(checkedAt).toLocaleString()}`}
            className="inline-flex items-center gap-1.5 font-mono"
        >
            <Clock className="size-3" />
            {relativeTime(checkedAt, now)}
            {cached && ", cached"}
        </span>
    );
}

/**
 * How the score was reached, on demand.
 *
 * `scoreExplanation()` reads the intermediates `aggregateRisk()` recorded rather
 * than re-deriving them, so this cannot drift from the number above it. It is
 * behind a disclosure because the answer to "can I defend this verdict" is
 * wanted only when the verdict is being questioned, and the card is already
 * dense. The fact that it is worth questioning is surfaced on the always-visible
 * consensus line instead.
 */
function ScoreRationale({ result }: Readonly<{ result: ResultLike }>) {
    const [open, setOpen] = useState(false);
    const rationale = scoreRationale(result);
    if (!rationale) return null;

    return (
        <div className="space-y-2">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
            >
                {open ? "hide rationale" : "why this score"}
            </button>
            {open && (
                <div className="space-y-2">
                    {/* Numbers only. The two rows that answer the question sit
                        next to each other: what the loudest source said, and
                        what everything else averaged to. */}
                    <dl className="font-mono text-[11px] text-muted-foreground">
                        {rationale.terms.map((term, i) => (
                            <div
                                key={`${term.label}-${i}`}
                                className={cn(
                                    "flex items-baseline gap-x-3 py-0.5",
                                    term.derived &&
                                        "border-t border-foreground/12 text-foreground",
                                )}
                            >
                                <dt className="w-24 shrink-0 uppercase tracking-wider">
                                    {term.label}
                                </dt>
                                <dd className="w-14 shrink-0 text-right font-bold tabular-nums text-foreground">
                                    {term.value}
                                </dd>
                                <dd className="min-w-0 flex-1 truncate text-muted-foreground">
                                    {term.note}
                                </dd>
                            </div>
                        ))}
                    </dl>
                    {rationale.note && (
                        <p className="text-[13px] leading-relaxed text-muted-foreground">
                            {rationale.note}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}

/** The narrative builder that matches the result's shape. Order matters only in
 *  that the plain IP builder is the fallback, not a case. */
function narrativeFor(result: AnyCheckResult): string {
    if (isHashResult(result)) return buildHashNarrative(result).join(" ");
    if (isDomainResult(result)) return buildDomainNarrative(result).join(" ");
    return buildNarrative(result).join(" ");
}

export function VerdictHero({
    result,
    onRefresh,
}: Readonly<{
    result: AnyCheckResult;
    onRefresh: () => void;
}>) {
    // `result` only changes when the lookup actually finishes or refreshes,
    // but VerdictHero re-renders on every parent update in between (the ETA
    // ticker, sibling cards streaming in); narrativeFor dispatches into a
    // thousand-line sentence assembler each call, so it is worth keying this.
    const narrative = useMemo(() => narrativeFor(result), [result]);
    return (
        <VerdictShell
            result={result}
            onRefresh={onRefresh}
            narrative={narrative}
        />
    );
}

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
 *
 * A URL check runs three layers, and three source ids appear in two of them.
 * Both slots read the same settled result, which is why this looks a source up
 * rather than consuming it: the strip keeps its full width, and neither slot
 * is left pending forever.
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
    return (
        <div className="flex flex-wrap gap-1" aria-hidden>
            {dotSlots(sources, total, panel).map((slot, i) => (
                <span
                    // Position is the identity here: two layers of a URL check
                    // can share a source id, so an id key would collide.
                    key={i}
                    title={slot.name}
                    className={cn(
                        "size-1.5 rounded-full",
                        slot.result
                            ? dotTone(slot.result)
                            : "animate-pulse bg-foreground/15",
                    )}
                />
            ))}
        </div>
    );
}

/** The same three readings the progress list uses: adverse, gap, clean. */
function dotTone(s: SourceResult): string {
    if (s.status === "ok" && (s.malicious === true || (s.score ?? 0) > 0)) {
        return "bg-red-600 dark:bg-red-400";
    }
    if (s.status !== "ok") return "bg-amber-500";
    return "bg-emerald-600 dark:bg-emerald-400";
}

/** One cell of the stat strip: a small label over the value it names. */
type Stat = {
    key: string;
    label: string;
    value: string;
    title?: string;
    /** Lifted out of the muted tone, for the things that change what happens next. */
    emphatic?: boolean;
    /** Takes two grid tracks. For the cells holding a phrase rather than a
     *  count, which would otherwise wrap inside a column sized for "13". */
    wide?: boolean;
};

/** "1 rate limited, 2 no key", skipping the zeroes. Empty when all are 0. */
function tally(buckets: Readonly<{ count: number; label: string }>[]): string {
    return buckets
        .filter((b) => b.count > 0)
        .map((b) => `${b.count} ${b.label}`)
        .join(", ");
}

/**
 * The cells of the consensus strip, in reading order.
 *
 * Split out from the rendering because deciding *which* facts this check has to
 * report is the whole of the logic here, and the markup below is then four
 * lines that do not need reading.
 */
function consensusStats(result: ResultLike): Stat[] {
    // Only scoring feeds (weight > 0) are detectors; context-only sources like
    // geolocation (weight 0) can't flag, so excluding them keeps this strip
    // consistent with the narrative's "of N TI sources" (issue #8). The tally
    // logic is the unit-tested consensusBuckets() — the single source of truth.
    const c = consensusBuckets(result);
    const confidence = scoreConfidence(result);
    const trend = reputationTrend(result.history);
    const newlyFlagged = isNewlyFlagged(result.history, result.verdict);

    const stats: Stat[] = [];

    // How much the score is worth believing, as distinct from how bad it is.
    // It leads because everything to its right is the evidence it was drawn
    // from, so the strip reads as a claim followed by its support.
    if (confidence) {
        stats.push({
            key: "confidence",
            label: "Confidence",
            value: confidence.level,
            title: confidence.reason,
        });
    }

    // Detectors, adverse and clean are always present, zero included: a stable
    // set of columns is what makes the strip scannable, and "0 adverse" is a
    // finding rather than an absence of one.
    stats.push(
        { key: "detectors", label: "Detectors", value: String(c.total) },
        { key: "adverse", label: "Adverse", value: String(c.adverse) },
    );

    // Flagged is a subset of adverse, not a fourth bucket, so the value says
    // "of" rather than standing alone. Reporting only this count understated
    // the evidence, which is why "adverse" leads: a source listed on Spamhaus
    // ZEN scores 38, just under FLAG_THRESHOLD, and used to read as clean.
    if (c.flagged > 0 && c.flagged < c.adverse) {
        stats.push({
            key: "flagged",
            label: "Flagged",
            value: `${c.flagged} of ${c.adverse}`,
        });
    }

    stats.push({ key: "clean", label: "Clean", value: String(c.clean) });

    // A source with no record of the indicator never assessed it, which is not
    // the same as having looked and found it clean.
    if (c.noRecord > 0) {
        stats.push({
            key: "norecord",
            label: "No record",
            value: String(c.noRecord),
        });
    }

    // The ways a source can fail to answer, collected under one label: these
    // are gaps in the evidence rather than opinions about the indicator, and
    // most checks have none, so the cell costs nothing when nothing is wrong.
    const gaps = tally([
        { count: c.errored, label: "errors" },
        { count: c.rateLimited, label: "rate limited" },
        { count: c.noKey, label: "no key" },
        // Family-skipped sources are not misconfigured, so they must not be
        // reported as missing a key.
        { count: c.unsupported, label: "unsupported" },
    ]);
    if (gaps) stats.push({ key: "gaps", label: "Gaps", value: gaps, wide: true });

    // What the recorded checks say. Reported, never scored: today's verdict
    // becomes tomorrow's history, so feeding it back would let a verdict
    // confirm itself. The full sentence is on hover.
    if (trend) {
        stats.push({
            key: "history",
            label: "History",
            value: newlyFlagged ? "newly flagged" : trend.short,
            title: trend.steady
                ? `${trend.summary}. Every recorded check reached the same verdict.`
                : `${trend.summary}. Verdicts on record: ${trend.seen.join(", ")}.`,
            emphatic: newlyFlagged,
            wide: true,
        });
    }

    // Every floor-pinned verdict is borderline by construction: the floor is 75
    // and the malicious cutoff is 70, so it lands five points into a band it
    // did not reach on consensus. Those are the verdicts worth a second look,
    // so the flag is stated here rather than only inside the rationale.
    if (result.scoreBreakdown?.borderline) {
        stats.push({
            key: "flag",
            // Not "Flag": the strip may already carry a "Flagged" column, and
            // two labels a letter apart meaning unrelated things is the kind of
            // thing that gets misread once and distrusted after.
            label: "Caveat",
            value: "borderline",
            title: "Within five points of a verdict boundary, so the label could fall either way.",
            emphatic: true,
        });
    }

    return stats;
}

/**
 * The evidence behind the verdict, as a strip of labelled figures.
 *
 * This was one dot-separated run of text, and no amount of shortening the
 * wording fixed it: a chain of "· 5 adverse · 7 clean · 1 rate limited" reads
 * as a sentence, so every figure has to be parsed in sequence to find the one
 * being looked for. Small label over value gives each figure a column and a
 * name, which is the same reason the rationale below it is a table.
 *
 * Two tones only: muted labels, plain values. Color stays on the verdict word.
 */
function ConsensusLine({ result }: Readonly<{ result: ResultLike }>) {
    const stats = consensusStats(result);

    return (
        // A grid rather than a wrapping flex row: flex sizes each cell to its
        // own content, so the moment the strip wraps the second row's labels
        // sit at their own arbitrary offsets and the columns stop being
        // columns. auto-fill keeps one track width at every viewport, which is
        // the whole point of laying this out as a table.
        <dl className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-x-4 gap-y-3 border-t border-foreground/12 pt-3">
            {stats.map((s) => (
                <div
                    key={s.key}
                    title={s.title}
                    className={cn("min-w-0", s.wide && "col-span-2")}
                >
                    <dt className="font-mono text-[10px] uppercase leading-none tracking-[0.14em] text-muted-foreground">
                        {s.label}
                    </dt>
                    <dd
                        className={cn(
                            // Snug, not none: a long value ("2 errors, 1 no
                            // key") wraps inside its own track, and leading-none
                            // laps the two lines onto each other.
                            "mt-1.5 font-mono text-[13px] leading-snug break-words text-foreground",
                            s.emphatic && "font-bold",
                        )}
                    >
                        {s.value}
                    </dd>
                </div>
            ))}
        </dl>
    );
}

