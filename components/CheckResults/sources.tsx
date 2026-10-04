"use client";

import { memo, useState } from "react";
import { ChevronRight, ExternalLink } from "lucide-react";
import type { SourceMeta, SourceResult } from "@/lib/ti/types";
import { algoFromLength } from "@/lib/hash";
import { cn } from "@/lib/utils";
import { Tile } from "./frame";
import type { Mode } from "./types";

const CATEGORY_LABEL: Record<string, string> = {
    reputation: "Reputation",
    blocklist: "Blocklist",
    scanner: "Scanner",
    dnsbl: "DNSBL",
    context: "Context",
};

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
    let map = LOOKUP_URL;
    if (kind === "domain") map = DOMAIN_LOOKUP_URL;
    else if (kind === "hash") map = HASH_LOOKUP_URL;
    return map[source.id]?.(indicator) ?? source.url;
}

/**
 * Why a row has no summary of its own.
 *
 * A source that ran and found nothing, one turned off, and one waiting on a key
 * are three different states, and only the last is something the reader can act
 * on, so it names the variable to set.
 *
 * There is deliberately no "still waiting" reading. The breakdown only ever
 * has rows for sources that have settled, mid-stream included, so a row here
 * has always answered; a guard on the stream being open left an answered
 * source pulsing a skeleton until every other source was in, which said it was
 * still out when it was not.
 */
function noSummaryReason(skipped: boolean, keyEnv?: string): string {
    if (!skipped) return "No data";
    return keyEnv ? `Set ${keyEnv} to enable` : "Disabled";
}

/** One semantic state per source, driving the status dot and the verdict word. */
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

/** Ledger order: what moved the score first, then what answered clean, then
 *  what never answered. */
const TONE_RANK: Record<SourceTone, number> = {
    flagged: 0,
    low: 1,
    clean: 2,
    error: 3,
    limited: 3,
    skipped: 4,
};

/** The row's left edge is the only color in the breakdown (verdict-family).
 *  Sources that never contributed, skipped ones and context sources, which
 *  carry no weight and so cannot flag anything, leave the edge bare. */
const TONE_EDGE: Record<SourceTone, string> = {
    flagged: "bg-red-500",
    low: "bg-amber-500",
    clean: "bg-emerald-500",
    error: "bg-muted-foreground/40",
    limited: "bg-amber-500",
    skipped: "",
};

const TONE_LABEL: Record<SourceTone, string> = {
    flagged: "Flagged",
    low: "Low risk",
    clean: "Clear",
    error: "No response",
    limited: "Rate limited",
    skipped: "Skipped",
};

const HATCH = {
    backgroundImage:
        "repeating-linear-gradient(135deg, transparent 0 3px, var(--border) 3px 4px)",
};

/**
 * Where this source's score sits on the shared 0-100 axis.
 *
 * Every weighted source draws on the same track so the rows compare by eye
 * without reading a number. A source with no score to place, because it never
 * answered or because it is context and has no score at all, draws the track
 * hatched rather than with a mark at zero: a mark at zero is a measured clear,
 * and those must not look alike.
 */
function ScoreTrack({ score }: Readonly<{ score: number | null }>) {
    if (score === null)
        return <div aria-hidden className="h-2.5 w-full" style={HATCH} />;
    const pct = Math.max(0, Math.min(100, score));
    return (
        <div aria-hidden className="relative h-2.5 w-full border-x border-border">
            <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
            <div
                className="absolute top-0 h-2.5 w-[3px] bg-foreground"
                style={{ left: `calc(${pct}% - ${(pct / 100) * 3}px)` }}
            />
        </div>
    );
}

export const SourceBreakdown = memo(function SourceBreakdown({
    sources,
    indicator,
    kind,
    streaming = false,
}: Readonly<{
    sources: SourceResult[];
    indicator: string;
    kind: Mode;
    /** Set while the panel is still answering. `sources` is already the partial
     *  list in that case, and every row in it has answered, so the rows
     *  themselves need no change; this only marks the count as still
     *  growing. */
    streaming?: boolean;
}>) {
    const byRelevance = (a: SourceResult, b: SourceResult) =>
        TONE_RANK[sourceTone(a)] - TONE_RANK[sourceTone(b)] ||
        (b.score ?? 0) - (a.score ?? 0) ||
        b.source.weight - a.source.weight;

    // Split on weight, not category: a context source is one that cannot move
    // the score, and some of those (scanner identification) file under another
    // category.
    const weighted = sources.filter((s) => s.source.weight > 0).sort(byRelevance);
    const context = sources.filter((s) => s.source.weight === 0).sort(byRelevance);
    const flagged = weighted.filter((s) => sourceTone(s) === "flagged").length;

    return (
        <Tile
            span={12}
            id="sources"
            title="Source breakdown"
            note={
                <span className="flex items-center gap-1.5 tabular-nums">
                    {streaming && (
                        <span
                            aria-hidden
                            className="size-1.5 animate-pulse rounded-full bg-foreground/40"
                        />
                    )}
                    {flagged} of {weighted.length} flagged, {sources.length} answered
                </span>
            }
            className="overflow-x-auto p-0"
        >
            <table className="w-full min-w-[880px] border-collapse text-[13px]">
                <thead>
                    <tr className="border-b border-border text-left font-mono text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                        <th className="w-[3px] p-0" aria-label="Status" />
                        <th className="py-2 pr-3 pl-4 font-semibold">Source</th>
                        <th className="px-3 py-2 font-semibold">Class</th>
                        <th className="px-3 py-2 font-semibold">Verdict</th>
                        <th className="w-40 px-3 py-2 font-semibold">Score</th>
                        <th className="px-3 py-2 text-right font-semibold">Weight</th>
                        <th className="px-3 py-2 font-semibold">Finding</th>
                        <th className="w-6 p-0" aria-label="Raw details" />
                    </tr>
                </thead>
                <tbody>
                    {weighted.map((s) => (
                        <SourceRow
                            key={s.source.id}
                            result={s}
                            indicator={indicator}
                            kind={kind}
                        />
                    ))}
                </tbody>
                {context.length > 0 && (
                    <tbody>
                        <tr className="border-b border-border bg-muted/40">
                            <td
                                colSpan={8}
                                className="px-4 py-1.5 font-mono text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase"
                            >
                                Context, {context.length}, no weight in the score
                            </td>
                        </tr>
                        {context.map((s) => (
                            <SourceRow
                                key={s.source.id}
                                result={s}
                                indicator={indicator}
                                kind={kind}
                                isContext
                            />
                        ))}
                    </tbody>
                )}
            </table>
        </Tile>
    );
});

