"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  FileDigit,
  Globe,
  Link2,
  Loader2,
  Network,
  RefreshCw,
  Search,
  SearchX,
  ServerCrash,
  ShieldQuestion,
  X,
} from "lucide-react";
import {
  type AnyCheckResult,
  isDomainResult,
  isHashResult,
  type CheckResult,
  type DomainCheckResult,
  type HashCheckResult,
  type SourceMeta,
  type SourceResult,
  sourceRowKey,
} from "@/lib/ti/types";
import { parseIP, type ParsedIP } from "@/lib/ip";
import { parseDomain } from "@/lib/domain";
import { parseHash } from "@/lib/hash";
import { detectIOC, refangIOC, extractIps, iocFromPath, type IOCType } from "@/lib/ioc";
import type { GeoRow } from "@/lib/ti/geo";
import { isUrlResult, type UrlCheckResult } from "@/lib/ti/url/types";
import { buildPartial } from "@/lib/ti/partial";
import { parseUrl } from "@/lib/url";
import { useResearchStream } from "@/components/CheckResults/use-research";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

type IconType = ComponentType<{ className?: string }>;

type Mode = "ip" | "domain" | "hash" | "url";

/** Human label + icon per IOC type, shared by the toggle and detection hint. */
const MODE_META: Record<Mode, { label: string; icon: IconType }> = {
  ip: { label: "IP address", icon: Network },
  domain: { label: "domain", icon: Globe },
  hash: { label: "file hash", icon: FileDigit },
  url: { label: "URL", icon: Link2 },
};

/** "input" = bad/unsupported value the user typed; "request" = lookup failed. */
type CheckError = { kind: "input" | "request"; message: string };

/** Live state of an in-flight check, driven by the NDJSON progress stream. */
type Progress = {
  total: number;
  metas: SourceMeta[];
  settled: Record<string, SourceResult>;
};

const IP_EXAMPLES = ["8.8.8.8", "1.1.1.1", "185.220.101.1"];

const DOMAIN_EXAMPLES = ["google.com", "cloudflare.com", "wikipedia.org"];

// The EICAR test file, in MD5 / SHA-1 / SHA-256 - a harmless sample that every
// feed recognizes, so it shows all three hash types resolving.
const HASH_EXAMPLES = [
  "44d88612fea8a8f36de82e1278abb02f",
  "3395856ce81f2b7382dee72602f798b642f14140",
  "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f",
];

// One example per IOC type, since detection picks the checker automatically.
const EXAMPLES = [IP_EXAMPLES[0], DOMAIN_EXAMPLES[0], HASH_EXAMPLES[0]];

// Quick-start chips shown under the search box: one clickable example per type.
const EXAMPLE_CHIPS: { value: string; label: string; icon: IconType }[] = [
  { value: IP_EXAMPLES[0], label: IP_EXAMPLES[0], icon: Network },
  { value: DOMAIN_EXAMPLES[0], label: DOMAIN_EXAMPLES[0], icon: Globe },
  { value: HASH_EXAMPLES[0], label: "eicar test hash", icon: FileDigit },
];

/** Validate input before hitting the network, returning a friendly error or null. */
function validateInput(value: string, mode: Mode): string | null {
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
  } else if (mode === "url") {
    if (!parseUrl(value)) {
      return `"${value}" isn't a checkable URL. Paste an http or https link.`;
    }
  } else if (!parseHash(value)) {
    return `"${value}" isn't a valid file hash. Paste an MD5, SHA-1, or SHA-256 digest.`;
  }
  return null;
}

/**
 * The exact value the lookup runs on: the refanged input reduced to its
 * canonical IOC — the parsed IP (RFC 5952 form for v6), the apex domain (so a
 * pasted URL becomes just its host), or the normalized hash. Falls back to the
 * input until a type is recognized. Used both for the "we'll check …" hint and
 * the permalink.
 */
function canonicalFor(value: string, detected: Mode | null): string {
  if (detected === "ip") return parseIP(value)?.ip ?? value;
  if (detected === "domain") return parseDomain(value)?.domain ?? value;
  if (detected === "hash") return parseHash(value)?.hash ?? value;
  if (detected === "url") return parseUrl(value)?.canonical ?? value;
  return value;
}

