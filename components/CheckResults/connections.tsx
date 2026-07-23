"use client";

import {
    Check,
    Copy,
    ExternalLink,
    Link2,
    Server,
    ShieldCheck,
} from "lucide-react";
import {
    type CheckResult,
    type DomainCheckResult,
    type HashCheckResult,
    type RelatedIndicator,
} from "@/lib/ti/types";
import {
    relationsFor,
    sortRelationsForTable,
    RELATION_SHORT,
    RELATION_META,
    DIGEST_RELATIONS,
} from "@/lib/relations";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { hostFromUrl } from "@/lib/url";
import { cpeLabel } from "@/lib/cpe";
import { shodanHostInfo, PORT_SERVICE } from "@/lib/ti/shodan";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Pivot, SectionHeading, useCopied } from "./primitives";

export function ConnectionsCard({
    result,
}: {
    result: CheckResult | DomainCheckResult | HashCheckResult;
}) {
    const { related } = relationsFor(result);
    // Drop a file's own other digests; those live in the profile card. (Harmless
    // for IP/domain results, which never produce digest relations.)
    const pivots = related.filter((r) => !DIGEST_RELATIONS.has(r.relation));
    if (pivots.length === 0) return null;

    // One table for every indicator type. The confidence column + legend only
    // appear when the relations carry a tier (hash malware pivots); IP / domain
    // DNS facts render as the same table without it.
    return (
        <Card className="sketch-shadow rounded-lg border border-foreground/12">
            <CardContent className="space-y-4">
                <SectionHeading icon={Link2} action={<PivotCount n={pivots.length} />}>
                    Related indicators
                </SectionHeading>
                <RelationTable related={pivots} />
            </CardContent>
        </Card>
    );
}

function PivotCount({ n }: { n: number }) {
    return (
        <span className="font-mono text-[11px] tracking-wider text-muted-foreground tabular-nums">
            {n} {n === 1 ? "pivot" : "pivots"}
        </span>
    );
}

/** Short display name for a source id, for the provenance column. */
const SOURCE_LABEL: Record<string, string> = {
    triage: "Triage",
    virustotal: "VirusTotal",
    otx: "OTX",
    malwarebazaar: "MalwareBazaar",
    threatfox: "ThreatFox",
};

const TYPE_LABEL: Record<string, string> = {
    ip: "IP",
    domain: "domain",
    hash: "file",
};

/** How many low-confidence rows to show before collapsing the tail. For hash
 *  results these are the `observed` pivots (confirmed always show in full); for
 *  IP/domain results, which have no tier, it caps the whole list. */
const ROW_CAP = 12;

/**
 * One related-indicator table for every indicator type (layout: [CONF ·]
 * INDICATOR · TYPE · RELATION · SOURCES). For hash results the CONF column and
 * legend rank confirmed pivots (extracted C2 config or corroborated by 2+
 * sources) above single-source sandbox contacts, where benign OS noise
 * collects. IP / domain relations carry no tier, so the CONF column and legend
 * are omitted and the full list is capped uniformly. Provenance (`sources`)
 * lets an analyst trust a row without cross-checking every feed.
 */
