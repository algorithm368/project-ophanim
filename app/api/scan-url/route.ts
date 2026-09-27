import { type NextRequest } from "next/server";
import { detectIOC, type IOCType } from "@/lib/ioc";
import { getCachedScanBatch, setCachedScanBatch } from "@/lib/ti/cache";
import { scanTargetsFor } from "@/lib/ti/url/active/targets";
import { pollScan, submitScan } from "@/lib/ti/url/active/urlscan";
import {
  pollCloudflareScan,
  submitCloudflareScan,
} from "@/lib/ti/url/active/cloudflare";
import { rememberBatch } from "@/lib/ti/url/active/scan-history";
import { recordEngineHealth, scanOutcomes } from "@/lib/ti/url/active/engine-health";
import {
  readScanCredentials,
  SCAN_MISSING_KEY,
} from "@/lib/ti/url/active/credentials";
import { urlIndicatorProblem } from "@/lib/ti/url/validate";
import type { ActiveScan, ActiveScanBatch } from "@/lib/ti/url/active/types";
import { requireSession } from "@/lib/require-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Deliberately much smaller than the indicator routes (see
// app/api/check/route.ts): submit/poll each make one bounded request
// (REQUEST_TIMEOUT_MS below) and never wait on the scan itself finishing.
export const maxDuration = 30;

/** Submission is fast (it only queues), polling is one round trip. Neither
 *  waits for the scan itself, which takes roughly 30 seconds on the provider. */
const REQUEST_TIMEOUT_MS = 20000;

function badRequest(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

/** The indicator and its kind, or an error Response. */
function readIndicator(
  raw: unknown,
): { indicator: string; kind: IOCType } | Response {
  if (typeof raw !== "string" || !raw.trim()) {
    return badRequest("Missing 'indicator'");
  }
  const indicator = raw.trim();
  const kind = detectIOC(indicator);
  if (!kind) return badRequest("Unrecognized indicator");
  if (kind === "hash") {
    return badRequest("A hash has no address to scan", 422);
  }
  return { indicator, kind };
}

/**
 * Start an active scan.
 *
 * Submitting spends quota, so a batch already stored for this indicator is
 * returned as-is rather than resubmitted: a reload, a double click, or a second
 * tab must not buy the same scan twice. Pass `force: true` to deliberately scan
 * again.
 */
async function submitScanRoute(request: NextRequest): Promise<Response> {
  const creds = readScanCredentials();
  if (!creds.any) return Response.json(SCAN_MISSING_KEY, { status: 503 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return badRequest("Invalid JSON body");
  }

  const read = readIndicator(body.indicator);
  if (read instanceof Response) return read;
  const { indicator, kind } = read;

  const existing = await getCachedScanBatch(indicator);
  if (existing && body.force !== true) {
    return Response.json({ ...existing, reused: true });
  }

  const targets = scanTargetsFor(indicator, kind);
  if (targets.length === 0) {
    return badRequest("Nothing to scan for this indicator", 422);
  }

  // The same boundary the passive routes enforce. Without it this endpoint
  // would happily submit a reserved name or a non-routable address that
  // /api/check-domain and /api/check refuse, and asking a third party to fetch
  // 192.168.1.1 both wastes the quota and tells them about internal addressing.
  const problem = targets.map(urlIndicatorProblem).find(Boolean);
  if (problem) {
    return Response.json(
      { error: problem.message, ...(problem.scope ? { scope: problem.scope } : {}) },
      { status: problem.status },
    );
  }

  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const jobs: Promise<ActiveScan>[] = [];
  for (const target of targets) {
    if (creds.urlscanKey) {
      jobs.push(submitScan(target, creds.urlscanKey, signal));
    }
    if (creds.cfReady) {
      jobs.push(
        submitCloudflareScan(
          target,
          creds.cfToken as string,
          creds.cfAccount as string,
          signal,
        ),
      );
    }
  }
  const scans = await Promise.all(jobs);

  // A rescan is the only thing that discards a stored scan, so this is where
  // the reading being replaced gets its one chance to survive as a history
  // line. A phishing site changes fast, and "it said something different three
  // days ago" is evidence in its own right.
  const batch = rememberBatch(existing, {
    indicator,
    submittedAt: new Date().toISOString(),
    scans,
  });
  // Stored even when every submission failed, so a retry is a deliberate act
  // rather than something a page refresh does on the analyst's behalf. A
  // refused submission is also the only outcome a fresh batch can have yet,
  // which is what the engine health on /scan records.
  await Promise.all([
    setCachedScanBatch(indicator, batch),
    recordEngineHealth(scanOutcomes(null, scans, batch.submittedAt, Date.now())),
  ]);
  return Response.json(batch);
}

/**
 * Resume a submitted batch: poll each scan that has not finished.
 *
 * A scan still running is reported as running, never as an error. The quota is
 * already spent and the provider is still working, so the only correct answer
 * is "not yet".
 */
async function pollScanRoute(request: NextRequest): Promise<Response> {
  const creds = readScanCredentials();
  if (!creds.any) return Response.json(SCAN_MISSING_KEY, { status: 503 });

  const raw = request.nextUrl.searchParams.get("indicator");
  const read = readIndicator(raw);
  if (read instanceof Response) return read;

  const batch = await getCachedScanBatch(read.indicator);
  if (!batch) return Response.json({ error: "No scan for this indicator" }, { status: 404 });

  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const scans = await Promise.all(
    batch.scans.map((scan) => {
      if (scan.status !== "running") return scan;
      if (scan.engine === "cloudflare") {
        return creds.cfReady
          ? pollCloudflareScan(
              scan,
              creds.cfToken as string,
              creds.cfAccount as string,
              signal,
            )
          : scan;
      }
      return creds.urlscanKey ? pollScan(scan, creds.urlscanKey, signal) : scan;
    }),
  );

  const updated: ActiveScanBatch = { ...batch, scans };
  // Only the scans that settled on this poll: a finished batch polled again
  // (a reload, a second tab) changes nothing and records nothing.
  await Promise.all([
    scans.some((scan) => scan.status === "done")
      ? setCachedScanBatch(read.indicator, updated)
      : null,
    recordEngineHealth(scanOutcomes(batch.scans, scans, batch.submittedAt, Date.now())),
  ]);
  return Response.json(updated);
}

// The second lock. proxy.ts already refuses anonymous callers; this is what
// still refuses if the proxy's matcher is ever edited out from under us.
export async function POST(request: NextRequest): Promise<Response> {
  return (await requireSession()) ?? submitScanRoute(request);
}

export async function GET(request: NextRequest): Promise<Response> {
  return (await requireSession()) ?? pollScanRoute(request);
}
