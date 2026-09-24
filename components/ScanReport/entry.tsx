"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { count } from "@/lib/text";
import { relativeTime } from "@/lib/relative-time";
import { buildScanNarrative } from "@/lib/ti/narrative";
import { ENGINE_NAME } from "@/lib/ti/url/active/engines";
import { asSingleScan, type MergedIndicator } from "@/lib/ti/url/active/merge";
import type { RedFlag } from "@/lib/ti/url/active/red-flags";
import { describeScan, type ScanClass } from "@/lib/ti/url/active/scan-class";
import type { ActiveScan, ActiveScanBatch } from "@/lib/ti/url/active/types";
import { cn } from "@/lib/utils";
import { Tile } from "@/components/CheckResults/frame";
import { CopyBox } from "@/components/CheckResults/panel";
import { RailCapture } from "./capture";

/**
 * The head of the scan page: the capture, what it is, and when it was seen.
 *
 * The same three tiles the passive page opens with, in the same places, with
 * one substitution. The passive page draws a creature; this one shows the
 * capture, because the scan's own picture of the page is better evidence than
 * any drawing of it, and a sprite beside a screenshot would be two pictures of
 * one thing.
 *
 * The class is the large word, not the verdict. The first question on this page
 * is what the link leads to; whether an engine flagged it is the second, and is
 * stated once, small, under the capture.
 */

type Verdict = { word: string; tone: string };

/** The engines' verdict, as the word under the capture. "NOT FLAGGED" is
 *  deliberately not "clean": no engine flagging a page is an absence of
 *  evidence, and the class and the flags beside it make the actual case. */
export function verdictOf(merged: MergedIndicator | null, pending: boolean): Verdict {
  if (!merged || merged.engines.length === 0) {
    return pending
      ? { word: "SCANNING", tone: "text-muted-foreground" }
      : { word: "NO READING", tone: "text-muted-foreground" };
  }
  if (merged.detail.verdicts.overall.malicious) {
    return { word: "FLAGGED", tone: "text-red-600 dark:text-red-400" };
  }
  return { word: "NOT FLAGGED", tone: "text-foreground" };
}

/** "1 of 2 engines": how many that finished called it malicious. Counted per
 *  engine rather than per scan, so an address scanned on two ports by one
 *  engine is still one engine's opinion. */
function engineTally(scans: ActiveScan[], merged: MergedIndicator): string | undefined {
  const total = merged.engines.length;
  if (total === 0) return undefined;
  const flagged = new Set(
    scans
      .filter((s) => s.status === "done" && s.detail?.verdicts.overall.malicious)
      .map((s) => s.engine),
  ).size;
  return `${flagged} of ${count(total, "engine")}`;
}

/** The capture, and the verdict ruled off under it. */
export function ScanRailTile({
  merged,
  scans,
  klass,
  pending,
}: Readonly<{
  merged: MergedIndicator;
  scans: ActiveScan[];
  klass: ScanClass | undefined;
  pending: boolean;
}>) {
  const verdict = verdictOf(merged, pending);
  const tally = engineTally(scans, merged);
  return (
    <Tile span={4} tone="rail" className="flex flex-col items-center gap-4 p-5">
      <RailCapture merged={merged} scans={scans} kind={klass?.kind} tone={verdict.tone} />
      <div className="mt-auto w-full border-t border-foreground/12 pt-3 text-center">
        <div
          className={cn(
            "font-mono text-[11px] leading-tight font-bold tracking-[0.16em] uppercase",
            verdict.tone,
          )}
        >
          {verdict.word}
        </div>
        {tally && (
          <div className="mt-1 font-mono text-[10.5px] text-muted-foreground">{tally}</div>
        )}
      </div>
    </Tile>
  );
}

/**
 * Where the trip ended, what it found there, and what that thing is.
 *
 * The final URL rather than the submitted one, because that is where a victim
 * would have landed; the class caption says how the trip got there when it
 * crossed to another host, and the path tile below draws every hop.
 *
 * The sentence under them describes rather than judges: what the page calls
 * itself and who serves it. The verdict is already the tag under the capture,
 * and a second statement of it here pushed the description off the screen. The
 * copy still carries the whole case, verdict included, because what is pasted
 * into a ticket has to stand without the page beside it.
 */
