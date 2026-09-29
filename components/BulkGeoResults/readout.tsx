"use client";

import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import type { GeoRow } from "@/lib/ti/geo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCopied } from "@/components/CheckResults/primitives";
import {
  anchorNote,
  distanceBands,
  formatKm,
  medianKm,
  pointOf,
  spreadNote,
  type Spread,
} from "@/lib/ti/geo/distance";

/**
 * The map's reading as labelled fields rather than a paragraph: in spread mode,
 * where the batch clusters and who sits outside it; measuring, where the anchor
 * is and how the rest fall by distance. The paragraph still exists, it is what
 * Copy sends, because a ticket wants a sentence and a screen wants a readout.
 */

const OUTLIERS_SHOWN = 5;

/** The shared frame: label and copy button on top, fields below. */
export function ReadoutFrame({
  title,
  count,
  copyText,
  aside,
  children,
}: Readonly<{
  title: string;
  count?: number;
  copyText: string;
  aside?: ReactNode;
  children: ReactNode;
}>) {
  const [copied, copy] = useCopied();
  return (
    <section className="flex flex-col rounded-md border-2 border-foreground/20">
      <header className="flex min-h-9 items-center justify-between gap-2 border-b border-foreground/10 px-3">
        <h3 className="flex items-center gap-2 font-mono text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          {title}
          {count !== undefined && (
            <span className="rounded-sm bg-foreground/10 px-1.5 font-normal tabular-nums">{count}</span>
          )}
        </h3>
        <div className="-mr-1.5 flex items-center gap-1">
          {aside}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-label={`Copy ${title.toLowerCase()} as text`}
            onClick={() => copy(copyText)}
            className="font-hand gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            {copied ? (
              <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Copy className="size-3.5" />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </header>
      <div className="flex-1 space-y-3 p-3">{children}</div>
    </section>
  );
}

/** Label on the left, value on the right: the one line shape every field takes. */
function Field({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] items-baseline gap-3 text-sm">
      <dt className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function Ip({ ip }: Readonly<{ ip: string }>) {
  return <span className="font-mono text-[13px]">{ip}</span>;
}

/** A thin grey bar, for comparing counts or distances down a list at a glance. */
function Bar({ value, max }: Readonly<{ value: number; max: number }>) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <span className="block h-1.5 w-full rounded-full bg-foreground/10">
      <span className="block h-full rounded-full bg-foreground/55" style={{ width: `${pct}%` }} />
    </span>
  );
}

function SubHead({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="border-t border-foreground/10 pt-3 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
      {children}
    </div>
  );
}

interface Pointer {
  onAnchor: (ip: string) => void;
  onHover: (ip: string | null) => void;
}

function clusterValue(spread: Spread): ReactNode {
  const hub = spread.hub;
  if (!hub) return "none";
  if (spread.located > 1 && hub.within === 1) {
    return <span className="text-muted-foreground">none, no two within {formatKm(spread.radiusKm)}</span>;
  }
  return hub.label;
}

function OutlierList({
  spread,
  onAnchor,
  onHover,
}: Readonly<{ spread: Spread } & Pointer>) {
  const [open, setOpen] = useState(false);
  const all = spread.outliers;
  const shown = open ? all : all.slice(0, OUTLIERS_SHOWN);
  const max = all[0]?.km ?? 0;
  return (
    <div className="space-y-1.5">
      <SubHead>Outside, farthest first</SubHead>
      <ul className="-mx-1.5">
        {shown.map((o) => (
          <li key={o.ip}>
            <button
              type="button"
              title={`Measure distances from ${o.ip}`}
              onClick={() => onAnchor(o.ip)}
              onPointerEnter={() => onHover(o.ip)}
              onPointerLeave={() => onHover(null)}
              className="grid w-full grid-cols-[8.5rem_1fr_5rem_4.5rem] items-center gap-3 rounded-sm px-1.5 py-1 text-left text-sm hover:bg-foreground/[0.05]"
            >
              <Ip ip={o.ip} />
              <span className="truncate text-muted-foreground">{o.label}</span>
              <Bar value={o.km} max={max} />
              <span className="text-right font-mono text-xs tabular-nums">{formatKm(o.km)}</span>
            </button>
          </li>
        ))}
      </ul>
      {all.length > OUTLIERS_SHOWN && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="font-mono text-[11px] text-muted-foreground hover:text-foreground"
        >
          {open ? "Show fewer" : `Show ${all.length - OUTLIERS_SHOWN} more`}
        </button>
      )}
    </div>
  );
}

