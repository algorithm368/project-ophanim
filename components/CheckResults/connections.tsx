"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { type HashCheckResult } from "@/lib/ti/types";
import { hostFromUrl } from "@/lib/url";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Pivot, SectionHeading, useCopied } from "./primitives";

function DistributionUrlRow({ url }: Readonly<{ url: string }>) {
    const [copied, copy] = useCopied();
    const host = hostFromUrl(url);
    return (
        <li className="flex items-center gap-2 rounded-md border border-foreground/10 bg-muted/40 p-2 text-xs">
            <code
                className="min-w-0 flex-1 truncate font-mono text-[12px]"
                title={url}
            >
                {url}
            </code>
            {host && <Pivot value={host} label={`check ${host}`} />}
            <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open ${url} in a new tab`}
                title="Open in a new tab (may be a live malware URL)"
                className="shrink-0 text-muted-foreground hover:text-foreground"
            >
                <ExternalLink className="size-3.5" />
            </a>
            <Button
                type="button"
                variant="ghost"
                size="xs"
                aria-label="Copy URL"
                className="size-6 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                onClick={() => copy(url)}
            >
                {copied ? (
                    <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                ) : (
                    <Copy className="size-3.5" />
                )}
            </Button>
        </li>
    );
}

export function DistributionUrlsCard({
    result,
    streaming = false,
}: Readonly<{
    result: HashCheckResult | null;
    /** Set while the panel is still answering. Renders nothing at all, not a
     *  skeleton: this card hides itself for a file with no known distribution
     *  URLs, which is most of them, and a placeholder that later vanishes
     *  drags the whole page up. See the note on PassiveDnsCard. */
    streaming?: boolean;
}>) {
    if (streaming) return null;
    if (!result) return null;
    const urls = result.context?.distributionUrls ?? [];
    if (urls.length === 0) return null;
    const shown = urls.slice(0, 8);
    const extra = urls.length - shown.length;
    return (
        <Card className="sketch-shadow rounded-lg border border-foreground/12">
            <CardContent className="space-y-3">
                <SectionHeading>
                    Distribution URLs
                </SectionHeading>
                <p className="text-xs text-muted-foreground">
                    URLs that distributed this file. Use the pivot to check the
                    host, open links cautiously; they may still be live.
                </p>
                <ul className="space-y-1.5">
                    {shown.map((u) => (
                        <DistributionUrlRow key={u} url={u} />
                    ))}
                </ul>
                {extra > 0 && (
                    <p className="text-xs text-muted-foreground">
                        +{extra} more
                    </p>
                )}
            </CardContent>
        </Card>
    );
}

