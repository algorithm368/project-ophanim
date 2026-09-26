"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { IOCType } from "@/lib/ioc";
import { pollIntervalFor } from "@/lib/scan-poll";
import { checkUrlFor } from "@/lib/ti/endpoints";
import {
  subjectTargetFor,
  type SubjectKind,
} from "@/lib/ti/subject-target";
import { mergeTargets, type MergedIndicator } from "@/lib/ti/url/active/merge";
import { redFlagsFor, type RedFlag } from "@/lib/ti/url/active/red-flags";
import { classifyScan, type ScanClass } from "@/lib/ti/url/active/scan-class";
import { scanTargetsFor } from "@/lib/ti/url/active/targets";
import type { ActiveScanBatch } from "@/lib/ti/url/active/types";
import type { CheckResult, DomainCheckResult } from "@/lib/ti/types";
import { cn } from "@/lib/utils";
import { Frame, Tile } from "@/components/CheckResults/frame";
import { SectionNav, type NavItem } from "@/components/CheckResults/section-nav";
import { IdentityCard as SubjectRecordCard } from "@/components/CheckResults/identity";
import { ActiveModeButton, ArmedPanel } from "./active-mode";
import { BallotsTile } from "./ballots";
import {
  RedFlagsTile,
  ScanHeroTile,
  ScanProvenanceTile,
  ScanRailTile,
} from "./entry";
import { PayloadTile } from "./payload";
import { ScanSearchBar } from "./search";
import {
  DomSection,
  NetworkSection,
  PageSection,
  RequestSection,
} from "./sections/trip";
import {
  CertificateSection,
  IdentitySection,
  TraceSection,
  VerdictSection,
} from "./sections/record";

type SubjectState =
  | { status: "loading" }
  | {
      status: "ready";
      subjectKind: SubjectKind;
      result: CheckResult | DomainCheckResult;
      context?: string;
    }
  | { status: "failed" };

// Headroom over the slowest identity route's worst case: the others top out
// near 15s. Without this the fetch has no AbortSignal and will wait as long
// as the platform allows, holding the card on "checking the sources"
// indefinitely.
const SUBJECT_TIMEOUT_MS = 60_000;

/** The entry's tiles, in page order, then the passive record. The ids are what
 *  `redFlagsFor` links to and what the rail scrolls to, so the three lists are
 *  one list. Tiles that render nothing (no flags, no files, one engine) are
 *  pruned from the rail by `SectionNav` itself. */
const SECTIONS: NavItem[] = [
  { id: "flags", label: "Flags" },
  { id: "request", label: "Path" },
  { id: "payload", label: "Payload" },
  { id: "page", label: "Page" },
  { id: "network", label: "Network" },
  { id: "dom", label: "Forms" },
  { id: "identity", label: "Identity" },
  { id: "certs", label: "Certs" },
  { id: "verdicts", label: "Verdicts" },
  { id: "ballots", label: "Ballots" },
  { id: "trace", label: "Trace" },
  { id: "subject", label: "Subject" },
];

/**
 * The subject's identity, one card, exactly what /check renders for whatever
 * this indicator's host actually is. A url's subject is its host, not the
 * URL itself, so a scanned path/query is named separately by the caller
 * rather than folded into this record.
 *
 * An if/else ladder rather than chained ternaries: `no-nested-ternary` is an
 * error in this project, not a warning. Pulled out of `ScanReport` itself so
 * that component's cognitive complexity stays under the enforced limit.
 */
function IdentityCard({ subject }: Readonly<{ subject: SubjectState }>) {
  if (subject.status === "failed") {
    return (
      <p className="text-sm text-foreground/60">
        The identity lookup failed, so nothing is known here, which is not the
        same as nothing being found.
      </p>
    );
  }
  if (subject.status === "ready") {
    return (
      <SubjectRecordCard
        result={subject.result as CheckResult | DomainCheckResult}
        streaming={false}
      />
    );
  }
  return <SubjectRecordCard result={null} streaming />;
}

/** How far along a running batch is, as a bar and a count. */
function ScanProgress({ batch }: Readonly<{ batch: ActiveScanBatch }>) {
  const total = batch.scans.length;
  const done = batch.scans.filter((s) => s.status !== "running").length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="space-y-2">
      <div
        role="progressbar"
        aria-label="Scan targets completed"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-0.5 w-full overflow-hidden rounded-full bg-border"
      >
        <div
          className="h-full bg-foreground/70 transition-[width] duration-200 ease-linear"
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>
      <div className="flex items-center justify-between font-mono text-xs tabular-nums text-muted-foreground">
        <span>
          {done} / {total} targets
        </span>
        <span>about thirty seconds</span>
      </div>
      <div className="flex flex-wrap gap-1" aria-hidden>
        {batch.scans.map((s) => (
          <span
            key={`${s.target}-${s.engine}`}
            title={s.target}
            className={cn(
              "size-1.5 rounded-full",
              s.status === "done" && "bg-emerald-600 dark:bg-emerald-400",
              s.status === "error" && "bg-amber-500",
              s.status === "running" && "animate-pulse bg-foreground/30",
            )}
          />
        ))}
      </div>
      <p className="text-xs text-foreground/60">
        Sections fill in as each engine finishes, and leaving this page does not
        cancel it.
      </p>
    </div>
  );
}