function RelationTable({ related }: { related: RelatedIndicator[] }) {
    const [expanded, setExpanded] = useState(false);
    const rows = sortRelationsForTable(related);
    const tiered = rows.some((r) => r.tier);

    // Rows shown unconditionally (confirmed) vs. the capped tail (observed, or
    // the whole list when untiered).
    const pinned = tiered ? rows.filter((r) => r.tier === "confirmed") : [];
    const capped = tiered ? rows.filter((r) => r.tier !== "confirmed") : rows;
    const shownCapped = expanded ? capped : capped.slice(0, ROW_CAP);
    const hidden = capped.length - shownCapped.length;
    const shown = [...pinned, ...shownCapped];

    return (
        <div className="space-y-3">
            <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                    <thead>
                        <tr className="border-b border-foreground/10 font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase">
                            {tiered && (
                                <th className="w-6 py-1.5 pr-2 font-medium">
                                    <span className="sr-only">Confidence</span>
                                </th>
                            )}
                            <th className="py-1.5 pr-3 font-medium">Indicator</th>
                            <th className="py-1.5 pr-3 font-medium">Type</th>
                            <th className="py-1.5 pr-3 font-medium">Relation</th>
                            <th className="py-1.5 font-medium">Sources</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-foreground/[0.06]">
                        {shown.map((r) => (
                            <RelationTableRow
                                key={`${r.value}:${r.relation}`}
                                r={r}
                                tiered={tiered}
                            />
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                {tiered && (
                    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] tracking-wider text-muted-foreground">
                        {pinned.length > 0 && (
                            <span className="flex items-center gap-1.5">
                                <ShieldCheck className="size-3 text-red-600 dark:text-red-400" />
                                confirmed, C2 config or corroborated
                            </span>
                        )}
                        <span className="flex items-center gap-1.5">
                            <span className="inline-block size-1.5 rounded-full border border-muted-foreground/50" />
                            observed, sandbox contact, may include noise
                        </span>
                    </p>
                )}
                {capped.length > ROW_CAP && (
                    <button
                        type="button"
                        onClick={() => setExpanded((v) => !v)}
                        className="ml-auto font-mono text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                        {expanded
                            ? "show fewer"
                            : `+${hidden} more${tiered ? " observed" : ""}`}
                    </button>
                )}
            </div>
        </div>
    );
}

function RelationTableRow({
    r,
    tiered,
}: {
    r: RelatedIndicator;
    tiered: boolean;
}) {
    const confirmed = r.tier === "confirmed";
    const relation =
        RELATION_SHORT[r.relation] ?? RELATION_META[r.relation]?.label ?? r.relation;
    const sources = (r.sources ?? [])
        .map((s) => SOURCE_LABEL[s] ?? s)
        .join(", ");
    return (
        <tr
            className={cn(
                "align-baseline",
                tiered && !confirmed && "text-muted-foreground",
            )}
        >
            {tiered && (
                <td className="py-2 pr-2">
                    {confirmed ? (
                        <ShieldCheck
                            className="size-3.5 text-red-600 dark:text-red-400"
                            aria-label="confirmed"
                        />
                    ) : (
                        <span
                            className="ml-0.5 inline-block size-1.5 rounded-full border border-muted-foreground/50"
                            aria-label="observed"
                        />
                    )}
                </td>
            )}
            <td className="py-2 pr-3">
                <Pivot value={r.value} />
            </td>
            <td className="py-2 pr-3 text-[12px] text-muted-foreground">
                {TYPE_LABEL[r.type] ?? r.type}
            </td>
            <td className="py-2 pr-3 text-[12px]">{relation}</td>
            <td className="py-2 text-[12px] text-muted-foreground">{sources}</td>
        </tr>
    );
}

function DistributionUrlRow({ url }: { url: string }) {
    const [copied, copy] = useCopied();
    const host = hostFromUrl(url);
    return (
        <li className="flex items-center gap-2 rounded-md border border-foreground/10 bg-muted/40 p-2 text-xs">
            <code
                className="min-w-0 flex-1 truncate font-mono text-[12px]"
                title={url}
            >
                {url}
            </code>
            {host && <Pivot value={host} label={`check ${host}`} />}
            <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open ${url} in a new tab`}
                title="Open in a new tab (may be a live malware URL)"
                className="shrink-0 text-muted-foreground hover:text-foreground"
            >
                <ExternalLink className="size-3.5" />
            </a>
            <Button
                type="button"
                variant="ghost"
                size="xs"
                aria-label="Copy URL"
                className="size-6 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                onClick={() => copy(url)}
            >
                {copied ? (
                    <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                ) : (
                    <Copy className="size-3.5" />
                )}
            </Button>
        </li>
    );
}

export function DistributionUrlsCard({ result }: { result: HashCheckResult }) {
    const urls = result.context?.distributionUrls ?? [];
    if (urls.length === 0) return null;
    const shown = urls.slice(0, 8);
    const extra = urls.length - shown.length;
    return (
        <Card className="sketch-shadow rounded-lg border border-foreground/12">
            <CardContent className="space-y-3">
                <SectionHeading icon={Link2}>
                    Distribution URLs
                </SectionHeading>
                <p className="text-xs text-muted-foreground">
                    URLs that distributed this file. Use the pivot to check the
                    host, open links cautiously; they may still be live.
                </p>
                <ul className="space-y-1.5">
                    {shown.map((u) => (
                        <DistributionUrlRow key={u} url={u} />
                    ))}
                </ul>
                {extra > 0 && (
                    <p className="text-xs text-muted-foreground">
                        +{extra} more
                    </p>
                )}
            </CardContent>
        </Card>
    );
}

/** Shared formal sub-label: uppercase mono micro-caps, matching the other
 *  result cards (replaces the old hand-drawn headers). */
const SUBLABEL =
    "font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase";

const CVE_PREVIEW = 12;

export function ExposedServicesCard({ result }: { result: CheckResult }) {
    const { ports, vulns, cpes } = shodanHostInfo(result.sources);
    if (ports.length === 0 && vulns.length === 0 && cpes.length === 0)
        return null;

    const sortedPorts = [...ports].sort((a, b) => a - b);
    const shownVulns = vulns.slice(0, CVE_PREVIEW);

    // Detected technologies, deduped by their readable label so the same
    // product reported under two CPE strings collapses to one chip.
    const techs = Array.from(
        new Map(
            cpes
                .map((c) => cpeLabel(c))
                .map((t) => [`${t.name} ${t.version ?? ""}`, t]),
        ).values(),
    );

    return (
        <Card className="sketch-shadow rounded-lg border border-foreground/12">
            <CardContent className="space-y-4">
                <SectionHeading icon={Server}>Exposed services</SectionHeading>

                {sortedPorts.length > 0 && (
                    <div className="space-y-2">
                        <div className={SUBLABEL}>
                            Open ports ({sortedPorts.length})
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {sortedPorts.map((p) => {
                                const svc = PORT_SERVICE[p];
                                return (
                                    <span
                                        key={p}
                                        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1 font-mono text-xs"
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

                {techs.length > 0 && (
                    <div className="space-y-2">
                        <div className={SUBLABEL}>
                            Technologies ({techs.length})
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {techs.map((t) => (
                                <span
                                    key={`${t.name}-${t.version ?? ""}`}
                                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1 text-[13px]"
                                >
                                    <span className="font-medium">{t.name}</span>
                                    {t.version && (
                                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                                            {t.version}
                                        </span>
                                    )}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {vulns.length > 0 && (
                    <div className="space-y-2">
                        <div className={`${SUBLABEL} text-red-600 dark:text-red-400`}>
                            Known CVEs ({vulns.length})
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {shownVulns.map((cve) => (
                                <a
                                    key={cve}
                                    href={`https://nvd.nist.gov/vuln/detail/${encodeURIComponent(cve)}`}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    className="inline-flex items-center gap-1 rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1 font-mono text-xs font-semibold text-red-600 transition-colors hover:bg-red-500/20 dark:text-red-400"
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
                    Exposure data from Shodan InternetDB. Open ports aren&apos;t
                    malicious on their own; CVEs flag potentially unpatched
                    services.
                </p>
            </CardContent>
        </Card>
    );
}
