"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Download, Globe, X } from "lucide-react";
import type { GeoRow } from "@/lib/ti/geo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCopied } from "@/components/CheckResults/primitives";
import { canonicalAsn } from "@/lib/ti/geo/geokit";
import {
  countryCodeOf,
  groupRows,
  originReport,
  sameLocationNotes,
} from "@/lib/ti/geo/summary";
import { distancesFrom, formatKm, sitesOf, spreadOf } from "@/lib/ti/geo/distance";
import {
  exportRecords,
  filterCounts,
  filterRows,
  networksOf,
  sortRows,
  toCsv,
  type RowFilter,
  type SortKey,
} from "@/lib/ti/geo/table";
import { MapLegend, WorldMap } from "./map";
import { Networks } from "./networks";
import { FilterBar, GeoTable, nextSort, type Sort } from "./table";
import { DistanceReadout, SpreadReadout } from "./readout";
import { ByCountry } from "./by-country";
import { SameLocation } from "./same-location";
import { cn } from "@/lib/utils";

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** Copy and download, always of what the table is showing: filter to hosting,
 *  export, and the file holds the hosting addresses in the table's order. */
function ExportBar({
  rows,
  distances,
}: Readonly<{ rows: GeoRow[]; distances: ReadonlyMap<string, number> | undefined }>) {
  const [copied, copy] = useCopied();
  const records = () => exportRecords(rows, distances);
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        disabled={!rows.length}
        onClick={() => copy(rows.map((r) => r.ip).join("\n"))}
        className="font-hand gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        {copied ? (
          <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <Copy className="size-3.5" />
        )}
        {copied ? "Copied" : "Copy IPs"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        disabled={!rows.length}
        onClick={() => download(`ophanim-geo-${stamp()}.csv`, toCsv(records()), "text/csv")}
        className="font-hand gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <Download className="size-3.5" />
        CSV
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        disabled={!rows.length}
        onClick={() =>
          download(
            `ophanim-geo-${stamp()}.json`,
            `${JSON.stringify(records(), null, 2)}\n`,
            "application/json",
          )
        }
        className="font-hand gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <Download className="size-3.5" />
        JSON
      </Button>
    </div>
  );
}

function Stat({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="rounded-md border border-foreground/15 px-3 py-2">
      <div className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Stats({
  rows,
  located,
  networks,
  spanKm,
}: Readonly<{ rows: GeoRow[]; located: number; networks: number; spanKm: number }>) {
  const counts = filterCounts(rows);
  const countries = new Set(rows.map(countryCodeOf).filter(Boolean)).size;
  return (
    <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
      <Stat label="Located" value={`${located} / ${rows.length}`} />
      <Stat label="Countries" value={String(countries)} />
      <Stat label="Networks" value={String(networks)} />
      <Stat label="Hosting" value={String(counts.hosting)} />
      <Stat label="Proxy/VPN" value={String(counts["proxy/VPN"])} />
      <Stat label="Widest span" value={located > 1 ? formatKm(spanKm) : "n/a"} />
    </div>
  );
}

/** Copies the origin report, the prose version of the By country tab. */
function CopyReport({ report }: Readonly<{ report: string }>) {
  const [copied, copy] = useCopied();
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      disabled={!report}
      onClick={() => copy(report)}
      className="font-hand gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      {copied ? (
        <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <Copy className="size-3.5" />
      )}
      {copied ? "Copied" : "Copy report"}
    </Button>
  );
}

type Tab = "addresses" | "country";

function Tabs({
  tab,
  onTab,
  counts,
}: Readonly<{ tab: Tab; onTab: (t: Tab) => void; counts: Record<Tab, number> }>) {
  const tabs: [Tab, string][] = [
    ["addresses", "Addresses"],
    ["country", "By country"],
  ];
  return (
    <div role="tablist" aria-label="Address views" className="flex gap-1">
      {tabs.map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          id={`bulk-tab-${id}`}
          aria-selected={tab === id}
          aria-controls={`bulk-panel-${id}`}
          onClick={() => onTab(id)}
          className={cn(
            "-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors",
            tab === id
              ? "border-foreground font-semibold text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
          <span className="rounded-sm bg-foreground/10 px-1.5 font-mono text-[11px] tabular-nums">
            {counts[id]}
          </span>
        </button>
      ))}
    </div>
  );
}

function toggled<T>(set: ReadonlySet<T>, v: T): Set<T> {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}

