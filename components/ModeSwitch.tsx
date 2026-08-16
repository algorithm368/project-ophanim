"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Radar, Search } from "lucide-react";
import { detectIOC } from "@/lib/ioc";
import { modeHref, modeRouteFor, type ReadingMode } from "@/lib/route-mode";
import { scanTargetsFor } from "@/lib/ti/url/active/targets";

const SEGMENTS: { mode: ReadingMode; label: string; Icon: typeof Radar }[] = [
  { mode: "passive", label: "Passive", Icon: Search },
  { mode: "active", label: "Active", Icon: Radar },
];

const SEGMENT_CLASS =
  "inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2 font-mono text-[10px] font-medium tracking-[0.12em] uppercase transition-colors";

/**
 * Passive or active, as a mode the whole page is in.
 *
 * The two readings are separate pages, so the switch is navigation and each
 * half is a real link: middle-click opens the other reading in a tab, and the
 * address bar always says which one is on screen. It sits beside the theme
 * toggle because both describe how the page is being shown rather than what it
 * says.
 *
 * The selected half inverts. In a skin that spends color only on the verdict,
 * inversion is the only emphasis left that cannot be misread as a threat level,
 * and at this size it reads as a switch rather than as the armed panel's alarm.
 *
 * It is present from the first screen, because which reading you want is a
 * decision an analyst makes before typing, not after. On a path in neither mode
 * it renders nothing rather than claiming one.
 */
export function ModeSwitch() {
  const pathname = usePathname();
  const route = modeRouteFor(pathname ?? "");
  if (!route) return null;

  const { mode, indicator } = route;
  // A file hash has no address to visit. The half is shown and disabled rather
  // than hidden, so the reason is legible instead of the control silently
  // changing shape between indicators. With no indicator yet, both halves are
  // live: each landing page takes its own input.
  const kind = indicator ? detectIOC(indicator) : null;
  const scannable =
    !indicator || (kind ? scanTargetsFor(indicator, kind).length > 0 : false);

  return (
    <div
      role="group"
      aria-label="Reading mode"
      className="inline-flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5"
    >
      {SEGMENTS.map(({ mode: segment, label, Icon }) => {
        const current = segment === mode;
        const unavailable = segment === "active" && !scannable;

        // The word is hidden on a phone, where the icons alone fit beside the
        // brand. Hidden text is not an accessible name, so the name is stated
        // outright rather than left to depend on the viewport.
        const name = `${label} reading`;
        const face = (
          <>
            <Icon className="size-3" />
            <span className="hidden sm:inline">{label}</span>
          </>
        );

        if (current) {
          return (
            <span
              key={segment}
              aria-current="page"
              aria-label={name}
              className={`${SEGMENT_CLASS} bg-foreground text-background`}
            >
              {face}
            </span>
          );
        }

        if (unavailable) {
          return (
            <span
              key={segment}
              aria-disabled="true"
              aria-label={name}
              title="A file hash has no address to visit, so there is nothing to scan."
              className={`${SEGMENT_CLASS} cursor-not-allowed text-muted-foreground/45`}
            >
              {face}
            </span>
          );
        }

        return (
          <Link
            key={segment}
            href={modeHref(segment, indicator)}
            aria-label={name}
            className={`${SEGMENT_CLASS} text-muted-foreground hover:bg-muted hover:text-foreground`}
          >
            {face}
          </Link>
        );
      })}
    </div>
  );
}
