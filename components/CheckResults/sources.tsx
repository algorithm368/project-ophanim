"use client";

import { useState } from "react";
import {
    BarChart3,
    ChevronRight,
    CircleX,
    Clock,
    ExternalLink,
    Gauge,
    ShieldAlert,
    ShieldCheck,
    TriangleAlert,
} from "lucide-react";
import {
    type SourceMeta,
    type SourceResult,
} from "@/lib/ti/types";
import {
    formatDate,
    scoreExplanation,
    type ResultLike,
} from "@/lib/ti/narrative";
import { algoFromLength } from "@/lib/hash";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { scoreBarColor } from "./classify";
import { SectionHeading } from "./primitives";
import type { Mode } from "./types";

/** A source slower than this is flagged in the result card so a near-timeout
 *  (e.g. AlienVault OTX at 10s+) is visible rather than silent. */
const SLOW_MS = 6000;

const CATEGORY_LABEL: Record<string, string> = {
    reputation: "Reputation",
    blocklist: "Blocklist",
    scanner: "Scanner",
    dnsbl: "DNSBL",
    context: "Context",
};

const CATEGORY_ORDER = [
    "reputation",
    "blocklist",
    "scanner",
    "dnsbl",
    "context",
] as const;

/** Per-source pages that look up a specific IP, keyed by source id. */
const LOOKUP_URL: Record<string, (ip: string) => string> = {
    abuseipdb: (ip) => `https://www.abuseipdb.com/check/${ip}`,
    virustotal: (ip) => `https://www.virustotal.com/gui/ip-address/${ip}`,
    greynoise: (ip) => `https://viz.greynoise.io/ip/${ip}`,
    "shodan-internetdb": (ip) => `https://www.shodan.io/host/${ip}`,
    censys: (ip) => `https://search.censys.io/hosts/${ip}`,
    "criminal-ip": (ip) => `https://www.criminalip.io/asset/report/${ip}`,
    otx: (ip) => `https://otx.alienvault.com/indicator/ip/${ip}`,
    threatfox: (ip) =>
        `https://threatfox.abuse.ch/browse.php?search=ioc%3A${ip}`,
    feodo: (ip) => `https://feodotracker.abuse.ch/browse/host/${ip}/`,
    dnsbl: (ip) => `https://check.spamhaus.org/results/?query=${ip}`,
    "tor-project": (ip) =>
        `https://metrics.torproject.org/exonerator.html?ip=${ip}`,
    "ip-api": (ip) => `https://ip-api.com/#${ip}`,
};

/** Per-source pages that look up a specific domain, keyed by source id. */
const DOMAIN_LOOKUP_URL: Record<string, (d: string) => string> = {
    virustotal: (d) => `https://www.virustotal.com/gui/domain/${d}`,
    otx: (d) => `https://otx.alienvault.com/indicator/domain/${d}`,
    threatfox: (d) => `https://threatfox.abuse.ch/browse.php?search=ioc%3A${d}`,
    urlhaus: (d) => `https://urlhaus.abuse.ch/browse.php?search=${d}`,
    "spamhaus-dbl": (d) => `https://check.spamhaus.org/results/?query=${d}`,
    rdap: (d) => `https://rdap.org/domain/${d}`,
    dns: (d) => `https://dns.google/query?name=${d}`,
};

/** Per-source pages that look up a specific file hash, keyed by source id. */
const HASH_LOOKUP_URL: Record<string, (h: string) => string> = {
    virustotal: (h) => `https://www.virustotal.com/gui/file/${h}`,
    malwarebazaar: (h) => `https://bazaar.abuse.ch/sample/${h}/`,
    threatfox: (h) =>
        `https://threatfox.abuse.ch/browse.php?search=hash%3A${h}`,
    urlhaus: (h) => `https://urlhaus.abuse.ch/browse.php?search=${h}`,
    "hybrid-analysis": (h) =>
        `https://www.hybrid-analysis.com/search?query=${h}`,
    metadefender: (h) => `https://www.filescan.io/search-result?query=${h}`,
    otx: (h) => `https://otx.alienvault.com/indicator/file/${h}`,
    hashlookup: (h) =>
        `https://hashlookup.circl.lu/lookup/${algoFromLength(h) ?? "sha256"}/${h}`,
    maltiverse: (h) => `https://maltiverse.com/sample/${h}`,
    triage: (h) => `https://tria.ge/s?q=${h}`,
    pulsedive: (h) => `https://pulsedive.com/indicator/?ioc=${h}`,
    "kaspersky-opentip": (h) => `https://opentip.kaspersky.com/${h}/results`,
};

