"use client";

import { Fragment } from "react";
import {
    Asterisk,
    Check,
    Circle,
    SignalHigh,
    SignalLow,
    SignalMedium,
    Star,
} from "lucide-react";
import type { Confidence, GeoResolution } from "@/lib/ti/types";
import {
    buildVoteTable,
    providerLabel,
    type VoteCell,
    type VoteColumn,
} from "@/lib/ti/geo/votes";
import { geoConfidenceReason } from "./confidence";
import type { IconType } from "./types";

/** Fixed three-letter codes so the confidence levels are equal width in mono. */
const CONF_ABBR: Record<Confidence, string> = {
    high: "HIG",
    medium: "MED",
    low: "LOW",
};

/** Plain signal-strength icon, bars reflecting the level. */
const CONF_ICON: Record<Confidence, IconType> = {
    high: SignalHigh,
    medium: SignalMedium,
    low: SignalLow,
};

/** Confidence as a plain icon plus a fixed three-letter code, all grey mono so
 *  the levels line up wherever they appear. */
function ConfidenceLevel({ confidence }: { confidence: Confidence }) {
    const Icon = CONF_ICON[confidence];
    return (
        <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            <Icon className="size-3 shrink-0 text-foreground/50" aria-hidden />
            {CONF_ABBR[confidence]}
        </span>
    );
}

/** Compact resolved-value reference: the field label, the consensus value, and
 *  that field's confidence. Renders three grid cells so the columns line up
 *  across every row. The "answer" the source votes below support. */
function ResolvedRow({ field }: { field: VoteColumn }) {
    return (
        <>
            <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                {field.label}
            </span>
            <span className="min-w-0 truncate text-[13px] font-medium text-foreground">
                {field.winner}
            </span>
            <ConfidenceLevel confidence={field.confidence} />
        </>
    );
}

/** One source's vote in a single field column. Every state shares the same grey,
 *  so the icon shape, not color, carries the meaning: a check for agreement, a
 *  ring for a scattered point, and a minimal asterisk plus the value for a
 *  dissent (the one that should pop). Absent votes render blank. */
function VoteMark({ cell }: { cell: VoteCell | undefined }) {
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
            <span className="inline-flex items-center gap-1 text-foreground/70">
                <Asterisk
                    className="size-3 shrink-0 text-foreground/55"
                    aria-label="differs"
                />
                {cell.value}
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

/** Geo-confidence section: a plain header, the resolved values, then a ballot per
 *  TI source showing how each one voted. Minimal, document-style, no masthead or
 *  gauge. No-op when nothing resolved. */
export function VotingCard({ res }: { res: GeoResolution }) {
    const table = buildVoteTable(res);
    if (!table) return null;
    const confidence = res.overall?.confidence ?? "low";
    const pct = res.overall ? Math.round(res.overall.score * 100) : null;

    return (
        <section className="space-y-4">
            {/* Plain header: uppercase label left, confidence on the right. */}
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-foreground/10 pb-3">
                <span className="font-mono text-[13px] font-semibold uppercase tracking-[0.12em] text-foreground">
                    Geo confidence
                </span>
                <span className="flex items-center gap-1.5">
                    <ConfidenceLevel confidence={confidence} />
                    {pct != null && (
                        <span className="font-mono text-[10px] tabular-nums text-foreground/55">
                            {pct}/100
                        </span>
                    )}
                </span>
            </div>

            <p className="text-[13px] leading-snug text-muted-foreground">
                {geoConfidenceReason(res)}
            </p>

            {/* Resolved consensus values, the answer the votes support. One field
                per row, with label / value / confidence in aligned columns. */}
            <div className="grid grid-cols-[auto_minmax(0,auto)_auto] items-baseline justify-start gap-x-2.5 gap-y-2">
                {table.fields.map((f) => (
                    <ResolvedRow key={f.key} field={f} />
                ))}
            </div>

            {/* How each TI source voted: a tally with one column per field, so the
                votes line up. Same grey throughout, icons carry the meaning. */}
            <div className="border-t border-foreground/10 pt-3">
                <div className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Source votes
                </div>
                <div
                    className="grid items-center gap-x-5 gap-y-2.5 text-[12px]"
                    style={{
                        gridTemplateColumns: `auto repeat(${table.fields.length}, auto)`,
                    }}
                >
                    <span aria-hidden />
                    {table.fields.map((f) => (
                        <span
                            key={f.key}
                            className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
                        >
                            {f.label}
                        </span>
                    ))}
                    {table.providers.map((id) => (
                        <Fragment key={id}>
                            <span className="font-mono text-[12px] text-foreground/65">
                                {providerLabel(id)}
                            </span>
                            {table.fields.map((f) => (
                                <VoteMark key={f.key} cell={f.cells[id]} />
                            ))}
                        </Fragment>
                    ))}
                </div>
            </div>

            {table.fields.some((f) => f.authorityId) && (
                <p className="text-[11px] text-muted-foreground">
                    <Star className="mr-1 inline size-3 align-[-1px] text-foreground/55" />
                    allocation authority, RIPEstat ASN
                </p>
            )}
        </section>
    );
}
