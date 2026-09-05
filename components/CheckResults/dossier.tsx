"use client";

import { FileUser } from "lucide-react";
import { memo, useMemo, type ReactNode } from "react";
import type { CheckResult } from "@/lib/ti/types";
import { buildIpDossier } from "@/lib/ti/ip-dossier";
import { buildSubjectRecord } from "@/lib/ti/subject-record";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeading } from "./primitives";
import { Rule } from "./profile";
import { SubjectMasthead, SubjectMastheadSkeleton } from "./record";
import { VotingCard } from "./voting";

const SUBLABEL =
    "font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase";

/**
 * One label-value pair in the dossier's field grid. Deliberately not the shared
 * `GridItem` (w-28): dossier labels run much longer ("Cloud infrastructure",
 * "Known vulnerabilities", "Command and control"), so the label column here is
 * widened to keep them on one line without touching the narrower Origin/domain/
 * hash cards that still rely on GridItem's w-28.
 */
function DossierItem({
    label,
    hint,
    children,
}: Readonly<{
    label: string;
    hint?: string;
    children: ReactNode;
}>) {
    return (
        <div className="flex items-baseline gap-3 py-1">
            <dt
                title={hint}
                className={cn(
                    "w-44 shrink-0 text-[13px] leading-snug text-muted-foreground",
                    hint &&
                        "cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-2",
                )}
            >
                {label}
            </dt>
            <dd className="min-w-0 flex-1 text-sm font-medium text-foreground">
                {children}
            </dd>
        </div>
    );
}

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
                    <SectionHeading icon={FileUser}>Subject record</SectionHeading>
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
                <SectionHeading icon={FileUser}>Subject record</SectionHeading>

                <SubjectMasthead record={record} verdict={result.verdict} />

                {dossier.groups.map((g) => (
                    <div key={g.id} className="space-y-3">
                        <Rule />
                        <div className={SUBLABEL}>{g.title}</div>
                        <dl className="grid grid-cols-1 gap-x-8 gap-y-0.5 sm:grid-cols-2">
                            {g.fields.map((f) => (
                                <DossierItem key={f.label} label={f.label} hint={f.hint}>
                                    <span className={cn(f.mono && "font-mono text-[13px]")}>
                                        {f.value}
                                    </span>
                                </DossierItem>
                            ))}
                        </dl>
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
