"use client";

import {
    History,
    ShieldCheck,
    TriangleAlert,
} from "lucide-react";
import type { HistorySnapshot } from "@/lib/ti/types";
import {
    aggregateCategories,
    type ResultLike,
} from "@/lib/ti/narrative";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeading } from "./primitives";
import { VERDICT_STYLE } from "./verdict";

/**
 * Warn when a lookup ran but couldn't gather any intelligence (every
 * source that attempted a request failed. Without this the verdict reads
 * "inconclusive/clean" and looks like a real result rather than an outage.
 */
export function SourceHealthNotice({ result }: { result: ResultLike }) {
    const okCount = result.sources.filter((s) => s.status === "ok").length;
    if (okCount > 0 || result.stats.queried === 0) return null;

    return (
        <div className="sketch-shadow flex items-start gap-3 rounded-xl border-2 border-orange-500/40 bg-orange-500/10 px-4 py-3 text-orange-700 dark:text-orange-300">
            <TriangleAlert className="mt-0.5 size-5 shrink-0" />
            <div className="space-y-0.5">
                <p className="font-hand text-lg font-bold leading-tight">
                    Heads up: no sources responded
                </p>
                <p className="text-sm leading-relaxed">
                    All {result.stats.queried} threat-intel source(s) failed to
                    respond, so the verdict below is inconclusive, not a clean
                    result. Try re-checking in a moment.
                </p>
            </div>
        </div>
    );
}

