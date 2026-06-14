"use client";

import { Check, Star } from "lucide-react";
import type { GeoResolution } from "@/lib/ti/types";
import {
  buildVoteTable,
  providerLabel,
  type VoteCell,
  type VoteColumn,
} from "@/lib/ti/geo/votes";
import { ConfidenceDot, OverallGauge, geoConfidenceReason } from "./confidence";

/** One matrix cell, rendered by status. Agreement recedes (a light check),
 *  disagreement reads as the differing value, all in grayscale. */
function Cell({ cell }: { cell: VoteCell }) {
  switch (cell.status) {
    case "win":
      return (
        <span className="inline-flex items-center justify-center gap-0.5">
          <Check className="size-3.5 text-foreground/75" aria-label="agrees" />
          {cell.authority && (
            <Star className="size-3 text-foreground/55" aria-label="allocation authority" />
          )}
        </span>
      );
    case "dissent":
      return <span className="text-[12px] text-muted-foreground">{cell.value}</span>;
    case "scatter":
      return (
        <span className="text-foreground/40" aria-label="scattered point">
          ·
        </span>
      );
    case "absent":
    default:
      return (
        <span className="text-foreground/25" aria-label="not reported">
          –
        </span>
      );
  }
}

/** Wide layout: provider x field tally sheet. */
function Matrix({ providers, fields }: { providers: string[]; fields: VoteColumn[] }) {
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="border-b border-foreground/10">
          <th className="py-1.5 pr-3 text-left font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Provider
          </th>
          {fields.map((f) => (
            <th
              key={f.key}
              className="px-3 py-1.5 text-center font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
            >
              {f.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-foreground/[0.06]">
        {providers.map((id) => (
          <tr key={id} className="transition-colors hover:bg-foreground/[0.03]">
            <td className="py-1.5 pr-3 font-mono text-[12px] text-foreground/65">
              {providerLabel(id)}
            </td>
            {fields.map((f) => (
              <td key={f.key} className="px-3 py-1.5 text-center">
                <Cell cell={f.cells[id]} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t border-foreground/15 bg-muted/40">
          <td className="py-2 pr-3 font-mono text-[11px] font-semibold uppercase tracking-wider text-foreground">
            Result
          </td>
          {fields.map((f) => (
            <td key={f.key} className="px-3 py-2 text-center align-top">
              <div className="truncate text-[13px] font-medium text-foreground">{f.winner}</div>
              <div className="mt-1 flex items-center justify-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <ConfidenceDot confidence={f.confidence} />
                {f.confidence}
              </div>
            </td>
          ))}
        </tr>
      </tfoot>
    </table>
  );
}

/** Narrow layout: one ballot per field. */
function Ballots({ fields }: { fields: VoteColumn[] }) {
  return (
    <div className="space-y-3">
      {fields.map((f) => (
        <div
          key={f.key}
          className="border-t border-foreground/[0.06] pt-3 first:border-t-0 first:pt-0"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {f.label}
            </span>
            <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <ConfidenceDot confidence={f.confidence} />
              {f.confidence}
            </span>
          </div>
          <div className="mt-0.5 text-sm font-medium text-foreground">{f.winner}</div>
          {f.backers.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px]">
              <span className="text-foreground/45">backed</span>
              {f.backers.map((id) => (
                <span key={id} className="inline-flex items-center gap-0.5 text-foreground/75">
                  {providerLabel(id)}
                  {id === f.authorityId && (
                    <Star className="size-3 text-foreground/55" aria-label="allocation authority" />
                  )}
                </span>
              ))}
            </div>
          )}
          {f.dissent.map((d, i) => (
            <div key={i} className="mt-0.5 text-[12px] leading-snug text-foreground/75">
              <span className="text-foreground/45">differs </span>
              {d.value}, {d.sources.map(providerLabel).join(", ")}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Full-width geo-confidence card: overall gauge + per-provider voting,
 *  responsive matrix (sm+) / ballots (below sm). No-op when nothing resolved. */
export function VotingCard({ res }: { res: GeoResolution }) {
  const table = buildVoteTable(res);
  if (!table) return null;
  return (
    <div className="rounded-xl border border-foreground/10 bg-muted/30 p-4">
      {res.overall && (
        <div className="flex items-center gap-3 pb-3">
          <OverallGauge overall={res.overall} />
          <div className="min-w-0">
            <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-foreground">
              Geo confidence, {res.overall.confidence}
            </div>
            <div className="mt-0.5 text-[13px] text-muted-foreground">
              {geoConfidenceReason(res)}
            </div>
          </div>
        </div>
      )}
      <div className="hidden sm:block">
        <Matrix providers={table.providers} fields={table.fields} />
      </div>
      <div className="sm:hidden">
        <Ballots fields={table.fields} />
      </div>
      {table.fields.some((f) => f.authorityId) && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          <Star className="mr-1 inline size-3 align-[-1px] text-foreground/55" />
          allocation authority, RDAP country, RIPEstat ASN
        </p>
      )}
    </div>
  );
}
