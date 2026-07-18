"use client";

import { type ReactNode } from "react";
import {
    Check,
    Copy,
    FileDigit,
    Globe,
    MapPin,
    X,
} from "lucide-react";
import {
    type CheckResult,
    type DomainCheckResult,
    type HashCheckResult,
} from "@/lib/ti/types";
import { formatBytes, formatDate, joinPlace } from "@/lib/ti/narrative";
import { HASH_ALGO_LABEL } from "@/lib/hash";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    classifyType,
    classifyDomain,
    classifyHash,
    domainTone,
    flagUrl,
    hashTone,
} from "./classify";
import {
    Field,
    Pivot,
    PivotList,
    SectionHeading,
    useCopied,
} from "./primitives";
import { VotingCard } from "./voting";
import type { IconType } from "./types";

/** A flat group of related fields: a small uppercase label over hairline-
 *  separated rows. The minimal, borderless replacement for the old bento cell —
 *  the profile reads as one document instead of a grid of boxes. */
function Group({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="space-y-1">
            <div className="font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                {label}
            </div>
            <dl className="divide-y divide-foreground/[0.06] [&>:first-child]:pt-0 [&>:last-child]:pb-0">
                {children}
            </dl>
        </div>
    );
}

/** A hairline rule used to separate the identity line from the field groups. */
function Rule() {
    return <div className="h-px bg-foreground/10" />;
}

/** One label-value pair in the Origin spec grid: a fixed label column then the
 *  value, so every fact lines up into the same regular columns. */
function GridItem({
    label,
    hint,
    children,
}: {
    label: string;
    hint?: string;
    children: ReactNode;
}) {
    return (
        <div className="flex items-baseline gap-3 py-1">
            <dt
                title={hint}
                className={cn(
                    "w-28 shrink-0 text-[13px] leading-snug text-muted-foreground",
                    hint &&
                        "cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-2",
                )}
            >
                {label}
            </dt>
            <dd className="min-w-0 flex-1 text-sm font-medium text-foreground">
                {children}
            </dd>
        </div>
    );
}

/** Compact classification header for the domain / hash profile cards: a small
 *  tinted icon, the type label, and a one-line plain-language description. */
function IdentityHeader({
    icon: Icon,
    label,
    desc,
    tone,
}: {
    icon?: IconType;
    label: string;
    desc?: string;
    tone?: string;
}) {
    return (
        <div className="flex items-start gap-3">
            {Icon && (
                <span
                    className={cn(
                        "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border border-foreground/15 bg-background",
                        tone,
                    )}
                >
                    <Icon className="size-5" />
                </span>
            )}
            <div className="min-w-0">
                <div
                    className={cn(
                        "text-lg font-bold leading-tight tracking-tight",
                        tone,
                    )}
                >
                    {label}
                </div>
                {desc && (
                    <div className="mt-0.5 text-sm text-muted-foreground">
                        {desc}
                    </div>
                )}
            </div>
        </div>
    );
}

