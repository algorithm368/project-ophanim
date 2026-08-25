"use client";

import { Clock } from "lucide-react";
import type { PartialLookup } from "@/lib/ti/partial";
import { Card, CardContent } from "@/components/ui/card";
import { SourceDots } from "./verdict";

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
              <span className="inline-flex h-4 min-w-[6.5rem] items-center">
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

          <SourceDots sources={partial.sources} total={c.total} />
        </div>

        {/* Where the narrative will land. */}
        <div className="space-y-2">
          <div className="sweep h-3 w-11/12 rounded" />
          <div className="sweep h-3 w-2/3 rounded" />
        </div>

        <dl className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-x-4 gap-y-3 border-t border-foreground/12 pt-3">
          <Cell label="Confidence">
            <span className="sweep inline-block h-3 w-14 rounded align-middle" />
          </Cell>
          <Cell label="Detectors">
            {c.answered}{" "}
            <span className="text-muted-foreground">of {c.total || "…"}</span>
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
          <Cell label="Still out" emphatic>
            {c.stillOut}
          </Cell>
        </dl>

        <div className="font-mono text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="size-3" />
            verdict pending, {c.settled} of {c.total || "…"} in
          </span>
        </div>

        <p className="sr-only" role="status" aria-live="polite">
          {c.settled} of {c.total} sources checked for {indicator}. Verdict
          pending.
        </p>
      </CardContent>
    </Card>
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
        className={`mt-1.5 font-mono text-[13px] leading-snug break-words text-foreground${
          emphatic ? " font-bold" : ""
        }`}
      >
        {children}
      </dd>
    </div>
  );
}
