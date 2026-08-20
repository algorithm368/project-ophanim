"use client";

import {
    Clock,
    Database,
    RefreshCw,
    ShieldAlert,
    ShieldCheck,
    ShieldQuestion,
} from "lucide-react";
import {
    type AnyCheckResult,
    isDomainResult,
    isHashResult,
    type Verdict,
} from "@/lib/ti/types";
import {
    buildDomainNarrative,
    buildHashNarrative,
    buildNarrative,
    consensusBuckets,
    type ResultLike,
} from "@/lib/ti/narrative";
import { scoreConfidence } from "@/lib/ti/confidence";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CONF_ICON } from "./confidence";
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

    return (
        <Card className="sketch-shadow rounded-lg border border-foreground/12">
            <CardContent className="space-y-4">
                {/* Verdict + risk level. The verdict word is the focal point and
                    the only element that carries color; the level reads as a plain
                    monochrome band over a monochrome meter. */}
                <div className="space-y-2.5">
                    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
                        <span
                            className={cn(
                                "font-mono text-2xl font-bold leading-none tracking-tight uppercase sm:text-3xl",
                                style.text,
                            )}
                        >
                            {style.headline}
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
                </div>

                <CopyableSummary text={narrative} />

                <ConsensusLine result={result} />

                {/* Meta: plain muted line, no bordered chips. */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5 font-mono">
                        <Clock className="size-3" />
                        checked {new Date(result.checkedAt).toLocaleString()}
                    </span>
                    {result.cached && (
                        <span className="inline-flex items-center gap-1.5 font-mono">
                            <Database className="size-3" />
                            cached
                        </span>
                    )}
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
    const narrative = narrativeFor(result);
    return (
        <VerdictShell
            result={result}
            onRefresh={onRefresh}
            narrative={narrative}
        />
    );
}

function ConsensusLine({ result }: Readonly<{ result: ResultLike }>) {
    // Only scoring feeds (weight > 0) are detectors; context-only sources like
    // geolocation (weight 0) can't flag, so excluding them keeps this line
    // consistent with the narrative's "of N TI sources" (issue #8). The tally
    // logic is the unit-tested consensusBuckets() — the single source of truth.
    const c = consensusBuckets(result);

    const buckets = [
        // "Adverse" leads and "flagged" qualifies it. Showing only the flagging
        // count understated the evidence: a source listed on Spamhaus ZEN
        // scores 38, just under FLAG_THRESHOLD, and landed in "clean".
        {
            key: "adverse",
            count: c.adverse,
            label:
                c.flagged && c.flagged < c.adverse
                    ? `adverse (${c.flagged} flagged)`
                    : "adverse",
        },
        { key: "clean", count: c.clean, label: "clean" },
        // A source with no record of the indicator never assessed it.
        { key: "norecord", count: c.noRecord, label: "no record" },
        { key: "errored", count: c.errored, label: "errors" },
        { key: "rate", count: c.rateLimited, label: "rate limited" },
        { key: "skipped", count: c.noKey, label: "no key" },
        // Family-skipped sources are not misconfigured, so they must not be
        // reported as missing a key.
        { key: "unsupported", count: c.unsupported, label: "unsupported" },
    ];
    const segments = buckets.filter((b) => b.count > 0);

    // How much the score is worth believing, as distinct from how bad it is.
    // It leads this row because the detector tally below it is the evidence the
    // level is drawn from, so the two belong on one line.
    const confidence = scoreConfidence(result);
    const ConfIcon = confidence ? CONF_ICON[confidence.level] : undefined;

    // A plain monochrome breakdown reads more clearly than a tiny color bar and
    // keeps color reserved for the verdict word.
    return (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-muted-foreground">
            {confidence && ConfIcon && (
                <span
                    title={confidence.reason}
                    className="inline-flex items-center gap-1 font-medium tracking-wider uppercase"
                >
                    <ConfIcon
                        className="size-3 shrink-0 text-foreground/50"
                        aria-hidden
                    />
                    <span className="text-foreground">{confidence.level}</span>
                    {" confidence ·"}
                </span>
            )}
            <span className="font-medium tracking-wider uppercase">
                <span className="text-foreground">{c.responded}</span>/{c.total}{" "}
                detectors
            </span>
            {segments.map((s) => (
                <span key={s.key}>
                    · {s.count} {s.label}
                </span>
            ))}
        </div>
    );
}

