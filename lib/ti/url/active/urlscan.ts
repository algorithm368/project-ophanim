import { errorMessage, getJson, isTimeout, postJson } from "../../http";
import type { ActiveScan, ActiveVerdict, ScanVisibility } from "./types";
import { distillResult } from "./detail";
import { fetchCapability } from "./capability";

const SUBMIT_URL = "https://urlscan.io/api/v1/scan/";
const RESULT_URL = "https://urlscan.io/api/v1/result";

/**
 * Visibility order, tightest first. Probed on the configured account
 * 2026-08-15: private allows 50/day, unlisted 1000/day. Private is the default
 * because unlisted is unindexed but readable by anyone holding the link, while
 * private is visible only to this account. Public is never used: it is
 * searchable by anyone, including whoever sent the phish.
 */
const VISIBILITY_ORDER: ScanVisibility[] = ["private", "unlisted"];

interface SubmitResponse {
  uuid?: string;
  result?: string;
  message?: string;
  description?: string;
}

interface ResultResponse {
  verdicts?: {
    overall?: { malicious?: boolean; score?: number; categories?: string[] };
  };
  page?: { url?: string; ip?: string; asn?: string; server?: string };
  lists?: { domains?: string[] };
  task?: { screenshotURL?: string; domURL?: string };
}

/** Read a completed scan's payload. Absent blocks mean "not reported", which is
 *  not the same as malicious, so the default reading is not-malicious. */
export function verdictFromResult(data: ResultResponse): ActiveVerdict {
  const overall = data.verdicts?.overall;
  return {
    malicious: overall?.malicious === true,
    score: overall?.score,
    categories: overall?.categories,
    finalUrl: data.page?.url,
    contactedDomains: data.lists?.domains,
    screenshot: data.task?.screenshotURL,
    ip: data.page?.ip,
    asn: data.page?.asn,
    server: data.page?.server,
  };
}

/** Turn a submission response into a scan record. */
export function submissionOutcome(
  target: string,
  visibility: ScanVisibility,
  status: number,
  data: SubmitResponse | null,
): ActiveScan {
  if (status === 200 && data?.uuid) {
    return {
      target,
      engine: "urlscan",
      status: "running",
      uuid: data.uuid,
      visibility,
      resultUrl: data.result ?? `https://urlscan.io/result/${data.uuid}/`,
    };
  }
  const reason = data?.message ?? data?.description ?? `HTTP ${status}`;
  return { target, engine: "urlscan", status: "error", error: reason };
}

/**
 * Fold a poll response into the scan.
 *
 * A 404 means the scan has not finished yet. urlscan serves the result only
 * once it exists, so "not found" here is the normal pending state, and it must
 * stay `running`: the quota is already spent, and reporting an error would
 * invite the analyst to submit the same page a second time. Any other failure
 * also keeps the uuid, so polling can resume rather than restart.
 */
export function pollOutcome(
  scan: ActiveScan,
  status: number,
  data: ResultResponse | null,
): ActiveScan {
  if (status === 200 && data) {
    return {
      ...scan,
      status: "done",
      verdict: verdictFromResult(data),
      detail: distillResult(data),
    };
  }
  if (status === 404) return { ...scan, status: "running" };
  return { ...scan, status: "running", error: `HTTP ${status}` };
}

/** Submit one URL, falling back to the next visibility when a quota is spent.
 *  Never throws: a failure becomes an errored scan record. */
export async function submitScan(
  target: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<ActiveScan> {
  let last: ActiveScan | null = null;
  for (const visibility of VISIBILITY_ORDER) {
    try {
      const { status, data } = await postJson<SubmitResponse>(
        SUBMIT_URL,
        signal,
        { url: target, visibility },
        { "API-Key": apiKey },
      );
      const scan = submissionOutcome(target, visibility, status, data);
      if (scan.status !== "error") return scan;
      last = scan;
      // Only a spent quota is worth retrying at a looser visibility. A refused
      // target would be refused again, and retrying would waste the next tier.
      if (status !== 429) return scan;
    } catch (err) {
      last = {
        target,
        engine: "urlscan",
        status: "error",
        error: isTimeout(err) ? "Submission timed out" : errorMessage(err),
      };
      return last;
    }
  }
  return last ?? { target, engine: "urlscan", status: "error", error: "Submission failed" };
}

/** Poll one submitted scan once. */
export async function pollScan(
  scan: ActiveScan,
  apiKey: string,
  signal: AbortSignal,
): Promise<ActiveScan> {
  if (!scan.uuid) return scan;
  try {
    const { status, data } = await getJson<ResultResponse>(
      `${RESULT_URL}/${scan.uuid}/`,
      signal,
      { "API-Key": apiKey },
    );
    const outcome = pollOutcome(scan, status, data);
    // Read the DOM once, at the moment the scan completes. It does not change
    // afterwards, and reading the scanner's copy touches the target zero times.
    const domUrl = data?.task?.domURL;
    if (outcome.status === "done" && domUrl) {
      return {
        ...outcome,
        capability: await fetchCapability(
          domUrl,
          outcome.verdict?.finalUrl ?? scan.target,
          { "API-Key": apiKey },
          signal,
        ),
      };
    }
    return outcome;
  } catch (err) {
    // Still running, with the uuid intact: a network hiccup while polling says
    // nothing about the scan itself.
    return { ...scan, status: "running", error: errorMessage(err) };
  }
}
