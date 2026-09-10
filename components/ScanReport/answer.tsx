"use client";

import { TriangleAlert } from "lucide-react";
import { count } from "@/lib/text";
import { relativeTime } from "@/lib/relative-time";
import { buildScanNarrative, scanJudgement } from "@/lib/ti/narrative";
import { ENGINE_NAME } from "@/lib/ti/url/active/engines";
import { asSingleScan, type MergedIndicator } from "@/lib/ti/url/active/merge";
import type { RedFlag } from "@/lib/ti/url/active/red-flags";
import type { ActiveScanBatch } from "@/lib/ti/url/active/types";
import { cn } from "@/lib/utils";
import { CopyButton } from "@/components/CheckResults/primitives";

/** How the engines came down, in three words. */
function verdictOf(m: MergedIndicator): {
  headline: string;
  tone: string;
  flagged: boolean;
} {
  const flaggedBy = m.perTarget.filter(
    (t) => t.detail.verdicts.overall.malicious,
  ).length;
  if (flaggedBy > 0) {
    return {
      headline: "FLAGGED",
      tone: "text-red-600 dark:text-red-400",
      flagged: true,
    };
  }
  if (m.engines.length === 0) {
    return { headline: "NO READING", tone: "text-foreground/50", flagged: false };
  }
  return { headline: "NOT FLAGGED", tone: "text-foreground", flagged: false };
}

/**
 * The answer, above everything.
 *
 * Three things, in the order they are asked. Whether an engine flagged it, and
 * how many looked, because "not flagged by one engine" and "not flagged by two"
 * are different amounts of nothing. When the scan ran, because a phishing site
 * changes fast and an hour-old reading is a different claim from a week-old
 * one. Then the red flags, which are what the scan saw for itself rather than
 * what anyone concluded.
 *
 * "NOT FLAGGED" is deliberately not "clean". No engine flagging a page is an
 * absence of evidence, and the sections below are where the case is actually
 * made, which is why the red flags sit here in colour and the verdict does not
 * pretend to be a score.
 */
export function ScanAnswer({
  merged,
  batch,
  flags,
  now,
}: Readonly<{
  merged: MergedIndicator;
  batch: ActiveScanBatch;
  flags: RedFlag[];
  /** Passed in rather than read here so the server and the first client render
   *  agree; a clock read during render disagrees with itself across hydration. */
  now: number;
}>) {
  const { headline, tone } = verdictOf(merged);
  const engines = merged.engines.map((e) => ENGINE_NAME[e]);

  // On screen, the judgement only. Every fact the full paragraph recites is a
  // row of its own further down, and printing both said the domain's age twice.
  // The copy carries the whole paragraph, because what lands in a ticket has to
  // read without the table beside it.
  const single = asSingleScan(merged);
  const judgement = scanJudgement(single);
  const paragraph = buildScanNarrative(single).join(" ");

  return (
    <div className="sketch-shadow space-y-3 rounded-lg border border-foreground/12 bg-card p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={cn("font-mono text-lg font-semibold tracking-tight", tone)}>
          {headline}
        </span>
        <span className="text-xs text-foreground/55">
          {engines.length
            ? `${engines.join(" + ")} · ${count(engines.length, "engine")}`
            : "no engine has finished"}
        </span>
        <span className="ml-auto font-mono text-xs text-foreground/50 tabular-nums">
          {new Date(batch.submittedAt).toLocaleString()} ·{" "}
          {relativeTime(batch.submittedAt, now)}
        </span>
      </div>

      {judgement && (
        <div className="space-y-1 border-t border-foreground/10 pt-3">
          <p className="text-sm text-foreground/75">{judgement}</p>
          {paragraph && <CopyButton text={paragraph} />}
        </div>
      )}

      {flags.length > 0 && (
        <ul className="space-y-1 border-t border-foreground/10 pt-3">
          {flags.map((flag) => (
            <li key={flag.id} className="flex items-start gap-2 text-sm">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-red-600 dark:text-red-400" />
              <a
                href={`#${flag.section}`}
                className="text-red-600 underline decoration-red-600/30 underline-offset-2 hover:decoration-red-600 dark:text-red-400 dark:decoration-red-400/30 dark:hover:decoration-red-400"
              >
                {flag.label}
              </a>
            </li>
          ))}
        </ul>
      )}

      {/* A scan of one indicator can be a scan of two services. Saying so here
          rather than only beside the differing rows, because everything below
          this point is folded and the reader has to know that before reading
          it. */}
      {merged.separateSites && (
        <p className="border-t border-foreground/10 pt-3 text-xs text-amber-600 dark:text-amber-400">
          ⚠ The scanned URLs served different pages, so the reading below folds
          more than one thing together. Every field they answered differently on
          is named where it appears.
        </p>
      )}
    </div>
  );
}
