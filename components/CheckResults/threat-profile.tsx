"use client";

import { Bug, ExternalLink } from "lucide-react";
import { type HashCheckResult } from "@/lib/ti/types";
import { hashTone } from "./classify";
import { SectionHeading } from "./primitives";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

/** `N / M engines` confidence chip, mirroring the algorithm chip on the File
 *  identity card. Shown only when VirusTotal supplied a detection ratio. */
function EnginesChip({ malicious, total }: { malicious: number; total: number }) {
    return (
        <code className="rounded-sm border border-foreground/15 bg-muted/60 px-2.5 py-1 font-mono text-xs font-semibold tracking-tight">
            {malicious} / {total} engines
        </code>
    );
}

/** Host of a reference URL, minus a leading www, for a compact link label. */
function refLabel(href: string): string {
    try {
        return new URL(href).hostname.replace(/^www\./, "");
    } catch {
        return href;
    }
}

/** Small uppercase group label, matching the identity card's field-group heads. */
function GroupLabel({ children }: { children: React.ReactNode }) {
    return (
        <div className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {children}
        </div>
    );
}

export function ThreatProfileCard({ result }: { result: HashCheckResult }) {
    const ctx = result.context;
    const family = ctx?.malwareFamily;
    const capabilities = ctx?.capabilities ?? [];
    const techniques = ctx?.mitreTechniques ?? [];
    const ratio = ctx?.detectionRatio;

    // Nothing to say about an unknown hash, show only File identity.
    if (!family && capabilities.length === 0 && !ratio) return null;

    const tone = hashTone(ctx);
    const dotClass = tone.includes("red")
        ? "bg-red-500 dark:bg-red-400"
        : "bg-foreground/40";

    return (
        <Card className="sketch-shadow rounded-lg border border-foreground/12">
            <CardContent className="space-y-5">
                <SectionHeading
                    icon={Bug}
                    action={
                        ratio ? (
                            <EnginesChip malicious={ratio.malicious} total={ratio.total} />
                        ) : undefined
                    }
                >
                    Threat profile
                </SectionHeading>

                {family && (
                    <div className="space-y-1.5">
                        <GroupLabel>Family</GroupLabel>
                        <div className="flex items-center gap-2.5">
                            <span className={cn("size-2.5 shrink-0 rounded-full", dotClass)} />
                            <span className={cn("text-base font-bold tracking-tight", tone)}>
                                {family}
                            </span>
                        </div>
                        {ctx?.familyDescription && (
                            <p className="text-sm leading-relaxed text-foreground/85">
                                {ctx.familyDescription}
                            </p>
                        )}
                        {ctx?.familyRefs && ctx.familyRefs.length > 0 && (
                            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-0.5">
                                {ctx.familyRefs.map((href) => (
                                    <a
                                        key={href}
                                        href={href}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-1 text-[13px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                                    >
                                        {refLabel(href)}
                                        <ExternalLink className="size-3" />
                                    </a>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                <div className="space-y-1.5">
                    <GroupLabel>What this file does</GroupLabel>
                    {capabilities.length > 0 ? (
                        <ul className="space-y-1.5">
                            {capabilities.map((c) => (
                                <li key={c.label} className="flex flex-col gap-0.5">
                                    <span className="text-sm text-foreground">{c.label}</span>
                                    {c.mitre && c.mitre.length > 0 && (
                                        <span className="font-mono text-[11px] text-muted-foreground">
                                            {c.mitre.join(", ")}
                                        </span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-sm text-muted-foreground">
                            No sandbox report is available for this sample, so its
                            behavior hasn&apos;t been observed directly. The family
                            description is the best guide.
                        </p>
                    )}
                </div>

                {techniques.length > 0 && (
                    <div className="space-y-1.5">
                        <GroupLabel>MITRE ATT&amp;CK</GroupLabel>
                        <div className="flex flex-wrap gap-1.5">
                            {techniques.map((t) => (
                                <span
                                    key={t.id}
                                    title={t.tactic}
                                    className="inline-flex items-center rounded-md border border-foreground/15 bg-background px-2 py-0.5 font-mono text-[12px] text-foreground/80"
                                >
                                    {t.id}
                                    {t.name ? ` ${t.name}` : ""}
                                </span>
                            ))}
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
