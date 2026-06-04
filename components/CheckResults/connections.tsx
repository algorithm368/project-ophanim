"use client";

import {
    Check,
    Copy,
    ExternalLink,
    FileDigit,
    Fingerprint,
    Globe,
    Link2,
    Mail,
    Network,
    Server,
    SignalHigh,
} from "lucide-react";
import {
    type CheckResult,
    type DomainCheckResult,
    type HashCheckResult,
} from "@/lib/ti/types";
import { type ResultLike } from "@/lib/ti/narrative";
import { relationsFor } from "@/lib/relations";
import { hostFromUrl } from "@/lib/url";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Pivot, PivotList, SectionHeading, useCopied } from "./primitives";
import type { IconType } from "./types";

/** Display + ordering for relation labels surfaced in the Connections card. */
const RELATION_META: Record<string, { label: string; icon: IconType }> = {
    contacts: { label: "Contacts (C2 / network)", icon: Network },
    drops: { label: "Drops", icon: FileDigit },
    parent: { label: "Parent samples", icon: FileDigit },
    similar: { label: "Similar samples", icon: Fingerprint },
    distribution: { label: "Distribution hosts", icon: Globe },
    hosted: { label: "Hosted domains", icon: Globe },
    A: { label: "Resolves to (A)", icon: Link2 },
    resolved: { label: "Resolves to (passive DNS)", icon: Link2 },
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
    "resolved",
    "NS",
    "MX",
    "rDNS",
    "host",
];
/** A file's other digests are shown in the profile card, not as "connections". */
const DIGEST_RELATIONS = new Set(["MD5", "SHA-1", "SHA-256"]);

export function ConnectionsCard({
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
        <Card className="sketch-shadow rounded-2xl border border-foreground/12">
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
        <Card className="sketch-shadow rounded-2xl border border-foreground/12">
            <CardContent className="space-y-3">
                <SectionHeading icon={Link2}>
                    Where it&apos;s been served
                </SectionHeading>
                <p className="text-xs text-muted-foreground">
                    URLs that distributed this file. Use the pivot to check the
                    host — open links cautiously; they may still be live.
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

export function ExposedServicesCard({ result }: { result: CheckResult }) {
    const { ports, vulns, cpes } = shodanHostInfo(result);
    if (ports.length === 0 && vulns.length === 0) return null;

    const sortedPorts = [...ports].sort((a, b) => a - b);
    const shownVulns = vulns.slice(0, 12);

    return (
        <Card className="sketch-shadow rounded-2xl border border-foreground/12">
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
                                        className="inline-flex items-center gap-1.5 rounded-md border-2 border-foreground/20 bg-background px-2.5 py-0.5 font-mono text-xs"
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
                                    className="inline-flex items-center gap-1 rounded-md border-2 border-red-500/40 bg-red-500/10 px-2.5 py-0.5 font-mono text-xs font-semibold text-red-600 transition-colors hover:bg-red-500/20 dark:text-red-400"
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
