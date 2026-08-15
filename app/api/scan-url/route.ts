import { type NextRequest } from "next/server";
import { detectIOC, type IOCType } from "@/lib/ioc";
import { getCachedScanBatch, setCachedScanBatch } from "@/lib/ti/cache";
import { scanTargetsFor } from "@/lib/ti/url/active/targets";
import { pollScan, submitScan } from "@/lib/ti/url/active/urlscan";
import { urlIndicatorProblem } from "@/lib/ti/url/validate";
import type { ActiveScanBatch } from "@/lib/ti/url/active/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Submission is fast (it only queues), polling is one round trip. Neither
 *  waits for the scan itself, which takes roughly 30 seconds on the provider. */
const REQUEST_TIMEOUT_MS = 20000;

const MISSING_KEY = {
  error:
    "Active scanning needs a urlscan.io API key. Set URLSCAN_API_KEY to enable it.",
  keyEnv: "URLSCAN_API_KEY",
};

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
  const apiKey = process.env.URLSCAN_API_KEY;
  if (!apiKey) return Response.json(MISSING_KEY, { status: 503 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return badRequest("Invalid JSON body");
  }

  const read = readIndicator(body.indicator);
  if (read instanceof Response) return read;
  const { indicator, kind } = read;

  if (body.force !== true) {
    const existing = await getCachedScanBatch(indicator);
    if (existing) return Response.json({ ...existing, reused: true });
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
  const scans = await Promise.all(
    targets.map((target) => submitScan(target, apiKey, signal)),
  );

  const batch: ActiveScanBatch = {
    indicator,
    submittedAt: new Date().toISOString(),
    scans,
  };
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
  const apiKey = process.env.URLSCAN_API_KEY;
  if (!apiKey) return Response.json(MISSING_KEY, { status: 503 });

  const raw = request.nextUrl.searchParams.get("indicator");
  const read = readIndicator(raw);
  if (read instanceof Response) return read;

  const batch = await getCachedScanBatch(read.indicator);
  if (!batch) return Response.json({ error: "No scan for this indicator" }, { status: 404 });

  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const scans = await Promise.all(
    batch.scans.map((scan) =>
      scan.status === "running" ? pollScan(scan, apiKey, signal) : scan,
    ),
  );

  const updated: ActiveScanBatch = { ...batch, scans };
  if (scans.some((scan) => scan.status === "done")) {
    await setCachedScanBatch(read.indicator, updated);
  }
  return Response.json(updated);
}
