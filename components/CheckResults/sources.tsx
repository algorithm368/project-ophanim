"use client";

import { memo, useState } from "react";
import { ChevronRight, ExternalLink } from "lucide-react";
import {
    sourceRowKey,
    type SourceMeta,
    type SourceResult,
} from "@/lib/ti/types";
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

function relevanceRank(s: SourceResult): number {
    const flagged =
        s.status === "ok" && (s.malicious === true || (s.score ?? 0) >= 40);
    if (flagged) return 0;
    if (s.status === "ok") return 1;
    if (s.status === "error" || s.status === "timeout") return 2;
    return 3;
}

/** One semantic state per source, driving the single status dot. */
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

/** The status dot is the only color in the breakdown (verdict-family). A hollow
 *  ring marks skipped/no-key sources that never contributed. */
const TONE_DOT: Record<SourceTone, string> = {
    flagged: "bg-red-500",
    low: "bg-amber-500",
    clean: "bg-emerald-500",
    error: "bg-muted-foreground/40",
    limited: "bg-amber-500",
    skipped: "border border-muted-foreground/40",
};

const TONE_LABEL: Record<SourceTone, string> = {
    flagged: "Flagged",
    low: "Low risk",
    clean: "Clean",
    error: "No response",
    limited: "Rate limited",
    skipped: "Skipped",
};

function StatusDot({ tone }: Readonly<{ tone: SourceTone }>) {
    return (
        <span
            title={TONE_LABEL[tone]}
            className={cn("size-2 shrink-0 rounded-full", TONE_DOT[tone])}
        />
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
        relevanceRank(a) - relevanceRank(b) || (b.score ?? 0) - (a.score ?? 0);

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
                    {sources.length} sources
                </span>
            }
            className="space-y-6 p-4"
        >
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
                        <div className="border-t border-foreground/12">
                            {group.map((s) => (
                                <SourceRow
                                    // Not the bare id: a URL check's domain
                                    // and IP layers can register the same
                                    // source id, and two rows sharing a React
                                    // key silently collapse to one (#48).
                                    key={sourceRowKey(s)}
                                    result={s}
                                    indicator={indicator}
                                    kind={kind}
                                />
                            ))}
                        </div>
                    </div>
                );
            })}
        </Tile>
    );
});

function SourceRow({
    result,
    indicator,
    kind,
}: Readonly<{
    result: SourceResult;
    indicator: string;
    kind: Mode;
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

    return (
        <div
            className={cn(
                "group/row border-b border-border last:border-0",
                skipped && "opacity-60",
            )}
        >
            <div className="flex items-center gap-2 pr-2">
                <a
                    href={lookupUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`Look up ${indicator} on ${source.name}`}
                    className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
                >
                    <StatusDot tone={tone} />
                    <span className="shrink-0 text-sm font-medium tracking-tight">
                        {source.name}
                    </span>
                    <span className="sr-only">{TONE_LABEL[tone]}.</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                        {summary}
                    </span>
                    <ExternalLink className="size-3.5 shrink-0 text-muted-foreground/50 opacity-0 transition group-hover/row:opacity-100" />
                </a>
                {hasDetails && (
                    <button
                        type="button"
                        aria-label={
                            detailsOpen ? "Hide raw details" : "Show raw details"
                        }
                        onClick={() => setDetailsOpen((o) => !o)}
                        className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
                    >
                        <ChevronRight
                            className={cn(
                                "size-3.5 transition-transform",
                                detailsOpen && "rotate-90",
                            )}
                        />
                    </button>
                )}
            </div>
            {hasDetails && detailsOpen && (
                <pre className="overflow-x-auto border-t border-border bg-muted/40 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
                    {JSON.stringify(result.details, null, 2)}
                </pre>
            )}
        </div>
    );
}
