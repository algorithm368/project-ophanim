"use client";

import {
    Clock,
    Database,
    RefreshCw,
    ShieldAlert,
    ShieldCheck,
    ShieldQuestion,
    Tag,
} from "lucide-react";
import {
    isDomainResult,
    isHashResult,
    type CheckResult,
    type DomainCheckResult,
    type HashCheckResult,
    type Verdict,
} from "@/lib/ti/types";
import {
    buildDomainNarrative,
    buildHashNarrative,
    buildNarrative,
    consensusBuckets,
    type ResultLike,
} from "@/lib/ti/narrative";
import { HASH_ALGO_LABEL } from "@/lib/hash";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { classifyType, classifyDomain, classifyHash } from "./classify";
import { CopyableSummary, ScoreRing } from "./primitives";
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

export const VERDICT_STYLE: Record<Verdict, VerdictStyle> = {
    malicious: {
        label: "Malicious",
        headline: "Danger!",
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
        headline: "Be cautious",
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
        headline: "Mostly fine",
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
        headline: "All clear!",
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
        headline: "Inconclusive",
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
    typeLabel,
    TypeIcon,
    categoryLabel,
    narrative,
}: {
    result: ResultLike;
    onRefresh: () => void;
    typeLabel: string;
    TypeIcon: IconType;
    categoryLabel?: string;
    narrative: string;
}) {
    const style = VERDICT_STYLE[result.verdict];
    const Icon = style.icon;

    return (
        <Card
            className={cn(
                "sketch-shadow relative overflow-hidden rounded-[22px_34px_18px_30px/30px_18px_34px_22px] border-2 border-foreground/25 bg-gradient-to-br to-transparent",
                style.wash,
            )}
        >
            {/* giant faint verdict watermark */}
            <Icon
                aria-hidden
                className={cn(
                    "pointer-events-none absolute -top-8 -right-6 size-48 rotate-12 opacity-[0.07]",
                    style.text,
                )}
            />
            <CardContent className="relative z-10 space-y-4">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                    <div className="relative size-28 shrink-0 self-center sm:self-auto">
                        <ScoreRing
                            value={result.riskScore}
                            stroke={style.ring}
                        />
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span
                                className={cn(
                                    "font-hand text-5xl font-bold tabular-nums leading-none",
                                    style.text,
                                )}
                            >
                                {result.riskScore}
                            </span>
                            <span className="font-hand mt-0.5 text-base font-semibold text-muted-foreground">
                                risk / 100
                            </span>
                        </div>
                    </div>

                    <div className="min-w-0 flex-1 space-y-3">
                        <div className="flex items-center gap-2.5">
                            <Icon
                                className={cn("size-8 shrink-0", style.text)}
                            />
                            <span
                                className={cn(
                                    "font-hand text-4xl font-bold leading-none sm:text-5xl",
                                    style.text,
                                )}
                            >
                                {style.headline}
                            </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <Badge
                                className={cn(
                                    "font-hand gap-1.5 text-base",
                                    style.chip,
                                )}
                            >
                                {style.label}
                            </Badge>
                            <Badge
                                variant="secondary"
                                className="font-hand gap-1.5 text-base"
                            >
                                <TypeIcon className="size-4" />
                                {typeLabel}
                            </Badge>
                            {categoryLabel && (
                                <Badge
                                    variant="secondary"
                                    className="font-hand gap-1.5 text-base"
                                >
                                    <Tag className="size-4" />
                                    {categoryLabel}
                                </Badge>
                            )}
                        </div>
                        <CopyableSummary text={narrative} />
                        <div className="flex flex-wrap items-center gap-2.5 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1.5">
                                <Clock className="size-3" />
                                <span className="font-hand text-sm">
                                    checked
                                </span>
                                <span className="font-mono">
                                    {new Date(
                                        result.checkedAt,
                                    ).toLocaleString()}
                                </span>
                            </span>
                            {result.cached && (
                                <Badge
                                    variant="secondary"
                                    className="font-hand gap-1 text-sm"
                                >
                                    <Database className="size-3" />
                                    Cached
                                </Badge>
                            )}
                            <Button
                                type="button"
                                variant="outline"
                                size="xs"
                                className="font-hand rounded-[10px_14px_8px_12px/12px_8px_14px_10px] border-2 border-dashed text-sm"
                                onClick={onRefresh}
                            >
                                <RefreshCw className="size-3" />
                                {result.cached ? "Fetch fresh" : "Re-check"}
                            </Button>
                        </div>
                    </div>
                </div>

                <ConsensusBar result={result} style={style} />
            </CardContent>
        </Card>
    );
}

