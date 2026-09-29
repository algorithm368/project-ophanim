"use client";

import { Fragment } from "react";
import Link from "next/link";
import type { GeoRow } from "@/lib/ti/geo";
import { canonicalAsn } from "@/lib/ti/geo/geokit";
import type { CountryRows } from "@/lib/ti/geo/summary";
import { Flag } from "./shared";

function place(row: GeoRow): string {
  const g = row.geo;
  return [g?.city, g?.region].filter(Boolean).join(", ");
}

function network(row: GeoRow): string {
  const g = row.geo;
  return [canonicalAsn(g?.asn), g?.asnOrg ?? g?.isp ?? g?.org].filter(Boolean).join(" ");
}

function GroupHeader({
  label,
  code,
  n,
  max,
}: Readonly<{ label: string; code?: string; n: number; max: number }>) {
  return (
    <tr className="border-t-2 border-foreground/15 bg-foreground/[0.03] first:border-t-0">
      <th scope="rowgroup" colSpan={3} className="px-3 py-2 text-left font-normal">
        <span className="flex items-center gap-2">
          <Flag code={code} />
          <span className="font-semibold">{label}</span>
          {code && <span className="font-mono text-[11px] text-muted-foreground">{code}</span>}
          <span className="ml-auto flex w-40 items-center gap-2">
            <span className="h-1.5 flex-1 rounded-full bg-foreground/10">
              <span
                className="block h-full rounded-full bg-foreground/55"
                style={{ width: `${(n / max) * 100}%` }}
              />
            </span>
            <span
              className="w-6 text-right font-mono text-xs tabular-nums text-muted-foreground"
              title={`${n} ${n === 1 ? "address" : "addresses"}`}
            >
              {n}
            </span>
          </span>
        </span>
      </th>
    </tr>
  );
}

function AddressRow({ row }: Readonly<{ row: GeoRow }>) {
  return (
    <tr className="border-t border-foreground/10 align-top">
      <td className="w-48 py-1.5 pr-2 pl-10 font-mono">
        <Link href={`/check/${encodeURIComponent(row.ip)}`} className="underline-offset-4 hover:underline">
          {row.ip}
        </Link>
      </td>
      <td className="px-2 py-1.5">{place(row) || <span className="text-muted-foreground">—</span>}</td>
      <td className="px-2 py-1.5 text-muted-foreground">{network(row) || "—"}</td>
    </tr>
  );
}

/**
 * The origin report as a grouped list: one block per country, busiest first,
 * each address under it with its city and network, and the addresses nobody
 * could place at the end. Same grouping as the prose `originReport`, which is
 * what Copy sends from this tab.
 */
export function ByCountry({
  located,
  unlocated,
}: Readonly<{ located: CountryRows[]; unlocated: GeoRow[] }>) {
  const max = Math.max(unlocated.length, ...located.map((g) => g.rows.length));
  return (
    <div className="max-h-[36rem] overflow-auto rounded-md border-2 border-foreground/20">
      <table className="w-full border-collapse text-sm">
        <thead className="sr-only">
          <tr>
            <th scope="col">IP</th>
            <th scope="col">City / Region</th>
            <th scope="col">Network</th>
          </tr>
        </thead>
        <tbody>
          {located.map((g) => (
            <Fragment key={g.code}>
              <GroupHeader label={g.country} code={g.code} n={g.rows.length} max={max} />
              {g.rows.map((row) => (
                <AddressRow key={row.ip} row={row} />
              ))}
            </Fragment>
          ))}
          {unlocated.length > 0 && (
            <>
              <GroupHeader label="Not located" n={unlocated.length} max={max} />
              {unlocated.map((row) => (
                <AddressRow key={row.ip} row={row} />
              ))}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}
