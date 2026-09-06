"use client";

import { memo } from "react";
import { flagUrl } from "@/lib/flag";
import type { SubjectRecord } from "@/lib/ti/subject-record";
import type { Verdict } from "@/lib/ti/types";
import { cn } from "@/lib/utils";
import { RecordRow, RecordSection, RecordTable } from "./primitives";
import { Sprite } from "./sprite";
import { VERDICT_STYLE } from "./verdict";

/** "1 source says X" / "2 sources say Y", or undefined when nothing backed
 *  the row — the provenance line is what stops this card repeating
 *  VerdictHero: the hero says how bad, this says what, and who said so. */
function sourceNote(sources: string[] | undefined): string | undefined {
    return sources?.length ? sources.join(", ") : undefined;
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
    const flag = flagUrl(record.origin?.countryCode);

    return (
        <div className="flex items-start justify-between gap-4">
            <RecordTable>
                <RecordSection title="Identity">
                    <RecordRow label="Subject" mono>
                        {record.subject}
                        {record.qualifier && (
                            <span className="ml-2 font-mono text-xs text-muted-foreground">
                                {record.qualifier}
                            </span>
                        )}
                    </RecordRow>
                    <RecordRow label="Class" note={sourceNote(record.class.sources)}>
                        {record.class.label}
                    </RecordRow>
                    {record.origin && (
                        <RecordRow
                            label="Origin"
                            note={
                                record.origin.dissent?.length
                                    ? dissentText(record.origin.dissent)
                                    : undefined
                            }
                        >
                            <span className="inline-flex items-center gap-1.5">
                                {flag && (
                                    // eslint-disable-next-line @next/next/no-img-element -- tiny external flag asset; next/image is overkill here
                                    <img
                                        src={flag}
                                        alt=""
                                        width={20}
                                        height={15}
                                        loading="lazy"
                                        className="h-3.5 w-auto shrink-0 rounded-[2px] border border-foreground/20 object-cover"
                                    />
                                )}
                                {record.origin.label}
                            </span>
                        </RecordRow>
                    )}
                    {record.hostedOn && (
                        <RecordRow label="Hosted on" note={sourceNote(record.hostedOn.sources)}>
                            {record.hostedOn.label}
                        </RecordRow>
                    )}
                    <RecordRow label="Priors" note={sourceNote(priors.sources)}>
                        {priors.label}
                        <span className="text-muted-foreground">{alsoText}</span>
                    </RecordRow>
                    {record.detections && (
                        // VirusTotal is the only source that sets detectionRatio, and it is
                        // key-gated: on a keyless deployment this row simply does not render,
                        // same as hostedOn or seen when nothing backs them. That is correct,
                        // this is text on the card, not a rung the sprite depends on, so it
                        // never needs the free-source guard the ladders in subject-record.ts
                        // enforce. Do not turn this into a resolver rung.
                        <RecordRow label="Detections" note="virustotal">
                            {record.detections.malicious} of {record.detections.total} engines
                        </RecordRow>
                    )}
                    {seen && <RecordRow label="Record">{seen}</RecordRow>}
                </RecordSection>
            </RecordTable>

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
