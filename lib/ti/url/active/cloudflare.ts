import { errorMessage, getJson, isTimeout, postJson } from "../../http";
import { distillCloudflareResult } from "./cloudflare-detail";
import { fetchCapability } from "./capability";
import type { ActiveScan, ActiveVerdict, ScanVisibility } from "./types";

const BASE = "https://api.cloudflare.com/client/v4/accounts";

/** Cloudflare exposes no private tier, so an unlisted scan is the tightest it
 *  offers. Public is never used. */
const CF_VISIBILITY: ScanVisibility = "unlisted";

type Json = Record<string, unknown>;

function obj(value: unknown): Json {
  return value && typeof value === "object" ? (value as Json) : {};
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Cloudflare reports failures in the standard `errors` array; prefer its
 *  wording over a bare status code. */
function cfError(data: unknown, status: number): string {
  const errors = obj(data).errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const message = str(obj(errors[0]).message);
    if (message) return message;
  }
  return `HTTP ${status}`;
}

/**
 * Read a submission response.
 *
 * The success body is **flat**, verified against the live API 2026-08-15:
 * `{uuid, api, visibility, url, result, message}`. Note `result` is the
 * human-facing report URL as a *string*, not a nested object, so the uuid is
 * read from the top level. A wrapped `{success, result: {uuid}}` reading finds
 * nothing here, which is why this was probed rather than assumed.
 */
export function cfSubmissionOutcome(
  target: string,
  visibility: ScanVisibility,
  status: number,
  data: unknown,
): ActiveScan {
  const body = obj(data);
  const uuid = str(body.uuid);
  if (status === 200 && uuid) {
    return {
      target,
      engine: "cloudflare",
      status: "running",
      uuid,
      visibility: (str(body.visibility) as ScanVisibility) ?? visibility,
      resultUrl: str(body.result) ?? `https://radar.cloudflare.com/scan/${uuid}`,
    };
  }
  return {
    target,
    engine: "cloudflare",
    status: "error",
    error: cfError(data, status),
  };
}

function cfVerdict(data: Json): ActiveVerdict {
  const page = obj(data.page);
  const overall = obj(obj(data.verdicts).overall);
  const lists = obj(data.lists);
  return {
    malicious: overall.malicious === true,
    categories: Array.isArray(overall.categories)
      ? (overall.categories as string[])
      : undefined,
    finalUrl: str(page.url),
    contactedDomains: Array.isArray(lists.domains)
      ? (lists.domains as string[])
      : undefined,
    // Cloudflare's screenshot is an authenticated API endpoint, not a public
    // file, so it is deliberately not carried as an <img> source here.
    ip: str(page.ip),
    asn: str(page.asn),
    server: str(page.server),
  };
}

/**
 * Fold a poll response into the scan.
 *
 * Cloudflare reports progress through `task.status` rather than by withholding
 * the document, so "the task exists but is not finished" is a distinct case
 * from urlscan's 404. Both mean the same thing to us: still running.
 */
export function cfPollOutcome(
  scan: ActiveScan,
  status: number,
  data: unknown,
): ActiveScan {
  if (status === 200) {
    const task = obj(obj(data).task);
    if (str(task.status) === "finished") {
      return {
        ...scan,
        status: "done",
        verdict: cfVerdict(obj(data)),
        detail: distillCloudflareResult(data),
      };
    }
    return { ...scan, status: "running" };
  }
  if (status === 404 || status === 202) return { ...scan, status: "running" };
  return { ...scan, status: "running", error: `HTTP ${status}` };
}

export async function submitCloudflareScan(
  target: string,
  token: string,
  accountId: string,
  signal: AbortSignal,
): Promise<ActiveScan> {
  try {
    const { status, data } = await postJson<unknown>(
      `${BASE}/${accountId}/urlscanner/v2/scan`,
      signal,
      { url: target, visibility: CF_VISIBILITY },
      { Authorization: `Bearer ${token}` },
    );
    return cfSubmissionOutcome(target, CF_VISIBILITY, status, data);
  } catch (err) {
    return {
      target,
      engine: "cloudflare",
      status: "error",
      error: isTimeout(err) ? "Submission timed out" : errorMessage(err),
    };
  }
}

export async function pollCloudflareScan(
  scan: ActiveScan,
  token: string,
  accountId: string,
  signal: AbortSignal,
): Promise<ActiveScan> {
  if (!scan.uuid) return scan;
  try {
    const { status, data } = await getJson<unknown>(
      `${BASE}/${accountId}/urlscanner/v2/result/${scan.uuid}`,
      signal,
      { Authorization: `Bearer ${token}` },
    );
    const outcome = cfPollOutcome(scan, status, data);
    // Cloudflare's domURL is an authenticated API endpoint, so it is read here
    // with the token rather than handed to the browser.
    const domUrl = str(obj(obj(data).task).domURL);
    if (outcome.status === "done" && domUrl) {
      return {
        ...outcome,
        capability: await fetchCapability(
          domUrl,
          outcome.verdict?.finalUrl ?? scan.target,
          { Authorization: `Bearer ${token}` },
          signal,
        ),
      };
    }
    return outcome;
  } catch (err) {
    return { ...scan, status: "running", error: errorMessage(err) };
  }
}