/** The page before anything has been scanned: what would be visited, and the
 *  one control that spends the quota. */
function NotScannedPanel({
  targets,
  running,
  confirming,
  message,
  onArm,
  onCancel,
  onEngage,
}: Readonly<{
  targets: string[];
  running: boolean;
  confirming: boolean;
  message: string | null;
  onArm: () => void;
  onCancel: () => void;
  onEngage: () => void;
}>) {
  return (
    <Frame>
      <Tile span={12} title="Active scan" note="not scanned yet" className="space-y-4">
        <p className="text-xs text-foreground/55">
          Everything on /check is passive, this page is the one thing that
          reaches out and touches the indicator.
        </p>
        {message && <p className="text-sm text-orange-500">{message}</p>}
        {confirming ? (
          <ArmedPanel
            targets={targets}
            submitting={running}
            onEngage={onEngage}
            onCancel={onCancel}
          />
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-foreground/75">
              An active scan visits{" "}
              {targets.length === 1 ? "this address" : "these addresses"} now and
              reports what {targets.length === 1 ? "it serves" : "they serve"}.
            </p>
            <ActiveModeButton disabled={running} onClick={onArm} />
          </div>
        )}
      </Tile>
    </Frame>
  );
}

/**
 * The scan as one frame: the head row, the flags, then the teardown.
 *
 * The head row is the passive page's own (picture, name, provenance) so the two
 * modes read as two entries in one book. Below it the teardown keeps the order
 * the scanner met things in, the path it took, what it was handed, the page and
 * what the page pulled in, what it asks for and who owns the name, what each
 * engine concluded, and what was left behind. Split out so `ScanReport` stays a
 * state container rather than also being the document.
 */
function Entry({
  indicator,
  merged,
  batch,
  flags,
  klass,
  now,
  targets,
  context,
  pending,
  busy,
  onRescan,
}: Readonly<{
  indicator: string;
  merged: MergedIndicator;
  batch: ActiveScanBatch;
  flags: RedFlag[];
  klass: ScanClass | undefined;
  now: number;
  targets: string[];
  context?: string;
  pending: boolean;
  busy: boolean;
  onRescan: () => void;
}>) {
  const scans = batch.scans;
  // Nothing loaded, so every tile between the path and the trace would be a
  // column of "not reported". The path says what was sent and the trace says
  // why nothing came back, which is all there is.
  const empty = klass?.kind === "no-answer";
  return (
    <Frame>
      <ScanRailTile merged={merged} scans={scans} klass={klass} pending={pending} />
      <ScanHeroTile merged={merged} indicator={indicator} klass={klass} />
      <ScanProvenanceTile
        batch={batch}
        merged={merged}
        targets={targets}
        now={now}
        context={context}
        busy={busy}
        onRescan={onRescan}
      />
      <RedFlagsTile flags={flags} />
      <RequestSection merged={merged} scans={scans} batch={batch} />
      {!empty && (
        <>
          <PayloadTile merged={merged} klass={klass} />
          <PageSection merged={merged} scans={scans} />
          <NetworkSection merged={merged} scans={scans} />
          <DomSection merged={merged} scans={scans} />
          <IdentitySection merged={merged} scans={scans} />
          <CertificateSection merged={merged} scans={scans} />
          <VerdictSection merged={merged} scans={scans} />
          <BallotsTile scans={scans} />
        </>
      )}
      <TraceSection merged={merged} scans={scans} />
    </Frame>
  );
}

/**
 * The active scan as a page.
 *
 * An entry in the same book as /check, answering its own first question: what a
 * victim who followed the link would have been handed. Below the head row it is
 * still a teardown, not a triage: nothing is behind a disclosure triangle, and
 * the tiles run in the order the scan happened rather than in the order the two
 * APIs happen to return things.
 *
 * The reading is folded across every URL that was submitted. A bare IP is sent
 * on both ports, and rendering that as two near-identical teardowns meant two
 * paragraphs that matched almost word for word. What the URLs answered
 * differently on is printed beside the folded value instead, which is the part
 * worth reading.
 *
 * The passive record comes last. It is context for a page that is about the
 * visit, and it used to occupy the whole first screen of a page whose own
 * subject was below it.
 */
