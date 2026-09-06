"use client";

import { memo, useMemo } from "react";
import type { CheckResult } from "@/lib/ti/types";
import { buildIpDossier } from "@/lib/ti/ip-dossier";
import { buildSubjectRecord } from "@/lib/ti/subject-record";
import { Card, CardContent } from "@/components/ui/card";
import { RecordRow, RecordSection, RecordTable, SectionHeading } from "./primitives";
import { SubjectMasthead, SubjectMastheadSkeleton } from "./record";
import { VotingCard } from "./voting";

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
                        <div className="h-px bg-foreground/10" />
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

                <div className="space-y-5">
                    <SubjectMasthead record={record} verdict={result.verdict} />

                    <RecordTable>
                        {dossier.groups.map((g) => (
                            <RecordSection key={g.id} title={g.title}>
                                {g.fields.map((f) => (
                                    <RecordRow
                                        key={f.label}
                                        label={f.label}
                                        hint={f.hint}
                                        mono={f.mono}
                                    >
                                        {f.value}
                                    </RecordRow>
                                ))}
                            </RecordSection>
                        ))}
                    </RecordTable>

                    <p
                        suppressHydrationWarning
                        className="font-mono text-[11px] text-muted-foreground"
                    >
                        {dossier.footer}
                    </p>
                </div>

                {result.geoResolution && <VotingCard res={result.geoResolution} />}
            </CardContent>
        </Card>
    );
});
