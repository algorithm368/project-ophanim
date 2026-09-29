"use client";

import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, Crosshair, Search, X } from "lucide-react";
import type { GeoRow } from "@/lib/ti/geo";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { ConfidenceChip } from "@/components/CheckResults/confidence";
import { countryCodeOf } from "@/lib/ti/geo/summary";
import { canonicalAsn } from "@/lib/ti/geo/geokit";
import { formatKm, pointOf } from "@/lib/ti/geo/distance";
import {
  ROW_FILTERS,
  netTypesOf,
  type RowFilter,
  type SortDir,
  type SortKey,
} from "@/lib/ti/geo/table";
import { Flag, TypeTags } from "./shared";

export interface Sort {
  key: SortKey;
  dir: SortDir;
}

/** Click a column: ascending, then descending, then back to pasted order. */
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key !== key) return { key, dir: "asc" };
  if (current.dir === "asc") return { key, dir: "desc" };
  return { key: "input", dir: "asc" };
}

export function FilterBar({
  text,
  onText,
  chips,
  onChip,
  counts,
  shown,
  total,
}: Readonly<{
  text: string;
  onText: (v: string) => void;
  chips: ReadonlySet<RowFilter>;
  onChip: (f: RowFilter) => void;
  counts: Record<RowFilter, number>;
  shown: number;
  total: number;
}>) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-52 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={text}
          onChange={(e) => onText(e.target.value)}
          placeholder="Filter by IP, country, city, ASN, org or rDNS"
          aria-label="Filter addresses"
          className="pr-8 pl-8"
        />
        {text && (
          <button
            type="button"
            aria-label="Clear filter"
            onClick={() => onText("")}
            className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {ROW_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={chips.has(f)}
            disabled={!counts[f] && !chips.has(f)}
            onClick={() => onChip(f)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 font-mono text-[11px] tracking-wide uppercase transition-colors disabled:opacity-40",
              chips.has(f)
                ? "border-foreground bg-foreground text-background"
                : "border-foreground/25 text-muted-foreground hover:border-foreground/50 hover:text-foreground",
            )}
          >
            {f}
            <span className="tabular-nums opacity-70">{counts[f]}</span>
          </button>
        ))}
      </div>
      <span className="ml-auto font-mono text-[11px] text-muted-foreground tabular-nums">
        {shown === total ? `${total} shown` : `${shown} of ${total} shown`}
      </span>
    </div>
  );
}

function SortHeader({
  label,
  k,
  sort,
  onSort,
  className,
}: Readonly<{
  label: string;
  k: SortKey;
  sort: Sort;
  onSort: (k: SortKey) => void;
  className?: string;
}>) {
  const active = sort.key === k;
  let Icon = ArrowUpDown;
  if (active) Icon = sort.dir === "asc" ? ArrowUp : ArrowDown;
  let ariaSort: "ascending" | "descending" | "none" = "none";
  if (active) ariaSort = sort.dir === "asc" ? "ascending" : "descending";
  return (
    <th scope="col" aria-sort={ariaSort} className={cn("px-2 py-1.5 font-semibold", className)}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn(
          "inline-flex items-center gap-1 uppercase hover:text-foreground",
          active && "text-foreground",
        )}
      >
        {label}
        <Icon className={cn("size-3", !active && "opacity-40")} />
      </button>
    </th>
  );
}

function CountryCell({ row }: Readonly<{ row: GeoRow }>) {
  if (row.status === "error") {
    return <span className="text-orange-500">no data</span>;
  }
  const g = row.geo;
  if (!g?.country) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex items-center gap-1.5">
      <Flag code={countryCodeOf(row) ?? g.countryCode} />
      <span>{g.country}</span>
      {row.resolution?.country && (
        <ConfidenceChip confidence={row.resolution.country.confidence} />
      )}
    </span>
  );
}

function PlaceCell({ row }: Readonly<{ row: GeoRow }>) {
  const g = row.geo;
  const place = [g?.city, g?.region].filter(Boolean).join(", ");
  if (!place) return <span className="text-muted-foreground">—</span>;
  return <>{place}</>;
}

