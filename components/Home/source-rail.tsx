import type { HealthBoard } from "@/lib/ti/health-store";
import type { HealthGrade, SourceHealth } from "@/lib/ti/health";
import { relativeTime } from "@/lib/relative-time";
import { cn } from "@/lib/utils";

/**
 * The homepage's departures board: every TI source, worst first, graded from
 * its last 50 real runs. Colour is the grade and nothing else; the marker's
 * shape and the numbers carry it too, so it reads in greyscale.
 */

const TYPE_TAG: Record<string, string> = { ip: "IP", domain: "DOM", hash: "HASH" };

const MARK: Record<HealthGrade, { dot: string; text: string; hollow?: boolean }> = {
  failing: { dot: "bg-red-600 dark:bg-red-400", text: "text-red-700 dark:text-red-400" },
  degraded: { dot: "bg-amber-500 dark:bg-amber-400", text: "text-amber-700 dark:text-amber-400" },
  slow: { dot: "bg-amber-500 dark:bg-amber-400", text: "text-amber-700 dark:text-amber-400" },
  healthy: { dot: "bg-emerald-600 dark:bg-emerald-400", text: "text-muted-foreground" },
  "no-data": { dot: "", text: "text-muted-foreground", hollow: true },
  "no-key": { dot: "", text: "text-muted-foreground", hollow: true },
};

function ms(v: number | null): string {
  if (v === null) return "—";
  return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`;
}

function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

/** The surface both the live rail and its skeleton share, so the swap from
 *  one to the other moves nothing. */
function RailShell({ children, footer }: Readonly<{ children: React.ReactNode; footer?: React.ReactNode }>) {
  return (
    <aside
      aria-label="Source health"
      className="relative border-t border-border bg-[oklch(0.955_0_0)] font-mono md:border-t-0 md:border-l dark:bg-[oklch(0.15_0_0)]"
    >
      <div className="flex flex-col md:absolute md:inset-0">
        <div className="flex items-baseline justify-between border-b border-border px-4 py-3">
          <span className="text-[11px] font-bold tracking-[0.14em] uppercase">Sources</span>
          <span className="text-[10px] tracking-[0.14em] text-muted-foreground uppercase">p50 · ok</span>
        </div>
        <div className="relative flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="border-t border-border px-4 py-2 text-[10.5px] text-muted-foreground">{footer}</div>}
      </div>
    </aside>
  );
}

function Row({ row }: Readonly<{ row: SourceHealth }>) {
  const mark = MARK[row.grade];
  const off = row.grade === "no-key" || row.grade === "no-data";
  return (
    <li
      title={row.lastError}
      className="grid grid-cols-[10px_1fr_auto_52px_40px] items-center gap-2 border-b border-border/60 px-4 py-1.5 text-[11.5px]"
    >
      <span
        aria-hidden
        className={cn("size-2 rounded-full", mark.hollow ? "border border-muted-foreground" : mark.dot)}
      />
      <span className={cn("truncate", off && "text-muted-foreground")}>{row.name}</span>
      <span className="text-[10px] text-muted-foreground">{TYPE_TAG[row.type] ?? row.type}</span>
      {off ? (
        <span className="col-span-2 text-right text-muted-foreground">{row.grade === "no-key" ? "no key" : "no data"}</span>
      ) : (
        <>
          <span className="text-right text-muted-foreground tabular-nums">{ms(row.medianMs)}</span>
          <span className={cn("text-right tabular-nums", mark.text)}>{pct(row.okShare)}</span>
        </>
      )}
      <span className="sr-only">{row.grade}</span>
    </li>
  );
}

export function SourceRail({ board, now }: Readonly<{ board: HealthBoard | null; now: number }>) {
  if (!board) {
    return (
      <RailShell>
        <p className="px-4 py-3 text-[11.5px] text-muted-foreground">Health tracking needs the Redis cache.</p>
      </RailShell>
    );
  }
  const footer = board.newestAt
    ? `last 50 runs per source, newest ${relativeTime(board.newestAt, now)}`
    : "no runs recorded yet";
  return (
    <RailShell footer={footer}>
      <ul>
        {board.rows.map((r) => (
          <Row key={`${r.type}:${r.id}`} row={r} />
        ))}
      </ul>
    </RailShell>
  );
}

export function SourceRailSkeleton() {
  return (
    <RailShell footer={<span className="sweep block h-2 w-40 rounded" />}>
      <ul>
        {Array.from({ length: 14 }, (_, i) => (
          <li key={i} className="flex items-center gap-2 border-b border-border/60 px-4 py-[9px]">
            <span className="sweep block size-2 rounded-full" />
            <span className="sweep block h-2 flex-1 rounded" />
            <span className="sweep block h-2 w-16 rounded" />
          </li>
        ))}
      </ul>
    </RailShell>
  );
}