/**
 * What the live-research lane should ask about for a pending indicator. No
 * research provider declares support for a url kind, so a URL researches its
 * host as a domain, which is the pivot an analyst wants anyway: certificates,
 * archived snapshots, and prior scans of the site.
 */
function researchTargetFor(
  value: string,
): { indicator: string; kind: IOCType } | null {
  const kind = detectIOC(value);
  if (!kind) return null;
  if (kind === "url") {
    const host = parseUrl(value)?.host;
    return host ? { indicator: host, kind: "domain" } : null;
  }
  return { indicator: value, kind };
}

/** The indicator a result is about, whichever kind it is. */
function indicatorOf(result: AnyCheckResult | UrlCheckResult): string {
  if (isUrlResult(result)) return result.url;
  if (isHashResult(result)) return result.hash;
  if (isDomainResult(result)) return result.domain;
  return result.ip;
}

/**
 * What the live-research lane should ask about for a settled result.
 *
 * A URL researches its host as a domain: no provider supports a url kind, and
 * the host is the pivot an analyst wants anyway, certificates and archived
 * snapshots and prior scans of the site. Null when a URL will not parse, since
 * there is then no host to research.
 */
function researchTargetOf(
  result: AnyCheckResult | UrlCheckResult,
): { indicator: string; kind: IOCType } | null {
  if (isUrlResult(result)) {
    const host = parseUrl(result.url)?.host;
    return host ? { indicator: host, kind: "domain" } : null;
  }
  if (isHashResult(result)) return { indicator: result.hash, kind: "hash" };
  if (isDomainResult(result)) return { indicator: result.domain, kind: "domain" };
  return { indicator: result.ip, kind: "ip" };
}

/**
 * What the box has made of what is typed, in one line under it.
 *
 * Four states in the order they occur: nothing typed, a paste of many
 * addresses, a recognized indicator (with the canonical form when it differs
 * from the input), and something not recognized yet.
 */
function DetectionHint({
  trimmed,
  bulkCount,
  detected,
  canonical,
}: Readonly<{
  trimmed: string;
  bulkCount?: number;
  detected: Mode | null;
  canonical: string;
}>) {
  if (!trimmed) {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Search className="size-4" />
        Type or paste an indicator and we&apos;ll detect the type for you.
      </span>
    );
  }

  if (bulkCount) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5 text-primary">
        <Network className="size-4" />
        {bulkCount === 1
          ? "Detected an IPv6 address"
          : `Detected ${bulkCount} IP addresses`}
        <span className="text-muted-foreground">, bulk geolocation</span>
      </span>
    );
  }

  if (!detected) {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <ShieldQuestion className="size-4" />
        Not a recognized IOC yet. Paste an IP, domain, or file hash.
      </span>
    );
  }

  const DetectedIcon = MODE_META[detected].icon;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-primary">
      <DetectedIcon className="size-4" />
      Detected {detected === "ip" ? "an" : "a"} {MODE_META[detected].label}
      {canonical !== trimmed && (
        <span className="text-muted-foreground">
          (we&apos;ll check{" "}
          <span className="font-mono text-foreground">{canonical}</span>)
        </span>
      )}
    </span>
  );
}

/** No NDJSON line for this long means the stream stalled (server bounds each
 *  source at ~12s), so the inactivity watchdog aborts and we show what we have. */
const STREAM_INACTIVITY_MS = 20000;

/** abort() reason used when a history navigation cancels an in-flight lookup, so
 *  runCheck's catch can tell a deliberate Back/Forward from a real failure. */
const NAV_ABORT = "nav-abort";

const loadCheckResults = () => import("./CheckResults");
// SSR enabled so a cached permalink paints its verdict in the initial HTML;
// still code-split via dynamic() so the home page pays nothing for it.
const CheckResults = dynamic(loadCheckResults);
const loadBulkGeo = () => import("./BulkGeoResults");
const BulkGeoResults = dynamic(loadBulkGeo, { ssr: false });

