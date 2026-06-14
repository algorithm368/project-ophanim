"use client";

import { ExternalLink, Telescope } from "lucide-react";
import {
    isDomainResult,
    isHashResult,
    type CheckResult,
    type DomainCheckResult,
    type HashCheckResult,
} from "@/lib/ti/types";
import { researchLinks } from "@/lib/ti/research";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeading } from "./primitives";

/** Outbound research panel: one-click links that open each platform's search
 *  for this indicator in a new tab. Plain, monochrome, vertical lists — no data
 *  is fetched, the click is what sends the indicator to the third party. */
export function ResearchCard({
    result,
}: {
    result: CheckResult | DomainCheckResult | HashCheckResult;
}) {
    const { indicator, kind } = isHashResult(result)
        ? { indicator: result.hash, kind: "hash" as const }
        : isDomainResult(result)
          ? { indicator: result.domain, kind: "domain" as const }
          : { indicator: result.ip, kind: "ip" as const };

    const sections = researchLinks(indicator, kind);

    return (
        <Card className="sketch-shadow rounded-lg border border-foreground/12">
            <CardContent className="space-y-5">
                <SectionHeading icon={Telescope}>Research</SectionHeading>

                {sections.map((section) => (
                    <div key={section.id} className="space-y-2">
                        <div className="font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                            {section.label}
                        </div>
                        {/* Full-width clickable rows: large hit target, a hover
                            fill, and a persistent ↗ so each reads as a button. */}
                        <div className="overflow-hidden rounded-lg border border-border">
                            {section.links.map((link) => (
                                <a
                                    key={link.id}
                                    href={link.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title={`Search ${link.name} for ${indicator}`}
                                    className="group flex items-center gap-2 border-b border-border px-3 py-2.5 text-sm font-medium transition-colors last:border-0 hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
                                >
                                    <span className="min-w-0 flex-1 truncate">
                                        {link.name}
                                    </span>
                                    <ExternalLink className="size-3.5 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-foreground" />
                                </a>
                            ))}
                        </div>
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}
