import type { HealthBoard } from "@/lib/ti/health-store";
import type { SourceHealth } from "@/lib/ti/health";
import { relativeTime } from "@/lib/relative-time";
import { cn } from "@/lib/utils";
import { MARK, ms, pct, RAIL_PAD, RailShell } from "./rail";

/**
 * The homepage's departures board: every TI source, worst first, graded from
 * its last 50 real runs.
 */

const TYPE_TAG: Record<string, string> = { ip: "IP", domain: "DOM", hash: "HASH" };

/** The source rail's frame: its name, and the two numbers each row carries. */
function SourceShell({ children, footer }: Readonly<{ children: React.ReactNode; footer?: React.ReactNode }>) {
  return (
    <RailShell label="Source health" title="Sources" legend="p50 · ok" footer={footer}>
      {children}
    </RailShell>
  );
}

function Row({ row }: Readonly<{ row: SourceHealth }>) {
  const mark = MARK[row.grade];
  const off = row.grade === "no-key" || row.grade === "no-data";
  return (
    <li
      title={row.lastError}
      className={`grid grid-cols-[10px_1fr_auto_52px_40px] items-center gap-2 border-b border-border/60 py-1.5 text-[11.5px] ${RAIL_PAD}`}
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
      <SourceShell>
        <p className={`py-3 text-[11.5px] text-muted-foreground ${RAIL_PAD}`}>Health tracking needs the Redis cache.</p>
      </SourceShell>
    );
  }
  const footer = board.newestAt
    ? `last 50 runs per source, newest ${relativeTime(board.newestAt, now)}`
    : "no runs recorded yet";
  return (
    <SourceShell footer={footer}>
      <ul>
        {board.rows.map((r) => (
          <Row key={`${r.type}:${r.id}`} row={r} />
        ))}
      </ul>
    </SourceShell>
  );
}

export function SourceRailSkeleton() {
  return (
    <SourceShell footer={<span className="sweep block h-2 w-40 rounded" />}>
      <ul>
        {Array.from({ length: 14 }, (_, i) => (
          <li key={i} className={`flex items-center gap-2 border-b border-border/60 py-[9px] ${RAIL_PAD}`}>
            <span className="sweep block size-2 rounded-full" />
            <span className="sweep block h-2 flex-1 rounded" />
            <span className="sweep block h-2 w-16 rounded" />
          </li>
        ))}
      </ul>
    </SourceShell>
  );
}
