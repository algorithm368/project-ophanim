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
            className="group inline-flex max-w-full items-center gap-1 rounded-[8px_11px_7px_10px/10px_7px_11px_8px] border border-dashed border-foreground/30 bg-background/60 px-1.5 py-0.5 align-middle font-mono text-[12px] text-foreground transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary"
        >
            <span className="truncate">{text}</span>
            <Search className="size-3 shrink-0 opacity-40 transition-opacity group-hover:opacity-100" />
        </button>
    );
}

/** Wrapping list of pivotable indicators with a "+N more" overflow note. */
export function PivotList({ values, max = 4 }: { values: string[]; max?: number }) {
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

export function ScoreRing({ value, stroke }: { value: number; stroke: string }) {
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

export function SectionHeading({
    icon: Icon,
    children,
}: {
    icon: IconType;
    children: ReactNode;
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

export function Field({
    icon: Icon,
    label,
    children,
    wrap = false,
}: {
    icon: IconType;
    label: string;
    children: ReactNode;
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