export function ProfileCard({ result }: { result: CheckResult }) {
    const geo = result.geo;
    const res = result.geoResolution;
    const type = classifyType(geo);
    const cityRegion = geo ? joinPlace([geo.city, geo.region]) : "";
    const flag = flagUrl(geo?.countryCode);
    const coords =
        typeof geo?.lat === "number" && typeof geo?.lon === "number"
            ? `${geo.lat.toFixed(4)}, ${geo.lon.toFixed(4)}`
            : undefined;

    return (
        <Card className="sketch-shadow rounded-lg border border-foreground/12">
            <CardContent className="space-y-4">
                <SectionHeading icon={Globe}>Origin</SectionHeading>

                <div className="space-y-4">
                    {/* Identity line: grayscale flag, country, city — one row. */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {flag ? (
                            // eslint-disable-next-line @next/next/no-img-element -- tiny external flag asset; next/image is overkill here
                            <img
                                src={flag}
                                alt={`Flag of ${geo?.country ?? geo?.countryCode}`}
                                width={64}
                                height={48}
                                loading="lazy"
                                className="mr-1 h-7 w-auto shrink-0 rounded-sm border border-foreground/20 object-cover"
                            />
                        ) : (
                            <span className="mr-1 flex size-7 shrink-0 items-center justify-center rounded-md border border-foreground/15 bg-background text-muted-foreground">
                                <MapPin className="size-4" />
                            </span>
                        )}
                        <span className="text-base font-semibold leading-tight tracking-tight">
                            {geo?.country ?? "Unknown location"}
                        </span>
                        {geo?.countryCode && (
                            <span className="font-mono text-xs text-muted-foreground">
                                {geo.countryCode}
                            </span>
                        )}
                        {cityRegion && (
                            <>
                                <span className="text-muted-foreground/50">·</span>
                                <span className="text-sm text-muted-foreground">
                                    {cityRegion}
                                </span>
                            </>
                        )}
                    </div>

                    <Rule />

                    {/* Uniform spec grid: every fact is a regular label-value
                        cell, aligned into two even columns. */}
                    <dl className="grid grid-cols-1 gap-x-8 gap-y-0.5 sm:grid-cols-2">
                        <GridItem label="Type">
                            <span title={type.desc}>{type.label}</span>
                        </GridItem>
                        {geo?.asn && (
                            <GridItem
                                label="ASN"
                                hint="Autonomous System Number, the network block this IP routes through"
                            >
                                <span className="font-mono text-[13px]">
                                    {geo.asn}
                                </span>
                            </GridItem>
                        )}
                        {geo?.asnOrg && (
                            <GridItem label="Operator">{geo.asnOrg}</GridItem>
                        )}
                        {geo?.isp && <GridItem label="ISP">{geo.isp}</GridItem>}
                        {geo?.org && (
                            <GridItem label="Organization">{geo.org}</GridItem>
                        )}
                        {geo?.reverse && (
                            <GridItem
                                label="Reverse DNS"
                                hint="The PTR hostname this IP maps back to"
                            >
                                <div className="flex min-w-0 items-center gap-2">
                                    <span className="min-w-0">
                                        <Pivot value={geo.reverse} />
                                    </span>
                                    {geo.fcrdns && (
                                        <span
                                            title={
                                                geo.fcrdns.verified
                                                    ? "FCrDNS pass, the PTR host resolves back to this IP"
                                                    : "FCrDNS fail, the PTR host does not resolve back to this IP"
                                            }
                                            className={cn(
                                                "inline-flex shrink-0 items-center gap-0.5 text-[10px] font-semibold tracking-wide uppercase",
                                                geo.fcrdns.verified
                                                    ? "text-muted-foreground"
                                                    : "text-foreground",
                                            )}
                                        >
                                            {geo.fcrdns.verified ? (
                                                <Check className="size-3" />
                                            ) : (
                                                <X className="size-3" />
                                            )}
                                            FCrDNS
                                        </span>
                                    )}
                                </div>
                            </GridItem>
                        )}
                        {coords && (
                            <GridItem label="Coordinates">
                                <span className="font-mono text-[13px]">
                                    {coords}
                                </span>
                            </GridItem>
                        )}
                    </dl>
                </div>

                {res && <VotingCard res={res} />}
            </CardContent>
        </Card>
    );
}

export function DomainProfileCard({ result }: { result: DomainCheckResult }) {
    const ctx = result.context;
    const resolves =
        (ctx?.resolvedIps?.length ?? 0) > 0 || (ctx?.ipv6?.length ?? 0) > 0;
    const type = classifyDomain(ctx, resolves);
    const tone = domainTone(type.label);

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
        <Card className="sketch-shadow rounded-lg border border-foreground/12">
            <CardContent className="space-y-4">
                <SectionHeading
                    icon={Globe}
                    action={
                        <code className="rounded-sm border border-foreground/15 bg-muted/60 px-2.5 py-1 font-mono text-xs font-semibold tracking-tight">
                            {result.domain}
                        </code>
                    }
                >
                    Registration &amp; DNS
                </SectionHeading>

                {/* Classification identity header (no icon, per design). */}
                <IdentityHeader label={type.label} desc={type.desc} tone={tone} />

                {ctx ? (
                    <div className="space-y-4">
                        <Rule />

                        {(ctx.registrar ||
                            created ||
                            expires ||
                            (ctx.categories?.length ?? 0) > 0) && (
                            <Group label="Registration">
                                {ctx.registrar && (
                                    <Field label="Registrar">{ctx.registrar}</Field>
                                )}
                                {created && (
                                    <Field
                                        label="Registered"
                                        tone={
                                            ctx.ageDays !== undefined && ctx.ageDays < 30
                                                ? "text-orange-600 dark:text-orange-400"
                                                : undefined
                                        }
                                    >
                                        {created}
                                        {age ? ` · ${age} old` : ""}
                                    </Field>
                                )}
                                {expires && <Field label="Expires">{expires}</Field>}
                                {ctx.categories && ctx.categories.length > 0 && (
                                    <Field label="Category">
                                        {ctx.categories.slice(0, 3).join(", ")}
                                    </Field>
                                )}
                            </Group>
                        )}

                        {(ips.length > 0 ||
                            ns.length > 0 ||
                            (ctx.reverse?.length ?? 0) > 0 ||
                            (ctx.caa?.length ?? 0) > 0 ||
                            (ctx.dnssec !== undefined && ctx.dnssec !== "unknown") ||
                            (ctx.resolverConsensus?.respondingResolvers ?? 0) > 1) && (
                            <Group label="DNS records">
                                {ips.length > 0 && (
                                    <Field label="Resolves to" wrap>
                                        <PivotList values={ips} />
                                    </Field>
                                )}
                                {ns.length > 0 && (
                                    <Field label="Nameservers" wrap>
                                        <PivotList values={ns} />
                                    </Field>
                                )}
                                {(ctx.reverse?.length ?? 0) > 0 && (
                                    <Field label="Reverse DNS (PTR)" wrap>
                                        <PivotList values={ctx.reverse!} />
                                    </Field>
                                )}
                                {(ctx.caa?.length ?? 0) > 0 && (
                                    <Field
                                        label="CAA"
                                        wrap
                                        hint="Certificate Authority Authorization, which CAs may issue TLS certs for this domain"
                                    >
                                        <span className="font-mono text-[12px] break-all">
                                            {ctx.caa!.join(", ")}
                                        </span>
                                    </Field>
                                )}
                                {ctx.dnssec !== undefined &&
                                    ctx.dnssec !== "unknown" && (
                                        <Field
                                            label="DNSSEC"
                                            hint="Whether the zone is DNSSEC-signed (resolver set the AD flag)"
                                            tone={
                                                ctx.dnssec === "signed"
                                                    ? "text-emerald-600 dark:text-emerald-400"
                                                    : undefined
                                            }
                                        >
                                            {ctx.dnssec === "signed"
                                                ? "Signed"
                                                : "Unsigned"}
                                        </Field>
                                    )}
                                {ctx.resolverConsensus &&
                                    ctx.resolverConsensus.respondingResolvers > 1 && (
                                        <Field
                                            label="Resolvers"
                                            hint="Unfiltered DoH resolvers queried for the A record, and how many agree on the resolved IP. A low count suggests GeoDNS, split-horizon, or possible poisoning."
                                            tone={
                                                ctx.resolverConsensus.bucket === "low"
                                                    ? "text-red-600 dark:text-red-400"
                                                    : undefined
                                            }
                                        >
                                            {ctx.resolverConsensus.agreeCount}/
                                            {ctx.resolverConsensus.respondingResolvers}
                                            {ctx.resolverConsensus.bucket === "low"
                                                ? " split"
                                                : " agree"}
                                        </Field>
                                    )}
                            </Group>
                        )}

                        {(mx.length > 0 || ctx.spf || ctx.dmarc) && (
                            <Group label="Email security">
                                {mx.length > 0 && (
                                    <Field label="Mail (MX)" wrap>
                                        <PivotList values={mx} />
                                    </Field>
                                )}
                                {ctx.spf && (
                                    <Field
                                        label="SPF"
                                        wrap
                                        hint="Sender Policy Framework, which servers may send mail for this domain"
                                    >
                                        <span className="font-mono text-[12px] break-all">
                                            {ctx.spf}
                                        </span>
                                    </Field>
                                )}
                                {ctx.dmarc && (
                                    <Field
                                        label="DMARC"
                                        wrap
                                        hint="Policy for handling mail that fails SPF/DKIM authentication"
                                    >
                                        <span className="font-mono text-[12px] break-all">
                                            {ctx.dmarc}
                                        </span>
                                    </Field>
                                )}
                            </Group>
                        )}
                    </div>
                ) : (
                    <p className="text-sm text-muted-foreground">
                        No registration or DNS context was returned for this domain.
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

/** A minimal verdict marker, the one place this card carries color: filled red
 *  for a flagged file, filled neutral for a known but unflagged file, and a
 *  hollow ring for an unknown one, so the verdict reads at a glance. */
export function StatusDot({ kind }: { kind: "malicious" | "known" | "unknown" }) {
    return (
        <span
            aria-hidden
            className={cn(
                "mt-[7px] size-2.5 shrink-0 rounded-full",
                kind === "malicious" && "bg-red-500 dark:bg-red-400",
                kind === "known" && "bg-foreground/40",
                kind === "unknown" && "border-[1.5px] border-muted-foreground/50",
            )}
        />
    );
}

/** One aligned readout row: a fixed lowercase label column, the value beside it,
 *  and an optional trailing action (e.g. a copy button). Every row shares the
 *  same label width so the whole card reads as a single column. */
export function HashRow({
    label,
    hint,
    mono = false,
    action,
    children,
}: {
    label: string;
    hint?: string;
    mono?: boolean;
    action?: ReactNode;
    children: ReactNode;
}) {
    return (
        <div className="flex items-baseline gap-3 py-[3px]">
            <dt
                title={hint}
                className={cn(
                    "w-24 shrink-0 text-[13px] leading-snug text-muted-foreground",
                    hint &&
                        "cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-2",
                )}
            >
                {label}
            </dt>
            <dd
                className={cn(
                    "min-w-0 flex-1 truncate text-foreground",
                    mono ? "font-mono text-[12px]" : "text-sm font-medium",
                )}
                title={mono && typeof children === "string" ? children : undefined}
            >
                {children}
            </dd>
            {action}
        </div>
    );
}

/** Small uppercase mono lead for a sub-section inside the identity card. */
function SubLabel({ children }: { children: ReactNode }) {
    return (
        <div className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {children}
        </div>
    );
}

/** Host of a reference URL, minus a leading www, for a compact link label. */
function refLabel(href: string): string {
    try {
        return new URL(href).hostname.replace(/^www\./, "");
    } catch {
        return href;
    }
}

export function HashProfileCard({ result }: { result: HashCheckResult }) {
    const ctx = result.context;
    const hasData = result.sources.some(
        (s) => s.status === "ok" && s.score !== undefined,
    );
    const type = classifyHash(ctx, hasData);
    const tone = hashTone(ctx);
    const kind: "malicious" | "known" | "unknown" =
        ctx?.malwareFamily || ctx?.threatLabel
            ? "malicious"
            : ctx
              ? "known"
              : "unknown";

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

    // Threat evidence folded into the identity card: family write-up, engine
    // detection labels, sandbox behavior, and ATT&CK techniques.
    const capabilities = ctx?.capabilities ?? [];
    const techniques = ctx?.mitreTechniques ?? [];
    const refs = ctx?.familyRefs ?? [];
    const detections = [...new Set(ctx?.detectionNames ?? [])];
    const ratio = ctx?.detectionRatio;
    const shownTech = new Set(
        capabilities.flatMap((c) => (c.mitre ?? []).map((id) => id.toUpperCase())),
    );
    const extraTech = techniques.filter(
        (t) => !shownTech.has(t.id.toUpperCase()),
    );
    const hasThreat =
        Boolean(ctx?.familyDescription) ||
        capabilities.length > 0 ||
        detections.length > 0 ||
        extraTech.length > 0;

    return (
        <Card className="sketch-shadow rounded-lg border border-foreground/12">
            <CardContent className="space-y-4">
                <SectionHeading
                    icon={FileDigit}
                    action={
                        <code className="rounded-sm border border-foreground/15 bg-muted/60 px-2.5 py-1 font-mono text-xs font-semibold tracking-tight">
                            {HASH_ALGO_LABEL[result.algorithm]}
                        </code>
                    }
                >
                    File identity
                </SectionHeading>

                {/* Verdict dot + classification, the one place color appears. */}
                <div className="flex items-start gap-3">
                    <StatusDot kind={kind} />
                    <div className="min-w-0">
                        <div
                            className={cn(
                                "text-lg font-bold uppercase leading-tight tracking-tight",
                                tone,
                            )}
                        >
                            {type.label}
                        </div>
                        {type.desc && (
                            <div className="mt-0.5 text-sm text-muted-foreground">
                                {type.desc}
                            </div>
                        )}
                    </div>
                </div>

                {/* Flat record readout: one aligned label to value column. */}
                <div className="space-y-3">
                    {ctx &&
                        (ctx.fileName ||
                            ctx.fileType ||
                            size ||
                            firstSeen ||
                            lastSeen) && (
                            <dl>
                                {ctx.fileName && (
                                    <HashRow label="name" mono>
                                        {ctx.fileName}
                                    </HashRow>
                                )}
                                {ctx.fileType && (
                                    <HashRow label="type">{ctx.fileType}</HashRow>
                                )}
                                {size && <HashRow label="size">{size}</HashRow>}
                                {firstSeen && (
                                    <HashRow label="first seen">{firstSeen}</HashRow>
                                )}
                                {lastSeen && (
                                    <HashRow label="last seen">{lastSeen}</HashRow>
                                )}
                            </dl>
                        )}

                    <dl>
                        {digests.map((d) => (
                            <HashRow
                                key={d.label}
                                label={d.label.toLowerCase()}
                                mono
                                action={<CopyHashButton value={d.value} />}
                            >
                                {d.value}
                            </HashRow>
                        ))}
                        {ctx?.imphash && (
                            <HashRow
                                label="imphash"
                                mono
                                hint="Hash of the PE import table, clusters samples built from the same code"
                            >
                                {ctx.imphash}
                            </HashRow>
                        )}
                        {ctx?.ssdeep && (
                            <HashRow
                                label="ssdeep"
                                mono
                                hint="Fuzzy hash, matches files that are similar but not identical"
                            >
                                {ctx.ssdeep}
                            </HashRow>
                        )}
                        {ctx?.magic && (
                            <HashRow
                                label="magic"
                                mono
                                hint="libmagic file-type signature derived from the file's leading bytes"
                            >
                                {ctx.magic}
                            </HashRow>
                        )}
                    </dl>

                    {(altNames.length > 0 ||
                        (ctx?.tags && ctx.tags.length > 0)) && (
                        <dl>
                            {altNames.length > 0 && (
                                <HashRow label="aka">
                                    {altNames.slice(0, 6).join(", ")}
                                    {altNames.length > 6 &&
                                        ` +${altNames.length - 6}`}
                                </HashRow>
                            )}
                            {ctx?.tags && ctx.tags.length > 0 && (
                                <HashRow label="tags">
                                    {ctx.tags.slice(0, 10).join(", ")}
                                </HashRow>
                            )}
                        </dl>
                    )}
                </div>

                {/* Threat evidence: what scanners and sandboxes say this file is
                    and does. Only the malware verdict carries color. */}
                {hasThreat && (
                    <>
                        <Rule />
                        <div className="space-y-4">
                            {ctx?.familyDescription && (
                                <p className="text-sm leading-relaxed text-foreground/85">
                                    {ctx.familyDescription}
                                </p>
                            )}
                            {refs.length > 0 && (
                                <div className="flex flex-wrap gap-x-4 gap-y-1">
                                    {refs.map((href, i) => (
                                        <a
                                            key={href}
                                            href={href}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-[13px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                                        >
                                            {i === 0 ? "refs: " : ""}
                                            {refLabel(href)}
                                        </a>
                                    ))}
                                </div>
                            )}

                            {capabilities.length > 0 && (
                                <div className="space-y-1">
                                    <SubLabel>What this file does</SubLabel>
                                    <dl>
                                        {capabilities.map((c) => (
                                            <HashRow
                                                key={c.label}
                                                label={c.mitre?.[0] ?? "behavior"}
                                            >
                                                {c.label}
                                            </HashRow>
                                        ))}
                                    </dl>
                                </div>
                            )}

                            {detections.length > 0 && (
                                <div className="space-y-1">
                                    <SubLabel>
                                        Engine detections
                                        {ratio
                                            ? `, ${ratio.malicious} of ${ratio.total} flagged`
                                            : ""}
                                    </SubLabel>
                                    <ul className="space-y-0.5">
                                        {detections.slice(0, 8).map((n) => (
                                            <li
                                                key={n}
                                                title={n}
                                                className="truncate font-mono text-[12px] text-foreground/80"
                                            >
                                                {n}
                                            </li>
                                        ))}
                                    </ul>
                                    {detections.length > 8 && (
                                        <div className="text-xs text-muted-foreground">
                                            +{detections.length - 8} more
                                        </div>
                                    )}
                                </div>
                            )}

                            {extraTech.length > 0 && (
                                <div className="space-y-1">
                                    <SubLabel>MITRE ATT&amp;CK</SubLabel>
                                    <div className="flex flex-wrap gap-1.5">
                                        {extraTech.map((t) => (
                                            <span
                                                key={t.id}
                                                title={t.tactic}
                                                className="inline-flex items-center rounded-md border border-foreground/15 bg-background px-2 py-0.5 font-mono text-[12px] text-foreground/80"
                                            >
                                                {t.id}
                                                {t.name ? ` ${t.name}` : ""}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
}
