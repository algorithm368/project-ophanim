"use client";

import { Fingerprint } from "lucide-react";
import type { ReactNode } from "react";
import type { CheckResult } from "@/lib/ti/types";
import { buildIpDossier } from "@/lib/ti/ip-dossier";
import { joinPlace } from "@/lib/ti/narrative";
import { flagUrl } from "./classify";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeading } from "./primitives";
import { Rule } from "./profile";
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
export function IpDossierCard({ result }: Readonly<{ result: CheckResult }>) {
    const dossier = buildIpDossier(result);
    const geo = result.geo;
    const flag = flagUrl(geo?.countryCode);
    const place = joinPlace([geo?.city, geo?.region]);

    return (
        <Card className="sketch-shadow rounded-lg border border-foreground/12">
            <CardContent className="space-y-5">
                <SectionHeading icon={Fingerprint}>IP dossier</SectionHeading>

                {/* Identity line: grayscale flag, country, city. No verdict repeat
                    (VerdictHero owns the verdict word, risk level, and tally). */}
                {geo?.country && (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {flag && (
                            // eslint-disable-next-line @next/next/no-img-element -- tiny external flag asset; next/image is overkill here
                            <img
                                src={flag}
                                alt={`Flag of ${geo.country ?? geo.countryCode}`}
                                width={64}
                                height={48}
                                loading="lazy"
                                className="mr-1 h-6 w-auto shrink-0 rounded-sm border border-foreground/20 object-cover"
                            />
                        )}
                        <span className="text-base font-semibold leading-tight">
                            {geo.country}
                        </span>
                        {geo.countryCode && (
                            <span className="font-mono text-xs text-muted-foreground">
                                {geo.countryCode}
                            </span>
                        )}
                        {place && (
                            <>
                                <span className="text-muted-foreground/50">·</span>
                                <span className="text-sm text-muted-foreground">
                                    {place}
                                </span>
                            </>
                        )}
                    </div>
                )}

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

                <p className="font-mono text-[11px] text-muted-foreground">
                    {dossier.footer}
                </p>

                {result.geoResolution && <VotingCard res={result.geoResolution} />}
            </CardContent>
        </Card>
    );
}
