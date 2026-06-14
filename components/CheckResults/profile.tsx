"use client";

import {
    Check,
    Copy,
    FileDigit,
    Globe,
    MapPin,
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
    BentoCell,
    Field,
    FieldGroup,
    Pivot,
    PivotList,
    SectionHeading,
    useCopied,
} from "./primitives";
import { VotingCard } from "./voting";
import type { IconType } from "./types";

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
    const TypeIcon = type.icon;
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

                {/* Uniform bento grid: location, type, network, host. Every block
                    shares the same cell chrome and stays monochrome — color is
                    reserved for the verdict elsewhere. */}
                <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2">
                    {/* Where the address sits: grayscale flag, country, city. */}
                    <BentoCell label="Location">
                        <div className="flex items-center gap-3">
                            {flag ? (
                                // eslint-disable-next-line @next/next/no-img-element -- tiny external flag asset; next/image is overkill here
                                <img
                                    src={flag}
                                    alt={`Flag of ${geo?.country ?? geo?.countryCode}`}
                                    width={64}
                                    height={48}
                                    loading="lazy"
                                    className="h-9 w-auto shrink-0 rounded-sm border border-foreground/20 object-cover"
                                />
                            ) : (
                                <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-foreground/15 bg-background text-muted-foreground">
                                    <MapPin className="size-5" />
                                </span>
                            )}
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                    <span className="text-base font-semibold leading-tight tracking-tight">
                                        {geo?.country ?? "Unknown location"}
                                    </span>
                                    {geo?.countryCode && (
                                        <span className="font-mono text-xs text-muted-foreground">
                                            {geo.countryCode}
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
                    </BentoCell>

                    {/* What kind of address it is, monochrome (no risk tint). */}
                    <BentoCell label="Type">
                        <div className="flex items-start gap-3">
                            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border border-foreground/15 bg-background text-foreground/65">
                                <TypeIcon className="size-5" />
                            </span>
                            <div className="min-w-0">
                                <div className="text-base font-semibold leading-tight tracking-tight text-foreground">
                                    {type.label}
                                </div>
                                <div className="mt-0.5 text-sm text-muted-foreground">
                                    {type.desc}
                                </div>
                            </div>
                        </div>
                    </BentoCell>

                    {(geo?.asn || geo?.asnOrg || geo?.isp || geo?.org) && (
                        <FieldGroup label="Network">
                            {geo!.asn && (
                                <Field
                                    label="ASN"
                                    hint="Autonomous System Number, the network block this IP routes through"
                                >
                                    <span className="font-mono text-[13px]">
                                        {geo!.asn}
                                    </span>
                                </Field>
                            )}
                            {geo!.asnOrg && (
                                <Field label="ASN operator">{geo!.asnOrg}</Field>
                            )}
                            {geo!.isp && <Field label="ISP">{geo!.isp}</Field>}
                            {geo!.org && (
                                <Field label="Organization">{geo!.org}</Field>
                            )}
                        </FieldGroup>
                    )}

                    {(geo?.reverse || coords) && (
                        <FieldGroup label="Host & location">
                            {geo!.reverse && (
                                <Field
                                    label="Reverse DNS"
                                    hint="The PTR hostname this IP maps back to"
                                >
                                    <Pivot value={geo!.reverse} />
                                    {geo!.fcrdns && (
                                        <span
                                            title={
                                                geo!.fcrdns.verified
                                                    ? "Forward-confirmed reverse DNS, the PTR host resolves back to this IP"
                                                    : "PTR is not forward-confirmed, the hostname does not resolve back to this IP"
                                            }
                                            className={cn(
                                                "ml-2 inline-flex items-center rounded-sm border px-1.5 py-0.5 align-middle text-[10px] font-semibold tracking-wide uppercase",
                                                geo!.fcrdns.verified
                                                    ? "border-foreground/20 text-muted-foreground"
                                                    : "border-foreground bg-foreground text-background",
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
                                <Field label="Coordinates">
                                    <span className="font-mono text-[13px]">{coords}</span>
                                </Field>
                            )}
                        </FieldGroup>
                    )}
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

                {/* Grouped details: registration, DNS records, email security. */}
                {ctx ? (
                    <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2">
                        {(ctx.registrar ||
                            created ||
                            expires ||
                            (ctx.categories?.length ?? 0) > 0) && (
                            <FieldGroup label="Registration">
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
                                {expires && (
                                    <Field label="Expires">{expires}</Field>
                                )}
                                {ctx.categories && ctx.categories.length > 0 && (
                                    <Field label="Category">
                                        {ctx.categories.slice(0, 3).join(", ")}
                                    </Field>
                                )}
                            </FieldGroup>
                        )}

                        {(ips.length > 0 ||
                            ns.length > 0 ||
                            (ctx.reverse?.length ?? 0) > 0 ||
                            (ctx.caa?.length ?? 0) > 0 ||
                            (ctx.dnssec !== undefined && ctx.dnssec !== "unknown") ||
                            ctx.resolverAgreement === false) && (
                            <FieldGroup label="DNS records">
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
                                {ctx.resolverAgreement === false && (
                                    <Field
                                        label="Resolvers"
                                        hint="DoH resolvers returned different A records, GeoDNS, split-horizon, or possible poisoning"
                                        tone="text-red-600 dark:text-red-400"
                                    >
                                        Disagree
                                    </Field>
                                )}
                            </FieldGroup>
                        )}

                        {(mx.length > 0 || ctx.spf || ctx.dmarc) && (
                            <FieldGroup label="Email security" span>
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

                {/* Classification identity header. */}
                <IdentityHeader
                    icon={TypeIcon}
                    label={type.label}
                    desc={type.desc}
                    tone={tone}
                />

                {/* Grouped details: classification, timeline, fingerprints. */}
                {ctx ? (
                    <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2">
                        {(ctx.malwareFamily ||
                            ctx.threatLabel ||
                            ctx.fileName ||
                            ctx.fileType ||
                            size) && (
                            <FieldGroup label="Classification">
                                {ctx.malwareFamily && (
                                    <Field
                                        label="Malware family"
                                        tone="text-red-600 dark:text-red-400"
                                    >
                                        {ctx.malwareFamily}
                                    </Field>
                                )}
                                {ctx.threatLabel && (
                                    <Field
                                        label="Threat label"
                                        tone="text-red-600 dark:text-red-400"
                                    >
                                        {ctx.threatLabel}
                                    </Field>
                                )}
                                {ctx.fileName && (
                                    <Field label="File name">
                                        <span className="font-mono text-[13px]">
                                            {ctx.fileName}
                                        </span>
                                    </Field>
                                )}
                                {ctx.fileType && (
                                    <Field label="File type">{ctx.fileType}</Field>
                                )}
                                {size && <Field label="Size">{size}</Field>}
                            </FieldGroup>
                        )}

                        {(firstSeen || lastSeen) && (
                            <FieldGroup label="Timeline">
                                {firstSeen && (
                                    <Field label="First seen">{firstSeen}</Field>
                                )}
                                {lastSeen && (
                                    <Field label="Last seen">{lastSeen}</Field>
                                )}
                            </FieldGroup>
                        )}

                        {(ctx.magic || ctx.imphash || ctx.ssdeep) && (
                            <FieldGroup label="Fingerprints" span>
                                {ctx.magic && (
                                    <Field
                                        label="Magic"
                                        wrap
                                        hint="libmagic file-type signature derived from the file's leading bytes"
                                    >
                                        <span className="font-mono text-[13px] break-all">
                                            {ctx.magic}
                                        </span>
                                    </Field>
                                )}
                                {ctx.imphash && (
                                    <Field
                                        label="Imphash"
                                        wrap
                                        hint="Hash of the PE import table, clusters samples built from the same code"
                                    >
                                        <span className="font-mono text-[13px] break-all">
                                            {ctx.imphash}
                                        </span>
                                    </Field>
                                )}
                                {ctx.ssdeep && (
                                    <Field
                                        label="ssdeep"
                                        wrap
                                        hint="Fuzzy hash, matches files that are similar but not identical"
                                    >
                                        <span className="font-mono text-[13px] break-all">
                                            {ctx.ssdeep}
                                        </span>
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

                <BentoCell label="Digests">
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
                </BentoCell>

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
