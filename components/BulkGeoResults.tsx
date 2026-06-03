"use client";

import { Check, Copy, Globe, MapPin } from "lucide-react";
import type { GeoRow } from "@/lib/ti/geo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCopied } from "@/components/CheckResults/primitives";
import { flagUrl } from "@/lib/flag";

/** Source backing the bulk batch lookup (see lib/ti/geo.ts → bulkGeolocate). */
const GEO_SOURCE = "ip-api.com";

/** Uppercase ISO country code for a row, or "?" when it couldn't be located. */
function codeOf(row: GeoRow): string {
  const cc = row.geo?.countryCode;
  return row.status === "ok" && cc ? cc.toUpperCase() : "?";
}

/** One-line, copy-friendly summary: `1.1.1.1 (US), 8.8.8.8 (US)`. */
function copyLineOf(rows: GeoRow[]): string {
  return rows.map((r) => `${r.ip} (${codeOf(r)})`).join(", ");
}

/** Join IPs with commas and a trailing "and": `a, b and c` (or `a and b`). */
function joinIps(ips: string[]): string {
  if (ips.length <= 1) return ips.join("");
  if (ips.length === 2) return `${ips[0]} and ${ips[1]}`;
  return `${ips.slice(0, -1).join(", ")} and ${ips[ips.length - 1]}`;
}

/** If every located IP shares one country, describe it; otherwise null. */
function sameCountryOf(
  rows: GeoRow[],
): { ips: string[]; country: string; code: string } | null {
  const located = rows.filter((r) => r.status === "ok" && r.geo?.countryCode);
  if (located.length < 2) return null;
  const code = located[0].geo!.countryCode!.toUpperCase();
  if (!located.every((r) => r.geo!.countryCode!.toUpperCase() === code)) {
    return null;
  }
  return {
    ips: located.map((r) => r.ip),
    country: located[0].geo!.country ?? code,
    code,
  };
}

/** A selectable, monospace box of the one-line summary with a copy button. */
function CopyableList({ rows }: { rows: GeoRow[] }) {
  const line = copyLineOf(rows);
  const [copied, copy] = useCopied();
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-hand text-sm font-semibold text-muted-foreground">
          Copy-friendly summary
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-label="Copy summary"
          className="font-hand -mr-1.5 gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          onClick={() => copy(line)}
        >
          {copied ? (
            <>
              <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
              Copied
            </>
          ) : (
            <>
              <Copy className="size-3.5" />
              Copy
            </>
          )}
        </Button>
      </div>
      <pre className="max-h-32 overflow-auto rounded-[10px_14px_8px_12px/12px_8px_14px_10px] border-2 border-foreground/20 bg-background/60 px-3 py-2 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap select-all">
        {line}
      </pre>
    </div>
  );
}

/** Formal plain-text sentence for the same-country result (no flag glyph). */
function sameCountrySentence(same: {
  ips: string[];
  country: string;
  code: string;
}): string {
  return `${joinIps(same.ips)} are located in the same country, ${same.country} (${same.code}), as verified by ${GEO_SOURCE}.`;
}

/** Callout shown when all located IPs resolve to the same country. Mirrors the
 *  copy-friendly box: a label, a Copy button, and a selectable box. */
function SameCountryCallout({ rows }: { rows: GeoRow[] }) {
  const same = sameCountryOf(rows);
  const [copied, copy] = useCopied();
  if (!same) return null;
  const flag = flagUrl(same.code);
  const sentence = sameCountrySentence(same);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-hand text-sm font-semibold text-muted-foreground">
          Same-country summary
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-label="Copy same-country summary"
          className="font-hand -mr-1.5 gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          onClick={() => copy(sentence)}
        >
          {copied ? (
            <>
              <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
              Copied
            </>
          ) : (
            <>
              <Copy className="size-3.5" />
              Copy
            </>
          )}
        </Button>
      </div>
      <div className="flex items-start gap-2.5 rounded-[10px_14px_8px_12px/12px_8px_14px_10px] border-2 border-emerald-500/40 bg-emerald-500/10 px-3.5 py-3 select-all">
        <MapPin className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <p className="font-sans text-sm leading-relaxed text-foreground/90">
          {joinIps(same.ips)} are located in the same country,{" "}
          <span className="inline-flex items-center gap-1.5 font-semibold">
            {flag && (
              // eslint-disable-next-line @next/next/no-img-element -- tiny external flag asset; next/image is overkill here
              <img
                src={flag}
                alt=""
                width={20}
                height={14}
                loading="lazy"
                className="inline-block h-3.5 w-5 rounded-[2px] border border-foreground/20 object-cover align-[-1px]"
              />
            )}
            {same.country} ({same.code})
          </span>
          {", as verified by "}
          {GEO_SOURCE}.
        </p>
      </div>
    </div>
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
  if (!rows.length) return null;
  return (
    <Card className="sketch-shadow mt-8 overflow-hidden rounded-[22px_34px_18px_30px/30px_18px_34px_22px] border-2 border-foreground/20 bg-card/50">
      <CardContent className="space-y-4">
        <h2 className="font-hand flex items-center gap-2 text-2xl font-bold">
          <Globe className="size-5 text-primary" />
          Geolocation — {rows.length} {rows.length === 1 ? "address" : "addresses"}
        </h2>

        <CopyableList rows={rows} />
        <SameCountryCallout rows={rows} />

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="font-hand border-b-2 border-dashed border-foreground/20 text-left text-muted-foreground">
                <th scope="col" className="px-2 py-1.5 font-semibold">IP</th>
                <th scope="col" className="px-2 py-1.5 font-semibold">Ver</th>
                <th scope="col" className="px-2 py-1.5 font-semibold">Country</th>
                <th scope="col" className="px-2 py-1.5 font-semibold">City / Region</th>
                <th scope="col" className="px-2 py-1.5 font-semibold">ASN</th>
                <th scope="col" className="px-2 py-1.5 font-semibold">ISP / Org</th>
                <th scope="col" className="px-2 py-1.5 font-semibold">Flags</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const g = row.geo;
                const flag = flagUrl(g?.countryCode);
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
                        <span className="flex items-center gap-1.5">
                          {flag && (
                            // eslint-disable-next-line @next/next/no-img-element -- tiny external flag asset; next/image is overkill here
                            <img
                              src={flag}
                              alt=""
                              width={20}
                              height={14}
                              loading="lazy"
                              className="h-3.5 w-5 shrink-0 rounded-[2px] border border-foreground/20 object-cover"
                            />
                          )}
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
