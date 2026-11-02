"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { useMemo } from "react";
import { count } from "@/lib/text";
import { relativeTime } from "@/lib/relative-time";
import { buildScanNarrative } from "@/lib/ti/narrative";
import { ENGINE_NAME } from "@/lib/ti/url/active/engines";
import { asSingleScan, type MergedIndicator } from "@/lib/ti/url/active/merge";
import { agreementLevel, type EngineBallot, engineBallots } from "@/lib/ti/url/active/engine-ballot";
import type { RedFlag } from "@/lib/ti/url/active/red-flags";
import { describeScan, type ScanClass } from "@/lib/ti/url/active/scan-class";
import { historyLevel } from "@/lib/ti/url/active/scan-history";
import { scanVitals } from "@/lib/ti/url/active/scan-vitals";
import type { ActiveScan, ActiveScanBatch } from "@/lib/ti/url/active/types";
import { voteMarkOf, voteMarksUsed } from "@/lib/ti/geo/votes";
import { cn } from "@/lib/utils";
import { Tile } from "@/components/CheckResults/frame";
import { Vitals } from "@/components/CheckResults/identity";
import { markFace } from "@/components/CheckResults/mark-face";
import { CopyBox, markSize } from "@/components/CheckResults/panel";
import { LABEL, Section, stamp } from "@/components/CheckResults/readout";
import { VoteMark } from "@/components/CheckResults/voting";
import { BleedCapture, RailCapture, railShots } from "./capture";
import { ScanWheel } from "./wheel";

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