/** The IPs a value would bulk-geolocate, or null if it isn't a bulk case. */
function bulkTargets(value: string): ParsedIP[] | null {
  const ips = extractIps(value);
  return ips.length >= 2 ? ips : null;
}

const ENDPOINTS: Record<Mode, string> = {
  ip: "/api/check",
  domain: "/api/check-domain",
  hash: "/api/check-hash",
  url: "/api/check-url",
};

/** One line of the NDJSON progress stream the route factory writes. */
type StreamEvent = {
  type: "start" | "source" | "done" | "error";
  total?: number;
  sources?: SourceMeta[];
  result?: (CheckResult & DomainCheckResult & HashCheckResult) | SourceResult;
  error?: string;
};

type Prepared =
  | { ok: true; detected: Mode; canonical: string; endpoint: string }
  | { ok: false; message: string };

/**
 * Everything that must hold before a lookup is worth starting.
 *
 * The type is detected from the value itself rather than from the active tab,
 * so the right checker runs regardless of which one is selected. In-scope but
 * uncheckable input (private IPs, reserved names) is caught here too, so the
 * user gets specific feedback immediately instead of a server round-trip.
 */
function prepareCheck(value: string): Prepared {
  const detected = detectIOC(value);
  if (!detected) {
    return {
      ok: false,
      message: `"${value}" doesn't look like an IPv4 address, domain, or file hash. Try one of the examples below.`,
    };
  }
  const invalid = validateInput(value, detected);
  if (invalid) return { ok: false, message: invalid };

  return {
    ok: true,
    detected,
    canonical: canonicalFor(value, detected),
    endpoint: ENDPOINTS[detected],
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
function inactivityWatchdog(ms: number, onStall: () => void) {
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
 *  when the body isn't the JSON error shape. */
async function requestErrorMessage(res: Response): Promise<string> {
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
type StreamHandlers = {
  chunk: () => void;
  start: (total: number, metas: SourceMeta[]) => void;
  source: (sr: SourceResult) => void;
};

/** Read the NDJSON body line by line. The whole result is shown at once when
 *  complete, so only `start` and `source` surface mid-stream. */
async function consumeCheckStream(
  body: ReadableStream<Uint8Array>,
  on: StreamHandlers,
): Promise<{ result: AnyCheckResult | null; error: string | null }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: AnyCheckResult | null = null;
  let error: string | null = null;

  while (true) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    on.chunk();
    buffer += decoder.decode(chunk, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines.filter((l) => l.trim())) {
      const evt = JSON.parse(line) as StreamEvent;
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
  }
  return { result, error };
}

type LookupOutcome =
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
async function streamLookup(
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

/**
 * The search box, in whichever size the page is showing.
 *
 * The compact form is the same control, shorter and stuck to the top: it takes
 * over once a result is on screen so the box stays in reach without pushing the
 * verdict off it. One component rather than two near-copies, which is what they
 * were, and what let them drift a class at a time.
 */
function SearchBox({
  compact,
  query,
  loading,
  canSubmit,
  inputRef,
  onQueryChange,
  onClear,
  onSubmit,
}: Readonly<{
  compact: boolean;
  query: string;
  loading: boolean;
  canSubmit: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onQueryChange: (value: string) => void;
  onClear: () => void;
  onSubmit: () => void;
}>) {
  const height = compact ? "h-10" : "h-11";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className={
        compact
          ? "sketch-shadow sticky top-2 z-30 flex items-center gap-2 rounded-lg border border-border bg-card p-2"
          : "flex flex-col gap-3 sm:flex-row"
      }
    >
      <div className="relative flex flex-1 items-center rounded-md border border-input bg-background transition-colors focus-within:border-foreground/50">
        <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          inputMode="text"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          aria-label="IOC to check"
          placeholder="IP, domain, or file hash"
          className={cn(
            height,
            "rounded-none border-0 bg-transparent pl-9 font-mono text-sm shadow-none placeholder:text-sm focus-visible:ring-0",
            query ? "pr-9" : "pr-3",
          )}
        />
        {query && (
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear input"
            className="absolute right-2 flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      <Button
        type="submit"
        aria-label="Check"
        disabled={!canSubmit}
        className={cn(
          height,
          compact ? "w-10" : "w-11",
          "shrink-0 rounded-md p-0",
        )}
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Search className="size-4" />
        )}
      </Button>
    </form>
  );
}

export default function Checker({
  initialQuery,
  initialResult,
}: Readonly<{
  initialQuery?: string;
  /** A server-fetched cached result for a permalink (/check/<ioc>). When present
   *  it is shown immediately on first paint, skipping the client lookup. */
  initialResult?: AnyCheckResult | null;
}>) {
  const [mode, setMode] = useState<Mode>(
    () => detectIOC(initialQuery ?? "") ?? "ip",
  );
  const [query, setQuery] = useState(initialQuery ?? "");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<CheckError | null>(null);
  const [result, setResult] = useState<
    AnyCheckResult | UrlCheckResult | null
  >(initialResult ?? null);
  const [bulkRows, setBulkRows] = useState<GeoRow[] | null>(null);
  const [bulkPending, setBulkPending] = useState(0);
  const [isBulk, setIsBulk] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Captures the mount-time runCheck so the init effect can fire it once without
  // listing the (re-created-each-render) function as a dependency.
  const runCheckRef = useRef(runCheck);
  const didInit = useRef(false);
  // Session-scoped client cache of completed results, keyed by the canonical IOC
  // that appears in /check/<ioc> (the decoded path segment). Lets Back/Forward
  // restore a prior result instantly with no network; seeded from initialResult
  // and written on every completed lookup.
  const resultsCache = useRef<
    Map<string, AnyCheckResult>
  >(new Map());
  // The in-flight lookup's AbortController, so a history navigation can cancel it.
  const abortRef = useRef<AbortController | null>(null);

  // On first mount: show a server-provided cached result as-is (no client
  // round-trip), auto-run the check for a permalinked IOC (/check/<ioc>), or
  // focus the empty input for a fresh search.
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    if (initialResult) {
      // Cached permalink: the result is already on screen. Seed the client cache
      // (initialQuery is the canonical IOC from the URL) so Back/Forward to this
      // indicator restores instantly, and warm the lazy chunk so it paints fast;
      // the user can still re-check via refresh.
      if (initialQuery) resultsCache.current.set(initialQuery, initialResult);
      void loadCheckResults();
    } else if (initialQuery && detectIOC(initialQuery)) {
      runCheckRef.current(initialQuery);
    } else {
      inputRef.current?.focus();
    }
  }, [initialQuery, initialResult]);

  // Lookups change the URL via pushState, so browser Back/Forward only swaps the
  // URL — the page never remounts. Re-sync the whole view to the URL on popstate:
  // restore the box, mode, and result from the in-memory cache (instant), re-fetch
  // on a miss, or clear to the empty state at "/". We also land the user at the
  // top: the browser's "auto" scroll restoration re-applies the old position one
  // frame after popstate (and Next resets the flag to "auto" on cross-route hops),
  // so we set "manual" and re-assert top on the next frame as a fallback.
  useEffect(() => {
    const prevRestoration =
      "scrollRestoration" in window.history
        ? window.history.scrollRestoration
        : undefined;
    if (prevRestoration !== undefined) {
      window.history.scrollRestoration = "manual";
    }

    /** Everything a lookup puts on screen, cleared. The empty state and a
     *  restored cache hit both need exactly this, and listing the setters twice
     *  is how one of them quietly grows a field the other forgets. */
    function clearLookupState() {
      setError(null);
      setLoading(false);
      setProgress(null);
      setBulkRows(null);
      setIsBulk(false);
    }

    /**
     * Put the view back in sync with the address bar.
     *
     * The path segment is canonicalized the same way runCheck does before it
     * builds the URL, so the cache key and re-fetch target match what a lookup
     * stored. A directly-visited non-canonical permalink (mixed-case domain,
     * "algo:"-prefixed hash) then normalizes via one push and hits the cache on
     * subsequent Back, instead of bouncing.
     */
    function restoreFromPath() {
      const ioc = iocFromPath(window.location.pathname);
      if (ioc === null) {
        // Back to the home page: clear to the empty state.
        setQuery("");
        setResult(null);
        clearLookupState();
        return;
      }

      const refanged = refangIOC(ioc);
      const detected = detectIOC(refanged);
      const canonical = canonicalFor(refanged, detected);
      setQuery(canonical);
      if (detected) setMode(detected);

      const cached = resultsCache.current.get(canonical);
      if (cached) {
        // Cache hit: restore instantly, no network.
        setResult(cached);
        clearLookupState();
      } else {
        // Cache miss (e.g. after a hard reload): re-fetch this indicator. The
        // pathname === url guard in runCheck means it won't push a duplicate
        // entry for an already-canonical URL we're on (a non-canonical one
        // normalizes with a single push).
        runCheckRef.current(canonical);
      }
    }

    function onPopState() {
      // Cancel any in-flight lookup so it can't error or clobber the restore.
      if (abortRef.current) {
        abortRef.current.abort(NAV_ABORT);
        abortRef.current = null;
      }
      restoreFromPath();
      window.scrollTo({ top: 0 });
      requestAnimationFrame(() => window.scrollTo({ top: 0 }));
    }

    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      if (prevRestoration !== undefined) {
        window.history.scrollRestoration = prevRestoration;
      }
    };
  }, []);

  // "/" focuses the search from anywhere, Esc clears it: quick keyboard access
  // for the analysts who live in this tool.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === "Escape" && el === inputRef.current) {
        setQuery("");
        setError((prev) => (prev?.kind === "input" ? null : prev));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const trimmed = query.trim();
  const detected = detectIOC(query);
  const bulkPreview = bulkTargets(refangIOC(query));
  // What we actually look up: the input refanged ("evil[.]com" -> "evil.com")
  // and reduced to its canonical IOC (a pasted URL becomes just its host), so
  // the hint shows the real target when it differs from what was typed.
  const canonical = canonicalFor(refangIOC(query), detected);

  // Live auto-detection: as the user types, switch the active checker to match
  // what they pasted. Detection only fires on a confident match, so partial
  // input leaves the current mode untouched.
  function onQueryChange(value: string) {
    setQuery(value);
    if (error?.kind === "input") setError(null);
    const detected = detectIOC(value);
    if (detected && detected !== mode) setMode(detected);
  }

  async function runBulk(value: string, ips: ParsedIP[]) {
    setLoading(true);
    setIsBulk(true);
    setBulkPending(ips.length);
    setBulkRows(null);
    setProgress(null);
    setError(null);
    setResult(null);
    void loadBulkGeo();

    try {
      const res = await fetch("/api/geo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ips: value }),
      });
      if (!res.ok) {
        setError({ kind: "request", message: await requestErrorMessage(res) });
        return;
      }
      const data = (await res.json()) as { results: GeoRow[] };
      setBulkRows(data.results);
    } catch {
      setError({
        kind: "request",
        message:
          "Couldn't reach the server. Check your connection and try again.",
      });
    } finally {
      setLoading(false);
    }
  }

  async function runCheck(target: string, opts?: { refresh?: boolean }) {
    // Refang first so defanged input ("evil[.]com", "hxxp://bad[.]site") still
    // resolves and the server receives a clean, checkable indicator.
    const value = refangIOC(target);
    if (!value || loading) return;

    const bulk = bulkTargets(value);
    if (bulk) {
      void runBulk(value, bulk);
      return;
    }

    const prep = prepareCheck(value);
    if (!prep.ok) {
      setError({ kind: "input", message: prep.message });
      setResult(null);
      return;
    }
    if (prep.detected !== mode) setMode(prep.detected);

    // Reflect the lookup in a shareable URL (/check/<ioc>) without a full
    // navigation, so a result can be linked into a ticket and reopened.
    const canonical = prep.canonical;
    const url = `/check/${encodeURIComponent(canonical)}`;
    if (window.location.pathname !== url) {
      window.history.pushState(null, "", url);
    }

    setLoading(true);
    // Track the canonical target (not the raw input) so the live-research key is
    // identical during the check and once the result renders — the stream that
    // starts now keeps feeding the card without a refetch on that transition.
    setPending(canonical);
    setProgress(null);
    setError(null);
    setResult(null);
    setBulkRows(null);
    setIsBulk(false);
    // Warm the lazy results chunk while the lookup runs so it renders instantly.
    void loadCheckResults();

    const controller = new AbortController();
    abortRef.current = controller;
    const watchdog = inactivityWatchdog(STREAM_INACTIVITY_MS, () =>
      controller.abort(),
    );

    try {
      const outcome = await streamLookup(
        prep.endpoint,
        { [prep.detected]: value, refresh: opts?.refresh === true },
        controller,
        {
          chunk: watchdog.bump,
          start: (total, metas) => setProgress({ total, metas, settled: {} }),
          // Keyed by sourceRowKey, not the bare id: a URL check's domain and
          // IP layers can register the same source id, and an id-keyed
          // record loses one of the two rows to the other (#48).
          source: (sr) =>
            setProgress((p) =>
              p
                ? { ...p, settled: { ...p.settled, [sourceRowKey(sr)]: sr } }
                : p,
            ),
        },
      );

      if (outcome.kind === "error") {
        setError({ kind: "request", message: outcome.message });
      } else if (outcome.kind === "result") {
        // Cache the completed result so Back/Forward to this indicator restores
        // instantly — `canonical` is the exact key the URL was built from.
        resultsCache.current.set(canonical, outcome.result);
        setResult(outcome.result);
      }
    } finally {
      watchdog.clear();
      // Only clear shared lookup state if a newer lookup hasn't taken over: a
      // navigation may have aborted this one and started another, which now owns
      // abortRef/loading/progress.
      if (abortRef.current === controller) {
        abortRef.current = null;
        setLoading(false);
        setProgress(null);
      }
    }
  }

  function refresh() {
    if (!result) return;
    runCheck(indicatorOf(result), { refresh: true });
  }

  // The indicator the live-research lane should fetch: the displayed result's
  // IOC, or — while a check is still running — the canonical value being looked
  // up (so research streams concurrently with the main TI fan-out, not after).
  // Bulk geo lookups have no single indicator, so the lane stays idle there.
  // A URL result researches its *host* as a domain: no research provider
  // supports a url kind, and the host is the pivot an analyst wants anyway
  // (certificates, archived snapshots, prior scans of the site).
  const settled = result ? researchTargetOf(result) : null;
  const inFlight =
    loading && !isBulk && pending ? researchTargetFor(pending) : null;
  const activeIndicator = settled?.indicator ?? inFlight?.indicator ?? null;
  const activeKind =
    settled?.kind ?? (pending ? (researchTargetFor(pending)?.kind ?? null) : null);
  const research = useResearchStream(activeIndicator, activeKind);

  // Follow a related indicator from a result: jump to the top and run a fresh
  // check.
  function pivot(value: string) {
    setQuery(value);
    window.scrollTo({ top: 0, behavior: "smooth" });
    runCheck(value);
  }

  // On a populated (or in-flight) single-IOC lookup, the full hero form collapses
  // to a one-line search bar so the verdict is the first thing on screen. The full
  // hero — heading, detection hint, TRY chips — stays on the landing/empty/error
  // states and on the bulk path.
  const showCompact = !isBulk && !bulkRows && Boolean(loading || result);

  // Recomputed only when the streamed progress or the finished result
  // actually changes, not on every render `Checker` happens to take (the ETA
  // ticker in pending.tsx among them). Built inline, this handed CheckResults
  // a fresh object identity every render, which defeated memoization on
  // every card beneath it regardless of what they individually did about it.
  const partial = useMemo(
    () =>
      result
        ? null
        : buildPartial(
            progress?.total ?? 0,
            Object.values(progress?.settled ?? {}),
            progress?.metas ?? [],
          ),
    [result, progress],
  );

  const searchBox = (
    <SearchBox
      compact={showCompact}
      query={query}
      loading={loading}
      canSubmit={
        !loading && Boolean(query.trim()) && Boolean(detected ?? bulkPreview)
      }
      inputRef={inputRef}
      onQueryChange={onQueryChange}
      onClear={() => {
        setQuery("");
        if (error?.kind === "input") setError(null);
        inputRef.current?.focus();
      }}
      onSubmit={() => runCheck(query)}
    />
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      {showCompact ? (
        searchBox
      ) : (
        <div className="sketch-shadow relative rounded-lg border border-border bg-card p-4 sm:p-5">
          <div className="mb-2 font-mono text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
            Indicator lookup
          </div>
          <h1 className="mb-4 text-2xl font-semibold tracking-tight sm:text-[1.7rem]">
            Check an IP, domain, or file&nbsp;hash
          </h1>

          {searchBox}

          <div className="mt-3 min-h-7 text-sm">
            <DetectionHint
              trimmed={trimmed}
              bulkCount={bulkPreview?.length}
              detected={detected}
              canonical={canonical}
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-foreground/10 pt-3">
            <span className="font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
              Try
            </span>
            {EXAMPLE_CHIPS.map(({ value, label, icon: ChipIcon }) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setQuery(value);
                  runCheck(value);
                }}
                className="group inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 font-mono text-xs text-foreground/80 transition-colors hover:border-foreground/40 hover:text-foreground"
              >
                <ChipIcon className="size-3.5 text-muted-foreground transition-colors group-hover:text-foreground" />
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <ErrorState
          error={error}
          examples={EXAMPLES}
          onRetry={() => runCheck(query)}
          onExample={(s) => {
            setQuery(s);
            runCheck(s);
          }}
        />
      )}

      {loading && isBulk && <BulkProgress count={bulkPending} />}

      {!loading && !error && !result && !bulkRows && (
        <EmptyState detected={detected} />
      )}

      {!loading && bulkRows && <BulkGeoResults rows={bulkRows} />}

      {/* One tree from the first frame to the last. The progress readout is
          not a card that gets discarded, it is the score's placeholder, so
          there is nothing to unmount when the lookup finishes.

          Gated on `loading`, not on `loading && progress`. A cache hit never
          sends a `start` event, only `done`, so waiting for `progress` left
          the fastest lookups, the ones served from Redis, as the only ones
          with nothing on screen at all: the hero collapsed to the compact
          search box and the page below it went blank until the result
          landed. `buildPartial` with no panel yet reports its denominators as
          unknown rather than as zero, which is what makes an empty partial
          safe to render. */}
      {!isBulk && (result || loading) && (
        <CheckResults
          result={result}
          partial={partial}
          indicator={pending || query}
          // `mode` is the type of the in-flight/displayed check itself.
          // `activeKind` is a different thing: it is what the *research*
          // lane should ask about, which is deliberately "domain" for a URL
          // (no research provider understands a url kind). Passing that here
          // made a streaming URL check render as a domain check until the
          // result landed and the type guards took over.
          kind={mode}
          onRefresh={refresh}
          onPivot={pivot}
          research={research}
        />
      )}
    </div>
  );
}

