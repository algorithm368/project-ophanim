"use client";

import {
    createContext,
    useContext,
    useState,
    type ReactNode,
} from "react";
import { Check, Copy, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { IconType } from "./types";

/**
 * Lets nested result fields launch a fresh check for a related indicator,
 * turning isolated lookups into a connected web (an IP's reverse DNS, a
 * domain's resolved IPs / nameservers / mail hosts, etc.).
 */
export const PivotContext = createContext<((value: string) => void) | null>(null);

/** A related indicator rendered as a one-click pivot into its own check.
 *  Falls back to plain text when no pivot handler is provided. */
export function Pivot({ value, label }: { value: string; label?: string }) {
    const pivot = useContext(PivotContext);
    const text = label ?? value;
    if (!pivot) return <span className="font-mono text-[13px]">{text}</span>;
    return (
        <button
            type="button"
            onClick={() => pivot(value)}
            title={`Check ${value}`}
            className="group inline-flex max-w-full items-center gap-1 rounded-sm border border-border bg-muted/50 px-1.5 py-0.5 align-middle font-mono text-[12px] text-foreground transition-colors hover:border-foreground/40 hover:bg-muted"
        >
            <span className="truncate">{text}</span>
            <Search className="size-3 shrink-0 opacity-40 transition-opacity group-hover:opacity-100" />
        </button>
    );
}

/** Wrapping list of pivotable indicators with an expandable "+N more" overflow. */
export function PivotList({ values, max = 4 }: { values: string[]; max?: number }) {
    // Dedupe so repeated values (e.g. two IPs sharing a PTR) don't collide as
    // React keys or show as duplicate chips.
    const unique = [...new Set(values)];
    const [expanded, setExpanded] = useState(false);
    const shown = expanded ? unique : unique.slice(0, max);
    const extra = unique.length - shown.length;
    return (
        <div className="flex flex-wrap gap-1.5">
            {shown.map((v) => (
                <Pivot key={v} value={v} />
            ))}
            {extra > 0 && (
                <button
                    type="button"
                    onClick={() => setExpanded(true)}
                    className="self-center text-[12px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                    +{extra} more
                </button>
            )}
            {expanded && unique.length > max && (
                <button
                    type="button"
                    onClick={() => setExpanded(false)}
                    className="self-center text-[12px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                    show less
                </button>
            )}
        </div>
    );
}

export function ScoreRing({ value, stroke }: { value: number; stroke: string }) {
    const radius = 50;
    const circumference = 2 * Math.PI * radius;
    const clamped = Math.max(0, Math.min(100, value));
    const offset = circumference - (clamped / 100) * circumference;
    return (
        <svg viewBox="0 0 120 120" className="size-full">
            {/* smooth track */}
            <circle
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                strokeWidth="10"
                className="stroke-foreground/12"
            />
            {/* progress arc */}
            <g transform="rotate(-90 60 60)">
                <circle
                    cx="60"
                    cy="60"
                    r={radius}
                    fill="none"
                    strokeWidth="10"
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
export function useCopied(): [boolean, (value: string) => Promise<void>] {
    const [copied, setCopied] = useState(false);
    async function copy(value: string) {
        if (await copyToClipboard(value)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        }
    }
    return [copied, copy];
}

export function CopyableSummary({ text }: { text: string }) {
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
                    className="gap-1.5 text-sm text-muted-foreground hover:text-foreground"
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

export function SectionHeading({
    icon: Icon,
    children,
    action,
}: {
    icon: IconType;
    children: ReactNode;
    /** Optional right-aligned content (e.g. the indicator chip) shown on the
     *  same row as the title, above the shared divider. */
    action?: ReactNode;
}) {
    return (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-foreground/10 pb-3">
            <h2 className="flex items-center gap-2.5">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-foreground/15 bg-background text-foreground/65">
                    <Icon className="size-4" />
                </span>
                <span className="font-mono text-[13px] font-semibold tracking-[0.12em] text-foreground uppercase">
                    {children}
                </span>
            </h2>
            {action}
        </div>
    );
}

/** One labeled datum, rendered as an aligned readout row: a fixed label column
 *  on the left, the value flowing in the column beside it. Stacks label-over-value
 *  on narrow screens. Grouped under a <FieldGroup> for a scannable, report-style
 *  layout — no per-field boxes or icons. */
export function Field({
    label,
    children,
    wrap = false,
    tone,
    hint,
}: {
    label: string;
    children: ReactNode;
    /** Allow multi-line / wrapping content (e.g. pivot chips, long DNS records)
     *  instead of truncating the value to a single line. */
    wrap?: boolean;
    /** Color class (e.g. "text-red-600 …") to tint a risk-relevant value. */
    tone?: string;
    /** Plain-language tooltip for a jargon label (ASN, CAA, SPF, ssdeep, …).
     *  Marks the label with a dotted underline to signal it's explainable. */
    hint?: string;
}) {
    const labelEl = (
        <dt
            title={hint}
            className={cn(
                "text-[13px] leading-snug text-muted-foreground",
                !wrap && "shrink-0 sm:w-32",
                hint &&
                    "w-fit cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-2",
            )}
        >
            {label}
        </dt>
    );

    // Long / chip values (`wrap`) stack under the label and take the full cell
    // width, so they never truncate inside a narrow bento cell. Short scalar
    // values keep the aligned label→value columns.
    if (wrap) {
        return (
            <div className="py-1.5">
                {labelEl}
                <dd
                    className={cn(
                        "mt-1 min-w-0 text-sm font-medium",
                        tone ?? "text-foreground",
                    )}
                >
                    {children}
                </dd>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-x-3 gap-y-0.5 py-1.5 sm:flex-row sm:items-baseline">
            {labelEl}
            <dd
                className={cn(
                    "min-w-0 flex-1 truncate text-sm font-medium",
                    tone ?? "text-foreground",
                )}
            >
                {children}
            </dd>
        </div>
    );
}

/** A bordered "bento" cell with an uppercase section label — the building block
 *  of the report's left-to-right grid. Pass `span` to make a cell occupy the
 *  full grid width (for groups with long values that shouldn't be cramped). */
export function BentoCell({
    label,
    children,
    span = false,
}: {
    label: string;
    children: ReactNode;
    span?: boolean;
}) {
    return (
        <div
            className={cn(
                "rounded-xl border border-foreground/10 bg-muted/30 p-3.5",
                span && "sm:col-span-2",
            )}
        >
            <div className="mb-2 font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                {label}
            </div>
            {children}
        </div>
    );
}

/** A labeled sub-section of related fields, rendered as a bento cell of aligned
 *  <Field> rows separated by hairlines. Pass `span` for full-width groups. */
export function FieldGroup({
    label,
    children,
    span = false,
}: {
    label: string;
    children: ReactNode;
    span?: boolean;
}) {
    return (
        <BentoCell label={label} span={span}>
            <dl className="divide-y divide-foreground/[0.06] [&>:first-child]:pt-0 [&>:last-child]:pb-0">
                {children}
            </dl>
        </BentoCell>
    );
}
