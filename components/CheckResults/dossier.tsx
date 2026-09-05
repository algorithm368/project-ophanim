"use client";

import { memo, useMemo } from "react";
import type { CheckResult } from "@/lib/ti/types";
import { buildIpDossier } from "@/lib/ti/ip-dossier";
import { buildSubjectRecord } from "@/lib/ti/subject-record";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Group, SectionHeading } from "./primitives";
import { Rule } from "./profile";
import { SubjectMasthead, SubjectMastheadSkeleton } from "./record";
import { VotingCard } from "./voting";

/** Long-form values (CVE lists, allocation ranges, abuse contacts) truncate
 *  unreadably in the aligned label→value row; past this length, stack the
 *  value under the label instead, the same rule the domain profile's DNS
 *  fields already follow for pivot chips. */
const WRAP_THRESHOLD = 40;

/**
 * The consolidated IP dossier: a passive profile assembled from every source
 * that returned something, rendered as self-hiding groups of facts. Purely a
 * renderer over `buildIpDossier` — no scoring or classification lives here.
 * Owns none of the verdict/score/tally, that stays on `VerdictHero` above it.
 */
export const IpDossierCard = memo(function IpDossierCard({
    result,
    streaming,
}: Readonly<{ result: CheckResult | null; streaming: boolean }>) {
    // Hooks run before any early return, so the null case is folded in here
    // rather than guarding the call site. buildIpDossier is 350-odd lines of
    // field assembly; unmemoized it reran on every render this card took
    // while streaming and research sat below it, which was most of them.
    const dossier = useMemo(
        () => (result ? buildIpDossier(result) : null),
        [result],
    );
    const record = useMemo(
        () => (result ? buildSubjectRecord(result) : null),
        [result],
    );

    if (streaming || !result || !dossier || !record) {
        return (
            <Card className="sketch-shadow rounded-lg border border-foreground/12">
                <CardContent className="space-y-5">
                    <SectionHeading>Subject record</SectionHeading>
                    <SubjectMastheadSkeleton />
                    <div className="space-y-3">
                        <Rule />
                        <span className="sweep inline-block h-3 w-32 rounded" />
                        <div className="space-y-2 py-1">
                            <span className="sweep block h-3 w-full rounded" />
                            <span className="sweep block h-3 w-5/6 rounded" />
                            <span className="sweep block h-3 w-2/3 rounded" />
                        </div>
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="sketch-shadow rounded-lg border border-foreground/12">
            <CardContent className="space-y-5">
                <SectionHeading>Subject record</SectionHeading>

                <SubjectMasthead record={record} verdict={result.verdict} />

                {dossier.groups.map((g) => (
                    <div key={g.id} className="space-y-3">
                        <Rule />
                        <Group label={g.title}>
                            {g.fields.map((f) => (
                                <Field
                                    key={f.label}
                                    label={f.label}
                                    hint={f.hint}
                                    wide
                                    wrap={f.value.length > WRAP_THRESHOLD}
                                >
                                    <span className={cn(f.mono && "font-mono text-[13px]")}>
                                        {f.value}
                                    </span>
                                </Field>
                            ))}
                        </Group>
                    </div>
                ))}

                <p
                    suppressHydrationWarning
                    className="font-mono text-[11px] text-muted-foreground"
                >
                    {dossier.footer}
                </p>

                {result.geoResolution && <VotingCard res={result.geoResolution} />}
            </CardContent>
        </Card>
    );
});
