"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { IOCType } from "@/lib/ioc";
import { pollIntervalFor } from "@/lib/scan-poll";
import { parseUrl } from "@/lib/url";
import { ENGINE_NAME } from "@/lib/ti/url/active/engines";
import { mergeScans } from "@/lib/ti/url/active/merge";
import { scanTargetsFor } from "@/lib/ti/url/active/targets";
import type { ActiveScanBatch } from "@/lib/ti/url/active/types";
import type { CheckResult, DomainCheckResult } from "@/lib/ti/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeading } from "@/components/CheckResults/primitives";
import { IpDossierCard } from "@/components/CheckResults/dossier";
import { DomainProfileCard } from "@/components/CheckResults/profile";
import { ActiveModeButton, ArmedPanel } from "./active-mode";
import { TargetReport } from "./target";

type SubjectKind = "ip" | "domain";

/** What identity lookup answers for the scanned indicator, and how to reach
 *  it. A url indicator's subject is its host, not the URL itself, so this
 *  resolves to the ip/domain the host actually is; `context` carries the
 *  path/query that was scanned but isn't part of that identity. */
function subjectTarget(
  indicator: string,
  kind: IOCType,
): { subjectKind: SubjectKind; subject: string; context?: string } | null {
  if (kind === "ip") return { subjectKind: "ip", subject: indicator };
  if (kind === "domain") return { subjectKind: "domain", subject: indicator };
  if (kind === "url") {
    const parsed = parseUrl(indicator);
    if (!parsed) return null;
    const context =
      parsed.path !== "/" || parsed.query
        ? `${parsed.path}${parsed.query ? `?${parsed.query}` : ""}`
        : undefined;
    return {
      subjectKind: parsed.isIpHost ? "ip" : "domain",
      subject: parsed.host,
      context,
    };
  }
  return null;
}

const SUBJECT_ROUTE: Record<SubjectKind, { path: string; param: string }> = {
  ip: { path: "/api/check", param: "ip" },
  domain: { path: "/api/check-domain", param: "domain" },
};

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
function IdentityCard({
  subject,
  loadingKind,
}: Readonly<{ subject: SubjectState; loadingKind: SubjectKind }>) {
  if (subject.status === "failed") {
    return (
      <p className="text-sm text-foreground/60">
        The identity lookup failed, so nothing is known here, which is not the
        same as nothing being found.
      </p>
    );
  }
  if (subject.status === "ready" && subject.subjectKind === "ip") {
    return (
      <IpDossierCard result={subject.result as CheckResult} streaming={false} />
    );
  }
  if (subject.status === "ready") {
    return (
      <DomainProfileCard
        result={subject.result as DomainCheckResult}
        streaming={false}
      />
    );
  }
  if (loadingKind === "ip") return <IpDossierCard result={null} streaming />;
  return <DomainProfileCard result={null} streaming />;
}

/**
 * The active scan as a page, rather than as a card inside a triage result.
 *
 * The scan is the subject here: the answer and the picture come first, the
 * evidence sits beneath, and everything nobody collected is named rather than
 * left as an empty section. The passive reading is fetched in parallel and only
 * ever appears as one attributed line, because this page is the teardown and
 * /check is the triage.
 */
