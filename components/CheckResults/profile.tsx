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
import {
    formatBytes,
    formatDate,
    joinPlace,
} from "@/lib/ti/narrative";
import { HASH_ALGO_LABEL } from "@/lib/hash";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    classifyType,
    classifyDomain,
    classifyHash,
    domainVibe,
    flagUrl,
    hashVibe,
    locationQuip,
} from "./classify";
import { Field, Pivot, PivotList, SectionHeading, useCopied } from "./primitives";
import type { IconType } from "./types";

export function ProfileCard({ result }: { result: CheckResult }) {
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

export function DomainProfileCard({ result }: { result: DomainCheckResult }) {
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

export function HashProfileCard({ result }: { result: HashCheckResult }) {
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
