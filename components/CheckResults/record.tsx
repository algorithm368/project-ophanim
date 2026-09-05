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
 *  this says what, and who said so. `note` is a pre-formatted alternative to
 *  `sources` for a row whose provenance is not a plain list of source ids (the
 *  Origin row's dissent sentence) — the two are mutually exclusive, and no row
 *  ever needs both. */
function Row({
    label,
    sources,
    note,
    children,
}: Readonly<{
    label: string;
    sources?: string[];
    note?: string;
    children: ReactNode;
}>) {
    const provenance = sources?.length ? sources.join(", ") : note;
    return (
        <div className="flex flex-wrap items-baseline gap-x-3 py-1 sm:flex-nowrap">
            <dt className="w-44 shrink-0 font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                {label}
            </dt>
            <dd className="min-w-0 flex-1">
                <div className="text-sm text-foreground">{children}</div>
                {provenance ? (
                    <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        {provenance}
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

/** "2 sources say Netherlands" for one dissenting value, joined with a comma
 *  when more than one alternative was reported. Rendered only when the
 *  country vote actually split; see the counting rule in the design doc. */
function dissentText(dissent: NonNullable<SubjectRecord["origin"]>["dissent"]): string {
    return (dissent ?? [])
        .map((d) =>
            d.sources.length === 1
                ? `1 source says ${d.value}`
                : `${d.sources.length} sources say ${d.value}`,
        )
        .join(", ");
}

export const SubjectMasthead = memo(function SubjectMasthead({
    record,
    verdict,
}: Readonly<{ record: SubjectRecord; verdict: Verdict }>) {
    const seen = seenText(record.seen);
    const priors = record.priors;
    const alsoText = priors.also.length ? `, also described as ${priors.also.join(", ")}` : "";

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
                {record.origin && (
                    <Row
                        label="Origin"
                        note={
                            record.origin.dissent?.length
                                ? dissentText(record.origin.dissent)
                                : undefined
                        }
                    >
                        {record.origin.label}
                    </Row>
                )}
                {record.hostedOn && (
                    <Row label="Hosted on" sources={record.hostedOn.sources}>
                        {record.hostedOn.label}
                    </Row>
                )}
                <Row label="Priors" sources={priors.sources}>
                    {priors.label}
                    <span className="text-muted-foreground">{alsoText}</span>
                </Row>
                {record.detections && (
                    // VirusTotal is the only source that sets detectionRatio, and it is
                    // key-gated: on a keyless deployment this row simply does not render,
                    // same as hostedOn or seen when nothing backs them. That is correct,
                    // this is text on the card, not a rung the sprite depends on, so it
                    // never needs the free-source guard the ladders in subject-record.ts
                    // enforce. Do not turn this into a resolver rung.
                    <Row label="Detections" sources={["virustotal"]}>
                        {record.detections.malicious} of {record.detections.total} engines
                    </Row>
                )}
                {seen && <Row label="Record">{seen}</Row>}
            </dl>

            {/* Corner brackets, not a plain box: an evidence-photo crop marker
                rather than another bordered cell, in keeping with the card's
                subject-record framing. */}
            <div className="relative flex size-16 shrink-0 items-center justify-center rounded-md border border-foreground/10 bg-background sm:size-20">
                <span
                    aria-hidden
                    className={cn("absolute inset-0", VERDICT_STYLE[verdict].text)}
                >
                    <span className="absolute -top-px -left-px size-2.5 border-t-2 border-l-2 border-current sm:size-3" />
                    <span className="absolute -top-px -right-px size-2.5 border-t-2 border-r-2 border-current sm:size-3" />
                    <span className="absolute -bottom-px -left-px size-2.5 border-b-2 border-l-2 border-current sm:size-3" />
                    <span className="absolute -right-px -bottom-px size-2.5 border-r-2 border-b-2 border-current sm:size-3" />
                </span>
                <span className={VERDICT_STYLE[verdict].text}>
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
                </span>
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
