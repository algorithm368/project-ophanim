"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { etaBudgetMs, etaLabel } from "@/lib/ti/eta";
import type { PartialLookup } from "@/lib/ti/partial";
import { Card, CardContent } from "@/components/ui/card";
import { SourceDots } from "./verdict";

/**
 * How much longer this is likely to take, ticking down.
 *
 * An analyst waiting twenty seconds is owed an estimate, which the readout
 * this replaced gave and the first draft of the pending hero dropped. The
 * budget is the longest timeout among the sources still out, so it shrinks as
 * slow sources land and can never grow; the elapsed side only rises. The
 * countdown therefore never ticks up, and when the estimate runs out it says
 * so instead of counting into negatives.
 */
function useEta(partial: PartialLookup): string {
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  // A multiset, not deduped: see etaBudgetMs for why a URL check's repeated
  // ids need every settled occurrence counted, not just whether one landed.
  const settledIds = partial.sources.map((s) => s.source.id);
  const budgetMs = etaBudgetMs(partial.metas, settledIds);
  // Nothing left to count down to once the last source is in.
  const finished = budgetMs === 0;

  useEffect(() => {
    if (finished) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [finished]);

  return etaLabel(budgetMs - (now - startedAt));
}

/**
 * The hero while the panel is still answering.
 *
 * It occupies the same slots the completed hero does, so completion changes
 * the contents of the card and never its shape: the verdict word replaces
 * "ANALYZING", the meter's fill switches from progress to score, and the held
 * threat slot receives the threat type.
 *
 * Counts never appear without their denominator. Five of twenty-seven sources
 * in, three of them adverse, reads as "3 adverse" to anyone glancing at it,
 * which is alarming; the same three out of a finished twenty-seven is mild.
 */
export function PendingHero({
  indicator,
  partial,
}: Readonly<{ indicator: string; partial: PartialLookup }>) {
  const c = partial.counts;
  const pct = c.total > 0 ? Math.round((c.settled / c.total) * 100) : 0;
  // Deliberately not in the live region below: it changes twice a second, and
  // a screen reader reading a countdown aloud would drown out the counts.
  const eta = useEta(partial);

  return (
    <Card className="sketch-shadow rounded-lg border border-foreground/12">
      <CardContent className="space-y-4">
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono text-2xl font-bold leading-none tracking-tight uppercase text-muted-foreground sm:text-3xl">
                Analyzing
              </span>
              {/* Held for the threat type, which is what actually reflows this
                  row when it arrives. */}
              <span className="inline-flex h-4 min-w-26 items-center">
                <span className="sweep h-2.5 w-full rounded" />
              </span>
            </span>
            <span className="font-mono font-bold uppercase leading-none text-muted-foreground">
              <span className="text-2xl sm:text-3xl tabular-nums">
                {c.settled}
                <span className="text-base">/{c.total || "…"}</span>
              </span>
              <span className="text-base font-medium"> sources</span>
            </span>
          </div>

          {/* The same meter the score will fill. */}
          <div
            role="progressbar"
            aria-label="Threat-intel sources checked"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={c.total > 0 ? pct : undefined}
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-foreground transition-[width] duration-200 ease-linear"
              style={{ width: `${Math.max(pct, 3)}%` }}
            />
          </div>

          <SourceDots
            sources={partial.sources}
            total={c.total}
            panel={partial.metas}
          />
        </div>

        {/* Where the narrative will land. */}
        <div className="space-y-2">
          <div className="sweep h-3 w-11/12 rounded" />
          <div className="sweep h-3 w-2/3 rounded" />
        </div>

        <dl className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-x-4 gap-y-3 border-t border-foreground/12 pt-3">
          <Cell label="Confidence">
            <span className="sweep inline-block h-3 w-14 rounded align-middle" />
          </Cell>
          {/* Detectors, not sources. `total` is the whole panel, most of
              which is context-only (geolocation and the like) and can never
              answer for or against the indicator; against that denominator
              this cell could not pass about half, and then collapsed onto the
              detector count when the result landed. */}
          <Cell label="Detectors">
            {c.answered}{" "}
            <span className="text-muted-foreground">
              of {c.detectors || "…"}
            </span>
          </Cell>
          <Cell label="Adverse" wide>
            {c.adverse}{" "}
            <span className="text-muted-foreground">
              / {c.answered} answered
            </span>
          </Cell>
          <Cell label="Clean" wide>
            {c.clean}{" "}
            <span className="text-muted-foreground">
              / {c.answered} answered
            </span>
          </Cell>
          {/* Shown on the same condition the completed strip uses, so the set
              of columns does not change shape when the result lands. "No
              record" is a third answer, not a shade of clean: a source that has
              never seen the indicator has not vouched for it. */}
          {c.noRecord > 0 && <Cell label="No record">{c.noRecord}</Cell>}
          {c.gaps > 0 && <Cell label="Gaps">{c.gaps}</Cell>}
          {/* Unknown, not zero, before the `start` event names the panel.
              A cache hit never sends that event, so this cell would otherwise
              read "still out: 0" for the whole of the one lookup that renders
              without a panel. */}
          <Cell label="Still out" emphatic>
            {c.total > 0 ? c.stillOut : "…"}
          </Cell>
        </dl>

        <div className="font-mono text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="size-3" />
            verdict pending, {c.settled} of {c.total || "…"} in, {eta}
          </span>
        </div>

        <p className="sr-only" role="status" aria-live="polite">
          {c.total > 0
            ? `${c.settled} of ${c.total} sources checked for ${indicator}. Verdict pending.`
            : `Checking ${indicator}. Verdict pending.`}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * The same evidence as the pending hero, without the hero.
 *
 * A URL check has no single verdict to hold a place for, so its hero is the
 * layer stack rather than a card, and the pending hero cannot stand in for it.
 * That left the slowest check of the four, three layers and forty-odd sources,
 * showing no progress at all: no bar, no dots, no counts. This is what the
 * hero says minus the parts that need a verdict, laid inside the layer stack's
 * own placeholder so it takes no space of its own.
 */
export function PendingReadout({
  partial,
}: Readonly<{ partial: PartialLookup }>) {
  const c = partial.counts;
  const pct = c.total > 0 ? Math.round((c.settled / c.total) * 100) : 0;
  const eta = useEta(partial);

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Clock className="size-3" />
          verdict pending, {c.settled} of {c.total || "…"} in, {eta}
        </span>
        <span className="tabular-nums">
          {c.answered} of {c.detectors || "…"} detectors
        </span>
      </div>

      {/* The same meter the hero draws, at the same weight. */}
      <div
        role="progressbar"
        aria-label="Threat-intel sources checked"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={c.total > 0 ? pct : undefined}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-foreground transition-[width] duration-200 ease-linear"
          style={{ width: `${Math.max(pct, 3)}%` }}
        />
      </div>

      <SourceDots
        sources={partial.sources}
        total={c.total}
        panel={partial.metas}
      />

      {/* Counts never appear without their denominator: "3 adverse" alone is
          alarming at five sources in and mild at forty. */}
      {c.answered > 0 && (
        <p className="font-mono text-xs tabular-nums text-muted-foreground">
          {c.adverse} adverse and {c.clean} clean, of {c.answered} answered
        </p>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {c.settled} of {c.total} sources checked. Verdict pending.
      </p>
    </div>
  );
}

/** One cell of the strip, matching the completed hero's dt/dd shape. */
function Cell({
  label,
  children,
  wide,
  emphatic,
}: Readonly<{
  label: string;
  children: React.ReactNode;
  wide?: boolean;
  emphatic?: boolean;
}>) {
  return (
    <div className={wide ? "col-span-2 min-w-0" : "min-w-0"}>
      <dt className="font-mono text-[10px] uppercase leading-none tracking-[0.14em] text-muted-foreground">
        {label}
      </dt>
      <dd
        className={`mt-1.5 font-mono text-[13px] leading-snug wrap-break-word text-foreground${
          emphatic ? " font-bold" : ""
        }`}
      >
        {children}
      </dd>
    </div>
  );
}
