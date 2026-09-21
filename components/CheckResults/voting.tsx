"use client";

import { Asterisk, Check, Circle, Star } from "lucide-react";
import { type VoteCell } from "@/lib/ti/geo/votes";

/** One source's vote in a single field column. Every state shares the same grey,
 *  so the icon shape, not color, carries the meaning: a check for agreement, a
 *  ring for a scattered point, and a minimal asterisk plus the value for a
 *  dissent (the one that should pop). Absent votes render blank. */
export function VoteMark({
    cell,
    compact,
}: Readonly<{
    cell: VoteCell | undefined;
    /** Drop a dissent's value to its tooltip. The ballots live in a
     *  three-column tile now, and "Andorra la Vella" printed inline pushed the
     *  matrix out of its own grid. */
    compact?: boolean;
}>) {
    if (!cell || cell.status === "absent") return <span aria-hidden />;
    if (cell.status === "scatter")
        return (
            <Circle
                className="size-2.5 text-foreground/40"
                aria-label="scattered point"
            />
        );
    if (cell.status === "dissent")
        return (
            <span
                title={compact ? cell.value : undefined}
                className="inline-flex min-w-0 items-center gap-1 text-foreground/70"
            >
                <Asterisk
                    className="size-3 shrink-0 text-foreground/55"
                    aria-label={`differs: ${cell.value}`}
                />
                {!compact && cell.value}
            </span>
        );
    return (
        <span className="inline-flex items-center gap-1 text-foreground/45">
            <Check className="size-3.5" aria-label="agrees" />
            {cell.authority && (
                <Star
                    className="size-3 text-foreground/55"
                    aria-label="allocation authority"
                />
            )}
        </span>
    );
}
