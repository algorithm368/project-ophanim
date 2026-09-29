"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { NetworkGroup } from "@/lib/ti/geo/table";
import { ReadoutFrame } from "./readout";
import { Flag, TypeTags } from "./shared";

const COLLAPSED = 6;
const FLAGS_SHOWN = 3;

/** The networks as plain lines, for the Copy button. */
function networksText(groups: NetworkGroup[]): string {
  return groups
    .map((g) => {
      const name = [g.asn || "No ASN", g.org].filter(Boolean).join(" ");
      return `${name}: ${g.ips.join(", ")}`;
    })
    .join("\n");
}

/**
 * Which networks announce the batch, busiest first. The question it answers is
 * "are these forty addresses really three providers?", which a per-row table
 * makes you count by hand. Clicking a network filters the table to it.
 */
export function Networks({
  groups,
  active,
  onPick,
}: Readonly<{
  groups: NetworkGroup[];
  /** The ASN the table is currently filtered to, if any. */
  active: string | null;
  onPick: (asn: string) => void;
}>) {
  const [open, setOpen] = useState(false);
  if (!groups.length) return null;
  const shown = open ? groups : groups.slice(0, COLLAPSED);
  const busiest = groups[0].ips.length;
  const attributed = groups.filter((g) => g.asn).length;

  return (
    <ReadoutFrame title="Networks" count={attributed} copyText={networksText(groups)}>
      <ul className="-mx-1.5 -my-1">
        {shown.map((g) => {
          const isActive = Boolean(g.asn) && g.asn === active;
          return (
            <li key={g.asn || "none"}>
              <button
                type="button"
                disabled={!g.asn}
                aria-pressed={isActive}
                onClick={() => onPick(g.asn)}
                title={g.asn ? `Show only ${g.asn} in the table` : undefined}
                className={cn(
                  "grid w-full grid-cols-[3.25rem_1fr_auto] items-center gap-3 rounded-sm px-1.5 py-1.5 text-left text-sm transition-colors enabled:hover:bg-foreground/[0.05]",
                  isActive && "bg-foreground/[0.08]",
                )}
              >
                <span className="flex items-center gap-1.5">
                  <span className="w-4 text-right font-mono text-xs tabular-nums">
                    {g.ips.length}
                  </span>
                  <span className="h-1.5 flex-1 rounded-full bg-foreground/10">
                    <span
                      className="block h-full rounded-full bg-foreground/55"
                      style={{ width: `${(g.ips.length / busiest) * 100}%` }}
                    />
                  </span>
                </span>
                <span className="min-w-0">
                  <span className="flex items-baseline gap-2">
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {g.asn || "no ASN"}
                    </span>
                    <span className="truncate">
                      {g.org || <span className="text-muted-foreground">unattributed</span>}
                    </span>
                  </span>
                  {g.types.length > 0 && (
                    <span className="mt-1 block">
                      <TypeTags types={g.types} />
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-1">
                  {g.countries.slice(0, FLAGS_SHOWN).map((c) => (
                    <span key={c} title={c}>
                      <Flag code={c} />
                    </span>
                  ))}
                  {g.countries.length > FLAGS_SHOWN && (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      +{g.countries.length - FLAGS_SHOWN}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {groups.length > COLLAPSED && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="font-mono text-[11px] text-muted-foreground hover:text-foreground"
        >
          {open ? "Show fewer" : `Show ${groups.length - COLLAPSED} more`}
        </button>
      )}
    </ReadoutFrame>
  );
}
