"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Loader2, Radar } from "lucide-react";
import type { IOCType } from "@/lib/ioc";
import { consensusBuckets, type ResultLike } from "@/lib/ti/narrative";
import { ENGINE_NAME } from "@/lib/ti/url/active/engines";
import { mergeScans } from "@/lib/ti/url/active/merge";
import { scanTargetsFor } from "@/lib/ti/url/active/targets";
import type { ActiveScanBatch } from "@/lib/ti/url/active/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeading } from "@/components/CheckResults/primitives";
import { ActiveModeButton, ArmedPanel } from "./active-mode";
import { TargetReport } from "./target";

/** Re-poll while anything is queued. A scan takes roughly half a minute, so
 *  this is a handful of requests rather than a spin. */
const POLL_MS = 6000;

/** Which passive route answers for this kind of indicator. */
const PASSIVE_ROUTE: Record<string, { path: string; param: string }> = {
  ip: { path: "/api/check", param: "ip" },
  domain: { path: "/api/check-domain", param: "domain" },
  url: { path: "/api/check-url", param: "url" },
};

type PassiveState =
  | { status: "loading" }
  | { status: "ready"; result: ResultLike }
  | { status: "failed" };

/**
 * The passive TI line, fetched separately from the scan.
 *
 * A slow fan-out must never delay the scan result, and a failed one must never
 * render as "0 flagged", which reads as a clean bill. It says the lookup failed
 * instead.
 */
function PassiveLine({
  state,
  indicator,
}: Readonly<{ state: PassiveState; indicator: string }>) {
  if (state.status === "loading") {
    return (
      <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
        <span className="w-28 shrink-0 text-[13px] text-muted-foreground">
          Passive TI
        </span>
        <span className="flex items-center gap-1.5 text-foreground/60">
          <Loader2 className="size-3 animate-spin" />
          checking the sources
        </span>
      </div>
    );
  }
  if (state.status === "failed") {
    return (
      <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
        <span className="w-28 shrink-0 text-[13px] text-muted-foreground">
          Passive TI
        </span>
        <span className="text-foreground/60">
          the lookup failed, so nothing is known here, which is not the same as
          nothing being found
        </span>
      </div>
    );
  }

  const buckets = consensusBuckets(state.result);
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
      <span className="w-28 shrink-0 text-[13px] text-muted-foreground">
        Passive TI
      </span>
      <span
        className={
          buckets.flagged > 0
            ? "text-amber-600 dark:text-amber-400"
            : "text-foreground/75"
        }
      >
        {state.result.verdict.toUpperCase()}
        {"  "}
        {buckets.flagged} of {buckets.total} sources flagged it
      </span>
      <Link
        href={`/check/${encodeURIComponent(indicator)}`}
        className="inline-flex items-center gap-1 text-xs text-foreground/60 underline underline-offset-2 hover:text-foreground"
      >
        full breakdown
        <ExternalLink className="size-3" />
      </Link>
    </div>
  );
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
  // Whether a passive route exists for this kind is known at render time, so it
  // is the initial state rather than something an effect discovers.
  const [passive, setPassive] = useState<PassiveState>(() =>
    PASSIVE_ROUTE[kind] ? { status: "loading" } : { status: "failed" },
  );

  const targets = scanTargetsFor(indicator, kind);
  const pending = batch?.scans.some((s) => s.status === "running") ?? false;

  // The passive summary is its own request, in parallel with everything else.
  useEffect(() => {
    const route = PASSIVE_ROUTE[kind];
    if (!route) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `${route.path}?${route.param}=${encodeURIComponent(indicator)}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = (await res.json()) as ResultLike;
        if (!cancelled) setPassive({ status: "ready", result });
      } catch {
        if (!cancelled) setPassive({ status: "failed" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [indicator, kind]);

  const poll = useCallback(async () => {
    const res = await fetch(
      `/api/scan-url?indicator=${encodeURIComponent(indicator)}`,
    );
    if (!res.ok) return;
    setBatch((await res.json()) as ActiveScanBatch);
  }, [indicator]);

  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(timer);
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

  return (
    <Card className="sketch-shadow rounded-lg border border-foreground/12">
      <CardContent className="space-y-6">
        <SectionHeading
          icon={Radar}
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
          <h1 className="font-mono text-lg break-all">{indicator}</h1>
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
          <p className="flex items-center gap-2 text-xs text-foreground/60">
            <Loader2 className="size-3 animate-spin" />
            A scan takes about thirty seconds. Sections fill in as each engine
            finishes, and leaving this page does not cancel it.
          </p>
        )}

        {merged.map((m) => (
          <TargetReport
            key={m.target}
            merged={m}
            scans={batch?.scans.filter((s) => s.target === m.target) ?? []}
            passive={<PassiveLine state={passive} indicator={indicator} />}
          />
        ))}
      </CardContent>
    </Card>
  );
}
