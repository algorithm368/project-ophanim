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

    return (
        <Card className="sketch-shadow relative overflow-hidden rounded-2xl border border-foreground/12 bg-card">
            <CardContent className="relative z-10 space-y-4">
                <div className="flex flex-row items-start justify-between gap-4">
                    <div className="min-w-0 flex-1 space-y-3">
                        <div className="flex items-center gap-2.5">
                            <span
                                className={cn(
                                    "font-mono text-2xl font-bold leading-none tracking-tight uppercase sm:text-3xl",
                                    style.text,
                                )}
                            >
                                {style.headline}
                            </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <Badge
                                variant="secondary"
                                className="gap-1.5 rounded-md text-sm font-medium"
                            >
                                <TypeIcon className="size-4" />
                                {typeLabel}
                            </Badge>
                            {categoryLabel && (
                                <Badge
                                    variant="secondary"
                                    className="gap-1.5 rounded-md text-sm font-medium"
                                >
                                    <Tag className="size-4" />
                                    {categoryLabel}
                                </Badge>
                            )}
                        </div>
                        <CopyableSummary text={narrative} />
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-foreground/15 bg-background px-2.5 font-mono">
                                <Clock className="size-3" />
                                checked {new Date(result.checkedAt).toLocaleString()}
                            </span>
                            {result.cached && (
                                <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-foreground/15 bg-background px-2.5 font-mono">
                                    <Database className="size-3" />
                                    cached
                                </span>
                            )}
                            <Button
                                type="button"
                                variant="outline"
                                size="xs"
                                className="h-7 gap-1.5 rounded-md border border-foreground/15 bg-background px-2.5 font-mono text-xs"
                                onClick={onRefresh}
                            >
                                <RefreshCw className="size-3" />
                                {result.cached ? "fetch fresh" : "re-check"}
                            </Button>
                        </div>
                    </div>

                    <ConsensusMini result={result} style={style} />
                </div>
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

function ConsensusMini({
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

    const buckets = [
        { key: "flagged", count: c.flagged, color: "bg-red-500", label: "flagged" },
        { key: "clean", count: c.clean, color: "bg-emerald-500", label: "clean" },
        { key: "errored", count: c.errored, color: "bg-orange-400", label: "error" },
        { key: "rate", count: c.rateLimited, color: "bg-amber-400", label: "rate limited" },
        { key: "skipped", count: c.skipped, color: "bg-muted-foreground/30", label: "no key" },
    ];
    const segments = buckets.filter((b) => b.count > 0);
    // Full breakdown lives on hover so the corner stays minimal.
    const title = segments.map((s) => `${s.count} ${s.label}`).join(" · ");

    return (
        <div
            className="flex shrink-0 flex-col items-end gap-1.5"
            title={`Detector consensus — ${title}`}
        >
            <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                <span className="text-foreground">{c.responded}</span>/{c.total}{" "}
                detectors
            </span>
            <div
                className={cn(
                    "flex h-2 w-24 overflow-hidden rounded-sm border bg-muted",
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
        </div>
    );
}
