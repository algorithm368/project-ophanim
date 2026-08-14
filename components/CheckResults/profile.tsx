"use client";

import { useState, type ReactNode } from "react";
import {
    Check,
    ChevronRight,
    Copy,
    FileDigit,
    Globe,
} from "lucide-react";
import {
    type DomainCheckResult,
    type HashCheckResult,
    type HashContext,
} from "@/lib/ti/types";
import {
    formatBytes,
    formatDate,
    hashBehaviorSummary,
} from "@/lib/ti/narrative";
import { describeDll } from "@/lib/ti/dll-dictionary";
import { HASH_ALGO_LABEL } from "@/lib/hash";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    classifyDomain,
    classifyHash,
    domainTone,
} from "./classify";
import {
    Field,
    PivotList,
    SectionHeading,
    useCopied,
} from "./primitives";
import type { IconType } from "./types";

/** A flat group of related fields: a small uppercase label over hairline-
 *  separated rows. The minimal, borderless replacement for the old bento cell —
 *  the profile reads as one document instead of a grid of boxes. */
function Group({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
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
export function Rule() {
    return <div className="h-px bg-foreground/10" />;
}

/** Compact classification header for the domain / hash profile cards: a small
 *  tinted icon, the type label, and a one-line plain-language description. */
function IdentityHeader({
    icon: Icon,
    label,
    desc,
    tone,
}: Readonly<{
    icon?: IconType;
    label: string;
    desc?: string;
    tone?: string;
}>) {
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

export function DomainProfileCard({ result }: Readonly<{ result: DomainCheckResult }>) {
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

function CopyHashButton({ value }: Readonly<{ value: string }>) {
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
export function StatusDot({
    kind,
}: Readonly<{
    kind: "malicious" | "clean" | "known" | "unknown";
}>) {
    return (
        <span
            aria-hidden
            className={cn(
                "mt-[7px] size-2.5 shrink-0 rounded-full",
                kind === "malicious" && "bg-red-500 dark:bg-red-400",
                kind === "clean" && "bg-emerald-500 dark:bg-emerald-400",
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
    narrow = false,
    action,
    children,
}: Readonly<{
    label: string;
    hint?: string;
    mono?: boolean;
    /** Narrower label column (for short fingerprint labels), giving long mono
     *  values more room before truncating. */
    narrow?: boolean;
    action?: ReactNode;
    children: ReactNode;
}>) {
    // Fixed row height so parallel columns (Identity / Fingerprints) share the
    // same horizontal gridlines even when only some rows carry a copy button.
    return (
        <div className="flex min-h-7 items-center gap-3">
            <dt
                title={hint}
                className={cn(
                    "shrink-0 text-[13px] leading-snug text-muted-foreground",
                    narrow ? "w-14" : "w-28",
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
function SubLabel({ children }: Readonly<{ children: ReactNode }>) {
    return (
        <div className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {children}
        </div>
    );
}

/**
 * A collapsible technical section: a clickable header (label + optional count)
 * that expands its body. Collapsed by default so the card opens on the plain
 * summary, with the dense detail one click away. Uses native <details> for
 * zero-JS, keyboard-accessible disclosure.
 */
function Section({
    title,
    count,
    defaultOpen = false,
    children,
}: Readonly<{
    title: string;
    count?: number;
    defaultOpen?: boolean;
    children: ReactNode;
}>) {
    return (
        <details open={defaultOpen} className="group">
            <summary className="flex cursor-pointer list-none items-center gap-2 py-0.5 [&::-webkit-details-marker]:hidden">
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
                <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {title}
                </span>
                {count !== undefined && (
                    <span className="font-mono text-[11px] text-muted-foreground/60">
                        {count}
                    </span>
                )}
            </summary>
            <div className="mt-2 pl-[1.375rem]">{children}</div>
        </details>
    );
}

/**
 * Some sandboxes name signatures as machine tokens (`antivm_checks_available_memory`,
 * `static_pe_pdbpath`). Space out the underscores so capability labels read as
 * phrases; already-readable labels (with spaces) are untouched.
 */
function humanizeCapability(label: string): string {
    return /^[a-z0-9]+(_[a-z0-9]+)+$/i.test(label)
        ? label.replaceAll("_", " ")
        : label;
}

/** Uppercase the first character only; leaves acronyms and the rest untouched. */
function sentenceCase(s: string): string {
    return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** MITRE technique id -> attack.mitre.org URL (handles `T1070.004` sub-techniques). */
function mitreUrl(id: string): string {
    const [base, sub] = id.toUpperCase().split(".");
    return `https://attack.mitre.org/techniques/${base}/${sub ? `${sub}/` : ""}`;
}

/** A technique id that links out to its MITRE ATT&CK page. */
function MitreLink({ id, className }: Readonly<{ id: string; className?: string }>) {
    return (
        <a
            href={mitreUrl(id)}
            target="_blank"
            rel="noreferrer"
            title={`MITRE ATT&CK ${id}`}
            className={cn(
                "underline-offset-2 hover:text-foreground hover:underline",
                className,
            )}
        >
            {id}
        </a>
    );
}

/**
 * A capped list whose "+N more" toggles the full list open/closed. The render
 * prop receives the currently-visible slice, so each caller keeps its own markup.
 */
function ExpandableList<T>({
    items,
    cap,
    children,
}: Readonly<{
    items: T[];
    cap: number;
    children: (shown: T[]) => ReactNode;
}>) {
    const [expanded, setExpanded] = useState(false);
    const shown = expanded ? items : items.slice(0, cap);
    const extra = items.length - shown.length;
    return (
        <>
            {children(shown)}
            {items.length > cap && (
                <button
                    type="button"
                    onClick={() => setExpanded((e) => !e)}
                    className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                    {expanded ? "show less" : `+${extra} more`}
                </button>
            )}
        </>
    );
}

/**
 * One runtime-behaviour row: plain monospace text with a hover-reveal copy button
 * so analysts can lift the IOC. (Pivoting contacted infra lives on the Related
 * indicators card; here we keep the readout plain.)
 */
function RuntimeLine({ item }: Readonly<{ item: string }>) {
    const [copied, copy] = useCopied();
    return (
        <li className="group flex min-w-0 items-center gap-1.5">
            <span
                title={item}
                className="truncate font-mono text-[12px] text-foreground/80"
            >
                {item}
            </span>
            <button
                type="button"
                onClick={() => copy(item)}
                aria-label="Copy"
                className="shrink-0 opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
            >
                {copied ? (
                    <Check className="size-3 text-emerald-600 dark:text-emerald-400" />
                ) : (
                    <Copy className="size-3" />
                )}
            </button>
        </li>
    );
}

/** Display form of a capability: spaced-out tokens, sentence-cased. */
function tidyCapabilityLabel(label: string): string {
    return sentenceCase(humanizeCapability(label).trim());
}

/**
 * Collapse capability variants that different sources word slightly differently
 * (case, punctuation, `snake_case`) into one row, preferring the copy that carries
 * an ATT&CK id, and float ATT&CK-tagged rows to the top. Presentation only, no
 * relabeling of meaning.
 */
function tidyCapabilities(
    caps: { label: string; mitre?: string[] }[],
): { label: string; mitre?: string[] }[] {
    const byKey = new Map<string, { label: string; mitre?: string[] }>();
    for (const c of caps) {
        const key = c.label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        if (!key) continue;
        const prev = byKey.get(key);
        if (!prev || (!prev.mitre?.length && c.mitre?.length)) byKey.set(key, c);
    }
    return [...byKey.values()].sort(
        (a, b) => (b.mitre?.length ? 1 : 0) - (a.mitre?.length ? 1 : 0),
    );
}

/**
 * Drop engine labels that assert only "this is bad" without naming a family
 * (`Detected`, `Malicious`, ML-confidence/score strings, bare `ti!<hash>` refs),
 * then dedupe case-insensitively. Keeps the family/signature strings that actually
 * identify the sample. Filtering noise, not rewriting.
 */
function tidyDetections(names: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of names) {
        const t = raw.trim();
        if (!t) continue;
        const key = t.toLowerCase();
        if (seen.has(key)) continue;
        const noise =
            /^(detected|malicious|malware|clean|undetected|suspicious|unwanted|virus)$/i.test(
                t,
            ) ||
            /^malicious\b.*(confidence|score|\bml\b)/i.test(t) ||
            /\bscore:\s*\d+/i.test(t) ||
            /^(generic|malicious)[._]?ml(\.score)?$/i.test(t) ||
            /^ti![0-9a-f]+$/i.test(t);
        if (noise) continue;
        seen.add(key);
        out.push(t);
    }
    return out;
}

/** Grouped sandbox-observed runtime actions, ordered host-first then network. */
const RUNTIME_GROUPS: {
    key: "commands" | "files" | "registry" | "network";
    label: string;
}[] = [
    { key: "commands", label: "Processes, commands" },
    { key: "files", label: "Files" },
    { key: "registry", label: "Registry" },
    { key: "network", label: "Network" },
];

/**
 * Imported libraries as a mini dictionary: each DLL the binary links against,
 * annotated with what it is for, so imports read as capabilities. Static PE data
 * (present even when the sandbox report is thin), capability-revealing DLLs first.
 */
function DllImports({ dlls }: Readonly<{ dlls: { name: string; count?: number }[] }>) {
    return (
        <ExpandableList items={dlls} cap={8}>
            {(shown) => (
                <ul className="space-y-0.5">
                    {shown.map((d) => {
                        const note = describeDll(d.name);
                        return (
                            <li key={d.name} className="flex items-baseline gap-3">
                                <code className="shrink-0 font-mono text-[12px] text-foreground/85">
                                    {d.name}
                                </code>
                                {note && (
                                    <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
                                        {note}
                                    </span>
                                )}
                                {d.count !== undefined && (
                                    <span
                                        className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground/70"
                                        title={`${d.count} functions imported`}
                                    >
                                        {d.count}
                                    </span>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </ExpandableList>
    );
}

/** "What it did when it ran": VT sandbox artifacts as a compact grouped readout. */
function RuntimeBehavior({
    behavior,
}: Readonly<{
    behavior: NonNullable<HashContext["sandboxBehavior"]>;
}>) {
    const groups = RUNTIME_GROUPS.map((g) => ({
        ...g,
        items: behavior[g.key],
    })).filter(
        (g): g is typeof g & { items: string[] } =>
            Array.isArray(g.items) && g.items.length > 0,
    );
    if (groups.length === 0) return null;

    return (
        <>
            <div className="mb-2 font-mono text-[11px] text-muted-foreground">
                VirusTotal sandbox
            </div>
            <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                {groups.map((g) => (
                    <div key={g.key} className="min-w-0 space-y-1">
                        <div className="text-[12px] font-medium text-foreground/70">
                            {g.label}
                        </div>
                        <ExpandableList items={g.items} cap={5}>
                            {(shown) => (
                                <ul className="space-y-0.5">
                                    {shown.map((item) => (
                                        <RuntimeLine key={item} item={item} />
                                    ))}
                                </ul>
                            )}
                        </ExpandableList>
                    </div>
                ))}
            </div>
        </>
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

/** Substring, normalized-category pairs. Ordered so more specific tokens are
 *  listed first; substrings must not overlap (e.g. no bare "loader" that would
 *  also fire on "downloader"). */
const CATEGORY_TOKENS: { match: string; label: string }[] = [
    { match: "ransomware", label: "ransomware" },
    { match: "ransom", label: "ransomware" },
    { match: "downloader", label: "downloader" },
    { match: "dropper", label: "dropper" },
    { match: "backdoor", label: "backdoor" },
    { match: "keylog", label: "keylogger" },
    { match: "spyware", label: "spyware" },
    { match: "adware", label: "adware" },
    { match: "rootkit", label: "rootkit" },
    { match: "worm", label: "worm" },
    { match: "banker", label: "banker" },
    { match: "stealer", label: "stealer" },
    { match: "miner", label: "miner" },
    { match: "inject", label: "injector" },
    { match: "trojan", label: "trojan" },
    { match: "botnet", label: "botnet" },
    { match: "exploit", label: "exploit" },
    { match: "riskware", label: "riskware" },
    { match: "clicker", label: "clicker" },
    { match: "hacktool", label: "hacktool" },
];

/** Summarize what a file is from its engine detection labels: the malware
 *  categories the engines keep naming, most frequent first, capped at four.
 *  Turns a wall of vendor strings into an at-a-glance read. Detection labels
 *  only, not tags, which are often joke or user labels (EICAR's are nonsense). */
function deriveCategories(labels: string[]): string[] {
    const haystack = labels.map((s) => s.toLowerCase());
    const counts = new Map<string, number>();
    for (const { match, label } of CATEGORY_TOKENS) {
        const n = haystack.filter((s) => s.includes(match)).length;
        if (n > 0) counts.set(label, (counts.get(label) ?? 0) + n);
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([label]) => label);
}

/** `N of M flagged` engines chip, shown in the identity header. */
function EnginesChip({ malicious, total }: Readonly<{ malicious: number; total: number }>) {
    return (
        <code className="ml-auto shrink-0 rounded-sm border border-foreground/15 bg-muted/60 px-2 py-0.5 font-mono text-[11px] font-semibold tracking-tight text-foreground/80">
            {malicious} / {total} flagged
        </code>
    );
}

export function HashProfileCard({ result }: Readonly<{ result: HashCheckResult }>) {
    const ctx = result.context;
    const hasData = result.sources.some(
        (s) => s.status === "ok" && s.score !== undefined,
    );
    const type = classifyHash(ctx, hasData);
    // Severity signal follows the actual verdict, not just whether a family label
    // exists — otherwise a clean file with a family (EICAR) looks malicious and a
    // malicious file without one (a flagged script) looks benign.
    const kind: "malicious" | "clean" | "known" | "unknown" =
        result.verdict === "malicious" || result.verdict === "suspicious"
            ? "malicious"
            : result.verdict === "clean"
              ? "clean"
              : result.verdict === "unknown" && !ctx
                ? "unknown"
                : "known";
    const tone =
        kind === "malicious"
            ? "text-red-600 dark:text-red-400"
            : kind === "clean"
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-foreground/80";

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
    const capabilities = tidyCapabilities(ctx?.capabilities ?? []);
    const techniques = ctx?.mitreTechniques ?? [];
    // VT sandbox behaviour is aggregated across every submission of a hash, so for
    // a clean-verdict file it can surface unrelated/among-noise behaviour. Suppress
    // the prominent behaviour summary + tags there so a benign file doesn't read as
    // malicious; the (collapsed) detail sections stay available.
    const isClean = result.verdict === "clean";
    const behaviorTags = isClean ? [] : (ctx?.behaviorTags ?? []);
    const behaviorSummary = isClean ? undefined : hashBehaviorSummary(ctx);
    const dlls = ctx?.importedDlls ?? [];
    const refs = ctx?.familyRefs ?? [];
    // Full set drives category derivation; the tidied set is what we display.
    const detectionsAll = [...new Set(ctx?.detectionNames ?? [])];
    const detections = tidyDetections(detectionsAll);
    const ratio = ctx?.detectionRatio;
    const shownTech = new Set(
        capabilities.flatMap((c) => (c.mitre ?? []).map((id) => id.toUpperCase())),
    );
    const extraTech = techniques.filter(
        (t) => !shownTech.has(t.id.toUpperCase()),
    );
    // A flagged file with nothing to show (no behaviour, labels, imports) would
    // otherwise render an empty card that never says why it's flagged.
    const isThreat =
        result.verdict === "malicious" || result.verdict === "suspicious";
    const emptyThreat =
        isThreat &&
        !behaviorSummary &&
        capabilities.length === 0 &&
        detections.length === 0 &&
        extraTech.length === 0 &&
        dlls.length === 0 &&
        !ctx?.sandboxBehavior;
    const categories = deriveCategories(detectionsAll);
    const hasIdentityFacts = Boolean(
        ctx?.fileName || ctx?.fileType || size || firstSeen || lastSeen,
    );

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

                {/* Header: verdict dot, family, at-a-glance categories + tally. */}
                <div className="flex items-start gap-3">
                    <StatusDot kind={kind} />
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <span
                                className={cn(
                                    "text-lg font-bold uppercase leading-tight tracking-tight",
                                    tone,
                                )}
                            >
                                {type.label}
                            </span>
                            {ratio && (
                                <EnginesChip
                                    malicious={ratio.malicious}
                                    total={ratio.total}
                                />
                            )}
                        </div>
                        {type.desc && (
                            <div className="mt-0.5 text-sm text-muted-foreground">
                                {type.desc}
                            </div>
                        )}
                        {categories.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                                {categories.map((c) => (
                                    <span
                                        key={c}
                                        className="inline-flex items-center rounded-md border border-foreground/15 bg-muted/40 px-2 py-0.5 text-xs font-medium text-foreground/75"
                                    >
                                        {c}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Plain-language lead: what it does, then the family write-up. */}
                {behaviorSummary && (
                    <p className="text-[0.95rem] leading-relaxed text-foreground/90">
                        {behaviorSummary}
                    </p>
                )}

                {emptyThreat && (
                    <p className="text-sm leading-relaxed text-muted-foreground">
                        Flagged by scoring sources, but no behaviour, engine labels,
                        or imports are on record to detail what it does. The score
                        rests on limited signal, check the score breakdown and
                        sources below.
                    </p>
                )}

                {ctx?.familyDescription && (
                    <p className="text-sm leading-relaxed text-foreground/85">
                        {ctx.familyDescription}
                    </p>
                )}

                {behaviorTags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                        {behaviorTags.map((t) => (
                            <span
                                key={t}
                                className="inline-flex items-center rounded-md border border-foreground/15 bg-muted/40 px-2 py-0.5 text-xs font-medium text-foreground/75"
                            >
                                {t.toLowerCase().replaceAll("_", " ")}
                            </span>
                        ))}
                    </div>
                )}

                <Rule />

                {/* Two-column dossier: identity facts left, fingerprints right. */}
                <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
                    {hasIdentityFacts && (
                        <div className="space-y-1">
                            <SubLabel>Identity</SubLabel>
                            <dl>
                                {ctx?.fileName && (
                                    <HashRow label="name">{ctx.fileName}</HashRow>
                                )}
                                {ctx?.fileType && (
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
                        </div>
                    )}

                    <div className="space-y-1">
                        <SubLabel>Fingerprints</SubLabel>
                        <dl>
                            {digests.map((d) => (
                                <HashRow
                                    key={d.label}
                                    label={d.label.toLowerCase()}
                                    mono
                                    narrow
                                    action={<CopyHashButton value={d.value} />}
                                >
                                    {d.value}
                                </HashRow>
                            ))}
                            {ctx?.imphash && (
                                <HashRow
                                    label="imphash"
                                    mono
                                    narrow
                                    hint="Hash of the PE import table, clusters samples built from the same code"
                                >
                                    {ctx.imphash}
                                </HashRow>
                            )}
                            {ctx?.ssdeep && (
                                <HashRow
                                    label="ssdeep"
                                    mono
                                    narrow
                                    hint="Fuzzy hash, matches files that are similar but not identical"
                                >
                                    {ctx.ssdeep}
                                </HashRow>
                            )}
                            {ctx?.magic && (
                                <HashRow
                                    label="magic"
                                    mono
                                    narrow
                                    hint="libmagic file-type signature derived from the file's leading bytes"
                                >
                                    {ctx.magic}
                                </HashRow>
                            )}
                        </dl>
                    </div>
                </div>

                {/* `aka` only. The raw VT `tags` field is dropped: it is community
                    /crowd-sourced and often noise (EICAR's read "ransomware, worm,
                    backdoor, …"). Real classification comes from the category chips. */}
                {altNames.length > 0 && (
                    <dl>
                        <HashRow label="aka">
                            {altNames.slice(0, 6).join(", ")}
                            {altNames.length > 6 && ` +${altNames.length - 6}`}
                        </HashRow>
                    </dl>
                )}

                {/* Technical detail, collapsed by default so the card opens on the
                    plain summary; each section expands on click. */}
                {(capabilities.length > 0 ||
                    detections.length > 0 ||
                    extraTech.length > 0 ||
                    dlls.length > 0 ||
                    ctx?.sandboxBehavior ||
                    refs.length > 0) && (
                    <>
                        <Rule />
                        <div className="space-y-1.5">
                            {capabilities.length > 0 && (
                                <Section
                                    title="What this file does"
                                    count={capabilities.length}
                                >
                                    <ExpandableList items={capabilities} cap={10}>
                                        {(shown) => (
                                            <ul className="space-y-0.5">
                                                {shown.map((c) => (
                                                    <li
                                                        key={c.label}
                                                        className="flex items-baseline justify-between gap-3"
                                                    >
                                                        <span
                                                            title={c.label}
                                                            className="truncate text-[13px] text-foreground/85"
                                                        >
                                                            {tidyCapabilityLabel(c.label)}
                                                        </span>
                                                        {c.mitre?.[0] && (
                                                            <MitreLink
                                                                id={c.mitre[0]}
                                                                className="shrink-0 font-mono text-[11px] text-muted-foreground"
                                                            />
                                                        )}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </ExpandableList>
                                </Section>
                            )}

                            {detections.length > 0 && (
                                <Section
                                    title="Detection labels"
                                    count={detections.length}
                                >
                                    <ExpandableList items={detections} cap={8}>
                                        {(shown) => (
                                            <ul className="space-y-0.5">
                                                {shown.map((n) => (
                                                    <li
                                                        key={n}
                                                        title={n}
                                                        className="truncate font-mono text-[12px] text-foreground/80"
                                                    >
                                                        {n}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </ExpandableList>
                                </Section>
                            )}

                            {extraTech.length > 0 && (
                                <Section title="MITRE ATT&CK" count={extraTech.length}>
                                    <div className="flex flex-wrap gap-1.5">
                                        {extraTech.map((t) => (
                                            <a
                                                key={t.id}
                                                href={mitreUrl(t.id)}
                                                target="_blank"
                                                rel="noreferrer"
                                                title={t.tactic ?? `MITRE ATT&CK ${t.id}`}
                                                className="inline-flex items-center rounded-md border border-foreground/15 bg-background px-2 py-0.5 font-mono text-[12px] text-foreground/80 transition-colors hover:border-foreground/40 hover:bg-muted"
                                            >
                                                {t.id}
                                                {t.name ? ` ${t.name}` : ""}
                                            </a>
                                        ))}
                                    </div>
                                </Section>
                            )}

                            {dlls.length > 0 && (
                                <Section
                                    title="Imported libraries"
                                    count={dlls.length}
                                >
                                    <DllImports dlls={dlls} />
                                </Section>
                            )}

                            {ctx?.sandboxBehavior && (
                                <Section title="Runtime behavior">
                                    <RuntimeBehavior
                                        behavior={ctx.sandboxBehavior}
                                    />
                                </Section>
                            )}

                            {refs.length > 0 && (
                                <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 pl-[1.375rem]">
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
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
}
