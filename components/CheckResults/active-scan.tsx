"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Loader2 } from "lucide-react";
import type { IOCType } from "@/lib/ioc";
import { modeHref } from "@/lib/route-mode";
import { SCAN_MISSING_KEY } from "@/lib/ti/url/active/credentials";
import { mergeScans } from "@/lib/ti/url/active/merge";
import { scanTargetsFor } from "@/lib/ti/url/active/targets";
import type { ActiveScanBatch } from "@/lib/ti/url/active/types";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeading } from "./primitives";

type State =
  | { status: "loading" }
  | { status: "never" }
  | { status: "scanned"; batch: ActiveScanBatch }
  | { status: "unavailable"; message: string }
  | { status: "unreadable" };

/**
 * What the server already established about this indicator, when it had the
 * chance to.
 *
 * `/check/[ioc]` knows the indicator before it renders and is holding a Redis
 * connection open anyway, so it answers both halves there. The landing page
 * does not have an indicator until one is typed, so it passes nothing and the
 * card asks the route, as it always did.
 *
 * `batch: null` is a real answer, "never scanned", and is not the same as this
 * prop being absent.
 */
export interface KnownScan {
  batch: ActiveScanBatch | null;
  /** Whether this deployment has any scanning engine configured at all. */
  configured: boolean;
}

function stateFrom(known: KnownScan | undefined): State {
  if (!known) return { status: "loading" };
  if (!known.configured) {
    return { status: "unavailable", message: SCAN_MISSING_KEY.error };
  }
  return known.batch
    ? { status: "scanned", batch: known.batch }
    : { status: "never" };
}

/** What a stored batch amounts to, in one clause. */
function summarize(batch: ActiveScanBatch): string {
  if (batch.scans.some((s) => s.status === "running")) return "still scanning";
  const merged = mergeScans(batch.scans);
  if (merged.every((m) => m.engines.length === 0)) return "no engine finished";
  return merged.some((m) => m.detail.verdicts.overall.malicious)
    ? "flagged by a scanner"
    : "no verdict from the scanners";
}

/**
 * The way into the active scan, which lives on its own page.
 *
 * This card never scans. Everything on /check is passive, and the one control
 * that reaches out and touches the indicator belongs on the page devoted to it,
 * where the confirmation states what leaves the machine and the result gets the
 * room to be read. Keeping a second trigger here would mean two places to
 * understand before spending the quota.
 *
 * What it does do is say whether a scan already exists, because "it was scanned
 * on Tuesday and nothing flagged it" is a triage answer in itself, and reading
 * that costs a cache lookup rather than a visit to the site.
 */
export function ActiveScanCard({
  indicator,
  kind,
  known,
}: Readonly<{ indicator: string; kind: IOCType; known?: KnownScan }>) {
  const [state, setState] = useState<State>(() => stateFrom(known));

  const targets = scanTargetsFor(indicator, kind);
  const scannable = targets.length > 0;

  // Only when the server had no chance to answer, which is the landing page's
  // freshly typed indicator. On a permalink this whole request is already paid
  // for by the page's own Redis read.
  useEffect(() => {
    if (!scannable || known) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/scan-url?indicator=${encodeURIComponent(indicator)}`,
        );
        if (cancelled) return;
        // 404 is the honest "nobody has scanned this", 503 is "this deployment
        // has no scanner". Neither is an error to swallow into the same blank.
        if (res.status === 404) return setState({ status: "never" });
        if (res.status === 503) {
          const data = await res.json();
          return setState({
            status: "unavailable",
            message: data.error ?? "Active scanning is not configured.",
          });
        }
        if (!res.ok) return setState({ status: "unreadable" });
        setState({ status: "scanned", batch: (await res.json()) as ActiveScanBatch });
      } catch {
        if (!cancelled) setState({ status: "unreadable" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [indicator, scannable, known]);

  if (!scannable) return null;

  return (
    <Card className="sketch-shadow rounded-lg border border-foreground/12">
      <CardContent className="space-y-3">
        <SectionHeading>Active scan</SectionHeading>

        <p className="text-sm text-foreground/75">
          Everything above is passive, it reports what other people already
          recorded. An active scan visits{" "}
          {targets.length === 1 ? "this address" : "these addresses"} now and
          reports what {targets.length === 1 ? "it serves" : "they serve"}. It
          runs on its own page, where it says exactly what will leave this
          machine before anything does.
        </p>

        {state.status === "loading" && (
          <p className="flex items-center gap-2 text-xs text-foreground/60">
            <Loader2 className="size-3 animate-spin" />
            checking whether this has been scanned
          </p>
        )}

        {state.status === "scanned" && (
          <p className="text-xs text-foreground/70">
            Scanned {new Date(state.batch.submittedAt).toLocaleString()} ·{" "}
            {summarize(state.batch)}
          </p>
        )}

        {state.status === "never" && (
          <p className="text-xs text-foreground/55">Not scanned yet.</p>
        )}

        {state.status === "unreadable" && (
          <p className="text-xs text-foreground/55">
            Whether this has been scanned could not be read, which is not the
            same as it never having been.
          </p>
        )}

        {state.status === "unavailable" ? (
          <p className="text-xs text-foreground/55">{state.message}</p>
        ) : (
          <Link
            href={modeHref("active", indicator)}
            className="inline-flex items-center gap-1 text-xs text-foreground/60 underline underline-offset-2 hover:text-foreground"
          >
            {state.status === "scanned"
              ? "Open the active scan"
              : "Open the active scan page"}
            <ArrowUpRight className="size-3" />
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
