"use client";

import {
    Binary,
    Bug,
    Building2,
    CalendarClock,
    Check,
    Copy,
    FileDigit,
    FileText,
    Fingerprint,
    Globe,
    HardDrive,
    History,
    Link2,
    Mail,
    MapPin,
    Navigation,
    Network,
    Server,
    ShieldAlert,
    ShieldCheck,
    ShieldQuestion,
    SignalHigh,
    Smartphone,
    Tag,
    Wifi,
} from "lucide-react";
import {
    type CheckResult,
    type DomainCheckResult,
    type HashCheckResult,
} from "@/lib/ti/types";
import { formatBytes, formatDate, joinPlace } from "@/lib/ti/narrative";
import { HASH_ALGO_LABEL } from "@/lib/hash";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
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
    FieldGroup,
    Pivot,
    PivotList,
    SectionHeading,
    useCopied,
} from "./primitives";
import { Disagreement } from "./confidence";
import { LocationMap } from "./location-map";
import type { IconType } from "./types";

export function ProfileCard({ result }: { result: CheckResult }) {
    const geo = result.geo;
    const res = result.geoResolution;
    const type = classifyType(geo);
    const TypeIcon = type.icon;
    const cityRegion = geo ? joinPlace([geo.city, geo.region]) : "";
    const flag = flagUrl(geo?.countryCode);
    const coords =
        typeof geo?.lat === "number" && typeof geo?.lon === "number"
            ? `${geo.lat.toFixed(4)}, ${geo.lon.toFixed(4)}`
            : undefined;

    // Accent tint keyed to the dominant trait, for the type label/badge.
    const accent = geo?.isProxy
        ? "text-orange-600 dark:text-orange-400"
        : geo?.isMobile
            ? "text-sky-600 dark:text-sky-400"
            : geo?.isHosting
                ? "text-foreground/70"
                : "text-emerald-600 dark:text-emerald-400";

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
    const hasMap = typeof geo?.lat === "number" && typeof geo?.lon === "number";

    return (
        <Card className="sketch-shadow rounded-2xl border border-foreground/12">
            <CardContent className="space-y-4">
                <SectionHeading
                    icon={Globe}
                    action={
                        <code className="rounded-sm border border-foreground/15 bg-muted/60 px-2.5 py-1 font-mono text-xs font-semibold tracking-tight">
                            {result.ip}
                        </code>
                    }
                >
                    Where it&apos;s from
                </SectionHeading>

                {/* Map floats in column 1; detail flows in column 2 beside it and
                    spills into a full-width row below once it outgrows the map. */}
                <div className="flow-root">
                    {hasMap && (
                        <div className="mb-4 lg:float-left lg:mr-4 lg:mb-0 lg:w-80">
                            <LocationMap
                                lat={geo!.lat!}
                                lon={geo!.lon!}
                                caption={
                                    joinPlace([
                                        geo!.city,
                                        geo!.region,
                                        geo!.country,
                                    ]) || coords
                                }
                            />
                        </div>
                    )}

                    <div className="[&>*+*]:mt-4">
                        {/* Location identity header: flag, country, classification. */}
                        <div className="flex flex-col gap-4 rounded-xl border border-foreground/12 bg-muted/40 p-4 sm:flex-row sm:items-center">
                            {flag ? (
                                // eslint-disable-next-line @next/next/no-img-element -- tiny external flag asset; next/image is overkill here
                                <img
                                    src={flag}
                                    alt={`Flag of ${geo?.country ?? geo?.countryCode}`}
                                    width={64}
                                    height={48}
                                    loading="lazy"
                                    className="h-11 w-auto shrink-0 rounded-sm border border-foreground/20 object-cover shadow-sm"
                                />
                            ) : (
                                <span className="flex size-11 shrink-0 items-center justify-center rounded-md border border-foreground/15 bg-background text-muted-foreground">
                                    <MapPin className="size-5" />
                                </span>
                            )}
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                    <span className="text-2xl font-bold leading-tight tracking-tight">
                                        {geo?.country ?? "Unknown location"}
                                    </span>
                                    {geo?.countryCode && (
                                        <span className="font-mono text-sm text-muted-foreground">
                                            {geo.countryCode}
                                        </span>
                                    )}
                                    {res?.country && <Disagreement field={res.country} />}
                                </div>
                                {cityRegion && (
                                    <div className="mt-0.5 truncate text-sm text-muted-foreground">
                                        {cityRegion}
                                    </div>
                                )}
                            </div>
                            <span
                                className={cn(
                                    "inline-flex shrink-0 items-center gap-1.5 self-start rounded-md border border-foreground/15 bg-background px-2.5 py-1 text-sm font-medium sm:self-auto",
                                    accent,
                                )}
                            >
                                <TypeIcon className="size-4" />
                                {type.label}
                            </span>
                        </div>

                        {traits.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {traits.map((t) => {
                                    const TIcon = t.icon;
                                    return (
                                        <span
                                            key={t.label}
                                            className={cn(
                                                "inline-flex items-center gap-1.5 rounded-md border border-foreground/15 bg-background px-2.5 py-1 text-sm font-medium",
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

                        {/* Grouped details: network infrastructure, then host/location. */}
                        {hasDetails && (
                            <div className="space-y-4">
                                {(geo!.asn || geo!.asnOrg || geo!.isp || geo!.org) && (
                                    <FieldGroup label="Network">
                                        {geo!.asn && (
                                            <Field icon={Network} label="Network (ASN)" wrap>
                                                <span className="font-mono text-[13px]">
                                                    {geo!.asn}
                                                </span>
                                                {res?.asn && <Disagreement field={res.asn} />}
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
                                    </FieldGroup>
                                )}

                                {(geo!.reverse || coords) && (
                                    <FieldGroup label="Host & location">
                                        {geo!.reverse && (
                                            <Field
                                                icon={SignalHigh}
                                                label="Reverse DNS"
                                                wrap
                                                tone={
                                                    geo!.fcrdns && !geo!.fcrdns.verified
                                                        ? "text-red-600 dark:text-red-400"
                                                        : undefined
                                                }
                                            >
                                                <Pivot value={geo!.reverse} />
                                                {geo!.fcrdns && (
                                                    <span
                                                        title={
                                                            geo!.fcrdns.verified
                                                                ? "Forward-confirmed reverse DNS — the PTR host resolves back to this IP"
                                                                : "PTR is not forward-confirmed — the hostname does not resolve back to this IP"
                                                        }
                                                        className={cn(
                                                            "ml-2 inline-flex items-center rounded-sm border px-1.5 py-0.5 align-middle text-[10px] font-semibold tracking-wide uppercase",
                                                            geo!.fcrdns.verified
                                                                ? "border-emerald-600/40 text-emerald-700 dark:text-emerald-400"
                                                                : "border-red-600/40 text-red-700 dark:text-red-400",
                                                        )}
                                                    >
                                                        {geo!.fcrdns.verified
                                                            ? "FCrDNS pass"
                                                            : "FCrDNS fail"}
                                                    </span>
                                                )}
                                            </Field>
                                        )}
                                        {coords && (
                                            <Field icon={Navigation} label="Coordinates">
                                                <span className="font-mono text-[13px]">{coords}</span>
                                            </Field>
                                        )}
                                    </FieldGroup>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {res && res.providerCount > 0 && (
                    <p className="text-sm text-muted-foreground">
                        Reconciled from {res.providerCount} geo provider
                        {res.providerCount > 1 ? "s" : ""}.
                    </p>
                )}
            </CardContent>
        </Card>
    );
}

export function DomainProfileCard({ result }: { result: DomainCheckResult }) {
    const ctx = result.context;
    const resolves =
        (ctx?.resolvedIps?.length ?? 0) > 0 || (ctx?.ipv6?.length ?? 0) > 0;
    const type = classifyDomain(ctx, resolves);
    const TypeIcon = type.icon;
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
        <Card className="sketch-shadow rounded-2xl border border-foreground/12">
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

                {/* Classification identity header: icon, label, description. */}
                <div className="flex items-center gap-4 rounded-xl border border-foreground/12 bg-muted/40 p-4">
                    <span
                        className={cn(
                            "flex size-12 shrink-0 items-center justify-center rounded-md border border-foreground/15 bg-background",
                            tone,
                        )}
                    >
                        <TypeIcon className="size-6" />
                    </span>
                    <div className="min-w-0 flex-1">
                        <div
                            className={cn(
                                "text-2xl font-bold leading-tight tracking-tight",
                                tone,
                            )}
                        >
                            {type.label}
                        </div>
                        <div className="mt-0.5 text-sm text-muted-foreground">
                            {type.desc}
                        </div>
                    </div>
                </div>

                {ctx && (
                    <div className="flex flex-wrap gap-2">
                        <span
                            className={cn(
                                "inline-flex items-center gap-1.5 rounded-md border border-foreground/15 bg-background px-2.5 py-1 text-sm font-medium",
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
                                className="inline-flex items-center gap-1.5 rounded-md border border-foreground/15 bg-background px-2.5 py-1 text-sm font-medium text-foreground/80"
                            >
                                {s}
                            </span>
                        ))}
                        {ctx.dnssec && ctx.dnssec !== "unknown" && (
                            <span
                                className={cn(
                                    "inline-flex items-center gap-1.5 rounded-md border border-foreground/15 bg-background px-2.5 py-1 text-sm font-medium",
                                    ctx.dnssec === "signed"
                                        ? "text-emerald-600 dark:text-emerald-400"
                                        : "text-foreground/70",
                                )}
                                title={
                                    ctx.dnssec === "signed"
                                        ? "Zone is DNSSEC-signed (resolver set the AD flag)"
                                        : "Zone is not DNSSEC-signed"
                                }
                            >
                                <ShieldCheck className="size-4" />
                                DNSSEC {ctx.dnssec}
                            </span>
                        )}
                        {ctx.resolverAgreement === false && (
                            <span
                                className="inline-flex items-center gap-1.5 rounded-md border border-red-500/40 bg-background px-2.5 py-1 text-sm font-medium text-red-600 dark:text-red-400"
                                title="DoH resolvers returned different A records (GeoDNS, split-horizon, or possible poisoning)"
                            >
                                <ShieldAlert className="size-4" />
                                resolvers disagree
                            </span>
                        )}
                    </div>
                )}

                {/* Grouped details: registration, DNS records, email security. */}
                {ctx ? (
                    <div className="space-y-4">
                        {(ctx.registrar ||
                            created ||
                            expires ||
                            (ctx.categories?.length ?? 0) > 0) && (
                            <FieldGroup label="Registration">
                                {ctx.registrar && (
                                    <Field icon={Building2} label="Registrar">
                                        {ctx.registrar}
                                    </Field>
                                )}
                                {created && (
                                    <Field
                                        icon={CalendarClock}
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
                                {expires && (
                                    <Field icon={History} label="Expires">
                                        {expires}
                                    </Field>
                                )}
                                {ctx.categories && ctx.categories.length > 0 && (
                                    <Field icon={Tag} label="Category">
                                        {ctx.categories.slice(0, 3).join(", ")}
                                    </Field>
                                )}
                            </FieldGroup>
                        )}

                        {(ips.length > 0 ||
                            ns.length > 0 ||
                            (ctx.reverse?.length ?? 0) > 0 ||
                            (ctx.caa?.length ?? 0) > 0) && (
                            <FieldGroup label="DNS records">
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
                                {(ctx.reverse?.length ?? 0) > 0 && (
                                    <Field icon={SignalHigh} label="Reverse DNS (PTR)" wrap>
                                        <PivotList values={ctx.reverse!} />
                                    </Field>
                                )}
                                {(ctx.caa?.length ?? 0) > 0 && (
                                    <Field icon={ShieldCheck} label="CAA" wrap>
                                        <span className="font-mono text-[12px] break-all">
                                            {ctx.caa!.join(", ")}
                                        </span>
                                    </Field>
                                )}
                            </FieldGroup>
                        )}

                        {(mx.length > 0 || ctx.spf || ctx.dmarc) && (
                            <FieldGroup label="Email security">
                                {mx.length > 0 && (
                                    <Field icon={Mail} label="Mail (MX)" wrap>
                                        <PivotList values={mx} />
                                    </Field>
                                )}
                                {ctx.spf && (
                                    <Field icon={Mail} label="SPF" wrap>
                                        <span className="font-mono text-[12px] break-all">
                                            {ctx.spf}
                                        </span>
                                    </Field>
                                )}
                                {ctx.dmarc && (
                                    <Field icon={Mail} label="DMARC" wrap>
                                        <span className="font-mono text-[12px] break-all">
                                            {ctx.dmarc}
                                        </span>
                                    </Field>
                                )}
                            </FieldGroup>
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

export function HashProfileCard({ result }: { result: HashCheckResult }) {
    const ctx = result.context;
    const hasData = result.sources.some(
        (s) => s.status === "ok" && s.score !== undefined,
    );
    const type = classifyHash(ctx, hasData);
    const TypeIcon = type.icon;
    const tone = hashTone(ctx);

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
        <Card className="sketch-shadow rounded-2xl border border-foreground/12">
            <CardContent className="space-y-4">
                <SectionHeading
                    icon={FileDigit}
                    action={
                        <code className="rounded-sm border border-foreground/15 bg-muted/60 px-2.5 py-1 font-mono text-xs font-semibold tracking-tight">
                            {HASH_ALGO_LABEL[result.algorithm]}
                        </code>
                    }
                >
                    What this file is
                </SectionHeading>

                {/* Classification identity header: icon, label, description. */}
                <div className="flex items-center gap-4 rounded-xl border border-foreground/12 bg-muted/40 p-4">
                    <span
                        className={cn(
                            "flex size-12 shrink-0 items-center justify-center rounded-md border border-foreground/15 bg-background",
                            tone,
                        )}
                    >
                        <TypeIcon className="size-6" />
                    </span>
                    <div className="min-w-0 flex-1">
                        <div
                            className={cn(
                                "text-2xl font-bold leading-tight tracking-tight",
                                tone,
                            )}
                        >
                            {type.label}
                        </div>
                        <div className="mt-0.5 text-sm text-muted-foreground">
                            {type.desc}
                        </div>
                    </div>
                </div>

                {/* Grouped details: classification, timeline, fingerprints. */}
                {ctx ? (
                    <div className="space-y-4">
                        {(ctx.malwareFamily ||
                            ctx.threatLabel ||
                            ctx.fileName ||
                            ctx.fileType ||
                            size) && (
                            <FieldGroup label="Classification">
                                {ctx.malwareFamily && (
                                    <Field
                                        icon={Bug}
                                        label="Malware family"
                                        tone="text-red-600 dark:text-red-400"
                                    >
                                        {ctx.malwareFamily}
                                    </Field>
                                )}
                                {ctx.threatLabel && (
                                    <Field
                                        icon={Tag}
                                        label="Threat label"
                                        tone="text-red-600 dark:text-red-400"
                                    >
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
                            </FieldGroup>
                        )}

                        {(firstSeen || lastSeen) && (
                            <FieldGroup label="Timeline">
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
                            </FieldGroup>
                        )}

                        {(ctx.magic || ctx.imphash || ctx.ssdeep) && (
                            <FieldGroup label="Fingerprints">
                                {ctx.magic && (
                                    <Field icon={Binary} label="Magic">
                                        <span className="font-mono text-[13px]">{ctx.magic}</span>
                                    </Field>
                                )}
                                {ctx.imphash && (
                                    <Field icon={Fingerprint} label="Imphash">
                                        <span className="font-mono text-[13px]">{ctx.imphash}</span>
                                    </Field>
                                )}
                                {ctx.ssdeep && (
                                    <Field icon={Fingerprint} label="ssdeep">
                                        <span className="font-mono text-[13px]">{ctx.ssdeep}</span>
                                    </Field>
                                )}
                            </FieldGroup>
                        )}
                    </div>
                ) : (
                    <p className="text-sm text-muted-foreground">
                        {hasData
                            ? "No file metadata was returned for this hash."
                            : "No threat-intel source has this file on record, so there's nothing to describe. An unknown hash isn't necessarily safe; it may just be new or unseen."}
                    </p>
                )}

                <div className="space-y-2">
                    <div className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        Digests
                    </div>
                    <dl className="space-y-1.5">
                        {digests.map((d) => (
                            <div key={d.label} className="flex items-center gap-2 text-xs">
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
                        <div className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
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
                                className="inline-flex items-center rounded-md border border-foreground/15 bg-background px-2.5 py-0.5 text-sm font-medium text-foreground/80"
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
