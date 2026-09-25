/**
 * Everything the checker does that is not rendering: validating what was typed,
 * reducing it to the value a lookup actually runs on, and driving one streaming
 * request from fetch to outcome.
 *
 * None of it touches React, which is the point of the file. It was interleaved
 * with the components in one 1,175-line module, where the only way to find the
 * stream reader was to scroll past the search box.
 */
import { parseIP, type ParsedIP } from "@/lib/ip";
import { parseDomain } from "@/lib/domain";
import { parseHash } from "@/lib/hash";
import { detectIOC, extractIps, type IOCType, type LookupType } from "@/lib/ioc";
import { readNdjson } from "@/lib/ndjson";
import { ENDPOINTS } from "@/lib/ti/endpoints";
import { modeHref } from "@/lib/route-mode";
import {
  type AnyCheckResult,
  isDomainResult,
  isHashResult,
  type CheckResult,
  type DomainCheckResult,
  type HashCheckResult,
  type SourceMeta,
  type SourceResult,
} from "@/lib/ti/types";
import { parseUrl } from "@/lib/url";
import type { Mode } from "./types";

/** No NDJSON line for this long means the stream stalled (server bounds each
 *  source at ~12s), so the inactivity watchdog aborts and we show what we have. */
export const STREAM_INACTIVITY_MS = 20000;

/** abort() reason used when a history navigation cancels an in-flight lookup, so
 *  runCheck's catch can tell a deliberate Back/Forward from a real failure. */
export const NAV_ABORT = "nav-abort";

/** Validate input before hitting the network, returning a friendly error or null. */
export function validateInput(value: string, mode: LookupType): string | null {
  if (mode === "ip") {
    const parsed = parseIP(value);
    if (!parsed) {
      return `"${value}" isn't a valid IP address. Try something like 8.8.8.8.`;
    }
    if (parsed.isPrivate || parsed.isReserved) {
      return `${parsed.scopeNote}. This address can't be checked against threat-intel feeds.`;
    }
  } else if (mode === "domain") {
    const parsed = parseDomain(value);
    if (!parsed) {
      return `"${value}" isn't a valid domain. Try something like example.org.`;
    }
    if (parsed.isReserved) {
      return `${parsed.scopeNote}. This is a special-use name and can't be checked.`;
    }
  } else if (!parseHash(value)) {
    return `"${value}" isn't a valid file hash. Paste an MD5, SHA-1, or SHA-256 digest.`;
  }
  return null;
}

/**
 * The exact value the lookup runs on: the refanged input reduced to its
 * canonical IOC — the parsed IP (RFC 5952 form for v6), the apex domain, the
 * normalized hash, or the canonical URL a scan page is keyed by. Falls back to
 * the input until a type is recognized. Used both for the "we'll check …" hint
 * and the permalink.
 */
export function canonicalFor(value: string, detected: Mode | null): string {
  if (detected === "ip") return parseIP(value)?.ip ?? value;
  if (detected === "domain") return parseDomain(value)?.domain ?? value;
  if (detected === "hash") return parseHash(value)?.hash ?? value;
  if (detected === "url") return parseUrl(value)?.canonical ?? value;
  return value;
}

/** What the live-research lane should ask about for a pending indicator. */
export function researchTargetFor(
  value: string,
): { indicator: string; kind: IOCType } | null {
  const kind = detectIOC(value);
  if (!kind || kind === "url") return null;
  return { indicator: value, kind };
}

/** The indicator a result is about, whichever kind it is. */
export function indicatorOf(result: AnyCheckResult): string {
  if (isHashResult(result)) return result.hash;
  if (isDomainResult(result)) return result.domain;
  return result.ip;
}

/** What the live-research lane should ask about for a settled result. */
export function researchTargetOf(result: AnyCheckResult): {
  indicator: string;
  kind: IOCType;
} {
  if (isHashResult(result)) return { indicator: result.hash, kind: "hash" };
  if (isDomainResult(result))
    return { indicator: result.domain, kind: "domain" };
  return { indicator: result.ip, kind: "ip" };
}

/** The IPs a value would bulk-geolocate, or null if it isn't a bulk case. */
export function bulkTargets(value: string): ParsedIP[] | null {
  const ips = extractIps(value);
  return ips.length >= 2 ? ips : null;
}

/** One line of the NDJSON progress stream the route factory writes. */
type StreamEvent = {
  type: "start" | "source" | "done" | "error";
  total?: number;
  sources?: SourceMeta[];
  result?: (CheckResult & DomainCheckResult & HashCheckResult) | SourceResult;
  error?: string;
};

export type Prepared =
  | { kind: "lookup"; detected: LookupType; canonical: string; endpoint: string }
  | { kind: "scan"; href: string }
  | { kind: "invalid"; message: string };