function NetworkCell({ row }: Readonly<{ row: GeoRow }>) {
  const g = row.geo;
  const asn = canonicalAsn(g?.asn);
  const org = g?.isp ?? g?.org ?? g?.asnOrg;
  if (!asn && !org) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-2">
        {asn && <span className="font-mono text-xs text-muted-foreground">{asn}</span>}
        {org && <span className="truncate">{org}</span>}
      </div>
      {g?.reverse && (
        <div className="truncate font-mono text-[11px] text-muted-foreground" title={g.reverse}>
          {g.reverse}
        </div>
      )}
    </div>
  );
}

function DistanceCell({
  row,
  anchorIp,
  km,
}: Readonly<{ row: GeoRow; anchorIp: string; km: number | undefined }>) {
  if (row.ip === anchorIp) {
    return (
      <span className="font-mono text-[10px] tracking-wide text-foreground uppercase">anchor</span>
    );
  }
  if (km === undefined) return <span className="text-muted-foreground">—</span>;
  const approx = pointOf(row)?.precision === "country";
  return (
    <span className="font-mono text-xs tabular-nums" title={approx ? "Country level position, approximate" : undefined}>
      {approx && "~"}
      {formatKm(km)}
    </span>
  );
}

export function GeoTable({
  rows,
  sort,
  onSort,
  anchorIp,
  hoverIp,
  distances,
  onAnchor,
  onHover,
}: Readonly<{
  rows: GeoRow[];
  sort: Sort;
  onSort: (k: SortKey) => void;
  anchorIp: string | null;
  hoverIp: string | null;
  distances: ReadonlyMap<string, number>;
  onAnchor: (ip: string | null) => void;
  onHover: (ip: string | null) => void;
}>) {
  const head = { sort, onSort };
  return (
    <div className="max-h-[36rem] overflow-auto rounded-md border-2 border-foreground/20">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-[1] bg-card">
          <tr className="border-b border-border text-left font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
            <SortHeader label="IP" k="ip" {...head} />
            <SortHeader label="Country" k="country" {...head} />
            <th scope="col" className="px-2 py-1.5 font-semibold">City / Region</th>
            <SortHeader label="Network" k="asn" {...head} />
            <th scope="col" className="px-2 py-1.5 font-semibold">Type</th>
            {anchorIp && <SortHeader label="Distance" k="distance" {...head} className="text-right" />}
            <th scope="col" className="w-8 px-1 py-1.5">
              <span className="sr-only">Measure</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const located = Boolean(pointOf(row));
            const isAnchor = row.ip === anchorIp;
            return (
              <tr
                key={row.ip}
                onPointerEnter={() => onHover(row.ip)}
                onPointerLeave={() => onHover(null)}
                className={cn(
                  "border-b border-foreground/10 align-top last:border-0",
                  row.ip === hoverIp && "bg-foreground/[0.04]",
                  isAnchor && "bg-foreground/[0.07]",
                )}
              >
                <td className="px-2 py-2 font-mono break-all">
                  <Link
                    href={`/check/${encodeURIComponent(row.ip)}`}
                    className="underline-offset-4 hover:underline"
                    title={`Open the full record for ${row.ip}`}
                  >
                    {row.ip}
                  </Link>
                  {row.version === 6 && (
                    <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">v6</span>
                  )}
                </td>
                <td className="px-2 py-2">
                  <CountryCell row={row} />
                </td>
                <td className="px-2 py-2">
                  <PlaceCell row={row} />
                </td>
                <td className="max-w-72 px-2 py-2">
                  <NetworkCell row={row} />
                </td>
                <td className="px-2 py-2">
                  <TypeTags types={netTypesOf(row)} />
                </td>
                {anchorIp && (
                  <td className="px-2 py-2 text-right">
                    <DistanceCell row={row} anchorIp={anchorIp} km={distances.get(row.ip)} />
                  </td>
                )}
                <td className="px-1 py-1.5">
                  {located && (
                    <button
                      type="button"
                      aria-pressed={isAnchor}
                      aria-label={isAnchor ? `Stop measuring from ${row.ip}` : `Measure distances from ${row.ip}`}
                      title={isAnchor ? "Stop measuring" : "Measure from here"}
                      onClick={() => onAnchor(isAnchor ? null : row.ip)}
                      className={cn(
                        "flex size-6 items-center justify-center rounded-md hover:bg-muted",
                        isAnchor ? "text-foreground" : "text-muted-foreground/60 hover:text-foreground",
                      )}
                    >
                      <Crosshair className="size-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
          {!rows.length && (
            <tr>
              <td colSpan={7} className="px-2 py-8 text-center text-muted-foreground">
                No address matches the filter.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
