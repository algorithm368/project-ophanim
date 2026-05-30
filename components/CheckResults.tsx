"use client";

import { createContext, useContext, useState, type ComponentType } from "react";
import {
    BarChart3,
    Binary,
    Bug,
    Building2,
    CalendarClock,
    Check,
    CircleX,
    Clock,
    Copy,
    Database,
    ExternalLink,
    FileDigit,
    FileText,
    Fingerprint,
    Gauge,
    Globe,
    HardDrive,
    History,
    Link2,
    Mail,
    MapPin,
    Navigation,
    Network,
    RefreshCw,
    Search,
    Server,
    ShieldAlert,
    ShieldCheck,
    ShieldQuestion,
    SignalHigh,
    Smartphone,
    Sparkles,
    Tag,
    TriangleAlert,
    Wifi,
} from "lucide-react";
import {
    isDomainResult,
    isHashResult,
    type CheckResult,
    type DomainCheckResult,
    type DomainContext,
    type GeoContext,
    type HashCheckResult,
    type HashContext,
    type HistorySnapshot,
    type SourceMeta,
    type SourceResult,
    type Verdict,
} from "@/lib/ti/types";
import { algoFromLength, HASH_ALGO_LABEL } from "@/lib/hash";
import { relationsFor } from "@/lib/relations";
import {
    aggregateCategories,
    buildDomainNarrative,
    buildHashNarrative,
    buildNarrative,
    consensusBuckets,
    formatBytes,
    formatDate,
    joinPlace,
    type ResultLike,
    scoreExplanation,
} from "@/lib/ti/narrative";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

type IconType = ComponentType<{ className?: string }>;

type Mode = "ip" | "domain" | "hash";

/**
 * Lets nested result fields launch a fresh check for a related indicator,
 * turning isolated lookups into a connected web (an IP's reverse DNS, a
 * domain's resolved IPs / nameservers / mail hosts, etc.).
 */
const PivotContext = createContext<((value: string) => void) | null>(null);

/** A related indicator rendered as a one-click pivot into its own check.
 *  Falls back to plain text when no pivot handler is provided. */
function Pivot({ value, label }: { value: string; label?: string }) {
    const pivot = useContext(PivotContext);
    const text = label ?? value;
    if (!pivot) return <span className="font-mono text-[13px]">{text}</span>;
    return (
        <button
            type="button"
            onClick={() => pivot(value)}
            title={`Check ${value}`}
            className="group inline-flex max-w-full items-center gap-1 rounded-[8px_11px_7px_10px/10px_7px_11px_8px] border border-dashed border-foreground/30 bg-background/60 px-1.5 py-0.5 align-middle font-mono text-[12px] text-foreground transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary"
        >
            <span className="truncate">{text}</span>
            <Search className="size-3 shrink-0 opacity-40 transition-opacity group-hover:opacity-100" />
        </button>
    );
}

/** Wrapping list of pivotable indicators with a "+N more" overflow note. */
function PivotList({ values, max = 4 }: { values: string[]; max?: number }) {
    const shown = values.slice(0, max);
    const extra = values.length - shown.length;
    return (
        <div className="flex flex-wrap gap-1.5">
            {shown.map((v) => (
                <Pivot key={v} value={v} />
            ))}
            {extra > 0 && (
                <span className="self-center text-[12px] text-muted-foreground">
                    +{extra} more
                </span>
            )}
        </div>
    );
}

