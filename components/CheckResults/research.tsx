"use client";

import { Check, Copy, ExternalLink, Telescope } from "lucide-react";
import {
    isDomainResult,
    isHashResult,
    type CheckResult,
    type DomainCheckResult,
    type HashCheckResult,
} from "@/lib/ti/types";
import { researchLinks, type ResearchLink } from "@/lib/ti/research";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SectionHeading, useCopied } from "./primitives";

/** Open a URL in a new *background* tab, keeping the user on the result page.
 *  A synthetic modifier-click (Ctrl on Windows/Linux, Cmd on macOS) is the
 *  portable way to ask for a background tab — a plain click or window.open()
 *  foregrounds the new tab and yanks the user away from their place. Setting
 *  both modifiers lets the browser apply whichever matches the platform.
 *  Anchor-click navigation (not window.open) also sidesteps the popup blocker,
 *  so a whole section can open at once. */
function openInBackground(url: string) {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.style.display = "none";
    document.body.appendChild(a);
    a.dispatchEvent(
        new MouseEvent("click", {
            ctrlKey: true,
            metaKey: true,
            bubbles: true,
            cancelable: true,
            view: window,
        }),
    );
    a.remove();
}

/** Fan-out: open every link in a section at once, all in background tabs. */
function openAll(links: ResearchLink[]) {
    for (const link of links) openInBackground(link.url);
}

/** Outbound research panel: one-click links that open each platform's search
 *  for this indicator in a new tab. Compact monochrome chips grouped by purpose;
 *  no data is fetched, the click is what sends the indicator to the third party.
 *  A Copy control puts the indicator on the clipboard for platforms whose search
 *  can't be deep-linked (e.g. ANY.RUN). */
export function ResearchCard({
    result,
}: {
    result: CheckResult | DomainCheckResult | HashCheckResult;
}) {
    const [copied, copy] = useCopied();

    const { indicator, kind } = isHashResult(result)
        ? { indicator: result.hash, kind: "hash" as const }
        : isDomainResult(result)
          ? { indicator: result.domain, kind: "domain" as const }
          : { indicator: result.ip, kind: "ip" as const };

    const sections = researchLinks(indicator, kind);

    return (
        <Card className="sketch-shadow rounded-lg border border-foreground/12">
            <CardContent className="space-y-5">
                <SectionHeading
                    icon={Telescope}
                    action={
                        <div className="flex min-w-0 items-center gap-1.5">
                            <code className="max-w-[150px] truncate font-mono text-[12px] text-muted-foreground sm:max-w-[260px]">
                                {indicator}
                            </code>
                            <Button
                                type="button"
                                variant="ghost"
                                size="xs"
                                aria-label={`Copy ${kind}`}
                                className="gap-1.5 text-muted-foreground hover:text-foreground"
                                onClick={() => copy(indicator)}
                            >
                                {copied ? (
                                    <>
                                        <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                                        Copied
                                    </>
                                ) : (
                                    <>
                                        <Copy className="size-3.5" />
                                        Copy
                                    </>
                                )}
                            </Button>
                        </div>
                    }
                >
                    Research
                </SectionHeading>

                {sections.map((section) => (
                    <div key={section.id} className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                            <div className="font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                                {section.label}
                            </div>
                            {/* Best-effort: opens every chip in this group at once. */}
                            <button
                                type="button"
                                onClick={() => openAll(section.links)}
                                title={`Open all ${section.label.toLowerCase()} links`}
                                className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:outline-none"
                            >
                                Open all
                                <ExternalLink className="size-3" />
                            </button>
                        </div>
                        {/* Wrapping chips: small flat hit targets, a hover fill, and
                            a ↗ that brightens on hover so each reads as an outbound
                            link. Mirrors the Pivot chip idiom. */}
                        <div className="flex flex-wrap gap-1.5">
                            {section.links.map((link) => (
                                <a
                                    key={link.id}
                                    href={link.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title={`Search ${link.name} for ${indicator}`}
                                    onClick={(e) => {
                                        // Plain left-click opens in the
                                        // background so the user keeps their
                                        // place; modified clicks / non-primary
                                        // buttons keep native handling.
                                        if (
                                            e.button !== 0 ||
                                            e.metaKey ||
                                            e.ctrlKey ||
                                            e.shiftKey ||
                                            e.altKey
                                        )
                                            return;
                                        e.preventDefault();
                                        openInBackground(link.url);
                                    }}
                                    className="group inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:border-foreground/40 hover:bg-muted focus-visible:border-foreground/40 focus-visible:bg-muted focus-visible:outline-none"
                                >
                                    {link.name}
                                    <ExternalLink className="size-3 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-foreground" />
                                </a>
                            ))}
                        </div>
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}
