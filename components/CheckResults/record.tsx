"use client";

import type { ReactNode } from "react";
import { memo } from "react";
import type { SubjectRecord } from "@/lib/ti/subject-record";
import type { Verdict } from "@/lib/ti/types";
import { cn } from "@/lib/utils";
import { Sprite } from "./sprite";
import { VERDICT_STYLE } from "./verdict";

/** One labelled row, with the sources that backed it underneath. The provenance
 *  line is what stops this card repeating VerdictHero: the hero says how bad,
 *  this says what, and who said so. */
function Row({
    label,
    sources,
    children,
}: Readonly<{ label: string; sources?: string[]; children: ReactNode }>) {
    return (
        <div className="flex flex-wrap items-baseline gap-x-3 py-1.5 sm:flex-nowrap">
            <dt className="w-32 shrink-0 font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                {label}
            </dt>
            <dd className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">{children}</div>
                {sources?.length ? (
                    <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        {sources.join(", ")}
                    </div>
                ) : null}
            </dd>
        </div>
    );
}

function seenText(seen: SubjectRecord["seen"]): string | null {
    if (!seen) return null;
    if (seen.first && seen.last) return `${seen.first} to ${seen.last}`;
    if (seen.last) return `Last seen ${seen.last}`;
    if (seen.first) return `First seen ${seen.first}`;
    return null;
}

export const SubjectMasthead = memo(function SubjectMasthead({
    record,
    verdict,
}: Readonly<{ record: SubjectRecord; verdict: Verdict }>) {
    const seen = seenText(record.seen);
    const reported = record.reportedFor;
    const alsoText = reported?.also.length
        ? `, also described as ${reported.also.join(", ")}`
        : "";

    return (
        <div className="flex items-start justify-between gap-4">
            <dl className="min-w-0 flex-1">
                <Row label="Subject">
                    <span className="font-mono break-all">{record.subject}</span>
                    {record.qualifier && (
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                            {record.qualifier}
                        </span>
                    )}
                </Row>
                <Row label="Class" sources={record.class.sources}>
                    {record.class.label}
                </Row>
                {record.hostedOn && (
                    <Row label="Hosted on" sources={record.hostedOn.sources}>
                        {record.hostedOn.label}
                    </Row>
                )}
                <Row label="Reported for" sources={reported?.sources}>
                    {reported ? (
                        <span className="capitalize">
                            {reported.label}
                            <span className="text-muted-foreground normal-case">{alsoText}</span>
                        </span>
                    ) : (
                        <span className="text-muted-foreground">Nothing on file</span>
                    )}
                </Row>
                {seen && <Row label="Seen">{seen}</Row>}
            </dl>

            <div
                className={cn(
                    "flex size-16 shrink-0 items-center justify-center rounded-md border border-foreground/20 bg-background sm:size-20",
                    VERDICT_STYLE[verdict].text,
                )}
            >
                <Sprite
                    spec={record.sprite}
                    px={48}
                    title={record.class.label}
                    className="sm:hidden"
                />
                <Sprite
                    spec={record.sprite}
                    px={64}
                    title={record.class.label}
                    className="hidden sm:block"
                />
            </div>
        </div>
    );
});

/** Matches the row rhythm above, so the card does not jump when the result
 *  lands. Mirrors the skeleton already in IpDossierCard. */
export function SubjectMastheadSkeleton() {
    return (
        <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-3">
                {["w-48", "w-36", "w-44", "w-40"].map((w) => (
                    <div key={w} className="flex items-baseline gap-3">
                        <span className="sweep h-3 w-24 shrink-0 rounded" />
                        <span className={cn("sweep h-3 rounded", w)} />
                    </div>
                ))}
            </div>
            <span className="sweep size-16 shrink-0 rounded-md sm:size-20" />
        </div>
    );
}