/** Where clicking a source card should take you: that source's lookup for this indicator. */
function sourceLookupUrl(
    source: SourceMeta,
    indicator: string,
    kind: Mode,
): string {
    const map =
        kind === "domain"
            ? DOMAIN_LOOKUP_URL
            : kind === "hash"
              ? HASH_LOOKUP_URL
              : LOOKUP_URL;
    return map[source.id]?.(indicator) ?? source.url;
}

function relevanceRank(s: SourceResult): number {
    const flagged =
        s.status === "ok" && (s.malicious === true || (s.score ?? 0) >= 40);
    if (flagged) return 0;
    if (s.status === "ok") return 1;
    if (s.status === "error" || s.status === "timeout") return 2;
    return 3;
}

/** One semantic state per source, driving both the status rail and the pill so
 *  the two never disagree. */
type SourceTone = "flagged" | "low" | "clean" | "error" | "limited" | "skipped";

function sourceTone(result: SourceResult): SourceTone {
    const { status } = result;
    const score = result.score ?? 0;
    if (status === "ok" && (result.malicious === true || score >= 40))
        return "flagged";
    if (status === "ok" && score > 0) return "low";
    if (status === "ok") return "clean";
    if (status === "error" || status === "timeout") return "error";
    if (status === "rate_limited") return "limited";
    return "skipped";
}

/** Color of the 3px status rail down the left edge of each card. */
const TONE_RAIL: Record<SourceTone, string> = {
    flagged: "bg-red-500",
    low: "bg-amber-500",
    clean: "bg-emerald-500",
    error: "bg-destructive",
    limited: "bg-amber-500",
    skipped: "bg-foreground/20",
};

/** Risk number tint — same thresholds as the score bar (see scoreBarColor). */
function scoreTextColor(score: number): string {
    if (score >= 70) return "text-red-600 dark:text-red-400";
    if (score >= 40) return "text-orange-600 dark:text-orange-400";
    if (score >= 15) return "text-amber-600 dark:text-amber-400";
    return "text-emerald-600 dark:text-emerald-400";
}

