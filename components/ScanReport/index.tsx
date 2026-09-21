"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { IOCType } from "@/lib/ioc";
import { pollIntervalFor } from "@/lib/scan-poll";
import { count } from "@/lib/text";
import { checkUrlFor } from "@/lib/ti/endpoints";
import {
  subjectTargetFor,
  type SubjectKind,
} from "@/lib/ti/subject-target";
import { mergeTargets, type MergedIndicator } from "@/lib/ti/url/active/merge";
import { redFlagsFor, type RedFlag } from "@/lib/ti/url/active/red-flags";
import { scanTargetsFor } from "@/lib/ti/url/active/targets";
import type { ActiveScanBatch } from "@/lib/ti/url/active/types";
import type { CheckResult, DomainCheckResult } from "@/lib/ti/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeading } from "@/components/CheckResults/primitives";
import { SectionNav, type NavItem } from "@/components/CheckResults/section-nav";
import { IdentityCard as SubjectRecordCard } from "@/components/CheckResults/identity";
import { ActiveModeButton, ArmedPanel } from "./active-mode";
import { ScanAnswer } from "./answer";
import { ScanCapture } from "./capture";
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

/** The teardown's sections, in the order the scanner met them, then the passive
 *  record. The ids are what `redFlagsFor` links to and what the rail scrolls
 *  to, so the three lists are one list. */
const SECTIONS: NavItem[] = [
  { id: "capture", label: "Capture" },
  { id: "request", label: "Request" },
  { id: "page", label: "Page" },
  { id: "network", label: "Network" },
  { id: "dom", label: "DOM" },
  { id: "identity", label: "Identity" },
  { id: "certs", label: "Certs" },
  { id: "verdicts", label: "Verdicts" },
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

/** The one line above the teardown that is about the submission rather than
 *  about the page: how much was sent, what path was scanned, and what earlier
 *  readings said. A phishing site changes fast, so "scanned before, and it said
 *  something different then" is evidence in its own right. */
function SubmissionLine({
  targets,
  context,
  previous,
}: Readonly<{
  targets: string[];
  context?: string;
  previous?: { at: string; malicious: boolean }[];
}>) {
  const parts = [
    `${count(targets.length, "URL")} sent`,
    context ? `scanned path ${context}` : undefined,
    previous?.length
      ? `scanned before: ${previous
          .map(
            (p) =>
              `${new Date(p.at).toLocaleDateString()} → ${p.malicious ? "malicious" : "not flagged"}`,
          )
          .join(" · ")}`
      : undefined,
  ].filter(Boolean);
  return <p className="text-xs text-foreground/55">{parts.join(" · ")}</p>;
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
    <Card className="sketch-shadow rounded-lg border border-foreground/12">
      <CardContent className="space-y-5">
        <SectionHeading>Active scan</SectionHeading>
        <p className="text-xs text-foreground/55">
          Not scanned yet. Everything on /check is passive, this page is the one
          thing that reaches out and touches the indicator.
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
      </CardContent>
    </Card>
  );
}

/** Every section of the teardown, in the order the scanner met them. Split out
 *  so `ScanReport` itself stays a state container rather than also being the
 *  document. */
function Teardown({
  merged,
  batch,
  flags,
  now,
}: Readonly<{
  merged: MergedIndicator;
  batch: ActiveScanBatch;
  flags: RedFlag[];
  now: number;
}>) {
  const scans = batch.scans;
  return (
    <>
      <ScanAnswer merged={merged} batch={batch} flags={flags} now={now} />

      {/* Both phases: the rail draws the left column's edge, and a rail that
          appears only once the scan lands slides the whole content column
          sideways when it does. */}
      <SectionNav items={SECTIONS} />

      <section id="capture" className="scroll-mt-20">
        <ScanCapture merged={merged} scans={scans} />
      </section>
      <RequestSection merged={merged} scans={scans} batch={batch} />
      <PageSection merged={merged} scans={scans} />
      <NetworkSection merged={merged} scans={scans} />
      <DomSection merged={merged} scans={scans} />
      <IdentitySection merged={merged} scans={scans} />
      <CertificateSection merged={merged} scans={scans} />
      <VerdictSection merged={merged} scans={scans} />
      <TraceSection merged={merged} scans={scans} />
    </>
  );
}

/**
 * The active scan as a page.
 *
 * A teardown, not a triage: the point of coming here is to read everything the
 * scanner collected, so nothing is behind a disclosure triangle and the
 * sections run in the order the scan happened rather than in the order the two
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

    function tick() {
      timer = setTimeout(() => {
        if (cancelled) return;
        void poll().finally(() => {
          if (!cancelled) {
            setNow(Date.now());
            tick();
          }
        });
      }, pollIntervalFor(Date.now() - startedAt));
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

  return (
    <div className="space-y-5">
      <ScanSearchBar indicator={indicator} />

      {batch && merged ? (
        <>
          {/* A rescan spends quota, so it stays a deliberate button rather than
              something a reload does. */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SubmissionLine
              targets={targets}
              context={subject.status === "ready" ? subject.context : undefined}
              previous={batch.previous}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={running || pending}
              onClick={() => void submit(true)}
            >
              {running ? "Submitting" : "Rescan"}
            </Button>
          </div>

          {message && <p className="text-sm text-orange-500">{message}</p>}
          {pending && <ScanProgress batch={batch} />}

          <Teardown merged={merged} batch={batch} flags={flags} now={now} />
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