export function ScanReport({
  indicator,
  kind,
  initialBatch,
}: Readonly<{
  indicator: string;
  kind: IOCType;
  initialBatch: ActiveScanBatch | null;
}>) {
  const [batch, setBatch] = useState<ActiveScanBatch | null>(initialBatch);
  const [running, setRunning] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Computed synchronously, not just inside the fetch effect, so the initial
  // state and the loading skeleton can both match the resolved kind's shape
  // instead of guessing domain.
  const target = useMemo(() => subjectTarget(indicator, kind), [indicator, kind]);
  const [subject, setSubject] = useState<SubjectState>(() =>
    target ? { status: "loading" } : { status: "failed" },
  );

  const targets = scanTargetsFor(indicator, kind);
  const pending = batch?.scans.some((s) => s.status === "running") ?? false;

  // The subject's identity record — the same passive lookup /check renders,
  // for whatever this indicator's host actually is — fetched in parallel with
  // everything else on this page.
  useEffect(() => {
    if (!target) return;
    const route = SUBJECT_ROUTE[target.subjectKind];
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `${route.path}?${route.param}=${encodeURIComponent(target.subject)}`,
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
  }, [target]);

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
          if (!cancelled) tick();
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
    } catch {
      setMessage("The scan could not be started.");
    } finally {
      setRunning(false);
    }
  }

  const merged = batch ? mergeScans(batch.scans) : [];
  const enginesUsed = [...new Set(batch?.scans.map((s) => s.engine) ?? [])];
  const visibilities = [
    ...new Set(batch?.scans.map((s) => s.visibility).filter(Boolean) ?? []),
  ];
  const scanTotal = batch?.scans.length ?? 0;
  const scanDone =
    batch?.scans.filter((s) => s.status !== "running").length ?? 0;
  const scanPct = scanTotal > 0 ? Math.round((scanDone / scanTotal) * 100) : 0;

  return (
    <div className="space-y-5">
      <IdentityCard subject={subject} loadingKind={target?.subjectKind ?? "domain"} />

      <Card className="sketch-shadow rounded-lg border border-foreground/12">
        <CardContent className="space-y-5">
          <SectionHeading
            action={
              batch && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={running || pending}
                  onClick={() => void submit(true)}
                >
                  {running ? "Submitting" : "Rescan"}
                </Button>
              )
            }
          >
            Active scan
          </SectionHeading>

          <div className="space-y-1">
            {subject.status === "ready" && subject.context && (
              <p className="text-xs text-foreground/55">
                Scanned path:{" "}
                <span className="font-mono text-foreground">
                  {subject.context}
                </span>
              </p>
            )}
            {batch ? (
              <p className="text-xs text-foreground/55">
                {targets.length === 1 ? "1 URL sent" : `${targets.length} URLs sent`}
                {enginesUsed.length
                  ? ` · ${enginesUsed.map((e) => ENGINE_NAME[e]).join(" + ")}`
                  : ""}
                {` · ${new Date(batch.submittedAt).toLocaleString()}`}
                {visibilities.length ? ` · ${visibilities.join(", ")}` : ""}
              </p>
            ) : (
              <p className="text-xs text-foreground/55">
                Not scanned yet. Everything on /check is passive, this page is the
                one thing that reaches out and touches the indicator.
              </p>
            )}

            {/* A phishing site changes fast, so an earlier reading is evidence in
                its own right rather than trivia. */}
            {batch?.previous?.length ? (
              <p className="text-xs text-foreground/55">
                Scanned before:{" "}
                {batch.previous
                  .map(
                    (p) =>
                      `${new Date(p.at).toLocaleDateString()} → ${p.malicious ? "malicious" : "not flagged"}`,
                  )
                  .join(" · ")}
              </p>
            ) : null}
          </div>

          {message && <p className="text-sm text-orange-500">{message}</p>}

          {!batch && !confirming && (
            <div className="space-y-3">
              <p className="text-sm text-foreground/75">
                An active scan visits{" "}
                {targets.length === 1 ? "this address" : "these addresses"} now and
                reports what {targets.length === 1 ? "it serves" : "they serve"}.
              </p>
              <ActiveModeButton
                disabled={running}
                onClick={() => setConfirming(true)}
              />
            </div>
          )}

          {confirming && (
            <ArmedPanel
              targets={targets}
              submitting={running}
              onEngage={() => void submit(false)}
              onCancel={() => setConfirming(false)}
            />
          )}

          {pending && (
            <div className="space-y-2">
              <div
                role="progressbar"
                aria-label="Scan targets completed"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={scanPct}
                className="h-0.5 w-full overflow-hidden rounded-full bg-border"
              >
                <div
                  className="h-full bg-foreground/70 transition-[width] duration-200 ease-linear"
                  style={{ width: `${Math.max(scanPct, 2)}%` }}
                />
              </div>
              <div className="flex items-center justify-between font-mono text-xs tabular-nums text-muted-foreground">
                <span>
                  {scanDone} / {scanTotal} targets
                </span>
                <span>about thirty seconds</span>
              </div>
              <div className="flex flex-wrap gap-1" aria-hidden>
                {(batch?.scans ?? []).map((s) => (
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
                Sections fill in as each engine finishes, and leaving this page
                does not cancel it.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {merged.map((m) => (
        <TargetReport
          key={m.target}
          merged={m}
          scans={batch?.scans.filter((s) => s.target === m.target) ?? []}
        />
      ))}
    </div>
  );
}