function BulkProgress({ count }: Readonly<{ count: number }>) {
  return (
    <Card className="sketch-shadow mt-8 overflow-hidden rounded-lg border border-border bg-card">
      <CardContent className="flex items-center gap-3 py-8">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <div className="text-xl font-semibold tracking-tight">
          Looking up {count} {count === 1 ? "address" : "addresses"}…
        </div>
      </CardContent>
    </Card>
  );
}

const HASH_EMPTY_COPY =
  "Paste a file hash (MD5, SHA-1, or SHA-256) above and we'll tell you what the file is, its name and type, any malware family it belongs to, and whether threat-intel sources have flagged it.";

// Before a type is recognized (the default on first load), the copy describes
// every IOC so the tool doesn't read as IP-only; once detection has picked a
// type, it says what that particular lookup will actually return.
//
// `url` reads the hash copy, which is what the if/else chain this replaced did
// (its last branch caught both) and is kept unchanged here rather than quietly
// corrected. A detected URL deserves its own sentence.
const EMPTY_STATE_COPY: Record<Mode | "none", string> = {
  none: "Paste an IP address, domain, or file hash above, we'll detect the type, then tell you what it is, where it lives, and whether any threat-intel source has flagged it, summarized into one risk score.",
  ip: "Enter an IPv4 address above and we'll tell you what kind of address it is, where it's located, and whether any threat-intel source has flagged it, summarized into one risk score.",
  domain:
    "Enter a domain above and we'll tell you when it was registered, where it resolves, and whether any threat-intel source has flagged it, summarized into one risk score.",
  hash: HASH_EMPTY_COPY,
  url: HASH_EMPTY_COPY,
};