export function ScanReport({
  indicator,
  kind,
  initialBatch,
  initialSubject,
}: Readonly<{
  indicator: string;
  kind: IOCType;
  initialBatch: ActiveScanBatch | null;
  /** The subject's cached identity record, read server-side. When present the
   *  card is on screen in the first paint and no lookup is made at all. */
  initialSubject: CheckResult | DomainCheckResult | null;
}>) {
  const [batch, setBatch] = useState<ActiveScanBatch | null>(initialBatch);
  const [running, setRunning] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Computed synchronously, not just inside the fetch effect, so the initial
  // state and the loading skeleton can both match the resolved kind's shape
  // instead of guessing domain.
  const target = useMemo(
    () => subjectTargetFor(indicator, kind),
    [indicator, kind],
  );
  const [subject, setSubject] = useState<SubjectState>(() => {
    if (!target) return { status: "failed" };
    if (!initialSubject) return { status: "loading" };
    return {
      status: "ready",
      subjectKind: target.subjectKind,
      result: initialSubject,
      context: target.context,
    };
  });

  // Read once per render rather than per component, so every "how long ago"
  // on the page agrees with every other and none of them disagrees with the
  // markup the server sent.
  const [now, setNow] = useState(() => Date.now());

  const targets = scanTargetsFor(indicator, kind);
  const pending = batch?.scans.some((s) => s.status === "running") ?? false;

  // The subject's identity record — the same passive lookup /check renders,
  // for whatever this indicator's host actually is.
  //
  // Only on a server-side cache miss. The page reads the same record out of
  // Redis before it renders, so the common case costs no request at all; this
  // is the cold path, where the fan-out has to be run and paid for once so the
  // next visit hits.
  useEffect(() => {
    if (!target || initialSubject) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          checkUrlFor(target.subjectKind, target.subject),
          { signal: AbortSignal.timeout(SUBJECT_TIMEOUT_MS) },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = (await res.json()) as CheckResult | DomainCheckResult;
        if (!cancelled) {
          setSubject({
            status: "ready",
            subjectKind: target.subjectKind,
            result,
            context: target.context,
          });
        }
      } catch {
        if (!cancelled) setSubject({ status: "failed" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target, initialSubject]);

  const poll = useCallback(async () => {
    const res = await fetch(
      `/api/scan-url?indicator=${encodeURIComponent(indicator)}`,
    );
    if (!res.ok) return;
    setBatch((await res.json()) as ActiveScanBatch);
  }, [indicator]);

  // Re-poll while anything is queued, tightening early and widening as the
  // scan ages. See lib/scan-poll.ts for why the interval is a function of age.
  useEffect(() => {
    if (!pending) return;
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const settled = () => {
      if (cancelled) return;
      setNow(Date.now());
      tick();
    };
    const fire = () => {
      if (!cancelled) void poll().finally(settled);
    };
    function tick() {
      timer = setTimeout(fire, pollIntervalFor(Date.now() - startedAt));
    }
    tick();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pending, poll]);

  async function submit(force: boolean) {
    setRunning(true);
    setConfirming(false);
    setMessage(null);
    try {
      const res = await fetch("/api/scan-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ indicator, force }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "The scan could not be started.");
        return;
      }
      setBatch(data as ActiveScanBatch);
      setNow(Date.now());
    } catch {
      setMessage("The scan could not be started.");
    } finally {
      setRunning(false);
    }
  }

  const merged = useMemo(
    () => (batch ? mergeTargets(batch.scans) : null),
    [batch],
  );
  const flags = useMemo(
    () => (merged ? redFlagsFor(merged, now) : []),
    [merged, now],
  );
  // Nothing to classify while every engine is still out: "No answer" is a
  // finding, and saying it before anyone has answered would be a false one.
  const waiting = pending && (merged?.engines.length ?? 0) === 0;
  const klass = useMemo(
    () => (merged && !waiting ? classifyScan(merged, now, batch?.previous) : undefined),
    [merged, waiting, now, batch?.previous],
  );

  return (
    <div className="space-y-5">
      <ScanSearchBar indicator={indicator} />

      {batch && merged ? (
        <>
          {message && <p className="text-sm text-orange-500">{message}</p>}
          {pending && <ScanProgress batch={batch} />}

          <Entry
            indicator={indicator}
            merged={merged}
            batch={batch}
            flags={flags}
            klass={klass}
            now={now}
            targets={targets}
            context={subject.status === "ready" ? subject.context : undefined}
            pending={pending}
            busy={running || pending}
            // A rescan spends quota, so it stays a deliberate button rather
            // than something a reload does.
            onRescan={() => void submit(true)}
          />

          {/* Both phases: the rail draws the left column's edge, and a rail
              that appears only once the scan lands slides the whole content
              column sideways when it does. */}
          <SectionNav items={SECTIONS} />
        </>
      ) : (
        <NotScannedPanel
          targets={targets}
          running={running}
          confirming={confirming}
          message={message}
          onArm={() => setConfirming(true)}
          onCancel={() => setConfirming(false)}
          onEngage={() => void submit(false)}
        />
      )}

      {/* Last, and unlabelled: the dossier and profile cards head themselves,
          and an outer title above them printed "subject record" twice. It is
          context for a page about the visit, which is why it is down here at
          all rather than occupying the first screen as it used to. */}
      <section id="subject" className="scroll-mt-20">
        <IdentityCard subject={subject} />
      </section>
    </div>
  );
}
