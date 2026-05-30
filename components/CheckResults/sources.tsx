"use client";

import {
    BarChart3,
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
        <div className="space-y-5">
            <h2 className="px-1 text-sm font-medium text-muted-foreground">
                Source breakdown ({sources.length})
            </h2>
            {CATEGORY_ORDER.filter((cat) =>
                sources.some((s) => s.source.category === cat),
            ).map((cat) => {
                const group = sources
                    .filter((s) => s.source.category === cat)
                    .sort(byRelevance);
                return (
                    <div key={cat} className="space-y-3">
                        <div className="flex items-center gap-3 px-1">
                            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                                {CATEGORY_LABEL[cat] ?? cat}
                            </h3>
                            <span className="text-xs tabular-nums text-muted-foreground">
                                {group.length}
                            </span>
                            <div className="h-px flex-1 bg-border" />
                        </div>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
        <Card className="sketch-shadow rounded-[20px_28px_16px_24px/24px_16px_28px_20px] border-2 border-foreground/15">
            <CardContent className="space-y-4">
                <SectionHeading icon={BarChart3}>
                    How each source rates {subject}
                </SectionHeading>
                {explanation.length > 0 && (
                    <div className="space-y-1.5 rounded-[14px_18px_12px_16px/16px_12px_18px_14px] border-2 border-dashed border-foreground/20 bg-muted/40 p-3">
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
                                <div className="h-2.5 overflow-hidden rounded-full bg-foreground/10">
                                    <div
                                        className={cn(
                                            "h-full rounded-full transition-all duration-500",
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
    const lookupUrl = sourceLookupUrl(source, indicator, kind);

    function openLookup() {
        window.open(lookupUrl, "_blank", "noopener,noreferrer");
    }

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
                "cursor-pointer transition-all hover:ring-foreground/20",
                (skipped || rateLimited) && "opacity-65",
            )}
        >
            <CardContent className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <a
                            href={lookupUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="group inline-flex items-center gap-1 font-heading text-lg font-bold leading-tight hover:text-primary"
                        >
                            {source.name}
                            <ExternalLink className="size-3 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
                        </a>
                        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                            <Badge
                                variant="secondary"
                                className="px-1.5 font-normal"
                            >
                                {CATEGORY_LABEL[source.category] ??
                                    source.category}
                            </Badge>
                            {result.durationMs > 0 && (
                                <span
                                    className={cn(
                                        "tabular-nums",
                                        slow &&
                                            "text-amber-600 dark:text-amber-400",
                                    )}
                                    title={
                                        slow
                                            ? "This source was slow to respond"
                                            : undefined
                                    }
                                >
                                    {result.durationMs} ms
                                    {slow ? " · slow" : ""}
                                </span>
                            )}
                            {result.lastSeen && formatDate(result.lastSeen) && (
                                <span className="inline-flex items-center gap-1">
                                    <Clock className="size-3" />
                                    seen {formatDate(result.lastSeen)}
                                </span>
                            )}
                        </div>
                    </div>
                    <StatusPill result={result} />
                </div>

                {!skipped && typeof score === "number" && (
                    <div className="flex items-center gap-3">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-foreground/10">
                            <div
                                className={cn(
                                    "h-full rounded-full transition-all duration-500",
                                    scoreBarColor(score),
                                )}
                                style={{ width: `${Math.max(score, 1)}%` }}
                            />
                        </div>
                        <span className="w-9 text-right text-xs font-semibold tabular-nums text-muted-foreground">
                            {score}
                        </span>
                    </div>
                )}

                <p
                    className={cn(
                        "text-sm leading-relaxed",
                        errored ? "text-destructive" : "text-foreground/85",
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
                    <div className="flex flex-wrap gap-1.5">
                        {result.categories.slice(0, 8).map((c, i) => (
                            <Badge
                                key={`${c}-${i}`}
                                variant="outline"
                                className="font-normal"
                            >
                                {c}
                            </Badge>
                        ))}
                    </div>
                )}

                {result.details && Object.keys(result.details).length > 0 && (
                    <details
                        className="text-xs"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <summary className="flex cursor-pointer items-center gap-1 text-muted-foreground select-none hover:text-foreground">
                            <ExternalLink className="size-3" />
                            View raw details
                        </summary>
                        <pre className="mt-2 overflow-x-auto rounded-lg bg-muted/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
                            {JSON.stringify(result.details, null, 2)}
                        </pre>
                    </details>
                )}
            </CardContent>
        </Card>
    );
}

function StatusPill({ result }: { result: SourceResult }) {
    const { status } = result;
    const score = result.score ?? 0;
    const flagged =
        status === "ok" && (result.malicious === true || score >= 40);

    if (flagged) {
        return (
            <Badge className="gap-1 border-transparent bg-red-500/12 text-red-600 dark:text-red-400">
                <TriangleAlert className="size-3" />
                Flagged
            </Badge>
        );
    }

    // A non-zero-but-sub-threshold score is a real (if weak) signal, so it gets
    // its own amber state instead of reading as a clean green pass.
    if (status === "ok" && score > 0) {
        return (
            <Badge className="gap-1 border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400">
                <ShieldAlert className="size-3" />
                Low risk
            </Badge>
        );
    }

    switch (status) {
        case "ok":
            return (
                <Badge className="gap-1 border-transparent bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
                    <ShieldCheck className="size-3" />
                    Clean
                </Badge>
            );
        case "error":
        case "timeout":
            return (
                <Badge variant="destructive" className="gap-1">
                    <CircleX className="size-3" />
                    {status === "timeout" ? "Timeout" : "Error"}
                </Badge>
            );
        case "rate_limited":
            return (
                <Badge className="gap-1 border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400">
                    <Gauge className="size-3" />
                    Rate limited
                </Badge>
            );
        default:
            // Skipped: distinguish "needs a key" (never ran) from "not applicable
            // for this indicator" (ran, but the source doesn't cover this type).
            return (
                <Badge variant="outline">
                    {result.enabled ? "N/A" : "No key"}
                </Badge>
            );
    }
}
