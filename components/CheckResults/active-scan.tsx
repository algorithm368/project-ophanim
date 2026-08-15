"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, Radar, ShieldAlert, ShieldCheck } from "lucide-react";
import type { IOCType } from "@/lib/ioc";
import { scanTargetsFor } from "@/lib/ti/url/active/targets";
import type { ActiveScan, ActiveScanBatch } from "@/lib/ti/url/active/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "./primitives";

/** How often to re-poll while a scan is on the provider's queue. A urlscan run
 *  takes roughly 30 seconds, so this is a handful of requests, not a spin. */
const POLL_MS = 6000;

type Phase = "idle" | "confirming" | "working" | "settled" | "nokey";

function StatusLine({ scan }: Readonly<{ scan: ActiveScan }>) {
  if (scan.status === "running") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-foreground/70">
        <Loader2 className="size-3 animate-spin" />
        still scanning
      </span>
    );
  }
  if (scan.status === "error") {
    return <span className="text-xs text-orange-500">{scan.error}</span>;
  }
  const malicious = scan.verdict?.malicious;
  const Icon = malicious ? ShieldAlert : ShieldCheck;
  return (
    <span
      className={`flex items-center gap-1.5 text-xs ${
        malicious ? "text-red-600 dark:text-red-400" : "text-foreground/70"
      }`}
    >
      <Icon className="size-3.5" />
      {malicious ? "flagged by the scanner" : "no verdict from the scanner"}
    </span>
  );
}

function ScanRow({ scan }: Readonly<{ scan: ActiveScan }>) {
  const v = scan.verdict;
  return (
    <div className="space-y-2 border-b border-foreground/10 py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <code className="min-w-0 truncate font-mono text-xs">{scan.target}</code>
        <StatusLine scan={scan} />
      </div>

      {v && (
        <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
          {v.finalUrl && v.finalUrl !== scan.target && (
            <>
              <dt className="text-foreground/55">Redirected to</dt>
              <dd className="truncate font-mono">{v.finalUrl}</dd>
            </>
          )}
          {v.ip && (
            <>
              <dt className="text-foreground/55">Served from</dt>
              <dd className="font-mono">
                {v.ip}
                {v.asn ? ` · ${v.asn}` : ""}
                {v.server ? ` · ${v.server}` : ""}
              </dd>
            </>
          )}
          {v.contactedDomains?.length ? (
            <>
              <dt className="text-foreground/55">Contacted</dt>
              <dd className="font-mono break-words">
                {v.contactedDomains.slice(0, 8).join(", ")}
                {v.contactedDomains.length > 8
                  ? `, and ${v.contactedDomains.length - 8} more`
                  : ""}
              </dd>
            </>
          ) : null}
        </dl>
      )}

      <div className="flex items-center gap-3">
        {scan.resultUrl && (
          <a
            href={scan.resultUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-foreground/60 underline underline-offset-2 hover:text-foreground"
          >
            Full report
            <ExternalLink className="size-3" />
          </a>
        )}
        {scan.visibility && (
          <span className="font-mono text-[10px] tracking-[0.12em] text-foreground/45 uppercase">
            submitted {scan.visibility}
          </span>
        )}
      </div>

      {v?.screenshot && (
        // eslint-disable-next-line @next/next/no-img-element -- provider-hosted screenshot; next/image would need urlscan allowlisted
        <img
          src={v.screenshot}
          alt={`Screenshot of ${scan.target}`}
          className="mt-1 max-h-64 w-full rounded border border-foreground/12 object-cover object-top"
          loading="lazy"
        />
      )}
    </div>
  );
}

/**
 * On-demand active scan.
 *
 * Everything else on the page is passive: it reads what others already
 * recorded. This is the one control that reaches out and touches the indicator,
 * so it never runs on its own. The confirmation step exists to show the exact
 * strings that will leave the machine, because a phishing URL routinely carries
 * a victim-identifying token in its query and the analyst has to see what they
 * are about to hand a third party.
 */
export function ActiveScanCard({
  indicator,
  kind,
}: Readonly<{ indicator: string; kind: IOCType }>) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [batch, setBatch] = useState<ActiveScanBatch | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const targets = scanTargetsFor(indicator, kind);

  const poll = useCallback(async () => {
    const res = await fetch(
      `/api/scan-url?indicator=${encodeURIComponent(indicator)}`,
    );
    if (!res.ok) return;
    const next = (await res.json()) as ActiveScanBatch;
    setBatch(next);
    if (next.scans.every((s) => s.status !== "running")) setPhase("settled");
  }, [indicator]);

  // Keep polling while anything is queued. The quota is already spent, so the
  // only thing left to do is wait for the provider.
  useEffect(() => {
    if (phase !== "working") return;
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(timer);
  }, [phase, poll]);

  async function submit() {
    setPhase("working");
    setMessage(null);
    const res = await fetch("/api/scan-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ indicator }),
    });
    const data = await res.json();
    if (res.status === 503) {
      setPhase("nokey");
      setMessage(data.error);
      return;
    }
    if (!res.ok) {
      setPhase("idle");
      setMessage(data.error ?? "The scan could not be started.");
      return;
    }
    setBatch(data as ActiveScanBatch);
    if ((data as ActiveScanBatch).scans.every((s) => s.status !== "running")) {
      setPhase("settled");
    }
  }

  if (targets.length === 0) return null;

  return (
    <Card className="sketch-shadow rounded-lg border border-foreground/12">
      <CardContent className="space-y-4">
        <SectionHeading icon={Radar}>Active scan</SectionHeading>

        {phase === "idle" && (
          <div className="space-y-3">
            <p className="text-sm text-foreground/75">
              Everything above is passive, it reports what other people already
              recorded. An active scan visits{" "}
              {targets.length === 1 ? "this address" : "these addresses"} now and
              reports what {targets.length === 1 ? "it serves" : "they serve"}.
            </p>
            {message && <p className="text-xs text-orange-500">{message}</p>}
            <Button type="button" size="sm" onClick={() => setPhase("confirming")}>
              Run an active scan
            </Button>
          </div>
        )}

        {phase === "confirming" && (
          <div className="space-y-3">
            <p className="text-sm text-foreground/75">
              This sends the following to urlscan.io, which will load{" "}
              {targets.length === 1 ? "it" : "them"} from its own
              infrastructure. Check the query string before continuing, phishing
              links often carry a token identifying the victim.
            </p>
            <ul className="space-y-1 rounded border border-foreground/12 bg-muted/40 p-2">
              {targets.map((target) => (
                <li key={target} className="truncate font-mono text-xs">
                  {target}
                </li>
              ))}
            </ul>
            <p className="text-xs text-foreground/60">
              Submitted private, so only this account can see the result, and
              never public. Falls back to unlisted if the private quota for today
              is spent.
            </p>
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={() => void submit()}>
                Send {targets.length === 1 ? "it" : `all ${targets.length}`}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setPhase("idle")}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {phase === "nokey" && (
          <p className="text-sm text-foreground/75">{message}</p>
        )}

        {(phase === "working" || phase === "settled") && (
          <div>
            {batch ? (
              batch.scans.map((scan) => <ScanRow key={scan.target} scan={scan} />)
            ) : (
              <span className="flex items-center gap-2 text-xs text-foreground/70">
                <Loader2 className="size-3 animate-spin" />
                submitting
              </span>
            )}
            {phase === "working" && batch && (
              <p className="pt-3 text-xs text-foreground/55">
                A scan takes about thirty seconds. Leaving this page does not
                cancel it, the result stays retrievable.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
