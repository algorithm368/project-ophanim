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

/**
 * Lets nested result fields launch a fresh check for a related indicator,
 * turning isolated lookups into a connected web (an IP's reverse DNS, a
 * domain's resolved IPs / nameservers / mail hosts, etc.).
 */
export const PivotContext = createContext<((value: string) => void) | null>(null);

/** A related indicator rendered as a one-click pivot into its own check.
 *  Falls back to plain text when no pivot handler is provided. */
export function Pivot({ value, label }: Readonly<{ value: string; label?: string }>) {
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
export function PivotList({ values, max = 4 }: Readonly<{ values: string[]; max?: number }>) {
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
        ta.remove();
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

/**
 * A button that puts `text` on the clipboard, whether or not the page is
 * showing that text.
 *
 * Separate from `CopyableSummary` because the scan page needs exactly that
 * split: it prints only the judgement, since every fact the full paragraph
 * recites is already a row of its own, but what gets pasted into a ticket has
 * to read without the table beside it. One button either way, so the copied
 * state does not get a second implementation.
 */
export function CopyButton({
    text,
    label = "Copy summary",
}: Readonly<{ text: string; label?: string }>) {
    const [copied, copy] = useCopied();
    return (
        <div className="-ml-1.5 flex flex-wrap items-center gap-1">
            <Button
                type="button"
                variant="ghost"
                size="xs"
                aria-label={label}
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
                        {label}
                    </>
                )}
            </Button>
        </div>
    );
}

export function CopyableSummary({ text }: Readonly<{ text: string }>) {
    return (
        <div className="space-y-1.5">
            {/* The measure is capped, not the card. Left to the full ~960px of
                the verdict hero this paragraph ran about 110 characters a line,
                against the 65-75 that keeps a reader from losing the line on the
                return sweep. Only the text is bounded; the card, the meter and
                the meta row still span the full width. */}
            <p className="max-w-[60ch] font-sans text-[0.95rem] leading-relaxed text-foreground/85">
                {text}
            </p>
            <CopyButton text={text} />
        </div>
    );
}

export function SectionHeading({
    children,
    action,
}: Readonly<{
    children: ReactNode;
    /** Optional right-aligned content (e.g. the indicator chip) shown on the
     *  same row as the title, above the shared divider. */
    action?: ReactNode;
}>) {
    return (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-foreground/10 pb-3">
            <h2 className="font-mono text-[13px] font-semibold tracking-[0.12em] text-foreground uppercase">
                {children}
            </h2>
            {action}
        </div>
    );
}

/** The subject record's body: a strict two-column ledger rather than a stack
 *  of flex rows, so every section's label column lines up with every other's
 *  regardless of content length — the thing ad hoc width classes kept fighting.
 *  A fixed `<colgroup>` under `table-fixed` is what makes the label column a
 *  real, shared boundary instead of an approximation.
 *
 *  Below `sm` the ledger stops being a ledger. An 11rem label column out of the
 *  ~326px a 390px viewport leaves (less again beside the masthead sprite) left
 *  the value column near 120px, so `Priors` set as ten lines of one or two
 *  words and the mobile result page ran 6,390px against desktop's 5,115px on a
 *  third the width. Every element in the table is switched to `block` for that
 *  range — table, tbody, rows and cells together, since a `display:block` child
 *  of a `display:table` parent gets wrapped in an anonymous table box and lays
 *  out as neither — which drops the colgroup out of play and puts each label on
 *  its own line above its value. The two-column grid is correct on desktop and
 *  does not move. */
export function RecordTable({ children }: Readonly<{ children: ReactNode }>) {
    return (
        <table className="block w-full border-collapse text-sm sm:table sm:table-fixed">
            <colgroup>
                <col className="w-44" />
                <col />
            </colgroup>
            <tbody className="block sm:table-row-group [&>tr:first-child>td]:pt-0">
                {children}
            </tbody>
        </table>
    );
}

/** A section title spanning both columns, then its rows: renders as a fragment
 *  so a table can hold several sections without nesting `<table>`s inside
 *  `<table>`s. */
export function RecordSection({
    title,
    children,
}: Readonly<{ title: string; children: ReactNode }>) {
    return (
        <>
            <tr className="block sm:table-row">
                <td
                    colSpan={2}
                    className="block border-b border-foreground/10 pt-4 pb-1.5 font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase sm:table-cell"
                >
                    {title}
                </td>
            </tr>
            {children}
        </>
    );
}

/** One row of the ledger: a label cell and a value cell, wrapping in place
 *  rather than truncating — the fixed column width means a long CVE list or
 *  allocation range grows the row's height instead of losing its tail. */
export function RecordRow({
    label,
    children,
    note,
    hint,
    tone,
    mono,
}: Readonly<{
    label: string;
    children: ReactNode;
    /** Small provenance/detail line under the value (sources that backed a
     *  masthead field, a dissenting geo vote, …). */
    note?: string;
    /** Plain-language tooltip for a jargon label (ASN, CAA, SPF, ssdeep, …).
     *  Marks the label with a dotted underline to signal it's explainable. */
    hint?: string;
    /** Color class (e.g. "text-red-600 …") to tint a risk-relevant value. */
    tone?: string;
    /** Render the value in monospace (addresses, hashes, raw record text). */
    mono?: boolean;
}>) {
    return (
        <tr className="block border-b border-foreground/[0.06] last:border-b-0 sm:table-row">
            {/* Stacked below `sm`: the label keeps its own type treatment and
                becomes the row's eyebrow, so the record still reads as a record
                rather than as a list of paragraphs. Padding splits accordingly —
                the label takes the top, the value the bottom — so a stacked row
                occupies the same vertical rhythm as the side-by-side one. */}
            <td
                title={hint}
                className={cn(
                    "block pt-1.5 pb-0 align-baseline font-mono text-[11px] text-muted-foreground sm:table-cell sm:py-1.5 sm:pr-3",
                    hint &&
                        "w-fit cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-2",
                )}
            >
                {label}
            </td>
            <td
                className={cn(
                    "block pt-0 pb-1.5 align-baseline break-words text-sm sm:table-cell sm:py-1.5",
                    mono && "font-mono text-[13px]",
                    tone ?? "text-foreground",
                )}
            >
                {children}
                {note && (
                    <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        {note}
                    </div>
                )}
            </td>
        </tr>
    );
}