/**
 * The capture, in the rail the passive page fills with its globe.
 *
 * One capture fills the tile edge to edge, with nothing laid on it but its
 * caption. Anything else, two sites side by side or a line saying why there is
 * no picture, keeps the framed layout with the verdict ruled off under it,
 * since a sentence or a pair of thumbnails has no edge to bleed to.
 */
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
  const shots = railShots(merged, scans, klass?.kind);
  if (shots.length === 1) {
    return (
      <Tile span={3} tone="rail" className="relative min-h-[300px] overflow-hidden p-0">
        <BleedCapture shot={shots[0]} merged={merged} />
      </Tile>
    );
  }
  const verdict = verdictOf(merged, pending);
  const tally = engineTally(scans, merged);
  return (
    <Tile span={3} tone="rail" className="flex flex-col items-center gap-4 p-5">
      {/* Until a capture is in, the wheel holds the rail, including after
          Cloudflare has answered alone: its "no screenshot" would be read as
          final while urlscan is still out. */}
      {pending && shots.length === 0 ? (
        <ScanWheel />
      ) : (
        <RailCapture merged={merged} scans={scans} kind={klass?.kind} tone={verdict.tone} />
      )}
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
 * itself and who serves it. The verdict is already in the provenance rail's
 * ballots, and a second statement of it here pushed the description off the screen. The
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
  const label = klass?.label ?? "Scanning";

  return (
    <Tile span={6} className="flex flex-col">
      <div className="@container mb-2 border-b border-foreground/12 pb-3">
        <p className="text-[12.5px] break-all text-muted-foreground">
          {merged.detail.finalUrl ?? indicator}
        </p>
        <p
          className={cn(markFace.className, "mt-2 leading-[0.82] tracking-[0.005em] uppercase")}
          style={{ fontSize: markSize(label) }}
        >
          {label}
        </p>
        <p className="mt-1.5 text-[11.5px] leading-3.5 text-muted-foreground">
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

/**
 * One URL's ballot as a grid of marks: a row per question, a column per
 * engine. The passive page's location grid turned on its side, because here
 * there are always two voters and seven questions, and seven columns would not
 * fit the rail. A split is a crossed box with both answers on hover; the
 * values themselves are in the tiles below, where each is attributed.
 */
function EngineGrid({ ballot, labelled }: Readonly<{ ballot: EngineBallot; labelled: boolean }>) {
  const template = `minmax(0,1fr) repeat(${ballot.engines.length}, 4.5rem)`;
  const marks = voteMarksUsed(ballot.fields.flatMap((f) => ballot.engines.map((e) => f.cells[e])));
  return (
    <div>
      {labelled && (
        <div className={cn(LABEL, "mb-1 truncate normal-case tracking-normal")} title={ballot.target}>
          {ballot.target}
        </div>
      )}
      <div className="grid items-end gap-x-1 pb-1" style={{ gridTemplateColumns: template }}>
        <span />
        {ballot.engines.map((e) => (
          <span
            key={e}
            className="text-center font-mono text-[9px] tracking-[0.06em] text-muted-foreground uppercase"
          >
            {ENGINE_NAME[e]}
          </span>
        ))}
      </div>
      {ballot.fields.map((f) => (
        <div
          key={f.key}
          className="grid items-center gap-x-1 border-t border-foreground/10 py-[5px]"
          style={{ gridTemplateColumns: template }}
        >
          <span className="truncate font-mono text-[11px]">{f.label}</span>
          {ballot.engines.map((e) => (
            <span key={e} className="flex justify-center">
              <VoteMark kind={voteMarkOf(f.cells[e])} title={f.cells[e]?.value} />
            </span>
          ))}
        </div>
      ))}
      <div className="mt-1.5 flex gap-x-4 border-t border-foreground/10 pt-2 font-mono text-[9.5px] whitespace-nowrap text-muted-foreground">
        {marks.map((m) => (
          <span key={m} className="inline-flex items-center gap-1.5">
            <VoteMark kind={m} />
            {m}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The engines' level when there is no ballot to draw one from. */
function soloLevel(engines: number, busy: boolean): string {
  if (engines === 0) return busy ? "Waiting" : "None";
  return count(engines, "engine");
}

/**
 * When this reading was taken, how far the engines agree on it, what came
 * before it, and how to take another.
 *
 * The passive page's provenance rail, in its grammar: each part a level set as
 * a mark over the picture of why. The ballot is the picture for the engines,
 * because two scanners agreeing is what makes a single split stand out: a login
 * page to one and a 403 to the other is what a kit hiding from scanners looks
 * like. The history is kept because a phishing site changes fast, so a reading
 * that said malicious three days ago and says nothing now is evidence of a
 * takedown rather than of innocence.
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
  /** The path and query of a scanned URL, which the host alone does not say. */
  context?: string;
  busy: boolean;
  onRescan: () => void;
}>) {
  const ballots = useMemo(() => engineBallots(batch.scans), [batch.scans]);
  const previous = batch.previous ?? [];
  const nowSaid = verdictOf(merged, busy).word.toLowerCase();
  const answered = merged.engines.length > 0 && !busy;
  const nowMalicious = answered ? merged.detail.verdicts.overall.malicious : undefined;

  return (
    <Tile span={3} rows={2} tone="rail" className="flex flex-col gap-4">
      <div>
        <span className={LABEL}>Scanned</span>
        <div
          suppressHydrationWarning
          title={`Submitted ${new Date(batch.submittedAt).toLocaleString()}`}
          className={cn(markFace.className, "mt-1 text-[44px] leading-[0.85] uppercase")}
        >
          {relativeTime(batch.submittedAt, now)}
        </div>
        <p suppressHydrationWarning className="mt-1.5 text-[11.5px] text-muted-foreground">
          {stamp(batch.submittedAt)}, {count(targets.length, "URL")} sent
        </p>
        {context && (
          <p className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground" title={context}>
            {context}
          </p>
        )}
      </div>
      <Section title="Engines" level={agreementLevel(ballots) ?? soloLevel(merged.engines.length, busy)}>
        {ballots.length > 0 ? (
          <div className="space-y-4">
            {ballots.map((b) => (
              <EngineGrid key={b.target} ballot={b} labelled={ballots.length > 1} />
            ))}
          </div>
        ) : (
          merged.engines.length > 0 && (
            <p className="text-[11.5px] text-muted-foreground">
              {merged.engines.map((e) => ENGINE_NAME[e]).join(" + ")} alone, nobody to compare with
            </p>
          )
        )}
      </Section>
      <Section title="History" level={historyLevel(previous, nowMalicious)}>
        {previous.length > 0 ? (
          <div className="grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1">
            {[...previous].reverse().map((p) => (
              <HistoryLine
                key={p.at}
                at={new Date(p.at).toLocaleDateString()}
                said={p.malicious ? "flagged" : "not flagged"}
              />
            ))}
            <HistoryLine at="now" said={nowSaid} />
          </div>
        ) : (
          <p className="text-[11.5px] text-muted-foreground">no earlier scan of this indicator</p>
        )}
      </Section>
      <div className="mt-auto border-t border-foreground/12 pt-3">
        <button
          type="button"
          onClick={onRescan}
          disabled={busy}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded border border-foreground/15 bg-background px-2.5 py-2.5 font-mono text-[11px] tracking-[0.06em] uppercase transition-colors hover:border-foreground/40 disabled:opacity-50 disabled:hover:border-foreground/15"
        >
          <RefreshCw className={cn("size-3", busy && "animate-spin")} />
          {busy ? "Scanning" : "Rescan"}
        </button>
      </div>
    </Tile>
  );
}

/**
 * The scan's headline facts as marks, under the hero, where the passive page
 * sets country, network and name. The slots are `scanVitals`'s; a slot holding
 * a red flag is drawn red, the scan page's standing exception to colour.
 */
export function ScanVitalsTile({
  merged,
  flags,
  now,
}: Readonly<{ merged: MergedIndicator; flags: RedFlag[]; now: number }>) {
  const vitals = useMemo(() => scanVitals(merged, flags, now), [merged, flags, now]);
  return (
    <Tile span={12} className="p-0">
      <Vitals vitals={vitals} />
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
