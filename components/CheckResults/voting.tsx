"use client";

import { type VoteCell, type VoteMarkKind, voteMarkOf, voteMarksUsed } from "@/lib/ti/geo/votes";
import { cn } from "@/lib/utils";

/**
 * A provider ballot as a grid of plain marks: one row per provider, one column
 * per thing it was asked, and a legend of only the marks the grid contains.
 *
 * Every mark is the same grey, so the shape carries the meaning, and every
 * shape is a square or a ring of one size, so the grid reads as a pattern
 * before it reads as cells: a solid column is a field everyone agrees on, an
 * outlined column is one nobody answered.
 */

export function VoteMark({ kind, title }: Readonly<{ kind: VoteMarkKind; title?: string }>) {
    const base = "inline-block size-2.5 shrink-0";
    switch (kind) {
        case "silent":
            return <span className={cn(base, "border border-dashed border-foreground/25")} aria-label="silent" />;
        case "near":
            return <span className={cn(base, "rounded-full border border-foreground/60")} aria-label="near" />;
        case "differs":
            return (
                <span
                    title={title}
                    className={cn(base, "relative overflow-hidden border border-foreground/70")}
                    aria-label={title ? `differs: ${title}` : "differs"}
                >
                    <span className="absolute top-1/2 left-1/2 h-px w-[150%] -translate-1/2 rotate-45 bg-foreground/70" />
                </span>
            );
        case "registry":
            return (
                <span
                    className={cn(base, "bg-foreground/70 outline outline-1 outline-offset-2 outline-foreground/60")}
                    aria-label="agrees, registry"
                />
            );
        default:
            return <span className={cn(base, "bg-foreground/70")} aria-label="agrees" />;
    }
}

export function VoteGrid({
    rows,
    cols,
    cell,
    rowLabel,
}: Readonly<{
    rows: string[];
    cols: { key: string; label: string }[];
    cell: (row: string, col: string) => VoteCell | undefined;
    rowLabel: (row: string) => string;
}>) {
    const template = `minmax(0,1fr) repeat(${cols.length}, 2.1rem)`;
    const marks = voteMarksUsed(rows.flatMap((r) => cols.map((c) => cell(r, c.key))));
    return (
        <div>
            <div className="grid items-end gap-x-1 pb-1" style={{ gridTemplateColumns: template }}>
                <span />
                {cols.map((c) => (
                    <span
                        key={c.key}
                        className="text-center font-mono text-[9px] tracking-[0.06em] text-muted-foreground uppercase"
                    >
                        {c.label}
                    </span>
                ))}
            </div>
            {rows.map((r) => (
                <div
                    key={r}
                    className="grid items-center gap-x-1 border-t border-foreground/10 py-[5px]"
                    style={{ gridTemplateColumns: template }}
                >
                    <span className="truncate font-mono text-[11px]">{rowLabel(r)}</span>
                    {cols.map((c) => {
                        const v = cell(r, c.key);
                        return (
                            <span key={c.key} className="flex justify-center">
                                <VoteMark kind={voteMarkOf(v)} title={v?.value} />
                            </span>
                        );
                    })}
                </div>
            ))}
            <div className="mt-1.5 grid grid-cols-3 gap-x-2 gap-y-1 border-t border-foreground/10 pt-2 font-mono text-[9.5px] whitespace-nowrap text-muted-foreground">
                {marks.map((m) => (
                    <span key={m} className="inline-flex items-center gap-1.5">
                        <VoteMark kind={m} />
                        {m}
                    </span>
                ))}
            </div>
        </div>
    );
}