export function ScanHeroTile({
  merged,
  indicator,
  klass,
}: Readonly<{
  merged: MergedIndicator;
  indicator: string;
  klass: ScanClass | undefined;
}>) {
  const description = klass ? describeScan(merged, klass) : undefined;
  const paragraph = [description, ...buildScanNarrative(asSingleScan(merged))].join(" ").trim();

  return (
    <Tile span={5} className="flex flex-col">
      <div className="mb-2 border-b border-foreground/12 pb-3">
        <p className="font-mono text-sm break-all text-muted-foreground">
          {merged.detail.finalUrl ?? indicator}
        </p>
        <p className="mt-0.5 font-mono text-[2rem] leading-tight font-bold break-words">
          {klass?.label ?? "Scanning"}
        </p>
        <p className="mt-1.5 font-mono text-xs text-muted-foreground">
          {klass?.caption ?? "the engines have not answered yet"}
        </p>
        {/* A scan of one indicator can be a scan of two services. Said here,
            above everything folded, because the reader has to know it before
            reading any of it. */}
        {merged.separateSites && (
          <p className="mt-2 font-mono text-[11px] text-amber-600 dark:text-amber-400">
            ⚠ The scanned URLs served different pages, so the rows below fold
            more than one thing together.
          </p>
        )}
      </div>
      {description && <CopyBox text={description} copyText={paragraph} />}
    </Tile>
  );
}

/** One line of the history: when, and what it said. */
function HistoryLine({ at, said }: Readonly<{ at: string; said: string }>) {
  return (
    <>
      <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{at}</span>
      <span className="text-right font-mono text-[11px]">{said}</span>
    </>
  );
}

const LABEL = "font-mono text-[9.5px] tracking-[0.13em] text-muted-foreground uppercase";

/**
 * When this reading was taken, what came before it, and how to take another.
 *
 * The history is the column's reason to exist here. A phishing site changes
 * fast, so a reading that said malicious three days ago and says nothing now is
 * evidence of a takedown rather than of innocence, and the two readings belong
 * side by side rather than one of them in a footnote.
 */
export function ScanProvenanceTile({
  batch,
  merged,
  targets,
  now,
  context,
  busy,
  onRescan,
}: Readonly<{
  batch: ActiveScanBatch;
  merged: MergedIndicator;
  targets: string[];
  now: number;
  /** The path and query of a scanned URL, which the host record below does
   *  not carry. */
  context?: string;
  busy: boolean;
  onRescan: () => void;
}>) {
  const engines = merged.engines.map((e) => ENGINE_NAME[e]).join(" + ");
  const previous = batch.previous ?? [];
  const nowSaid = verdictOf(merged, busy).word.toLowerCase();

  return (
    <Tile
      span={3}
      tone="rail"
      title="Scanned"
      note={engines || undefined}
      className="flex flex-col"
    >
      <div
        suppressHydrationWarning
        title={`Submitted ${new Date(batch.submittedAt).toLocaleString()}`}
        className="font-mono text-[22px] leading-none font-bold"
      >
        {relativeTime(batch.submittedAt, now)}
      </div>
      <div className="mt-4 grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1.5 border-t border-foreground/12 pt-3.5">
        <span className={LABEL}>Sent</span>
        <span className="text-right font-mono text-[11.5px]">{count(targets.length, "URL")}</span>
        {context && (
          <>
            <span className={LABEL}>Path</span>
            <span className="truncate text-right font-mono text-[11.5px]" title={context}>
              {context}
            </span>
          </>
        )}
      </div>
      {previous.length > 0 && (
        <div className="mt-3 grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1 border-t border-foreground/12 pt-3">
          <span className={cn(LABEL, "col-span-2 mb-0.5")}>History</span>
          {[...previous].reverse().map((p) => (
            <HistoryLine
              key={p.at}
              at={new Date(p.at).toLocaleDateString()}
              said={p.malicious ? "flagged" : "not flagged"}
            />
          ))}
          <HistoryLine at="now" said={nowSaid} />
        </div>
      )}
      <button
        type="button"
        onClick={onRescan}
        disabled={busy}
        className="mt-auto inline-flex w-full items-center justify-center gap-2 rounded border border-foreground/15 bg-background px-3 py-2 font-mono text-[11.5px] tracking-[0.06em] transition-colors hover:border-foreground/40 disabled:opacity-50 disabled:hover:border-foreground/15"
      >
        <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
        {busy ? "Scanning" : "Rescan"}
      </button>
    </Tile>
  );
}

/**
 * What the scan saw for itself, each linked to the tile holding the evidence.
 *
 * In red, which the passive page reserves for its sprite and verdict alone.
 * The exception is deliberate: these are observations the scanner made of the
 * page, not anyone's opinion of it, and they are what this page exists to
 * surface.
 */
export function RedFlagsTile({ flags }: Readonly<{ flags: RedFlag[] }>) {
  if (flags.length === 0) return null;
  return (
    <Tile span={12} id="flags" title="Red flags" note={count(flags.length, "flag")}>
      <ul className="grid gap-x-10 gap-y-1.5 md:grid-cols-2">
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
    </Tile>
  );
}
