"use client";

import { Globe } from "lucide-react";
import type { GeoRow } from "@/lib/ti/geo";
import { Card, CardContent } from "@/components/ui/card";

/** 2-letter country code -> regional-indicator flag emoji ("US" -> 🇺🇸). */
function flagEmoji(cc?: string): string {
  if (!cc || cc.length !== 2 || !/^[a-zA-Z]{2}$/.test(cc)) return "";
  const base = "A".charCodeAt(0);
  return String.fromCodePoint(
    ...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - base),
  );
}

function placeOf(row: GeoRow): string {
  const g = row.geo;
  if (!g) return "—";
  return [g.city, g.region].filter(Boolean).join(", ") || "—";
}

function flagsOf(row: GeoRow): string[] {
  const g = row.geo;
  if (!g) return [];
  const out: string[] = [];
  if (g.isProxy) out.push("proxy/VPN");
  if (g.isHosting) out.push("hosting");
  if (g.isMobile) out.push("mobile");
  return out;
}

export default function BulkGeoResults({ rows }: { rows: GeoRow[] }) {
  return (
    <Card className="sketch-shadow mt-8 overflow-hidden rounded-[22px_34px_18px_30px/30px_18px_34px_22px] border-2 border-foreground/20 bg-card/50">
      <CardContent className="space-y-4">
        <div className="font-hand flex items-center gap-2 text-2xl font-bold">
          <Globe className="size-5 text-primary" />
          Geolocation — {rows.length} {rows.length === 1 ? "address" : "addresses"}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="font-hand border-b-2 border-dashed border-foreground/20 text-left text-muted-foreground">
                <th className="px-2 py-1.5 font-semibold">IP</th>
                <th className="px-2 py-1.5 font-semibold">Ver</th>
                <th className="px-2 py-1.5 font-semibold">Country</th>
                <th className="px-2 py-1.5 font-semibold">City / Region</th>
                <th className="px-2 py-1.5 font-semibold">ASN</th>
                <th className="px-2 py-1.5 font-semibold">ISP / Org</th>
                <th className="px-2 py-1.5 font-semibold">Flags</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const g = row.geo;
                const flags = flagsOf(row);
                return (
                  <tr
                    key={row.ip}
                    className="border-b border-foreground/10 align-top last:border-0"
                  >
                    <td className="px-2 py-2 font-mono break-all">{row.ip}</td>
                    <td className="px-2 py-2 text-muted-foreground">
                      v{row.version}
                    </td>
                    <td className="px-2 py-2">
                      {row.status === "error" ? (
                        <span className="text-orange-500">no data</span>
                      ) : g?.country ? (
                        <span>
                          <span className="mr-1">{flagEmoji(g.countryCode)}</span>
                          {g.country}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-2 py-2">{placeOf(row)}</td>
                    <td className="px-2 py-2 font-mono text-xs text-muted-foreground">
                      {g?.asn ?? "—"}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {g?.isp ?? g?.org ?? "—"}
                    </td>
                    <td className="px-2 py-2">
                      {flags.length ? (
                        <span className="flex flex-wrap gap-1">
                          {flags.map((f) => (
                            <span
                              key={f}
                              className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400"
                            >
                              {f}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
