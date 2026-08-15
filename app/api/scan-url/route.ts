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
import { urlIndicatorProblem } from "@/lib/ti/url/validate";
import type { ActiveScan, ActiveScanBatch } from "@/lib/ti/url/active/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Submission is fast (it only queues), polling is one round trip. Neither
 *  waits for the scan itself, which takes roughly 30 seconds on the provider. */
const REQUEST_TIMEOUT_MS = 20000;

const MISSING_KEY = {
  error:
    "Active scanning needs urlscan.io or Cloudflare credentials. Set URLSCAN_API_KEY, or CLOUDFLARE_API_TOKEN with CLOUDFLARE_ACCOUNT_ID.",
  keyEnv: "URLSCAN_API_KEY",
};

/** Each engine is gated on its own credentials, so one configured engine still
 *  produces a scan and the other is simply absent rather than fatal. */
function readCredentials() {
  const urlscanKey = process.env.URLSCAN_API_KEY;
  const cfToken = process.env.CLOUDFLARE_API_TOKEN;
  const cfAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
  return {
    urlscanKey,
    cfToken,
    cfAccount,
    cfReady: Boolean(cfToken && cfAccount),
    any: Boolean(urlscanKey) || Boolean(cfToken && cfAccount),
  };
}

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
export async function POST(request: NextRequest): Promise<Response> {
  const creds = readCredentials();
  if (!creds.any) return Response.json(MISSING_KEY, { status: 503 });

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
  // rather than something a page refresh does on the analyst's behalf.
  await setCachedScanBatch(indicator, batch);
  return Response.json(batch);
}

/**
 * Resume a submitted batch: poll each scan that has not finished.
 *
 * A scan still running is reported as running, never as an error. The quota is
 * already spent and the provider is still working, so the only correct answer
 * is "not yet".
 */
export async function GET(request: NextRequest): Promise<Response> {
  const creds = readCredentials();
  if (!creds.any) return Response.json(MISSING_KEY, { status: 503 });

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
  if (scans.some((scan) => scan.status === "done")) {
    await setCachedScanBatch(read.indicator, updated);
  }
  return Response.json(updated);
}
