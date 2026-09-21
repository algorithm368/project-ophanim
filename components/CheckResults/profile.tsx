"use client";

import { useState, type ReactNode } from "react";
import { Check, ChevronRight, Copy } from "lucide-react";
import { type HashCheckResult, type HashContext } from "@/lib/ti/types";
import {
    formatBytes,
    formatDate,
    hashBehaviorSummary,
    hashCleanSummary,
} from "@/lib/ti/narrative";
import { describeDll } from "@/lib/ti/dll-dictionary";
import { HASH_ALGO_LABEL } from "@/lib/hash";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
    RecordRow,
    RecordSection,
    RecordTable,
    SectionHeading,
    useCopied,
} from "./primitives";

/** A hairline rule used to separate the identity line from the field groups. */
export function Rule() {
    return <div className="h-px bg-foreground/10" />;
}

function CopyHashButton({ value }: Readonly<{ value: string }>) {
    const [copied, copy] = useCopied();
    return (
        <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-label="Copy hash"
            className="size-6 shrink-0 p-0 text-muted-foreground hover:text-foreground"
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

/** ssdeep has no spaces to wrap at, so the browser's default word-wrap
 *  greedily fills the first line and leaves whatever didn't fit — often a
 *  single stray character — dangling alone on the next. ssdeep's own format
 *  (`blocksize:hash:hash`) already has natural break points; marking them
 *  with a `<wbr>` lets the layout wrap between chunks instead of mid-hash. */
function breakableSsdeep(value: string): ReactNode {
    let offset = 0;
    return value.split(/([:/])/).map((part) => {
        const start = offset;
        offset += part.length;
        return part === ":" || part === "/" ? (
            <span key={start}>
                {part}
                <wbr />
            </span>
        ) : (
            part
        );
    });
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
    const subPath = sub ? `${sub}/` : "";
    return `https://attack.mitre.org/techniques/${base}/${subPath}`;
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

export function HashProfileCard({
    result,
    streaming = false,
}: Readonly<{
    result: HashCheckResult | null;
    /** Set while the panel is still answering. Renders a plain skeleton, since
     *  no verdict, family, or fingerprint can be shown until the result lands. */
    streaming?: boolean;
}>) {
    if (streaming || !result) {
        return (
            <div className="space-y-3">
                <SectionHeading>Analysis</SectionHeading>
                <div className="space-y-2">
                    <span className="sweep block h-3 w-full rounded" />
                    <span className="sweep block h-3 w-5/6 rounded" />
                </div>
            </div>
        );
    }

    const ctx = result.context;

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
    // Only for the clean case: why nothing here reads as a threat, built from
    // whatever positive signals (signature, sandbox, engine tally) exist.
    const cleanSummary = isClean ? hashCleanSummary(ctx) : [];
    const dlls = ctx?.importedDlls ?? [];
    const refs = ctx?.familyRefs ?? [];
    // Deduplicated before the noise filter below tidies the labels for display.
    const detectionsAll = [...new Set(ctx?.detectionNames ?? [])];
    const detections = tidyDetections(detectionsAll);
    const yaraRules = [
        ...new Set(
            (result.sources.find((s) => s.source.id === "yaraify")?.details
                ?.yaraRules as string[] | undefined) ?? [],
        ),
    ];
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
    const hasIdentityFacts = Boolean(
        ctx?.fileName || ctx?.fileType || size || firstSeen || lastSeen,
    );
    // Whether there is write-up text (what it does, the family blurb, why a
    // clean file reads clean) to show prominently under the masthead.
    const hasSummaryText = Boolean(
        behaviorSummary || ctx?.familyDescription || cleanSummary.length > 0,
    );

    return (
        <div className="space-y-3">
            {/* What the file was seen doing. What it *is* lives in the subject
                record inside the panel above; this is only behaviour, which is
                why the heading names that rather than the file. */}
            <SectionHeading>Analysis</SectionHeading>
            <div className="space-y-4">
                {emptyThreat && (
                    <p className="text-sm leading-relaxed text-muted-foreground">
                        Flagged by scoring sources, but no behaviour, engine labels,
                        or imports are on record to detail what it does. The score
                        rests on limited signal, check the score breakdown and
                        sources below.
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

                <RecordTable>
                    {hasIdentityFacts && (
                        // Titled "File" rather than "Identity": the masthead above
                        // already has an "Identity" section (Subject/Class/Priors/…),
                        // and repeating the title back to back read as a duplicated
                        // section rather than two distinct groupings.
                        <RecordSection title="File">
                            {ctx?.fileName && (
                                <RecordRow label="Name">{ctx.fileName}</RecordRow>
                            )}
                            {ctx?.fileType && (
                                <RecordRow label="Type">{ctx.fileType}</RecordRow>
                            )}
                            {size && <RecordRow label="Size">{size}</RecordRow>}
                            {firstSeen && (
                                <RecordRow label="First seen">{firstSeen}</RecordRow>
                            )}
                            {lastSeen && (
                                <RecordRow label="Last seen">{lastSeen}</RecordRow>
                            )}
                            {/* The raw VT `tags` field is dropped: it is community/
                                crowd-sourced and often noise (EICAR's read "ransomware,
                                worm, backdoor, …"). Real classification comes from the
                                category chips. */}
                            {altNames.length > 0 && (
                                <RecordRow label="Also known as">
                                    {altNames.slice(0, 6).join(", ")}
                                    {altNames.length > 6 && ` +${altNames.length - 6}`}
                                </RecordRow>
                            )}
                        </RecordSection>
                    )}

                    <RecordSection title="Fingerprints">
                        {digests.map((d) => (
                            <RecordRow key={d.label} label={d.label} mono>
                                <span className="inline-flex flex-wrap items-center gap-1.5">
                                    {d.value}
                                    <CopyHashButton value={d.value} />
                                </span>
                            </RecordRow>
                        ))}
                        {ctx?.imphash && (
                            <RecordRow
                                label="Imphash"
                                mono
                                hint="Hash of the PE import table, clusters samples built from the same code"
                            >
                                {ctx.imphash}
                            </RecordRow>
                        )}
                        {ctx?.ssdeep && (
                            <RecordRow
                                label="ssdeep"
                                mono
                                hint="Fuzzy hash, matches files that are similar but not identical"
                            >
                                {breakableSsdeep(ctx.ssdeep)}
                            </RecordRow>
                        )}
                        {ctx?.magic && (
                            <RecordRow
                                label="Magic"
                                mono
                                hint="libmagic file-type signature derived from the file's leading bytes"
                            >
                                {ctx.magic}
                            </RecordRow>
                        )}
                    </RecordSection>
                </RecordTable>

                {hasSummaryText && (
                    <div className="space-y-2 rounded-md border border-foreground/10 bg-muted/30 p-3">
                        {behaviorSummary && (
                            <p className="text-sm leading-relaxed text-foreground/85">
                                {behaviorSummary}
                            </p>
                        )}
                        {cleanSummary.map((sentence) => (
                            <p key={sentence} className="text-sm leading-relaxed text-foreground/85">
                                {sentence}
                            </p>
                        ))}
                        {ctx?.familyDescription && (
                            <p className="text-sm leading-relaxed text-foreground/85">
                                {ctx.familyDescription}
                            </p>
                        )}
                    </div>
                )}

                {/* Technical detail, collapsed by default so the card opens on the
                    plain summary; each section expands on click. */}
                {(capabilities.length > 0 ||
                    detections.length > 0 ||
                    yaraRules.length > 0 ||
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

                            {yaraRules.length > 0 && (
                                <Section
                                    title="YARA rules matched"
                                    count={yaraRules.length}
                                >
                                    <ExpandableList items={yaraRules} cap={8}>
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
            </div>
        </div>
    );
}