export function SourceBreakdown({
    sources,
    indicator,
    kind,
}: {
    sources: SourceResult[];
    indicator: string;
    kind: Mode;
}) {
    const byRelevance = (a: SourceResult, b: SourceResult) =>
        relevanceRank(a) - relevanceRank(b) || (b.score ?? 0) - (a.score ?? 0);

    return (
        <div className="space-y-6">
            <div className="flex items-baseline justify-between border-b border-foreground/15 pb-2">
                <h2 className="font-mono text-[12px] font-semibold tracking-[0.16em] text-foreground/75 uppercase">
                    Source breakdown
                </h2>
                <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
                    {sources.length} sources
                </span>
            </div>
            {CATEGORY_ORDER.filter((cat) =>
                sources.some((s) => s.source.category === cat),
            ).map((cat) => {
                const group = sources
                    .filter((s) => s.source.category === cat)
                    .sort(byRelevance);
                return (
                    <div key={cat} className="space-y-3">
                        <div className="flex items-center gap-3">
                            <h3 className="font-mono text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                                {CATEGORY_LABEL[cat] ?? cat}
                            </h3>
                            <span className="font-mono text-[11px] tabular-nums text-muted-foreground/70">
                                {group.length.toString().padStart(2, "0")}
                            </span>
                            <div className="h-px flex-1 bg-border" />
                        </div>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            {group.map((s) => (
                                <SourceCard
                                    key={s.source.id}
                                    result={s}
                                    indicator={indicator}
                                    kind={kind}
                                />
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

export function ScoreChart({
    result,
    subject,
}: {
    result: ResultLike;
    subject: string;
}) {
    const scored = result.sources
        .filter((s) => s.status === "ok" && typeof s.score === "number")
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    if (scored.length === 0) return null;

    const explanation = scoreExplanation(result);

    const contextOnly = result.sources.filter(
        (s) => s.status === "ok" && typeof s.score !== "number",
    ).length;
    const notes = [
        contextOnly > 0 ? `${contextOnly} context-only` : "",
        result.stats.errored > 0 ? `${result.stats.errored} no response` : "",
        result.stats.rateLimited > 0
            ? `${result.stats.rateLimited} rate-limited`
            : "",
        result.stats.skipped > 0 ? `${result.stats.skipped} no key` : "",
    ].filter(Boolean);

    return (
        <Card className="sketch-shadow rounded-2xl border border-foreground/12">
            <CardContent className="space-y-4">
                <SectionHeading icon={BarChart3}>
                    How each source rates {subject}
                </SectionHeading>
                {explanation.length > 0 && (
                    <div className="space-y-1.5 rounded-lg border-2 border-dashed border-foreground/20 bg-muted/40 p-3">
                        <div className="font-hand text-base font-bold text-muted-foreground">
                            why this score
                        </div>
                        {explanation.map((line, i) => (
                            <p
                                key={i}
                                className="text-sm leading-relaxed text-foreground/85"
                            >
                                {line}
                            </p>
                        ))}
                    </div>
                )}
                <div className="space-y-2">
                    {scored.map((s) => {
                        const score = s.score ?? 0;
                        return (
                            <div
                                key={s.source.id}
                                className="grid grid-cols-[7.5rem_1fr_1.75rem] items-center gap-3 sm:grid-cols-[10rem_1fr_2rem]"
                            >
                                <span className="truncate text-xs text-muted-foreground">
                                    {s.source.name}
                                </span>
                                <div className="h-2.5 overflow-hidden rounded-sm bg-foreground/10">
                                    <div
                                        className={cn(
                                            "h-full rounded-sm transition-all duration-500",
                                            scoreBarColor(score),
                                        )}
                                        style={{
                                            width: `${Math.max(score, 1.5)}%`,
                                        }}
                                    />
                                </div>
                                <span className="text-right text-xs font-semibold tabular-nums">
                                    {score}
                                </span>
                            </div>
                        );
                    })}
                </div>
                {notes.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                        Plus {notes.join(", ")}.
                    </p>
                )}
            </CardContent>
        </Card>
    );
}

function SourceCard({
    result,
    indicator,
    kind,
}: {
    result: SourceResult;
    indicator: string;
    kind: Mode;
}) {
    const { source, status } = result;
    const skipped = status === "skipped";
    const errored = status === "error" || status === "timeout";
    const rateLimited = status === "rate_limited";
    const slow = result.durationMs >= SLOW_MS;
    const score = result.score;
    // Serialize the raw-details payload only once the disclosure is opened, so
    // the eager JSON.stringify doesn't run for every source on the result mount.
    const [detailsOpen, setDetailsOpen] = useState(false);
    const lookupUrl = sourceLookupUrl(source, indicator, kind);

    function openLookup() {
        window.open(lookupUrl, "_blank", "noopener,noreferrer");
    }

    const tone = sourceTone(result);
    const hasScore = !skipped && typeof score === "number";
    const seen = result.lastSeen ? formatDate(result.lastSeen) : null;

    return (
        <Card
            role="link"
            tabIndex={0}
            onClick={openLookup}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openLookup();
                }
            }}
            title={`Look up ${indicator} on ${source.name}`}
            className={cn(
                "relative h-full cursor-pointer gap-0 py-0 transition-colors",
                "hover:bg-accent/40 hover:ring-foreground/25",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                (skipped || rateLimited) && "opacity-70",
            )}
        >
            {/* Status rail — instant red/amber/green read across the whole grid. */}
            <span
                aria-hidden
                className={cn(
                    "absolute inset-y-0 left-0 w-[3px]",
                    TONE_RAIL[tone],
                )}
            />

            <CardContent className="flex h-full flex-col gap-3 py-3.5 pl-5">
                {/* Header: name + technical meta on the left, status pill aligned right. */}
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <a
                            href={lookupUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="group/name inline-flex items-center gap-1.5 text-[15px] font-semibold leading-tight tracking-tight hover:text-primary"
                        >
                            <span className="truncate">{source.name}</span>
                            <ExternalLink className="size-3 shrink-0 text-muted-foreground opacity-0 transition group-hover/name:opacity-100" />
                        </a>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase tabular-nums">
                            {result.durationMs > 0 && (
                                <span
                                    className={cn(
                                        slow &&
                                            "text-amber-600 dark:text-amber-400",
                                    )}
                                    title={
                                        slow
                                            ? "This source was slow to respond"
                                            : undefined
                                    }
                                >
                                    {result.durationMs} ms{slow ? " · slow" : ""}
                                </span>
                            )}
                            {result.durationMs > 0 && seen && (
                                <span className="text-muted-foreground/40">
                                    ·
                                </span>
                            )}
                            {seen && (
                                <span className="inline-flex items-center gap-1">
                                    <Clock className="size-3" />
                                    seen {seen}
                                </span>
                            )}
                        </div>
                    </div>
                    <StatusPill result={result} />
                </div>

                {/* Score readout — fixed-width label + number so every card aligns. */}
                {hasScore && (
                    <div className="flex items-center gap-2.5">
                        <span className="w-8 shrink-0 font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase">
                            risk
                        </span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-[2px] bg-foreground/10">
                            <div
                                className={cn(
                                    "h-full rounded-[2px] transition-all duration-500",
                                    scoreBarColor(score),
                                )}
                                style={{ width: `${Math.max(score, 1)}%` }}
                            />
                        </div>
                        <span
                            className={cn(
                                "w-7 shrink-0 text-right font-mono text-sm font-bold tabular-nums",
                                scoreTextColor(score),
                            )}
                        >
                            {score}
                        </span>
                    </div>
                )}

                {/* Summary grows so raw-details footers line up across a row. */}
                <div className="flex-1 space-y-2.5">
                    <p
                        className={cn(
                            "text-[13px] leading-relaxed",
                            errored
                                ? "text-destructive"
                                : "text-foreground/85",
                        )}
                    >
                        {errored
                            ? (result.error ?? "Lookup failed")
                            : (result.summary ??
                              (skipped
                                  ? source.keyEnv
                                      ? `Set ${source.keyEnv} to enable this source.`
                                      : "Disabled."
                                  : "No data."))}
                    </p>

                    {result.categories && result.categories.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                            {result.categories.slice(0, 8).map((c, i) => (
                                <Badge
                                    key={`${c}-${i}`}
                                    variant="outline"
                                    className="rounded-[3px] border-foreground/15 px-1.5 py-0 font-mono text-[10px] font-normal tracking-wide text-muted-foreground"
                                >
                                    {c}
                                </Badge>
                            ))}
                        </div>
                    )}
                </div>

                {result.details && Object.keys(result.details).length > 0 && (
                    <details
                        className="group/raw border-t border-foreground/10 pt-2.5"
                        onClick={(e) => e.stopPropagation()}
                        onToggle={(e) => setDetailsOpen(e.currentTarget.open)}
                    >
                        <summary className="inline-flex cursor-pointer items-center gap-1 font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase select-none hover:text-foreground">
                            <ChevronRight className="size-3 transition-transform group-open/raw:rotate-90" />
                            Raw details
                        </summary>
                        {detailsOpen && (
                            <pre className="mt-2 overflow-x-auto rounded-[4px] border border-foreground/10 bg-muted/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
                                {JSON.stringify(result.details, null, 2)}
                            </pre>
                        )}
                    </details>
                )}
            </CardContent>
        </Card>
    );
}

/** Shared chrome for every status chip: fixed height, mono, uppercase — so the
 *  pills form a tidy right-hand column down the grid. */
const PILL = "h-5 shrink-0 gap-1 rounded-[3px] border-transparent px-1.5 font-mono text-[10px] font-semibold tracking-[0.1em] uppercase [&>svg]:size-3";

function StatusPill({ result }: { result: SourceResult }) {
    const { status } = result;
    const score = result.score ?? 0;
    const flagged =
        status === "ok" && (result.malicious === true || score >= 40);

    if (flagged) {
        return (
            <Badge className={cn(PILL, "bg-red-500/12 text-red-600 dark:text-red-400")}>
                <TriangleAlert />
                Flagged
            </Badge>
        );
    }

    // A non-zero-but-sub-threshold score is a real (if weak) signal, so it gets
    // its own amber state instead of reading as a clean green pass.
    if (status === "ok" && score > 0) {
        return (
            <Badge className={cn(PILL, "bg-amber-500/15 text-amber-700 dark:text-amber-400")}>
                <ShieldAlert />
                Low risk
            </Badge>
        );
    }

    switch (status) {
        case "ok":
            return (
                <Badge className={cn(PILL, "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400")}>
                    <ShieldCheck />
                    Clean
                </Badge>
            );
        case "error":
        case "timeout":
            return (
                <Badge className={cn(PILL, "bg-destructive/12 text-destructive")}>
                    <CircleX />
                    {status === "timeout" ? "Timeout" : "Error"}
                </Badge>
            );
        case "rate_limited":
            return (
                <Badge className={cn(PILL, "bg-amber-500/15 text-amber-700 dark:text-amber-400")}>
                    <Gauge />
                    Rate limit
                </Badge>
            );
        default:
            // Skipped: distinguish "needs a key" (never ran) from "not applicable
            // for this indicator" (ran, but the source doesn't cover this type).
            return (
                <Badge
                    variant="outline"
                    className={cn(PILL, "border-foreground/20 text-muted-foreground")}
                >
                    {result.enabled ? "N/A" : "No key"}
                </Badge>
            );
    }
}
