import type { HealthGrade } from "@/lib/ti/health";

/**
 * What the two health rails share: the one on `/` (every TI source) and the
 * one on `/scan` (the two scan engines). Colour is the grade and nothing else;
 * the marker's shape and the text carry it too, so it reads in greyscale.
 */

export const MARK: Record<HealthGrade, { dot: string; text: string; hollow?: boolean }> = {
  failing: { dot: "bg-red-600 dark:bg-red-400", text: "text-red-700 dark:text-red-400" },
  degraded: { dot: "bg-amber-500 dark:bg-amber-400", text: "text-amber-700 dark:text-amber-400" },
  slow: { dot: "bg-amber-500 dark:bg-amber-400", text: "text-amber-700 dark:text-amber-400" },
  // The dot is green, the numbers stay grey, so a healthy row still reads
  // quieter than an amber or red one.
  healthy: { dot: "bg-emerald-600 dark:bg-emerald-400", text: "text-muted-foreground" },
  "no-data": { dot: "", text: "text-muted-foreground", hollow: true },
  "no-key": { dot: "", text: "text-muted-foreground", hollow: true },
};

/** Right padding that follows the board's bleed, so a rail's text ends under
 *  the banner's controls while its surface runs on to the window's edge. */
export const RAIL_PAD = "pr-[calc(1rem_+_var(--bleed,0px))] pl-4";

export function ms(v: number | null): string {
  if (v === null) return "—";
  return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`;
}

export function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

/** The surface a live rail and its skeleton share, so the swap from one to
 *  the other moves nothing. */
export function RailShell({
  label,
  title,
  legend,
  children,
  footer,
}: Readonly<{
  label: string;
  title: string;
  legend?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}>) {
  return (
    <aside
      aria-label={label}
      className="relative border-t border-border bg-[oklch(0.955_0_0)] font-mono md:border-t-0 md:border-l dark:bg-[oklch(0.15_0_0)]"
    >
      <div className="flex flex-col md:absolute md:inset-0">
        <div className={`flex items-baseline justify-between border-b border-border py-3 ${RAIL_PAD}`}>
          <span className="text-[11px] font-bold tracking-[0.14em] uppercase">{title}</span>
          {legend && (
            <span className="text-[10px] tracking-[0.14em] text-muted-foreground uppercase">{legend}</span>
          )}
        </div>
        <div className="relative flex-1 overflow-y-auto">{children}</div>
        {footer && (
          <div className={`border-t border-border py-2 text-[10.5px] text-muted-foreground ${RAIL_PAD}`}>
            {footer}
          </div>
        )}
      </div>
    </aside>
  );
}