function SourceRow({
    result,
    indicator,
    kind,
    isContext = false,
}: Readonly<{
    result: SourceResult;
    indicator: string;
    kind: Mode;
    /** Weight 0: it answers with facts, never a verdict, so it gets no verdict
     *  word and no score mark. */
    isContext?: boolean;
}>) {
    const { source, status } = result;
    const skipped = status === "skipped";
    const errored = status === "error" || status === "timeout";
    const tone = sourceTone(result);
    // Serialize the raw-details payload only once the disclosure is opened, so
    // the eager JSON.stringify doesn't run for every source on the result mount.
    const [detailsOpen, setDetailsOpen] = useState(false);
    const lookupUrl = sourceLookupUrl(source, indicator, kind);
    const hasDetails =
        !!result.details && Object.keys(result.details).length > 0;

    const summary = errored
        ? (result.error ?? "Lookup failed")
        : (result.summary || noSummaryReason(skipped, source.keyEnv));
    const placed = !isContext && status === "ok";
    const showVerdict = !isContext || tone !== "clean";

    return (
        <>
            <tr
                className={cn(
                    "group/row border-b border-border transition-colors hover:bg-accent/40",
                    skipped && "opacity-60",
                )}
            >
                <td
                    title={isContext ? "Context" : TONE_LABEL[tone]}
                    className={cn(
                        "w-[3px] p-0",
                        !(isContext && tone === "clean") && TONE_EDGE[tone],
                    )}
                >
                    <span className="sr-only">
                        {isContext ? "Context" : TONE_LABEL[tone]}
                    </span>
                </td>
                <td className="py-1.5 pr-3 pl-4 font-medium whitespace-nowrap">
                    <a
                        href={lookupUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`Look up ${indicator} on ${source.name}`}
                        className="inline-flex items-center gap-1.5 tracking-tight underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
                    >
                        {source.name}
                        <ExternalLink className="size-3 text-muted-foreground/50 opacity-0 transition group-hover/row:opacity-100" />
                    </a>
                </td>
                <td className="px-3 py-1.5 font-mono text-[11px] tracking-[0.1em] whitespace-nowrap text-muted-foreground uppercase">
                    {CATEGORY_LABEL[source.category] ?? source.category}
                </td>
                <td className="px-3 py-1.5 font-mono text-[11px] font-semibold tracking-[0.08em] whitespace-nowrap uppercase">
                    {showVerdict ? (
                        TONE_LABEL[tone]
                    ) : (
                        <span className="sr-only">No verdict</span>
                    )}
                </td>
                <td className="px-3 py-1.5">
                    <ScoreTrack score={placed ? (result.score ?? 0) : null} />
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {isContext ? "0" : source.weight.toFixed(2)}
                </td>
                <td className="px-3 py-1.5 text-muted-foreground">{summary}</td>
                <td className="p-0">
                    {hasDetails && (
                        <button
                            type="button"
                            aria-label={
                                detailsOpen ? "Hide raw details" : "Show raw details"
                            }
                            aria-expanded={detailsOpen}
                            onClick={() => setDetailsOpen((o) => !o)}
                            className={cn(
                                "ml-auto flex h-8 w-6 items-center justify-center text-muted-foreground/40 transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none",
                                detailsOpen && "text-foreground",
                            )}
                        >
                            <ChevronRight
                                strokeWidth={1.5}
                                className={cn(
                                    "size-3 transition-transform",
                                    detailsOpen && "rotate-90",
                                )}
                            />
                        </button>
                    )}
                </td>
            </tr>
            {hasDetails && detailsOpen && (
                <tr className="border-b border-border">
                    <td colSpan={8} className="p-0">
                        <pre className="overflow-x-auto bg-muted/40 px-4 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
                            {JSON.stringify(result.details, null, 2)}
                        </pre>
                    </td>
                </tr>
            )}
        </>
    );
}