type VerdictStyle = {
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

const VERDICT_STYLE: Record<Verdict, VerdictStyle> = {
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

function scoreBarColor(score: number): string {
    if (score >= 70) return "bg-red-500";
    if (score >= 40) return "bg-orange-500";
    if (score >= 15) return "bg-amber-500";
    return "bg-emerald-500";
}

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

/** Classify what kind of address this is, from ip-api context flags. */
function classifyType(geo?: GeoContext): {
    label: string;
    desc: string;
    icon: IconType;
} {
    if (!geo) {
        return {
            label: "Unknown type",
            desc: "No network classification available.",
            icon: ShieldQuestion,
        };
    }
    if (geo.isProxy) {
        return {
            label: "Anonymizer",
            desc: "Proxy, VPN, or Tor; the real user is hidden.",
            icon: ShieldAlert,
        };
    }
    if (geo.isHosting) {
        return {
            label: "Hosting / Datacenter",
            desc: "Server or cloud infrastructure, not a home user.",
            icon: Server,
        };
    }
    if (geo.isMobile) {
        return {
            label: "Mobile network",
            desc: "A mobile carrier (cellular) address.",
            icon: Smartphone,
        };
    }
    return {
        label: "Residential / Other",
        desc: "Likely a home or business end-user network.",
        icon: Network,
    };
}

/** Classify a domain from its registration age + whether it resolves. */
function classifyDomain(
    ctx?: DomainContext,
    resolves?: boolean,
): { label: string; desc: string; icon: IconType } {
    if (ctx?.ageDays !== undefined && ctx.ageDays < 30) {
        return {
            label: "Newly registered",
            desc: `Created ${ctx.ageDays} day(s) ago; young domains skew higher-risk.`,
            icon: Sparkles,
        };
    }
    if (resolves === false) {
        return {
            label: "Inactive / parked",
            desc: "Doesn't currently resolve to an address.",
            icon: ShieldQuestion,
        };
    }
    if (ctx?.ageDays !== undefined) {
        const years = Math.floor(ctx.ageDays / 365);
        return {
            label: "Established",
            desc:
                years >= 1
                    ? `Registered ${years}+ year(s) ago.`
                    : "Registered under a year ago.",
            icon: ShieldCheck,
        };
    }
    return {
        label: "Domain",
        desc: "Registration age unknown.",
        icon: Globe,
    };
}

/** Classify a file from its known malware family / file type, or lack thereof. */
function classifyHash(
    ctx: HashContext | undefined,
    hasData: boolean,
): { label: string; desc: string; icon: IconType } {
    if (ctx?.malwareFamily) {
        return {
            label: ctx.malwareFamily,
            desc: `Identified as ${ctx.malwareFamily}${
                ctx.fileType ? ` (${ctx.fileType})` : ""
            }.`,
            icon: Bug,
        };
    }
    if (ctx?.fileType) {
        return {
            label: ctx.fileType,
            desc: ctx.fileName
                ? `Seen as "${ctx.fileName}".`
                : "Known file, no malware family attributed.",
            icon: FileText,
        };
    }
    if (!hasData) {
        return {
            label: "Unknown file",
            desc: "No threat-intel source has this file on record.",
            icon: FileDigit,
        };
    }
    return {
        label: "File",
        desc: "No file metadata was returned.",
        icon: FileDigit,
    };
}


function SourceBreakdown({
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

/**
 * Warn when a lookup ran but couldn't gather any intelligence (every
 * source that attempted a request failed. Without this the verdict reads
 * "inconclusive/clean" and looks like a real result rather than an outage.
 */
function SourceHealthNotice({ result }: { result: ResultLike }) {
    const okCount = result.sources.filter((s) => s.status === "ok").length;
    if (okCount > 0 || result.stats.queried === 0) return null;

    return (
        <div className="sketch-shadow flex items-start gap-3 rounded-[16px_22px_14px_20px/20px_14px_22px_16px] border-2 border-orange-500/40 bg-orange-500/10 px-4 py-3 text-orange-700 dark:text-orange-300">
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

function Results({
    result,
    onRefresh,
}: {
    result: CheckResult;
    onRefresh: () => void;
}) {
    return (
        <div className="mt-5 space-y-6 duration-500 animate-in fade-in slide-in-from-bottom-2">
            <SourceHealthNotice result={result} />
            <VerdictHero result={result} onRefresh={onRefresh} />
            <div className="grid grid-cols-1 gap-6">
                <ProfileCard result={result} />
                <ActivityCard result={result} noun="address" />
            </div>
            <ExposedServicesCard result={result} />
            <HistoryCard result={result} />
            <ConnectionsCard result={result} />
            <ScoreChart result={result} subject="this IP" />
            <SourceBreakdown
                sources={result.sources}
                indicator={result.ip}
                kind="ip"
            />
        </div>
    );
}

function DomainResults({
    result,
    onRefresh,
}: {
    result: DomainCheckResult;
    onRefresh: () => void;
}) {
    return (
        <div className="mt-5 space-y-6 duration-500 animate-in fade-in slide-in-from-bottom-2">
            <SourceHealthNotice result={result} />
            <DomainVerdictHero result={result} onRefresh={onRefresh} />
            <div className="grid grid-cols-1 gap-6">
                <DomainProfileCard result={result} />
                <ActivityCard result={result} noun="domain" />
            </div>
            <HistoryCard result={result} />
            <ConnectionsCard result={result} />
            <ScoreChart result={result} subject="this domain" />
            <SourceBreakdown
                sources={result.sources}
                indicator={result.domain}
                kind="domain"
            />
        </div>
    );
}

function HashResults({
    result,
    onRefresh,
}: {
    result: HashCheckResult;
    onRefresh: () => void;
}) {
    return (
        <div className="mt-5 space-y-6 duration-500 animate-in fade-in slide-in-from-bottom-2">
            <SourceHealthNotice result={result} />
            <HashVerdictHero result={result} onRefresh={onRefresh} />
            <div className="grid grid-cols-1 gap-6">
                <HashProfileCard result={result} />
                <ActivityCard result={result} noun="file" />
            </div>
            <HistoryCard result={result} />
            <ConnectionsCard result={result} />
            <ScoreChart result={result} subject="this file" />
            <SourceBreakdown
                sources={result.sources}
                indicator={result.hash}
                kind="hash"
            />
        </div>
    );
}

function ScoreChart({
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

function relevanceRank(s: SourceResult): number {
    const flagged =
        s.status === "ok" && (s.malicious === true || (s.score ?? 0) >= 40);
    if (flagged) return 0;
    if (s.status === "ok") return 1;
    if (s.status === "error" || s.status === "timeout") return 2;
    return 3;
}

function ScoreRing({ value, stroke }: { value: number; stroke: string }) {
    const radius = 50;
    const circumference = 2 * Math.PI * radius;
    const clamped = Math.max(0, Math.min(100, value));
    const offset = circumference - (clamped / 100) * circumference;
    return (
        <svg viewBox="0 0 120 120" className="size-full">
            <defs>
                {/* roughen strokes so the gauge looks hand-drawn */}
                <filter id="sketch-ring">
                    <feTurbulence
                        type="turbulence"
                        baseFrequency="0.02"
                        numOctaves="1"
                        seed="7"
                        result="noise"
                    />
                    <feDisplacementMap
                        in="SourceGraphic"
                        in2="noise"
                        scale="1.2"
                    />
                </filter>
            </defs>
            {/* dashed hand-drawn track */}
            <circle
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray="1 7"
                filter="url(#sketch-ring)"
                className="stroke-foreground/25"
            />
            {/* scribbled progress arc */}
            <g transform="rotate(-90 60 60)" filter="url(#sketch-ring)">
                <circle
                    cx="60"
                    cy="60"
                    r={radius}
                    fill="none"
                    strokeWidth="12"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                    className={cn(
                        "transition-[stroke-dashoffset] duration-700 ease-out",
                        stroke,
                    )}
                />
            </g>
        </svg>
    );
}

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

function VerdictHero({
    result,
    onRefresh,
}: {
    result: CheckResult;
    onRefresh: () => void;
}) {
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

function DomainVerdictHero({
    result,
    onRefresh,
}: {
    result: DomainCheckResult;
    onRefresh: () => void;
}) {
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

function HashVerdictHero({
    result,
    onRefresh,
}: {
    result: HashCheckResult;
    onRefresh: () => void;
}) {
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
        { key: "flagged", count: c.flagged, color: "bg-red-500", label: "Flagged", inLegend: true },
        { key: "clean", count: c.clean, color: "bg-emerald-500", label: "Clean", inLegend: true },
        { key: "errored", count: c.errored, color: "bg-orange-400", label: "Error", inLegend: true },
        { key: "rate", count: c.rateLimited, color: "bg-amber-400", label: "Rate limited", inLegend: false },
        { key: "skipped", count: c.skipped, color: "bg-muted-foreground/30", label: "No key", inLegend: true },
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
                    <span className="font-mono">{c.total}</span>{" "}
                    responded
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

/** Copy text to the clipboard, falling back for non-secure contexts (e.g.
 *  reaching the dev server over http://<LAN-IP>) where the async Clipboard API
 *  is unavailable. Returns whether the copy succeeded. */
async function copyToClipboard(value: string): Promise<boolean> {
    if (!value) return false;
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(value);
            return true;
        }
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return ok;
    } catch {
        return false;
    }
}

/** Clipboard copy state: a `copied` flag that flashes true for 1.5s per copy. */
function useCopied(): [boolean, (value: string) => Promise<void>] {
    const [copied, setCopied] = useState(false);
    async function copy(value: string) {
        if (await copyToClipboard(value)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        }
    }
    return [copied, copy];
}

function CopyableSummary({ text }: { text: string }) {
    const [copied, copy] = useCopied();

    return (
        <div className="space-y-1.5">
            <p className="font-sans text-[0.95rem] leading-relaxed text-foreground/85">
                {text}
            </p>
            <div className="-ml-1.5 flex flex-wrap items-center gap-1">
                <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    aria-label="Copy summary"
                    className="font-hand gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                    onClick={() => copy(text)}
                >
                    {copied ? (
                        <>
                            <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                            Copied
                        </>
                    ) : (
                        <>
                            <Copy className="size-3.5" />
                            Copy summary
                        </>
                    )}
                </Button>
            </div>
        </div>
    );
}

function SectionHeading({
    icon: Icon,
    children,
}: {
    icon: IconType;
    children: React.ReactNode;
}) {
    return (
        <h2 className="flex items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px_14px_8px_12px/12px_8px_14px_10px] border-2 border-foreground/20 bg-background text-primary">
                <Icon className="size-4" />
            </span>
            <span className="font-hand text-2xl font-bold leading-none">
                {children}
            </span>
        </h2>
    );
}

function Field({
    icon: Icon,
    label,
    children,
    wrap = false,
}: {
    icon: IconType;
    label: string;
    children: React.ReactNode;
    /** Allow multi-line / wrapping content (e.g. pivot chips) instead of truncating. */
    wrap?: boolean;
}) {
    return (
        <div className="flex items-start gap-2.5 rounded-[12px_16px_10px_14px/14px_10px_16px_12px] border border-foreground/10 bg-muted/40 p-2.5">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-[8px_11px_7px_10px/10px_7px_11px_8px] bg-background text-muted-foreground ring-1 ring-foreground/10">
                <Icon className="size-3.5" />
            </span>
            <div className="min-w-0">
                <dt className="font-hand text-sm leading-tight text-muted-foreground">
                    {label}
                </dt>
                <dd
                    className={cn(
                        "text-sm font-medium text-foreground",
                        !wrap && "truncate",
                    )}
                >
                    {children}
                </dd>
            </div>
        </div>
    );
}

/**
 * ISO 3166-1 alpha-2 country code -> flag image URL. We use real images rather
 * than emoji flags because Windows doesn't render regional-indicator emoji as
 * flags (it shows the two letters instead).
 */
function flagUrl(cc?: string): string | undefined {
    if (!cc || !/^[a-zA-Z]{2}$/.test(cc)) return undefined;
    return `https://flagcdn.com/${cc.toLowerCase()}.svg`;
}

/** A playful one-liner about where this IP supposedly lives. */
function locationQuip(geo?: GeoContext): string {
    if (!geo) return "Pulled a vanishing act. No location, no paper trail.";
    if (geo.isProxy)
        return "Sneaky. It threw on a disguise to hide where it really lives.";
    if (geo.isHosting) return "Lives in a server rack, not on anyone's couch.";
    if (geo.isMobile) return "Probably doomscrolling on the bus right now.";
    return "Looks like an ordinary home address. Allegedly.";
}

function ProfileCard({ result }: { result: CheckResult }) {
    const geo = result.geo;
    const type = classifyType(geo);
    const TypeIcon = type.icon;
    const cityRegion = geo ? joinPlace([geo.city, geo.region]) : "";
    const flag = flagUrl(geo?.countryCode);
    const coords =
        typeof geo?.lat === "number" && typeof geo?.lon === "number"
            ? `${geo.lat.toFixed(4)}, ${geo.lon.toFixed(4)}`
            : undefined;

    // Stamp tint keyed to the dominant trait, for the diagonal passport stamp.
    const accent = geo?.isProxy
        ? "text-orange-600 dark:text-orange-400 border-orange-500/50"
        : geo?.isMobile
          ? "text-sky-600 dark:text-sky-400 border-sky-500/50"
          : geo?.isHosting
            ? "text-foreground/70 border-foreground/40"
            : "text-emerald-600 dark:text-emerald-400 border-emerald-500/50";

    const traits = geo
        ? ([
              geo.isProxy && {
                  icon: ShieldAlert,
                  label: "Proxy / VPN / Tor",
                  tone: "text-orange-600 dark:text-orange-400",
              },
              geo.isHosting && {
                  icon: Server,
                  label: "Hosting / Datacenter",
                  tone: "text-foreground/80",
              },
              geo.isMobile && {
                  icon: Smartphone,
                  label: "Mobile network",
                  tone: "text-sky-600 dark:text-sky-400",
              },
              !geo.isProxy &&
                  !geo.isHosting &&
                  !geo.isMobile && {
                      icon: Network,
                      label: "Residential / Other",
                      tone: "text-emerald-600 dark:text-emerald-400",
                  },
          ].filter(Boolean) as {
              icon: IconType;
              label: string;
              tone: string;
          }[])
        : [];

    const hasDetails = !!(
        geo &&
        (geo.asn || geo.asnOrg || geo.isp || geo.org || geo.reverse || coords)
    );

    return (
        <Card className="sketch-shadow rounded-[20px_28px_16px_24px/24px_16px_28px_20px] border-2 border-foreground/15">
            <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <SectionHeading icon={Globe}>
                        Where it&apos;s from
                    </SectionHeading>
                    <code className="rounded-[8px_11px_7px_10px/10px_7px_11px_8px] border-2 border-dashed border-foreground/25 bg-muted/60 px-2.5 py-1 font-mono text-xs font-semibold tracking-tight">
                        {result.ip}
                    </code>
                </div>

                {/* Passport-style hero: tilted flag, diagonal type stamp, a wisecrack. */}
                <div className="relative overflow-hidden rounded-[18px_26px_16px_22px/22px_16px_26px_18px] border-2 border-foreground/25 bg-muted/40 p-4 sketch-shadow">
                    <div
                        aria-hidden
                        className="pointer-events-none absolute inset-0 opacity-30 bg-[repeating-linear-gradient(45deg,color-mix(in_oklch,var(--foreground)_4%,transparent)_0,color-mix(in_oklch,var(--foreground)_4%,transparent)_10px,transparent_10px,transparent_20px)]"
                    />

                    <div
                        className={cn(
                            "font-hand pointer-events-none absolute top-3 right-2 hidden -rotate-12 items-center gap-1.5 rounded-[10px_14px_8px_12px/12px_8px_14px_10px] border-[2.5px] border-dashed bg-background/70 px-2.5 py-1 text-base font-bold tracking-wide uppercase sm:flex",
                            accent,
                        )}
                    >
                        <TypeIcon className="size-4" />
                        {type.label}
                    </div>

                    <div className="relative flex items-center gap-4">
                        {flag ? (
                            // eslint-disable-next-line @next/next/no-img-element -- tiny external flag asset; next/image is overkill here
                            <img
                                src={flag}
                                alt={`Flag of ${geo?.country ?? geo?.countryCode}`}
                                width={80}
                                height={60}
                                loading="lazy"
                                className="sketch-shadow h-14 w-auto shrink-0 -rotate-6 rounded-[6px_9px_5px_8px/8px_5px_9px_6px] border-2 border-foreground/30 object-cover"
                            />
                        ) : (
                            <MapPin className="size-14 shrink-0 -rotate-6 text-primary" />
                        )}
                        <div className="min-w-0 flex-1 sm:pr-28">
                            <div className="font-hand text-sm text-muted-foreground">
                                reporting live from...
                            </div>
                            <div className="font-hand text-3xl font-bold leading-tight">
                                {geo?.country ?? "Parts unknown"}
                                {geo?.countryCode && (
                                    <span className="ml-1.5 text-lg font-normal text-muted-foreground">
                                        ({geo.countryCode})
                                    </span>
                                )}
                            </div>
                            {cityRegion && (
                                <div className="truncate text-sm text-muted-foreground">
                                    {cityRegion}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="relative mt-3 rounded-[12px_16px_10px_14px/14px_10px_16px_12px] border-2 border-dashed border-foreground/20 bg-background/70 px-3 py-2">
                        <p className="font-hand text-lg leading-snug text-foreground/80">
                            &ldquo;{locationQuip(geo)}&rdquo;
                        </p>
                    </div>
                </div>

                {traits.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                        {traits.map((t) => {
                            const TIcon = t.icon;
                            return (
                                <span
                                    key={t.label}
                                    className={cn(
                                        "font-hand sketch-shadow inline-flex items-center gap-1.5 rounded-[10px_14px_8px_12px/12px_8px_14px_10px] border-2 border-foreground/20 bg-background px-2.5 py-1 text-base font-semibold",
                                        t.tone,
                                    )}
                                >
                                    <TIcon className="size-4" />
                                    {t.label}
                                </span>
                            );
                        })}
                    </div>
                )}

                {/* The boring-but-important bits. */}
                {hasDetails && (
                    <div className="space-y-3">
                        <div className="font-hand text-base font-bold text-muted-foreground">
                            the nerdy details
                        </div>
                        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                            {geo!.asn && (
                                <Field icon={Network} label="Network (ASN)">
                                    <span className="font-mono text-[13px]">
                                        {geo!.asn}
                                    </span>
                                </Field>
                            )}
                            {geo!.asnOrg && (
                                <Field icon={Building2} label="ASN operator">
                                    {geo!.asnOrg}
                                </Field>
                            )}
                            {geo!.isp && (
                                <Field icon={Wifi} label="ISP">
                                    {geo!.isp}
                                </Field>
                            )}
                            {geo!.org && (
                                <Field icon={Server} label="Organization">
                                    {geo!.org}
                                </Field>
                            )}
                            {geo!.reverse && (
                                <Field
                                    icon={SignalHigh}
                                    label="Reverse DNS"
                                    wrap
                                >
                                    <Pivot value={geo!.reverse} />
                                </Field>
                            )}
                            {coords && (
                                <Field icon={Navigation} label="Coordinates">
                                    <span className="font-mono text-[13px]">
                                        {coords}
                                    </span>
                                </Field>
                            )}
                        </dl>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

/** Avatar emoji + passport stamp + wisecrack, keyed to domain maturity. */
function domainVibe(label: string): {
    avatar: string;
    stamp: string;
    tone: string;
    quip: string;
} {
    switch (label) {
        case "Newly registered":
            return {
                avatar: "🌱",
                stamp: "Fresh!",
                tone: "text-orange-600 dark:text-orange-400 border-orange-500/50",
                quip: "Practically still in the shrink-wrap. Brand-new domains love to misbehave.",
            };
        case "Established":
            return {
                avatar: "🌳",
                stamp: "Veteran",
                tone: "text-emerald-600 dark:text-emerald-400 border-emerald-500/50",
                quip: "Been around the block. Old enough to know better.",
            };
        case "Inactive / parked":
            return {
                avatar: "🚧",
                stamp: "Parked",
                tone: "text-foreground/70 border-foreground/40",
                quip: "Nobody's home. It doesn't even resolve.",
            };
        default:
            return {
                avatar: "🌐",
                stamp: "Domain",
                tone: "text-sky-600 dark:text-sky-400 border-sky-500/50",
                quip: "A domain doing ordinary domain things.",
            };
    }
}

function DomainProfileCard({ result }: { result: DomainCheckResult }) {
    const ctx = result.context;
    const resolves =
        (ctx?.resolvedIps?.length ?? 0) > 0 || (ctx?.ipv6?.length ?? 0) > 0;
    const type = classifyDomain(ctx, resolves);
    const TypeIcon = type.icon;
    const vibe = domainVibe(type.label);

    const created = formatDate(ctx?.createdAt);
    const expires = formatDate(ctx?.expiresAt);
    const age =
        ctx?.ageDays !== undefined
            ? ctx.ageDays < 365
                ? `${ctx.ageDays} days`
                : `${Math.floor(ctx.ageDays / 365)} yr ${ctx.ageDays % 365} d`
            : undefined;
    const ips = ctx?.resolvedIps ?? [];
    const ns = ctx?.nameservers ?? [];
    const mx = ctx?.mx ?? [];

    return (
        <Card className="sketch-shadow rounded-[20px_28px_16px_24px/24px_16px_28px_20px] border-2 border-foreground/15">
            <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <SectionHeading icon={Globe}>
                        Registration &amp; DNS
                    </SectionHeading>
                    <code className="rounded-[8px_11px_7px_10px/10px_7px_11px_8px] border-2 border-dashed border-foreground/25 bg-muted/60 px-2.5 py-1 font-mono text-xs font-semibold tracking-tight">
                        {result.domain}
                    </code>
                </div>

                {/* Passport-style hero: avatar, maturity stamp, a wisecrack. */}
                <div className="relative overflow-hidden rounded-[18px_26px_16px_22px/22px_16px_26px_18px] border-2 border-foreground/25 bg-muted/40 p-4 sketch-shadow">
                    <div
                        aria-hidden
                        className="pointer-events-none absolute inset-0 opacity-30 bg-[repeating-linear-gradient(45deg,color-mix(in_oklch,var(--foreground)_4%,transparent)_0,color-mix(in_oklch,var(--foreground)_4%,transparent)_10px,transparent_10px,transparent_20px)]"
                    />

                    <div
                        className={cn(
                            "font-hand pointer-events-none absolute top-3 right-2 hidden -rotate-12 items-center gap-1.5 rounded-[10px_14px_8px_12px/12px_8px_14px_10px] border-[2.5px] border-dashed bg-background/70 px-2.5 py-1 text-base font-bold tracking-wide uppercase sm:flex",
                            vibe.tone,
                        )}
                    >
                        <TypeIcon className="size-4" />
                        {vibe.stamp}
                    </div>

                    <div className="relative flex items-center gap-4">
                        <span className="-rotate-6 text-7xl leading-none drop-shadow-sm">
                            {vibe.avatar}
                        </span>
                        <div className="min-w-0 flex-1 sm:pr-28">
                            <div className="font-hand text-sm text-muted-foreground">
                                pulled from the records...
                            </div>
                            <div className="font-hand text-3xl font-bold leading-tight">
                                {type.label}
                            </div>
                            <div className="text-sm text-muted-foreground">
                                {type.desc}
                            </div>
                        </div>
                    </div>

                    <div className="relative mt-3 rounded-[12px_16px_10px_14px/14px_10px_16px_12px] border-2 border-dashed border-foreground/20 bg-background/70 px-3 py-2">
                        <p className="font-hand text-lg leading-snug text-foreground/80">
                            &ldquo;{vibe.quip}&rdquo;
                        </p>
                    </div>
                </div>

                {ctx && (
                    <div className="flex flex-wrap gap-2">
                        <span
                            className={cn(
                                "font-hand sketch-shadow inline-flex items-center gap-1.5 rounded-[10px_14px_8px_12px/12px_8px_14px_10px] border-2 border-foreground/20 bg-background px-2.5 py-1 text-base font-semibold",
                                resolves
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : "text-orange-600 dark:text-orange-400",
                            )}
                        >
                            {resolves ? (
                                <ShieldCheck className="size-4" />
                            ) : (
                                <ShieldQuestion className="size-4" />
                            )}
                            {resolves ? "resolves" : "no DNS"}
                        </span>
                        {(ctx.statuses ?? []).slice(0, 6).map((s) => (
                            <span
                                key={s}
                                className="font-hand sketch-shadow inline-flex items-center gap-1.5 rounded-[10px_14px_8px_12px/12px_8px_14px_10px] border-2 border-foreground/20 bg-background px-2.5 py-1 text-base font-semibold text-foreground/80"
                            >
                                {s}
                            </span>
                        ))}
                    </div>
                )}

                {/* The boring-but-important bits. */}
                {ctx ? (
                    <div className="space-y-3">
                        <div className="font-hand text-base font-bold text-muted-foreground">
                            the nerdy details
                        </div>
                        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                            {ctx.categories && ctx.categories.length > 0 && (
                                <Field icon={Tag} label="Category">
                                    {ctx.categories.slice(0, 3).join(", ")}
                                </Field>
                            )}
                            {ctx.registrar && (
                                <Field icon={Building2} label="Registrar">
                                    {ctx.registrar}
                                </Field>
                            )}
                            {created && (
                                <Field icon={CalendarClock} label="Registered">
                                    {created}
                                    {age ? ` · ${age} old` : ""}
                                </Field>
                            )}
                            {expires && (
                                <Field icon={History} label="Expires">
                                    {expires}
                                </Field>
                            )}
                            {ips.length > 0 && (
                                <Field icon={Link2} label="Resolves to" wrap>
                                    <PivotList values={ips} />
                                </Field>
                            )}
                            {ns.length > 0 && (
                                <Field icon={Server} label="Nameservers" wrap>
                                    <PivotList values={ns} />
                                </Field>
                            )}
                            {mx.length > 0 && (
                                <Field icon={Mail} label="Mail (MX)" wrap>
                                    <PivotList values={mx} />
                                </Field>
                            )}
                        </dl>
                    </div>
                ) : (
                    <p className="text-sm text-muted-foreground">
                        No registration or DNS context was returned for this
                        domain.
                    </p>
                )}
            </CardContent>
        </Card>
    );
}

function CopyHashButton({ value }: { value: string }) {
    const [copied, copy] = useCopied();
    return (
        <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-label="Copy hash"
            className="ml-auto size-6 shrink-0 p-0 text-muted-foreground hover:text-foreground"
            onClick={() => copy(value)}
        >
            {copied ? (
                <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
            ) : (
                <Copy className="size-3.5" />
            )}
        </Button>
    );
}

/** Avatar emoji + passport stamp + wisecrack, keyed to what the file is. */
function hashVibe(
    ctx: HashContext | undefined,
    hasData: boolean,
): { avatar: string; stamp: string; tone: string; quip: string } {
    if (ctx?.malwareFamily || ctx?.threatLabel) {
        return {
            avatar: "🦠",
            stamp: "Malware",
            tone: "text-red-600 dark:text-red-400 border-red-500/50",
            quip: "Caught red-handed. This one's a known troublemaker.",
        };
    }
    if (ctx) {
        return {
            avatar: "📄",
            stamp: "Known",
            tone: "text-sky-600 dark:text-sky-400 border-sky-500/50",
            quip: "Seen this one before. Nothing scandalous on the record.",
        };
    }
    if (hasData) {
        return {
            avatar: "📄",
            stamp: "On file",
            tone: "text-foreground/70 border-foreground/40",
            quip: "On the books, but travelling light. Barely any details.",
        };
    }
    return {
        avatar: "👻",
        stamp: "Unseen",
        tone: "text-foreground/70 border-foreground/40",
        quip: "A total stranger. Never spotted in the wild, which isn't a clean bill of health.",
    };
}

function HashProfileCard({ result }: { result: HashCheckResult }) {
    const ctx = result.context;
    const hasData = result.sources.some(
        (s) => s.status === "ok" && s.score !== undefined,
    );
    const type = classifyHash(ctx, hasData);
    const TypeIcon = type.icon;
    const vibe = hashVibe(ctx, hasData);

    const size = formatBytes(ctx?.fileSize);
    const firstSeen = formatDate(ctx?.firstSeen);
    const lastSeen = formatDate(ctx?.lastSeen);
    const altNames = (ctx?.fileNames ?? []).filter((n) => n !== ctx?.fileName);

    // Known digests, falling back to just the hash the user queried.
    const digests = [
        ctx?.md5 ? { label: "MD5", value: ctx.md5 } : null,
        ctx?.sha1 ? { label: "SHA-1", value: ctx.sha1 } : null,
        ctx?.sha256 ? { label: "SHA-256", value: ctx.sha256 } : null,
    ].filter(Boolean) as { label: string; value: string }[];
    if (digests.length === 0) {
        digests.push({
            label: HASH_ALGO_LABEL[result.algorithm],
            value: result.hash,
        });
    }

    return (
        <Card className="sketch-shadow rounded-[20px_28px_16px_24px/24px_16px_28px_20px] border-2 border-foreground/15">
            <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <SectionHeading icon={FileDigit}>
                        What this file is
                    </SectionHeading>
                    <code className="rounded-[8px_11px_7px_10px/10px_7px_11px_8px] border-2 border-dashed border-foreground/25 bg-muted/60 px-2.5 py-1 font-mono text-xs font-semibold tracking-tight">
                        {HASH_ALGO_LABEL[result.algorithm]}
                    </code>
                </div>

                {/* Passport-style hero: avatar, verdict stamp, a wisecrack. */}
                <div className="relative overflow-hidden rounded-[18px_26px_16px_22px/22px_16px_26px_18px] border-2 border-foreground/25 bg-muted/40 p-4 sketch-shadow">
                    <div
                        aria-hidden
                        className="pointer-events-none absolute inset-0 opacity-30 bg-[repeating-linear-gradient(45deg,color-mix(in_oklch,var(--foreground)_4%,transparent)_0,color-mix(in_oklch,var(--foreground)_4%,transparent)_10px,transparent_10px,transparent_20px)]"
                    />

                    <div
                        className={cn(
                            "font-hand pointer-events-none absolute top-3 right-2 hidden -rotate-12 items-center gap-1.5 rounded-[10px_14px_8px_12px/12px_8px_14px_10px] border-[2.5px] border-dashed bg-background/70 px-2.5 py-1 text-base font-bold tracking-wide uppercase sm:flex",
                            vibe.tone,
                        )}
                    >
                        <TypeIcon className="size-4" />
                        {vibe.stamp}
                    </div>

                    <div className="relative flex items-center gap-4">
                        <span className="-rotate-6 text-7xl leading-none drop-shadow-sm">
                            {vibe.avatar}
                        </span>
                        <div className="min-w-0 flex-1 sm:pr-28">
                            <div className="font-hand text-sm text-muted-foreground">
                                from the rap sheet...
                            </div>
                            <div className="font-hand text-3xl font-bold leading-tight">
                                {type.label}
                            </div>
                            <div className="text-sm text-muted-foreground">
                                {type.desc}
                            </div>
                        </div>
                    </div>

                    <div className="relative mt-3 rounded-[12px_16px_10px_14px/14px_10px_16px_12px] border-2 border-dashed border-foreground/20 bg-background/70 px-3 py-2">
                        <p className="font-hand text-lg leading-snug text-foreground/80">
                            &ldquo;{vibe.quip}&rdquo;
                        </p>
                    </div>
                </div>

                {/* The boring-but-important bits. */}
                {ctx ? (
                    <div className="space-y-3">
                        <div className="font-hand text-base font-bold text-muted-foreground">
                            the nerdy details
                        </div>
                        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                            {ctx.malwareFamily && (
                                <Field icon={Bug} label="Malware family">
                                    {ctx.malwareFamily}
                                </Field>
                            )}
                            {ctx.threatLabel && (
                                <Field icon={Tag} label="Threat label">
                                    {ctx.threatLabel}
                                </Field>
                            )}
                            {ctx.fileName && (
                                <Field icon={FileText} label="File name">
                                    <span className="font-mono text-[13px]">
                                        {ctx.fileName}
                                    </span>
                                </Field>
                            )}
                            {ctx.fileType && (
                                <Field icon={FileText} label="File type">
                                    {ctx.fileType}
                                </Field>
                            )}
                            {size && (
                                <Field icon={HardDrive} label="Size">
                                    {size}
                                </Field>
                            )}
                            {firstSeen && (
                                <Field icon={CalendarClock} label="First seen">
                                    {firstSeen}
                                </Field>
                            )}
                            {lastSeen && (
                                <Field icon={History} label="Last seen">
                                    {lastSeen}
                                </Field>
                            )}
                            {ctx.magic && (
                                <Field icon={Binary} label="Magic">
                                    <span className="font-mono text-[13px]">
                                        {ctx.magic}
                                    </span>
                                </Field>
                            )}
                            {ctx.imphash && (
                                <Field icon={Fingerprint} label="Imphash">
                                    <span className="font-mono text-[13px]">
                                        {ctx.imphash}
                                    </span>
                                </Field>
                            )}
                            {ctx.ssdeep && (
                                <Field icon={Fingerprint} label="ssdeep">
                                    <span className="font-mono text-[13px]">
                                        {ctx.ssdeep}
                                    </span>
                                </Field>
                            )}
                        </dl>
                    </div>
                ) : (
                    <p className="text-sm text-muted-foreground">
                        {hasData
                            ? "No file metadata was returned for this hash."
                            : "No threat-intel source has this file on record, so there's nothing to describe. An unknown hash isn't necessarily safe; it may just be new or unseen."}
                    </p>
                )}

                <div className="space-y-2">
                    <div className="font-hand text-base font-bold text-foreground/70">
                        Digests
                    </div>
                    <dl className="space-y-1.5">
                        {digests.map((d) => (
                            <div
                                key={d.label}
                                className="flex items-center gap-2 text-xs"
                            >
                                <span className="w-16 shrink-0 text-muted-foreground">
                                    {d.label}
                                </span>
                                <code
                                    className="min-w-0 truncate font-mono text-[12px] text-foreground"
                                    title={d.value}
                                >
                                    {d.value}
                                </code>
                                <CopyHashButton value={d.value} />
                            </div>
                        ))}
                    </dl>
                </div>

                {altNames.length > 0 && (
                    <div className="space-y-1.5">
                        <div className="font-hand text-base font-bold text-foreground/70">
                            Also seen as
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {altNames.slice(0, 8).map((n) => (
                                <Badge
                                    key={n}
                                    variant="outline"
                                    className="font-mono font-normal"
                                >
                                    {n}
                                </Badge>
                            ))}
                        </div>
                    </div>
                )}

                {ctx?.tags && ctx.tags.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                        {ctx.tags.slice(0, 10).map((t) => (
                            <span
                                key={t}
                                className="font-hand sketch-shadow inline-flex items-center rounded-[10px_14px_8px_12px/12px_8px_14px_10px] border-2 border-foreground/20 bg-background px-2.5 py-0.5 text-base font-semibold text-foreground/80"
                            >
                                {t}
                            </span>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

/** Display + ordering for relation labels surfaced in the Connections card. */
const RELATION_META: Record<string, { label: string; icon: IconType }> = {
    contacts: { label: "Contacts (C2 / network)", icon: Network },
    drops: { label: "Drops", icon: FileDigit },
    parent: { label: "Parent samples", icon: FileDigit },
    similar: { label: "Similar samples", icon: Fingerprint },
    distribution: { label: "Distribution hosts", icon: Globe },
    hosted: { label: "Hosted domains", icon: Globe },
    A: { label: "Resolves to (A)", icon: Link2 },
    NS: { label: "Nameservers", icon: Server },
    MX: { label: "Mail (MX)", icon: Mail },
    rDNS: { label: "Reverse DNS", icon: SignalHigh },
    host: { label: "Observed hostnames", icon: Globe },
};
const RELATION_ORDER = [
    "contacts",
    "drops",
    "parent",
    "similar",
    "distribution",
    "hosted",
    "A",
    "NS",
    "MX",
    "rDNS",
    "host",
];
/** A file's other digests are shown in the profile card, not as "connections". */
const DIGEST_RELATIONS = new Set(["MD5", "SHA-1", "SHA-256"]);

function ConnectionsCard({
    result,
}: {
    result: CheckResult | DomainCheckResult | HashCheckResult;
}) {
    const { related } = relationsFor(result);
    const groups = new Map<string, string[]>();
    for (const r of related) {
        if (DIGEST_RELATIONS.has(r.relation)) continue;
        const list = groups.get(r.relation) ?? [];
        list.push(r.value);
        groups.set(r.relation, list);
    }
    if (groups.size === 0) return null;

    // Known relations in priority order, then any unknown ones alphabetically.
    const keys = [
        ...RELATION_ORDER.filter((k) => groups.has(k)),
        ...[...groups.keys()]
            .filter((k) => !RELATION_ORDER.includes(k))
            .sort(),
    ];

    return (
        <Card className="sketch-shadow rounded-[20px_28px_16px_24px/24px_16px_28px_20px] border-2 border-foreground/15">
            <CardContent className="space-y-4">
                <SectionHeading icon={Link2}>What it connects to</SectionHeading>
                <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                    {keys.map((key) => {
                        const meta = RELATION_META[key] ?? {
                            label: key,
                            icon: Link2,
                        };
                        return (
                            <Field
                                key={key}
                                icon={meta.icon}
                                label={meta.label}
                                wrap
                            >
                                <PivotList
                                    values={groups.get(key) ?? []}
                                    max={6}
                                />
                            </Field>
                        );
                    })}
                </dl>
            </CardContent>
        </Card>
    );
}

function ActivityCard({ result, noun }: { result: ResultLike; noun: string }) {
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
        <Card className="sketch-shadow rounded-[20px_28px_16px_24px/24px_16px_28px_20px] border-2 border-foreground/15">
            <CardContent className="space-y-4">
                <SectionHeading icon={TriangleAlert}>
                    What it does
                </SectionHeading>

                {flaggedCount > 0 ? (
                    <div className="flex items-start gap-2.5 rounded-[14px_18px_12px_16px/16px_12px_18px_14px] border-2 border-red-500/30 bg-red-500/8 p-3 text-sm text-red-700 dark:text-red-300">
                        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                        <span>
                            <span className="font-semibold">
                                {flaggedCount}
                            </span>{" "}
                            of {responded} TI sources flagged this {noun}.
                        </span>
                    </div>
                ) : (
                    <div className="flex items-start gap-2.5 rounded-[14px_18px_12px_16px/16px_12px_18px_14px] border-2 border-emerald-500/30 bg-emerald-500/8 p-3 text-sm text-emerald-700 dark:text-emerald-300">
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
                                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted ring-1 ring-foreground/5">
                                        <div
                                            className="h-full rounded-full bg-primary/70"
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
                                        <span className="shrink-0 rounded-full bg-red-500/12 px-2 py-0.5 text-xs font-semibold tabular-nums text-red-600 dark:text-red-400">
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

/** Common TCP ports -> service label, for the exposed-services view. */
const PORT_SERVICE: Record<number, string> = {
    21: "FTP",
    22: "SSH",
    23: "Telnet",
    25: "SMTP",
    53: "DNS",
    80: "HTTP",
    110: "POP3",
    111: "RPC",
    123: "NTP",
    135: "MSRPC",
    139: "NetBIOS",
    143: "IMAP",
    161: "SNMP",
    389: "LDAP",
    443: "HTTPS",
    445: "SMB",
    465: "SMTPS",
    587: "SMTP",
    993: "IMAPS",
    995: "POP3S",
    1433: "MSSQL",
    1521: "Oracle",
    2049: "NFS",
    2375: "Docker",
    3306: "MySQL",
    3389: "RDP",
    5432: "Postgres",
    5900: "VNC",
    5985: "WinRM",
    6379: "Redis",
    8080: "HTTP-alt",
    8443: "HTTPS-alt",
    9200: "Elasticsearch",
    11211: "Memcached",
    27017: "MongoDB",
};

type ShodanHostInfo = {
    ports: number[];
    vulns: string[];
    cpes: string[];
    hostnames: string[];
};

/** Pull host-exposure details out of the Shodan InternetDB source result. */
function shodanHostInfo(result: ResultLike): ShodanHostInfo {
    const d = (result.sources.find((s) => s.source.id === "shodan-internetdb")
        ?.details ?? {}) as Record<string, unknown>;
    const strs = (v: unknown): string[] =>
        Array.isArray(v)
            ? v.filter((x): x is string => typeof x === "string")
            : [];
    const nums = (v: unknown): number[] =>
        Array.isArray(v)
            ? v.filter((x): x is number => typeof x === "number")
            : [];
    return {
        ports: nums(d.ports),
        vulns: strs(d.vulns),
        cpes: strs(d.cpes),
        hostnames: strs(d.hostnames),
    };
}

function ExposedServicesCard({ result }: { result: CheckResult }) {
    const { ports, vulns, cpes } = shodanHostInfo(result);
    if (ports.length === 0 && vulns.length === 0) return null;

    const sortedPorts = [...ports].sort((a, b) => a - b);
    const shownVulns = vulns.slice(0, 12);

    return (
        <Card className="sketch-shadow rounded-[20px_28px_16px_24px/24px_16px_28px_20px] border-2 border-foreground/15">
            <CardContent className="space-y-4">
                <SectionHeading icon={Server}>
                    What&apos;s exposed
                </SectionHeading>

                {sortedPorts.length > 0 && (
                    <div className="space-y-2">
                        <div className="font-hand text-base font-bold text-muted-foreground">
                            open ports ({sortedPorts.length})
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {sortedPorts.map((p) => {
                                const svc = PORT_SERVICE[p];
                                return (
                                    <span
                                        key={p}
                                        className="inline-flex items-center gap-1.5 rounded-[10px_14px_8px_12px/12px_8px_14px_10px] border-2 border-foreground/20 bg-background px-2.5 py-0.5 font-mono text-xs"
                                    >
                                        <span className="font-semibold tabular-nums">
                                            {p}
                                        </span>
                                        {svc && (
                                            <span className="text-muted-foreground">
                                                {svc}
                                            </span>
                                        )}
                                    </span>
                                );
                            })}
                        </div>
                    </div>
                )}

                {vulns.length > 0 && (
                    <div className="space-y-2">
                        <div className="font-hand text-base font-bold text-red-600 dark:text-red-400">
                            known CVEs ({vulns.length})
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {shownVulns.map((cve) => (
                                <a
                                    key={cve}
                                    href={`https://nvd.nist.gov/vuln/detail/${encodeURIComponent(cve)}`}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    className="inline-flex items-center gap-1 rounded-[10px_14px_8px_12px/12px_8px_14px_10px] border-2 border-red-500/40 bg-red-500/10 px-2.5 py-0.5 font-mono text-xs font-semibold text-red-600 transition-colors hover:bg-red-500/20 dark:text-red-400"
                                >
                                    {cve}
                                    <ExternalLink className="size-3 opacity-60" />
                                </a>
                            ))}
                            {vulns.length > shownVulns.length && (
                                <span className="self-center text-xs text-muted-foreground">
                                    +{vulns.length - shownVulns.length} more
                                </span>
                            )}
                        </div>
                    </div>
                )}

                <p className="text-xs text-muted-foreground">
                    Exposure data from Shodan InternetDB
                    {cpes.length > 0
                        ? ` · ${cpes.length} detected technolog${cpes.length === 1 ? "y" : "ies"}`
                        : ""}
                    . Open ports aren&apos;t malicious on their own; CVEs flag
                    potentially unpatched services.
                </p>
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
function HistoryCard({ result }: { result: ResultLike }) {
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
        <Card className="sketch-shadow rounded-[20px_28px_16px_24px/24px_16px_28px_20px] border-2 border-foreground/15">
            <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <SectionHeading icon={History}>
                        Reputation over time
                    </SectionHeading>
                    <span className="text-xs text-muted-foreground">
                        <span className="font-mono">{n}</span> checks ·{" "}
                        {fmt(history[0].checkedAt)} → {fmt(latest.checkedAt)}
                    </span>
                </div>

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

export default function CheckResults({
    result,
    onRefresh,
    onPivot,
}: {
    result: CheckResult | DomainCheckResult | HashCheckResult;
    onRefresh: () => void;
    /** Launch a fresh check for a related indicator clicked within the result. */
    onPivot?: (value: string) => void;
}) {
    const body = isHashResult(result) ? (
        <HashResults result={result} onRefresh={onRefresh} />
    ) : isDomainResult(result) ? (
        <DomainResults result={result} onRefresh={onRefresh} />
    ) : (
        <Results result={result} onRefresh={onRefresh} />
    );
    return (
        <PivotContext.Provider value={onPivot ?? null}>
            {body}
        </PivotContext.Provider>
    );
}