export function SpreadReadout({
  spread,
  onAnchor,
  onHover,
}: Readonly<{ spread: Spread } & Pointer>) {
  const hub = spread.hub;
  return (
    <ReadoutFrame title="Spread" copyText={spreadNote(spread)}>
      <dl className="space-y-1.5">
        <Field label="Cluster">{clusterValue(spread)}</Field>
        {hub && (
          <Field label={`Within ${formatKm(spread.radiusKm)}`}>
            <span className="tabular-nums">
              {hub.within} of {spread.located} located
            </span>
          </Field>
        )}
        <Field label="Outside">
          <span className="tabular-nums">{spread.outliers.length}</span>
        </Field>
        {spread.approx > 0 && (
          <Field label="Approximate">
            {spread.approx} country level only, distances to{" "}
            {spread.approx === 1 ? "it" : "them"} are rough
          </Field>
        )}
      </dl>
      {spread.outliers.length > 0 && (
        <OutlierList spread={spread} onAnchor={onAnchor} onHover={onHover} />
      )}
    </ReadoutFrame>
  );
}

/** One address with its place and, when given, its distance. */
function Placed({ row, km }: Readonly<{ row: GeoRow; km?: number }>) {
  const p = pointOf(row);
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <Ip ip={row.ip} />
      {p && <span className="truncate text-muted-foreground">{p.label}</span>}
      {km !== undefined && (
        <span className="ml-auto font-mono text-xs tabular-nums">{formatKm(km)}</span>
      )}
    </span>
  );
}

export function DistanceReadout({
  anchorIp,
  rows,
  distances,
  onStop,
}: Readonly<{
  anchorIp: string;
  rows: GeoRow[];
  distances: ReadonlyMap<string, number>;
  onStop: () => void;
}>) {
  const anchorRow = rows.find((r) => r.ip === anchorIp);
  const others = rows
    .filter((r) => r.ip !== anchorIp && distances.has(r.ip))
    .sort((a, b) => (distances.get(a.ip) ?? 0) - (distances.get(b.ip) ?? 0));
  const near = others[0];
  const far = others.at(-1);
  const median = medianKm(anchorIp, distances);
  const bands = distanceBands(anchorIp, distances);
  const most = Math.max(...bands.map((b) => b.count));

  return (
    <ReadoutFrame
      title="Distance"
      copyText={anchorNote(anchorIp, rows, distances)}
      aside={
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={onStop}
          className="font-hand text-sm text-muted-foreground hover:text-foreground"
        >
          Stop
        </Button>
      }
    >
      <dl className="space-y-1.5">
        <Field label="Anchor">{anchorRow ? <Placed row={anchorRow} /> : <Ip ip={anchorIp} />}</Field>
        {near && (
          <Field label="Nearest">
            <Placed row={near} km={distances.get(near.ip)} />
          </Field>
        )}
        {far && far !== near && (
          <Field label="Farthest">
            <Placed row={far} km={distances.get(far.ip)} />
          </Field>
        )}
        {median !== undefined && others.length > 2 && (
          <Field label="Median">
            <span className="font-mono text-xs tabular-nums">{formatKm(median)}</span>
          </Field>
        )}
      </dl>
      {others.length > 0 ? (
        <div className="space-y-1.5">
          <SubHead>By distance</SubHead>
          <ul className="space-y-1">
            {bands.map((b) => (
              <li
                key={b.label}
                className={cn(
                  "grid grid-cols-[8.5rem_1fr_2rem] items-center gap-3 text-sm",
                  !b.count && "text-muted-foreground",
                )}
              >
                <span>{b.label}</span>
                <Bar value={b.count} max={most} />
                <span className="text-right font-mono text-xs tabular-nums">{b.count}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No other address has a position.</p>
      )}
    </ReadoutFrame>
  );
}