export function VerdictHero({
    result,
    onRefresh,
}: {
    result: CheckResult | DomainCheckResult | HashCheckResult;
    onRefresh: () => void;
}) {
    if (isHashResult(result)) {
        const ctx = result.context;
        const hasData = result.sources.some(
            (s) => s.status === "ok" && s.score !== undefined,
        );
        const type = classifyHash(ctx, hasData);
        return (
            <VerdictShell
                result={result}
                onRefresh={onRefresh}
                typeLabel={type.label}
                TypeIcon={type.icon}
                categoryLabel={HASH_ALGO_LABEL[result.algorithm]}
                narrative={buildHashNarrative(result).join(" ")}
            />
        );
    }
    if (isDomainResult(result)) {
        const ctx = result.context;
        const resolves =
            (ctx?.resolvedIps?.length ?? 0) > 0 || (ctx?.ipv6?.length ?? 0) > 0;
        const type = classifyDomain(ctx, resolves);
        const categories = ctx?.categories ?? [];
        return (
            <VerdictShell
                result={result}
                onRefresh={onRefresh}
                typeLabel={type.label}
                TypeIcon={type.icon}
                categoryLabel={
                    categories.length
                        ? categories.slice(0, 2).join(" · ")
                        : undefined
                }
                narrative={buildDomainNarrative(result).join(" ")}
            />
        );
    }
    const type = classifyType(result.geo);
    return (
        <VerdictShell
            result={result}
            onRefresh={onRefresh}
            typeLabel={type.label}
            TypeIcon={type.icon}
            narrative={buildNarrative(result).join(" ")}
        />
    );
}

function ConsensusBar({
    result,
    style,
}: {
    result: ResultLike;
    style: VerdictStyle;
}) {
    // Only scoring feeds (weight > 0) are detectors; context-only sources like
    // geolocation (weight 0) can't flag, so excluding them keeps this strip
    // consistent with the narrative's "of N TI sources" (issue #8). The tally
    // logic is the unit-tested consensusBuckets() — the single source of truth.
    const c = consensusBuckets(result);
    const total = c.total || 1;

    // One source of truth for colors/labels. The bar drops empty buckets;
    // the legend always lists the core ones (rate-limited only when nonzero).
    const buckets = [
        {
            key: "flagged",
            count: c.flagged,
            color: "bg-red-500",
            label: "Flagged",
            inLegend: true,
        },
        {
            key: "clean",
            count: c.clean,
            color: "bg-emerald-500",
            label: "Clean",
            inLegend: true,
        },
        {
            key: "errored",
            count: c.errored,
            color: "bg-orange-400",
            label: "Error",
            inLegend: true,
        },
        {
            key: "rate",
            count: c.rateLimited,
            color: "bg-amber-400",
            label: "Rate limited",
            inLegend: false,
        },
        {
            key: "skipped",
            count: c.skipped,
            color: "bg-muted-foreground/30",
            label: "No key",
            inLegend: true,
        },
    ];
    const segments = buckets.filter((b) => b.count > 0);
    const legend = buckets.filter((b) => b.inLegend || b.count > 0);

    return (
        <div
            className={cn(
                "space-y-2.5 rounded-[16px_22px_14px_20px/20px_14px_22px_16px] border-2 bg-gradient-to-br to-transparent p-3.5",
                style.border,
                style.wash,
            )}
        >
            <div className="flex items-center justify-between">
                <span
                    className={cn(
                        "font-hand flex items-center gap-1.5 text-lg font-bold",
                        style.text,
                    )}
                >
                    <span className={cn("size-2.5 rounded-full", style.bar)} />
                    Detector consensus
                </span>
                <span className="text-xs text-muted-foreground">
                    <span className="font-mono">{c.responded}</span> of{" "}
                    <span className="font-mono">{c.total}</span> responded
                </span>
            </div>
            <div
                className={cn(
                    "flex h-3 w-full overflow-hidden rounded-full border bg-muted",
                    style.border,
                )}
            >
                {segments.map((s) => (
                    <div
                        key={s.key}
                        className={cn("h-full transition-all", s.color)}
                        style={{ width: `${(s.count / total) * 100}%` }}
                    />
                ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
                {legend.map((s) => (
                    <span key={s.label} className="flex items-center gap-1.5">
                        <span className={cn("size-2 rounded-full", s.color)} />
                        <span className="font-mono font-semibold tabular-nums text-foreground">
                            {s.count}
                        </span>
                        <span className="font-hand text-base text-muted-foreground">
                            {s.label}
                        </span>
                    </span>
                ))}
            </div>
        </div>
    );
}