export function ActivityCard({ result, noun }: { result: ResultLike; noun: string }) {
    const categories = aggregateCategories(result.sources);
    const maxCount = categories.length ? categories[0].count : 1;
    const flaggedSources = result.sources
        .filter(
            (s) =>
                s.status === "ok" &&
                (s.malicious === true || (s.score ?? 0) >= 40),
        )
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const flaggedCount = result.stats.flagged;
    // Sources that actually returned an answer; errors/timeouts didn't respond.
    const responded = result.sources.filter((s) => s.status === "ok").length;

    return (
        <Card className="sketch-shadow rounded-2xl border border-foreground/12">
            <CardContent className="space-y-4">
                <SectionHeading icon={TriangleAlert}>
                    What it does
                </SectionHeading>

                {flaggedCount > 0 ? (
                    <div className="flex items-start gap-2.5 rounded-lg border-2 border-red-500/30 bg-red-500/8 p-3 text-sm text-red-700 dark:text-red-300">
                        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                        <span>
                            <span className="font-semibold">
                                {flaggedCount}
                            </span>{" "}
                            of {responded} TI sources flagged this {noun}.
                        </span>
                    </div>
                ) : (
                    <div className="flex items-start gap-2.5 rounded-lg border-2 border-emerald-500/30 bg-emerald-500/8 p-3 text-sm text-emerald-700 dark:text-emerald-300">
                        <ShieldCheck className="mt-0.5 size-4 shrink-0" />
                        <span>
                            No source flagged this {noun}
                            {responded > 0 ? ` (${responded} responded).` : "."}
                        </span>
                    </div>
                )}

                {categories.length > 0 && (
                    <div className="space-y-2.5">
                        <div className="font-hand text-base font-bold text-foreground/70">
                            Observed signals
                        </div>
                        <div className="space-y-2">
                            {categories.slice(0, 8).map((c) => (
                                <div key={c.name} className="space-y-1">
                                    <div className="flex items-center justify-between gap-2 text-xs">
                                        <span
                                            className="truncate text-foreground"
                                            title={`Reported by: ${c.sources.join(", ")}`}
                                        >
                                            {c.name}
                                        </span>
                                        <span className="shrink-0 tabular-nums text-muted-foreground">
                                            {c.count}{" "}
                                            {c.count === 1
                                                ? "source"
                                                : "sources"}
                                        </span>
                                    </div>
                                    <div className="h-2.5 w-full overflow-hidden rounded-sm bg-muted ring-1 ring-foreground/5">
                                        <div
                                            className="h-full rounded-sm bg-primary/70"
                                            style={{
                                                width: `${(c.count / maxCount) * 100}%`,
                                            }}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {flaggedSources.length > 0 && (
                    <div className="space-y-2">
                        <div className="font-hand text-base font-bold text-foreground/70">
                            Flagged by
                        </div>
                        <ul className="space-y-1.5">
                            {flaggedSources.map((s) => (
                                <li
                                    key={s.source.id}
                                    className="flex items-center justify-between gap-3 text-sm"
                                >
                                    <span className="min-w-0 truncate font-medium">
                                        {s.source.name}
                                    </span>
                                    {typeof s.score === "number" && (
                                        <span className="shrink-0 rounded-sm bg-red-500/12 px-2 py-0.5 text-xs font-semibold tabular-nums text-red-600 dark:text-red-400">
                                            {s.score}
                                        </span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {flaggedCount === 0 && categories.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                        This {noun} has a clean reputation across all TI
                        sources; no blocklist, malware, phishing, or abuse
                        signals were reported.
                    </p>
                )}
            </CardContent>
        </Card>
    );
}

function trendNote(history: HistorySnapshot[]): string {
    const delta = history[history.length - 1].riskScore - history[0].riskScore;
    if (delta > 4) return `Risk has climbed ${delta} points since first seen.`;
    if (delta < -4)
        return `Risk has eased ${Math.abs(delta)} points since first seen.`;
    return "Risk has held roughly steady over time.";
}

/** Sparkline of an indicator's risk score across past checks. */
export function HistoryCard({ result }: { result: ResultLike }) {
    const history = result.history ?? [];
    if (history.length < 2) return null;

    const n = history.length;
    const xOf = (i: number) => (n === 1 ? 50 : 3 + (i / (n - 1)) * 94);
    const yOf = (s: number) => 94 - (Math.max(0, Math.min(100, s)) / 100) * 88;
    const pts = history.map((h, i) => ({ x: xOf(i), y: yOf(h.riskScore) }));
    // A timeline that swings between 0 and an elevated score usually means some
    // checks ran with fewer API keys (e.g. no VirusTotal), not that the verdict
    // truly flip-flopped. Flag that so the graph isn't read as conflicting.
    const mixedKeyRuns =
        history.some((h) => h.riskScore === 0) &&
        history.some((h) => h.riskScore >= 40);
    const line = pts.map((p) => `${p.x},${p.y}`).join(" ");
    const area = `${pts[0].x},100 ${line} ${pts[n - 1].x},100`;
    const latest = history[n - 1];
    const style = VERDICT_STYLE[latest.verdict];
    const fmt = (iso: string) => new Date(iso).toLocaleDateString();

    return (
        <Card className="sketch-shadow rounded-2xl border border-foreground/12">
            <CardContent className="space-y-4">
                <SectionHeading
                    icon={History}
                    action={
                        <span className="text-xs text-muted-foreground">
                            <span className="font-mono">{n}</span> checks ·{" "}
                            {fmt(history[0].checkedAt)} → {fmt(latest.checkedAt)}
                        </span>
                    }
                >
                    Reputation over time
                </SectionHeading>

                <div className="relative h-28 w-full">
                    <svg
                        viewBox="0 0 100 100"
                        preserveAspectRatio="none"
                        className="absolute inset-0 size-full"
                        aria-hidden
                    >
                        <polygon
                            points={area}
                            fill="currentColor"
                            className={cn("opacity-15", style.text)}
                        />
                        <polyline
                            points={line}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1.5}
                            strokeLinejoin="round"
                            strokeLinecap="round"
                            vectorEffect="non-scaling-stroke"
                            className={style.text}
                        />
                    </svg>
                    {pts.map((p, i) => (
                        <div
                            key={i}
                            title={`${fmt(history[i].checkedAt)}: risk ${history[i].riskScore}`}
                            style={{ left: `${p.x}%`, top: `${p.y}%` }}
                            className={cn(
                                "absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-current bg-background",
                                style.text,
                            )}
                        />
                    ))}
                </div>

                <p className="font-hand text-base text-muted-foreground">
                    {trendNote(history)}
                </p>

                {mixedKeyRuns && (
                    <p className="text-xs leading-relaxed text-muted-foreground">
                        Heads up: scores depend on which API keys were
                        configured at check time, so a past{" "}
                        <span className="font-mono">0</span> may be a degraded
                        (no-key) run rather than a clean verdict.
                    </p>
                )}
            </CardContent>
        </Card>
    );
}
