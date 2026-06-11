"use client";

import { TriangleAlert } from "lucide-react";
import { type ResultLike } from "@/lib/ti/narrative";

/**
 * Warn when a lookup ran but couldn't gather any intelligence (every
 * source that attempted a request failed. Without this the verdict reads
 * "inconclusive/clean" and looks like a real result rather than an outage.
 */
export function SourceHealthNotice({ result }: { result: ResultLike }) {
    const okCount = result.sources.filter((s) => s.status === "ok").length;
    if (okCount > 0 || result.stats.queried === 0) return null;

    return (
        <div className="sketch-shadow flex items-start gap-3 rounded-lg border border-orange-500/40 bg-orange-500/10 px-4 py-3 text-orange-700 dark:text-orange-300">
            <TriangleAlert className="mt-0.5 size-5 shrink-0" />
            <div className="space-y-0.5">
                <p className="text-base font-semibold leading-tight">
                    Heads up: no sources responded
                </p>
                <p className="text-sm leading-relaxed">
                    All {result.stats.queried} threat-intel source(s) failed to
                    respond, so the verdict below is inconclusive, not a clean
                    result. Try re-checking in a moment.
                </p>
            </div>
        </div>
    );
}
