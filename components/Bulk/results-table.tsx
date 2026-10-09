"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { VERDICT_STYLE } from "@/components/CheckResults/verdict";
import { passiveHref } from "@/lib/route-mode";
import { depthOf, type RowSummary } from "@/lib/ti/bulk/types";
import type { Verdict } from "@/lib/ti/types";
import { cn } from "@/lib/utils";
import { SOURCE_NAMES } from "./confirm-bar";

type DepthFilter = "all" | "not-full";

const SEVERITY: Verdict[] = ["malicious", "suspicious", "low", "clean", "unknown"];

/** Worst first. A row with no verdict yet sorts after every verdict. */
export function severity(verdict: Verdict | undefined): number {
  return verdict ? SEVERITY.indexOf(verdict) : SEVERITY.length;
}

/** Why a row is the way it is. A partial row names the sources it lacks. */
export function noteFor(row: RowSummary): string | undefined {
  if (row.state === "partial") return `No ${row.missing.map((id) => SOURCE_NAMES[id]).join(", ")}`;
  return row.note;
}

function byWorst(a: RowSummary, b: RowSummary): number {
  return severity(a.verdict) - severity(b.verdict) || a.id - b.id;
}

function IndicatorCell({ row }: Readonly<{ row: RowSummary }>) {
  const name =
    row.state === "internal" ? (
      <span>{row.indicator}</span>
    ) : (
      <Link href={passiveHref(row.indicator)} className="underline-offset-4 hover:underline">
        {row.indicator}
      </Link>
    );
  return (
    <td className="px-3 py-1.5 font-mono">
      {name}
      {row.display && <div className="text-xs text-muted-foreground">{row.display}</div>}
    </td>
  );
}

function VerdictCell({ row }: Readonly<{ row: RowSummary }>) {
  if (row.state === "feed-only" || row.state === "internal" || !row.verdict) {
    return <td className="px-3 py-1.5 text-muted-foreground">{row.state === "pending" ? "Pending" : noteFor(row)}</td>;
  }
  const style = VERDICT_STYLE[row.verdict];
  return (
    <td className="px-3 py-1.5">
      <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", style.chip)}>{style.label}</span>
    </td>
  );
}

export function ResultsTable({ rows, runId }: Readonly<{ rows: RowSummary[]; runId: string }>) {
  const [filter, setFilter] = useState<DepthFilter>("all");
  const shown = useMemo(
    () => rows.filter((r) => filter === "all" || depthOf(r) !== "full").toSorted(byWorst),
    [rows, filter],
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-sm">
        <div className="flex gap-2">
          <Button size="sm" variant={filter === "all" ? "default" : "outline"} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            All
          </Button>
          <Button size="sm" variant={filter === "not-full" ? "default" : "outline"} aria-pressed={filter === "not-full"} onClick={() => setFilter("not-full")}>
            Not full
          </Button>
        </div>
        <div className="flex gap-3 text-muted-foreground">
          <a download href={`/api/bulk/${runId}/export?format=csv`} className="underline-offset-4 hover:text-foreground hover:underline">
            CSV
          </a>
          <a download href={`/api/bulk/${runId}/export?format=json`} className="underline-offset-4 hover:text-foreground hover:underline">
            JSON
          </a>
        </div>
      </div>
      <table className="w-full border-collapse text-left text-sm">
        <thead className="border-b border-border text-xs text-muted-foreground uppercase">
          <tr>
            <th className="px-3 py-1.5 font-medium">Indicator</th>
            <th className="px-3 py-1.5 font-medium">Kind</th>
            <th className="px-3 py-1.5 font-medium">Verdict</th>
            <th className="px-3 py-1.5 font-medium">Score</th>
            <th className="px-3 py-1.5 font-medium">Depth</th>
            <th className="px-3 py-1.5 font-medium">Note</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr key={row.id} className="border-b border-border/50 align-top">
              <IndicatorCell row={row} />
              <td className="px-3 py-1.5">{row.kind}</td>
              <VerdictCell row={row} />
              <td className="px-3 py-1.5 tabular-nums">{row.riskScore ?? ""}</td>
              <td className="px-3 py-1.5">{depthOf(row)}</td>
              <td className="px-3 py-1.5 text-muted-foreground">{noteFor(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
