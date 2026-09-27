import { Fragment } from "react";
import type { EngineBoard, EngineHealth, QuotaLine } from "@/lib/ti/url/active/engine-health";
import { MIN_RUNS } from "@/lib/ti/health";
import { relativeTime } from "@/lib/relative-time";
import { cn } from "@/lib/utils";
import { MARK, ms, pct, RAIL_PAD, RailShell } from "./rail";

/**
 * `/scan`'s rail: the two engines a scan is sent to, one block each rather
 * than a row, because two rows would leave the rail empty and each engine has
 * more worth saying: whether its scans finish, how long they take, and for
 * urlscan how much of today's quota is left to spend.
 */

const KEY_ENV: Record<string, string> = {
  urlscan: "URLSCAN_API_KEY",
  cloudflare: "CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID",
};

const GRADE_LABEL: Record<EngineHealth["grade"], string> = {
  failing: "failing",
  degraded: "degraded",
  slow: "slow",
  healthy: "healthy",
  "no-data": "no data",
  "no-key": "no key",
};

function EngineShell({ children, footer }: Readonly<{ children: React.ReactNode; footer?: React.ReactNode }>) {
  return (
    <RailShell label="Engine health" title="Engines" footer={footer}>
      {children}
    </RailShell>
  );
}

function Line({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div className="grid grid-cols-[84px_1fr] items-baseline gap-2 py-1">
      <dt className="text-[10px] tracking-[0.12em] text-muted-foreground uppercase">{label}</dt>
      <dd className="min-w-0 tabular-nums">{children}</dd>
    </div>
  );
}

/** What is left to spend, per visibility a scan is submitted at, in the
 *  order it tries them. A spent day turns red: the next scan will be refused. */
function Quota({ lines }: Readonly<{ lines: QuotaLine[] | null | undefined }>) {
  if (!lines) {
    return (
      <Line label="Quota">
        <span className="text-muted-foreground">urlscan did not say</span>
      </Line>
    );
  }
  return (
    <div className="mt-1 grid grid-cols-[84px_1fr_1fr] gap-x-2 gap-y-1 tabular-nums">
      <span className="text-[10px] tracking-[0.12em] text-muted-foreground uppercase">Quota left</span>
      <span className="text-right text-[10px] tracking-[0.12em] text-muted-foreground uppercase">Today</span>
      <span className="text-right text-[10px] tracking-[0.12em] text-muted-foreground uppercase">Hour</span>
      {lines.map((q) => (
        <Fragment key={q.visibility}>
          <span className="text-muted-foreground">{q.visibility}</span>
          <span className={cn("text-right", q.day.remaining === 0 && MARK.failing.text)}>
            {q.day.remaining} / {q.day.limit}
          </span>
          <span className={cn("text-right", q.hour.remaining === 0 && MARK.failing.text)}>
            {q.hour.remaining} / {q.hour.limit}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

/** "96% of 12", or while too few scans to grade, how many there are. */
function Finished({ engine }: Readonly<{ engine: EngineHealth }>) {
  if (engine.runs === 0) return <span className="text-muted-foreground">no scans yet</span>;
  if (engine.grade === "no-data") {
    return (
      <span className="text-muted-foreground">
        {engine.runs} of {MIN_RUNS} needed to grade
      </span>
    );
  }
  return (
    <>
      <span className={cn(engine.grade !== "healthy" && MARK[engine.grade].text)}>{pct(engine.okShare)}</span>
      <span className="text-muted-foreground"> of {engine.runs}</span>
    </>
  );
}

function Engine({ engine }: Readonly<{ engine: EngineHealth }>) {
  const mark = MARK[engine.grade];
  const counted = engine.grade !== "no-key";
  return (
    <section className={cn("border-b border-border/60 py-4 text-[11.5px]", RAIL_PAD)}>
      <header className="mb-2 flex items-center gap-2">
        <span
          aria-hidden
          className={cn("size-2 shrink-0 rounded-full", mark.hollow ? "border border-muted-foreground" : mark.dot)}
        />
        <span className={cn("flex-1 text-[13px] font-bold", !counted && "text-muted-foreground")}>{engine.name}</span>
        <span className={cn("text-[10.5px] tracking-[0.12em] uppercase", mark.text)}>{GRADE_LABEL[engine.grade]}</span>
      </header>
      {counted ? (
        <dl className="pl-4">
          <Line label="Finished">
            <Finished engine={engine} />
          </Line>
          <Line label="p50 result">{ms(engine.medianMs)}</Line>
          {"quota" in engine && <Quota lines={engine.quota} />}
          {engine.lastError && (
            <Line label="Last error">
              <span className="block truncate text-muted-foreground" title={engine.lastError}>
                {engine.lastError}
              </span>
            </Line>
          )}
        </dl>
      ) : (
        <p className="pl-4 text-muted-foreground">{KEY_ENV[engine.id] ?? "Credentials"} not set.</p>
      )}
    </section>
  );
}

function footerFor(board: EngineBoard, now: number): string {
  if (!board.recorded) return "Health tracking needs the Redis cache.";
  return board.newestAt
    ? `last 50 scans per engine, newest ${relativeTime(board.newestAt, now)}`
    : "no scans recorded yet";
}

export function EngineRail({ board, now }: Readonly<{ board: EngineBoard; now: number }>) {
  return (
    <EngineShell footer={footerFor(board, now)}>
      {board.engines.map((e) => (
        <Engine key={e.id} engine={e} />
      ))}
    </EngineShell>
  );
}

export function EngineRailSkeleton() {
  return (
    <EngineShell footer={<span className="sweep block h-2 w-40 rounded" />}>
      {[0, 1].map((i) => (
        <div key={i} className={cn("flex flex-col gap-2.5 border-b border-border/60 py-4", RAIL_PAD)}>
          <span className="sweep block h-3 w-32 rounded" />
          <span className="sweep ml-4 block h-2 w-40 rounded" />
          <span className="sweep ml-4 block h-2 w-28 rounded" />
          <span className="sweep ml-4 block h-2 w-48 rounded" />
        </div>
      ))}
    </EngineShell>
  );
}
