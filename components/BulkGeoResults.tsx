"use client";

import { Check, Copy, Globe } from "lucide-react";
import type { GeoRow } from "@/lib/ti/geo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCopied } from "@/components/CheckResults/primitives";
import { flagUrl } from "@/lib/flag";
import { ConfidenceChip } from "@/components/CheckResults/confidence";
import { originReport, sameCountryNote } from "@/lib/ti/geo/summary";

/** A short note that appears only when every located address shares one country. */
function SameCountryNote({ rows }: Readonly<{ rows: GeoRow[] }>) {
  const note = sameCountryNote(rows);
  if (!note) return null;
  return (
    <div className="space-y-1.5">
      <span className="font-hand text-sm font-semibold text-muted-foreground">
        Same country
      </span>
      <div className="rounded-md border-2 border-foreground/20 bg-background/60 px-3.5 py-3 select-all">
        <p className="font-sans text-sm leading-relaxed text-foreground/90">
          {note}
        </p>
      </div>
    </div>
  );
}

/** Origin summary as a selectable, report-style paragraph: coverage, then each
 *  country with its addresses and cities. The prose rendered here and the text
 *  copied are the same string, from `originReport`. */
function Origins({ rows }: Readonly<{ rows: GeoRow[] }>) {
  const report = originReport(rows);
  const [copied, copy] = useCopied();
  if (!report) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-hand text-sm font-semibold text-muted-foreground">
          Origins
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-label="Copy origins"
          className="font-hand -mr-1.5 gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          onClick={() => copy(report)}
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
      <div className="max-h-64 overflow-auto rounded-md border-2 border-foreground/20 bg-background/60 px-3.5 py-3 select-all">
        <p className="font-sans text-sm leading-relaxed text-foreground/90">
          {report}
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

/**
 * The country cell for one address.
 *
 * Three outcomes, and they are not the same: the lookup failed, the lookup
 * succeeded and named a country, or it succeeded and had no country to give.
 * Only the first is worth colouring, and an em dash for "no country" must not
 * read as "no answer".
 */
function CountryCell({
  row,
  flag,
}: Readonly<{ row: GeoRow; flag: string | undefined }>) {
  if (row.status === "error") {
    return <span className="text-orange-500">no data</span>;
  }
  const g = row.geo;
  if (!g?.country) return "—";
  return (
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
      {row.resolution?.country && (
        <ConfidenceChip confidence={row.resolution.country.confidence} />
      )}
    </span>
  );
}

export default function BulkGeoResults({ rows }: Readonly<{ rows: GeoRow[] }>) {
  if (!rows.length) return null;
  return (
    <Card className="sketch-shadow mt-8 overflow-hidden rounded-lg border border-border bg-card">
      <CardContent className="space-y-4">
        <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Globe className="size-5 text-muted-foreground" />
          Geolocation, {rows.length} {rows.length === 1 ? "address" : "addresses"}
        </h2>

        <SameCountryNote rows={rows} />
        <Origins rows={rows} />

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
                <th scope="col" className="px-2 py-1.5 font-semibold">IP</th>
                <th scope="col" className="px-2 py-1.5 font-semibold">Ver</th>
                <th scope="col" className="px-2 py-1.5 font-semibold">Country</th>
                <th scope="col" className="px-2 py-1.5 font-semibold">City / Region</th>
                <th scope="col" className="px-2 py-1.5 font-semibold">ASN</th>
                <th scope="col" className="px-2 py-1.5 font-semibold">ISP / Org</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const g = row.geo;
                const flag = flagUrl(row.resolution?.countryCode ?? g?.countryCode);
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
                      <CountryCell row={row} flag={flag} />
                    </td>
                    <td className="px-2 py-2">{placeOf(row)}</td>
                    <td className="px-2 py-2 font-mono text-xs text-muted-foreground">
                      {g?.asn ?? "—"}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {g?.isp ?? g?.org ?? "—"}
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