function EmptyState({ detected }: Readonly<{ detected: Mode | null }>) {
  const copy = EMPTY_STATE_COPY[detected ?? "none"];

  const readout: [string, string][] = [
    ["IP", "geolocation · ASN owner · hosting type · feed reputation"],
    ["Domain", "registration age · DNS & mail · category · resolver checks"],
    ["Hash", "malware family · file metadata · per-engine detections"],
  ];

  return (
    <Card className="sketch-shadow mt-8 overflow-hidden border border-border bg-card">
      {/* console-style header strip */}
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2 font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
        <span className="size-1.5 rounded-full bg-muted-foreground/60" />
        <span>idle</span>
      </div>
      <CardContent className="space-y-4 py-6">
        <div className="flex items-center gap-2 font-mono text-sm">
          <span className="text-muted-foreground/50">&gt;</span>
          <span className="text-foreground/80">awaiting indicator</span>
          <span className="inline-block h-[1.05em] w-[7px] animate-pulse bg-foreground/40 align-middle" />
        </div>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {copy}
        </p>
        <dl className="space-y-1.5 border-t border-border pt-4 font-mono text-xs">
          {readout.map(([k, v]) => (
            <div key={k} className="flex gap-3 sm:gap-4">
              <dt className="w-16 shrink-0 font-semibold tracking-wider text-foreground/70 uppercase">
                {k}
              </dt>
              <dd className="text-muted-foreground">{v}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function ErrorState({
  error,
  examples,
  onRetry,
  onExample,
}: Readonly<{
  error: CheckError;
  examples: string[];
  onRetry: () => void;
  onExample: (value: string) => void;
}>) {
  const isInput = error.kind === "input";
  const Icon = isInput ? SearchX : ServerCrash;

  // A wrong indicator is a calm correction (neutral); a failed lookup is a real
  // system alert (destructive red). Color stays reserved for genuine signal.
  const accent = isInput
    ? {
        border: "border-border",
        badge: "border-border bg-muted text-foreground",
        text: "text-foreground",
        headline: "That doesn't look like a valid indicator",
      }
    : {
        border: "border-destructive/40",
        badge: "border-destructive/40 bg-destructive/10 text-destructive",
        text: "text-destructive",
        headline: "Couldn't run the check",
      };

  return (
    <Card
      className={cn(
        "sketch-shadow mt-8 overflow-hidden rounded-lg border bg-card",
        accent.border,
      )}
    >
      <CardContent className="flex items-start gap-4 py-8">
        <span
          className={cn(
            "flex size-12 shrink-0 items-center justify-center rounded-lg border",
            accent.badge,
          )}
        >
          <Icon className="size-6" />
        </span>

        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-1">
            <p
              className={cn(
                "text-xl font-bold leading-tight tracking-tight",
                accent.text,
              )}
            >
              {accent.headline}
            </p>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {error.message}
            </p>
          </div>

          {isInput ? (
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-sm text-muted-foreground">
                Try one of these:
              </span>
              {examples.map((s) => (
                <Button
                  key={s}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-md border font-mono"
                  onClick={() => onExample(s)}
                >
                  {s}
                </Button>
              ))}
            </div>
          ) : (
            <Button
              type="button"
              onClick={onRetry}
              className="rounded-lg px-6 font-semibold"
            >
              <RefreshCw className="size-4" />
              Try again
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