/**
 * Everything that must hold before a lookup is worth starting.
 *
 * The type is detected from the value itself rather than from the active tab,
 * so the right checker runs regardless of which one is selected. In-scope but
 * uncheckable input (private IPs, reserved names) is caught here too, so the
 * user gets specific feedback immediately instead of a server round-trip.
 *
 * A URL is not looked up here at all. It goes to its scan page, which is the
 * only reading of a URL the app has; the host's reputation is one pivot away
 * from there.
 */
export function prepareCheck(value: string): Prepared {
  const detected = detectIOC(value);
  if (!detected) {
    return {
      kind: "invalid",
      message: `"${value}" doesn't look like an IPv4 address, domain, or file hash. Try one of the examples below.`,
    };
  }
  if (detected === "url") {
    return { kind: "scan", href: modeHref("active", canonicalFor(value, detected)) };
  }
  const invalid = validateInput(value, detected);
  if (invalid) return { kind: "invalid", message: invalid };

  return {
    kind: "lookup",
    detected,
    canonical: canonicalFor(value, detected),
    endpoint: ENDPOINTS[detected].path,
  };
}

/**
 * An inactivity watchdog.
 *
 * `bump` restarts the clock, so the stall fires only when nothing has arrived
 * for `ms`. The server streams a source every few seconds and bounds each at
 * ~12s, so a long gap means the stream genuinely stopped rather than that a
 * slow source is still working.
 */
export function inactivityWatchdog(ms: number, onStall: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    bump() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(onStall, ms);
    },
    clear() {
      if (timer) clearTimeout(timer);
    },
  };
}

/** The server's own message for a failed request, falling back to the status
 *  when the body isn't the JSON error shape. Also used by the bulk-geolocation
 *  path, which posts plain JSON rather than NDJSON. */
export async function requestErrorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    if (data?.error) return data.error;
  } catch {
    /* fall through to the generic message */
  }
  return `The lookup failed (HTTP ${res.status}). Please try again.`;
}

/** What to tell the user when the lookup threw, or null when a history
 *  navigation aborted it: the popstate handler owns the next state, so an
 *  error there would be a complaint about a lookup the user replaced. */
function abortMessage(signal: AbortSignal): string | null {
  if (signal.reason === NAV_ABORT) return null;
  return signal.aborted
    ? "This check is taking longer than expected. Please try again."
    : "Couldn't reach the server. Check your connection and try again.";
}

/** Callbacks the stream drives as it arrives: one per network chunk, and one
 *  per progress event worth showing before the result is complete. */
export type StreamHandlers = {
  chunk: () => void;
  start: (total: number, metas: SourceMeta[]) => void;
  source: (sr: SourceResult) => void;
};

/** Turn the progress stream into handler calls. The whole result is shown at
 *  once when complete, so only `start` and `source` surface mid-stream. */
async function consumeCheckStream(
  body: ReadableStream<Uint8Array>,
  on: StreamHandlers,
): Promise<{ result: AnyCheckResult | null; error: string | null }> {
  let result: AnyCheckResult | null = null;
  let error: string | null = null;

  for await (const evt of readNdjson<StreamEvent>(body, on.chunk)) {
    switch (evt.type) {
      case "start":
        on.start(evt.total ?? evt.sources?.length ?? 0, evt.sources ?? []);
        break;
      case "source":
        on.source(evt.result as SourceResult);
        break;
      case "done":
        result = evt.result as AnyCheckResult;
        break;
      case "error":
        error = evt.error ?? "The lookup failed. Please try again.";
        break;
    }
  }
  return { result, error };
}

export type LookupOutcome =
  | { kind: "result"; result: AnyCheckResult }
  | { kind: "error"; message: string }
  | { kind: "aborted" };

/**
 * One streaming lookup, from request to outcome.
 *
 * The NDJSON stream is the normal path; a validation or transport failure comes
 * back as a plain JSON body instead, so both shapes are handled here and the
 * caller sees exactly one of three outcomes. "aborted" is its own outcome
 * rather than an error because a navigation that cancels a lookup is not a
 * failure to report.
 */
export async function streamLookup(
  endpoint: string,
  body: unknown,
  controller: AbortController,
  on: StreamHandlers,
): Promise<LookupOutcome> {
  try {
    on.chunk();
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/x-ndjson",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      return { kind: "error", message: await requestErrorMessage(res) };
    }

    const { result, error } = await consumeCheckStream(res.body, on);
    if (error) return { kind: "error", message: error };
    if (result) return { kind: "result", result };
    return {
      kind: "error",
      message: "The server returned an unexpected response. Please try again.",
    };
  } catch {
    const message = abortMessage(controller.signal);
    return message ? { kind: "error", message } : { kind: "aborted" };
  }
}
