"use client";

import { ENGINE_NAME } from "@/lib/ti/url/active/engines";
import type { ScanDetail } from "@/lib/ti/url/active/detail";
import { COMPARED } from "@/lib/ti/url/active/merge";
import type { ActiveScan } from "@/lib/ti/url/active/types";
import { cn } from "@/lib/utils";
import { Tile } from "@/components/CheckResults/frame";

type Field = { label: string; read: (d: ScanDetail) => string | undefined };

/** The verdict first, then the facts `mergeScans` compares, in its order. */
const FIELDS: Field[] = [
  {
    label: "Verdict",
    read: (d) => (d.verdicts.overall.malicious ? "malicious" : "not malicious"),
  },
  ...COMPARED.map(({ label, read }) => ({ label, read })),
];

/** Whether the engines that answered a field gave different answers. One that
 *  did not answer is not a dissent. */
function split(values: (string | undefined)[]): boolean {
  return new Set(values.filter(Boolean)).size > 1;
}

/** Finished scans grouped by the URL they read, keeping only the URLs two or
 *  more engines read: one engine has nobody to agree with. */
function ballotsIn(scans: ActiveScan[]): { target: string; scans: ActiveScan[] }[] {
  const byTarget = new Map<string, ActiveScan[]>();
  for (const scan of scans) {
    if (scan.status !== "done" || !scan.detail) continue;
    byTarget.set(scan.target, [...(byTarget.get(scan.target) ?? []), scan]);
  }
  return [...byTarget.entries()]
    .filter(([, group]) => group.length >= 2)
    .map(([target, group]) => ({ target, scans: group }));
}

function Ballot({
  target,
  scans,
  labelled,
}: Readonly<{ target: string; scans: ActiveScan[]; labelled: boolean }>) {
  const cols = `8rem repeat(${scans.length}, minmax(0, 1fr)) 1.2rem`;
  return (
    <div>
      {labelled && (
        <div className="mb-1.5 font-mono text-[9.5px] tracking-[0.13em] text-muted-foreground uppercase">
          {target}
        </div>
      )}
      <div
        className="grid items-center gap-x-3 border-b border-foreground/12 py-1"
        style={{ gridTemplateColumns: cols }}
      >
        <span />
        {scans.map((s) => (
          <span
            key={s.engine}
            className="font-mono text-[9.5px] tracking-[0.08em] text-muted-foreground uppercase"
          >
            {ENGINE_NAME[s.engine]}
          </span>
        ))}
        <span />
      </div>
      {FIELDS.map((field) => {
        const values = scans.map((s) => field.read(s.detail as ScanDetail));
        const differs = split(values);
        return (
          <div
            key={field.label}
            className="grid items-center gap-x-3 border-b border-foreground/12 py-1 last:border-b-0"
            style={{ gridTemplateColumns: cols }}
          >
            <span className="font-mono text-[11px]">{field.label}</span>
            {values.map((value, i) => (
              <span
                key={scans[i].engine}
                title={value}
                className={cn(
                  "truncate font-mono text-[11px]",
                  !value && "text-muted-foreground",
                  differs && value && "text-amber-600 dark:text-amber-400",
                )}
              >
                {value ?? "not reported"}
              </span>
            ))}
            <span
              aria-label={differs ? "The engines disagree" : undefined}
              className="text-center font-mono text-[11px] text-amber-600 dark:text-amber-400"
            >
              {differs ? "⚠" : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Every engine's answer on every compared field, side by side.
 *
 * The passive page's location ballot, applied to the scanners. Agreement is
 * shown along with the split, because "both saw the same page" is what makes a
 * single disagreement stand out: a login page to one engine and a 403 to the
 * other is what a kit hiding from scanners looks like, and it only reads that
 * way against the rows where they matched.
 */
export function BallotsTile({ scans }: Readonly<{ scans: ActiveScan[] }>) {
  const ballots = ballotsIn(scans);
  if (ballots.length === 0) return null;

  const splits = ballots.reduce(
    (n, b) =>
      n +
      FIELDS.filter((f) => split(b.scans.map((s) => f.read(s.detail as ScanDetail)))).length,
    0,
  );

  return (
    <Tile
      span={12}
      id="ballots"
      title="Ballots"
      note={splits === 0 ? "the engines agree" : `${splits} ${splits === 1 ? "split" : "splits"}`}
      className="space-y-5"
    >
      {ballots.map((b) => (
        <Ballot key={b.target} target={b.target} scans={b.scans} labelled={ballots.length > 1} />
      ))}
    </Tile>
  );
}