export default function BulkGeoResults({ rows }: Readonly<{ rows: GeoRow[] }>) {
  const [text, setText] = useState("");
  const [chips, setChips] = useState<ReadonlySet<RowFilter>>(new Set());
  const [asn, setAsn] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>({ key: "input", dir: "asc" });
  const [anchorIp, setAnchorIp] = useState<string | null>(null);
  const [hoverIp, setHoverIp] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("addresses");

  const sites = useMemo(() => sitesOf(rows), [rows]);
  const spread = useMemo(() => spreadOf(rows), [rows]);
  const networks = useMemo(() => networksOf(rows), [rows]);
  const byCountry = useMemo(() => groupRows(rows), [rows]);
  const sameNotes = useMemo(() => sameLocationNotes(rows), [rows]);
  const distances = useMemo(
    () => (anchorIp ? distancesFrom(anchorIp, rows) : new Map<string, number>()),
    [anchorIp, rows],
  );
  const counts = useMemo(() => filterCounts(rows), [rows]);

  const visibleRows = useMemo(() => {
    const matched = filterRows(rows, text, chips).filter(
      (r) => !asn || canonicalAsn(r.geo?.asn) === asn,
    );
    return sortRows(matched, sort.key, sort.dir, distances);
  }, [rows, text, chips, asn, sort, distances]);
  const visible = useMemo(() => new Set(visibleRows.map((r) => r.ip)), [visibleRows]);

  const hubSite = spread.hub && sites.find((s) => s.label === spread.hub?.label);

  function anchor(ip: string | null) {
    setAnchorIp(ip);
    // Measuring is a question about distance, so show the answer in that order;
    // stopping hands the table back to whatever order it was in before.
    if (ip) setSort({ key: "distance", dir: "asc" });
    else if (sort.key === "distance") setSort({ key: "input", dir: "asc" });
  }

  function pickNetwork(a: string) {
    setAsn((cur) => (cur === a ? null : a));
    setTab("addresses");
  }

  if (!rows.length) return null;

  return (
    <Card className="sketch-shadow mt-8 overflow-hidden rounded-lg border border-border bg-card">
      <CardContent className="space-y-6">
        <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Globe className="size-5 text-muted-foreground" />
          Geolocation, {rows.length} {rows.length === 1 ? "address" : "addresses"}
        </h2>

        <Stats
          rows={rows}
          located={spread.located}
          networks={networks.filter((n) => n.asn).length}
          spanKm={spread.maxSpanKm}
        />

        <SameLocation notes={sameNotes} />

        {sites.length > 0 && (
          <div className="space-y-2">
            <WorldMap
              sites={sites}
              visible={visible}
              anchorIp={anchorIp}
              hoverIp={hoverIp}
              distances={distances}
              hub={hubSite ? { site: hubSite, radiusKm: spread.radiusKm } : undefined}
              onAnchor={anchor}
              onHover={setHoverIp}
            />
            <MapLegend measuring={Boolean(anchorIp)} />
          </div>
        )}

        <div className={cn("grid gap-4", sites.length > 0 && "lg:grid-cols-2")}>
          {sites.length > 0 &&
            (anchorIp ? (
              <DistanceReadout
                anchorIp={anchorIp}
                rows={rows}
                distances={distances}
                onStop={() => anchor(null)}
              />
            ) : (
              <SpreadReadout spread={spread} onAnchor={anchor} onHover={setHoverIp} />
            ))}
          <Networks groups={networks} active={asn} onPick={pickNetwork} />
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2 border-b border-foreground/15">
            <Tabs
              tab={tab}
              onTab={setTab}
              counts={{ addresses: rows.length, country: byCountry.located.length }}
            />
            <div className="pb-1">
              {tab === "addresses" ? (
                <ExportBar rows={visibleRows} distances={anchorIp ? distances : undefined} />
              ) : (
                <CopyReport report={originReport(rows)} />
              )}
            </div>
          </div>

          {tab === "addresses" ? (
            <div
              role="tabpanel"
              id="bulk-panel-addresses"
              aria-labelledby="bulk-tab-addresses"
              className="space-y-2"
            >
              <FilterBar
                text={text}
                onText={setText}
                chips={chips}
                onChip={(f) => setChips((c) => toggled(c, f))}
                counts={counts}
                shown={visibleRows.length}
                total={rows.length}
              />
              {asn && (
                <button
                  type="button"
                  onClick={() => setAsn(null)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-foreground bg-foreground px-2 py-0.5 font-mono text-[11px] text-background"
                >
                  network {asn}
                  <X className="size-3" />
                </button>
              )}
              <GeoTable
                rows={visibleRows}
                sort={sort}
                onSort={(k: SortKey) => setSort((s) => nextSort(s, k))}
                anchorIp={anchorIp}
                hoverIp={hoverIp}
                distances={distances}
                onAnchor={anchor}
                onHover={setHoverIp}
              />
            </div>
          ) : (
            <div role="tabpanel" id="bulk-panel-country" aria-labelledby="bulk-tab-country">
              <ByCountry located={byCountry.located} unlocated={byCountry.unlocated} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
