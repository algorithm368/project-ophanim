"use client";

import { Bug } from "lucide-react";
import { type HashCheckResult } from "@/lib/ti/types";
import { hashTone } from "./classify";
import { SectionHeading } from "./primitives";
import { StatusDot, HashRow } from "./profile";
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

/**
 * The behavioral counterpart to the File identity card, styled the same way: a
 * verdict dot + family header, then a flat aligned readout. Each capability is a
 * row keyed by its MITRE id; leftover techniques and reference links follow as
 * their own rows. Renders nothing for an unknown hash.
 */
export function ThreatProfileCard({ result }: { result: HashCheckResult }) {
    const ctx = result.context;
    const family = ctx?.malwareFamily;
    const capabilities = ctx?.capabilities ?? [];
    const techniques = ctx?.mitreTechniques ?? [];
    const refs = ctx?.familyRefs ?? [];
    const ratio = ctx?.detectionRatio;

    // Nothing to say about an unknown hash, show only File identity.
    if (!family && capabilities.length === 0 && !ratio) return null;

    const tone = hashTone(ctx);
    // Techniques a capability row already carries, so the att&ck row lists only
    // the extras and never repeats an id.
    const shown = new Set(
        capabilities.flatMap((c) => (c.mitre ?? []).map((id) => id.toUpperCase())),
    );
    const extraTech = techniques.filter((t) => !shown.has(t.id.toUpperCase()));

    return (
        <Card className="sketch-shadow rounded-lg border border-foreground/12">
            <CardContent className="space-y-4">
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
                    <div className="flex items-start gap-3">
                        <StatusDot kind="malicious" />
                        <div className="min-w-0">
                            <div
                                className={cn(
                                    "text-lg font-bold uppercase leading-tight tracking-tight",
                                    tone,
                                )}
                            >
                                {family}
                            </div>
                            {ctx?.familyDescription && (
                                <div className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                                    {ctx.familyDescription}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <div className="space-y-3">
                    {capabilities.length > 0 ? (
                        <dl>
                            {capabilities.map((c) => (
                                <HashRow key={c.label} label={c.mitre?.[0] ?? "behavior"}>
                                    {c.label}
                                </HashRow>
                            ))}
                        </dl>
                    ) : (
                        <p className="text-sm text-muted-foreground">
                            No sandbox report is available for this sample, so its
                            behavior hasn&apos;t been observed directly. The family
                            description is the best guide.
                        </p>
                    )}

                    {(extraTech.length > 0 || refs.length > 0) && (
                        <dl>
                            {extraTech.length > 0 && (
                                <HashRow label="att&ck">
                                    {extraTech.map((t) => t.id).join(", ")}
                                </HashRow>
                            )}
                            {refs.length > 0 && (
                                <HashRow label="refs">
                                    {refs.map((href, i) => (
                                        <span key={href}>
                                            {i > 0 && ", "}
                                            <a
                                                href={href}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="underline-offset-2 hover:text-foreground hover:underline"
                                            >
                                                {refLabel(href)}
                                            </a>
                                        </span>
                                    ))}
                                </HashRow>
                            )}
                        </dl>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
