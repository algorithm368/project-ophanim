"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  CircleX,
  Clock,
  FileDigit,
  Gauge,
  Globe,
  Loader2,
  Network,
  RefreshCw,
  Search,
  SearchX,
  ServerCrash,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  isDomainResult,
  isHashResult,
  type CheckResult,
  type DomainCheckResult,
  type HashCheckResult,
  type SourceMeta,
  type SourceResult,
} from "@/lib/ti/types";
import { parseIPv4, type ParsedIP } from "@/lib/ip";
import { parseDomain } from "@/lib/domain";
import { parseHash } from "@/lib/hash";
import { detectIOC, refangIOC, extractIps, iocFromPath } from "@/lib/ioc";
import type { GeoRow } from "@/lib/ti/geo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

type IconType = ComponentType<{ className?: string }>;

type Mode = "ip" | "domain" | "hash";

/** Human label + icon per IOC type, shared by the toggle and detection hint. */
const MODE_META: Record<Mode, { label: string; icon: IconType }> = {
  ip: { label: "IP address", icon: Network },
  domain: { label: "domain", icon: Globe },
  hash: { label: "file hash", icon: FileDigit },
};

/** "input" = bad/unsupported value the user typed; "request" = lookup failed. */
type CheckError = { kind: "input" | "request"; message: string };

/** Live state of an in-flight check, driven by the NDJSON progress stream. */
type Progress = {
  total: number;
  metas: SourceMeta[];
  settled: Record<string, SourceResult>;
};

/** How to render a source row in the live progress list. */
function progressStatus(result?: SourceResult): {
  icon: IconType;
  cls: string;
  label: string;
  spin?: boolean;
} {
  if (!result) {
    return {
      icon: Loader2,
      cls: "text-muted-foreground/50",
      label: "checking…",
      spin: true,
    };
  }
  const score = result.score ?? 0;
  const flagged =
    result.status === "ok" && (result.malicious === true || score >= 40);
  if (flagged) {
    return {
      icon: TriangleAlert,
      cls: "text-red-600 dark:text-red-400",
      label: "flagged",
    };
  }
  if (result.status === "ok" && score > 0) {
    return {
      icon: ShieldAlert,
      cls: "text-amber-600 dark:text-amber-400",
      label: "low risk",
    };
  }
  switch (result.status) {
    case "ok":
      return {
        icon: ShieldCheck,
        cls: "text-emerald-600 dark:text-emerald-400",
        label: "clean",
      };
    case "error":
    case "timeout":
      return {
        icon: CircleX,
        cls: "text-orange-500",
        label: result.status === "timeout" ? "timeout" : "no response",
      };
    case "rate_limited":
      return {
        icon: Gauge,
        cls: "text-amber-600 dark:text-amber-400",
        label: "rate limited",
      };
    default:
      return {
        icon: ShieldQuestion,
        cls: "text-muted-foreground/50",
        label: result.enabled ? "n/a" : "no key",
      };
  }
}

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
    const parsed = parseIPv4(value);
    if (!parsed) {
      return `"${value}" isn't a valid IPv4 address. Try something like 8.8.8.8.`;
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
  } else {
    if (!parseHash(value)) {
      return `"${value}" isn't a valid file hash. Paste an MD5, SHA-1, or SHA-256 digest.`;
    }
  }
  return null;
}

/**
 * The exact value the lookup runs on: the refanged input reduced to its
 * canonical IOC — the parsed IPv4, the apex domain (so a pasted URL becomes
 * just its host), or the normalized hash. Falls back to the input until a type
 * is recognized. Used both for the "we'll check …" hint and the permalink.
 */
function canonicalFor(value: string, detected: Mode | null): string {
  if (detected === "ip") return parseIPv4(value)?.ip ?? value;
  if (detected === "domain") return parseDomain(value)?.domain ?? value;
  if (detected === "hash") return parseHash(value)?.hash ?? value;
  return value;
}

/** No NDJSON line for this long means the stream stalled (server bounds each
 *  source at ~12s), so the inactivity watchdog aborts and we show what we have. */
const STREAM_INACTIVITY_MS = 20000;

/** A still-pending source past this many seconds is flagged "slow…" so the wait
 *  reads as a known laggard about to time out, not a frozen UI. */
const SLOW_THRESHOLD_S = 5;

/** abort() reason used when a history navigation cancels an in-flight lookup, so
 *  runCheck's catch can tell a deliberate Back/Forward from a real failure. */
const NAV_ABORT = "nav-abort";

const loadCheckResults = () => import("./CheckResults");
const CheckResults = dynamic(loadCheckResults, { ssr: false });
const loadBulkGeo = () => import("./BulkGeoResults");
const BulkGeoResults = dynamic(loadBulkGeo, { ssr: false });

/**
 * The IPs a value would bulk-geolocate, or null if it isn't a bulk case.
 * Bulk applies to 2+ routable IPs, or a single IPv6 (the full TI pipeline is
 * IPv4-only, so a lone v6 goes to the geo table instead).
 */
function bulkTargets(value: string): ParsedIP[] | null {
  const ips = extractIps(value);
  if (ips.length >= 2) return ips;
  if (ips.length === 1 && ips[0].version === 6) return ips;
  return null;
}

export default function Checker({
  initialQuery,
  initialResult,
}: {
  initialQuery?: string;
  /** A server-fetched cached result for a permalink (/check/<ioc>). When present
   *  it is shown immediately on first paint, skipping the client lookup. */
  initialResult?: CheckResult | DomainCheckResult | HashCheckResult | null;
}) {
  const [mode, setMode] = useState<Mode>(
    () => detectIOC(initialQuery ?? "") ?? "ip",
  );
  const [query, setQuery] = useState(initialQuery ?? "");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<CheckError | null>(null);
  const [result, setResult] = useState<
    CheckResult | DomainCheckResult | HashCheckResult | null
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
    Map<string, CheckResult | DomainCheckResult | HashCheckResult>
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

    function onPopState() {
      // Cancel any in-flight lookup so it can't error or clobber the restore.
      if (abortRef.current) {
        abortRef.current.abort(NAV_ABORT);
        abortRef.current = null;
      }

      const ioc = iocFromPath(window.location.pathname);
      if (ioc === null) {
        // Back to the home page: clear to the empty state.
        setQuery("");
        setResult(null);
        setError(null);
        setLoading(false);
        setProgress(null);
        setBulkRows(null);
        setIsBulk(false);
      } else {
        // Canonicalize the path segment the same way runCheck does before it
        // builds the URL, so the cache key and re-fetch target match what a
        // lookup stored. A directly-visited non-canonical permalink (mixed-case
        // domain, "algo:"-prefixed hash) then normalizes via one push and hits
        // the cache on subsequent Back, instead of bouncing.
        const refanged = refangIOC(ioc);
        const detected = detectIOC(refanged);
        const canonical = canonicalFor(refanged, detected);
        setQuery(canonical);
        if (detected) setMode(detected);
        const cached = resultsCache.current.get(canonical);
        if (cached) {
          // Cache hit: restore instantly, no network.
          setResult(cached);
          setError(null);
          setLoading(false);
          setProgress(null);
          setBulkRows(null);
          setIsBulk(false);
        } else {
          // Cache miss (e.g. after a hard reload): re-fetch this indicator. The
          // pathname === url guard in runCheck means it won't push a duplicate
          // entry for an already-canonical URL we're on (a non-canonical one
          // normalizes with a single push).
          runCheckRef.current(canonical);
        }
      }

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
  const DetectedIcon = detected ? MODE_META[detected].icon : ShieldQuestion;

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
        let message = `The lookup failed (HTTP ${res.status}). Please try again.`;
        try {
          const data = (await res.json()) as { error?: string };
          if (data?.error) message = data.error;
        } catch {
          /* keep default */
        }
        setError({ kind: "request", message });
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

    // Auto-detect the IOC type from the value itself so the right checker runs
    // regardless of which tab is active.
    const detected = detectIOC(value);
    if (!detected) {
      setError({
        kind: "input",
        message: `"${value}" doesn't look like an IPv4 address, domain, or file hash. Try one of the examples below.`,
      });
      setResult(null);
      return;
    }
    if (detected !== mode) setMode(detected);

    // Catch in-scope-but-uncheckable input (private IPs, reserved names, etc.)
    // so the user gets immediate, specific feedback.
    const invalid = validateInput(value, detected);
    if (invalid) {
      setError({ kind: "input", message: invalid });
      setResult(null);
      return;
    }

    // Reflect the lookup in a shareable URL (/check/<ioc>) without a full
    // navigation, so a result can be linked into a ticket and reopened.
    const canonical = canonicalFor(value, detected);
    const url = `/check/${encodeURIComponent(canonical)}`;
    if (window.location.pathname !== url) {
      window.history.pushState(null, "", url);
    }

    setLoading(true);
    setPending(value);
    setProgress(null);
    setError(null);
    setResult(null);
    setBulkRows(null);
    setIsBulk(false);
    // Warm the lazy results chunk while the lookup runs so it renders instantly.
    void loadCheckResults();

    const endpoint =
      detected === "ip"
        ? "/api/check"
        : detected === "domain"
          ? "/api/check-domain"
          : "/api/check-hash";
    const refreshFlag = opts?.refresh === true;
    const body =
      detected === "ip"
        ? { ip: value, refresh: refreshFlag }
        : detected === "domain"
          ? { domain: value, refresh: refreshFlag }
          : { hash: value, refresh: refreshFlag };

    // Inactivity watchdog: the server streams a source every few seconds and
    // bounds each at ~12s, so a long gap means the stream genuinely stalled.
    // The whole result is shown at once when complete — no partial reveal.
    const controller = new AbortController();
    abortRef.current = controller;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const bump = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => controller.abort(), STREAM_INACTIVITY_MS);
    };

    try {
      bump();
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      // Validation/transport errors come back as a plain JSON body.
      if (!res.ok || !res.body) {
        let message = `The lookup failed (HTTP ${res.status}). Please try again.`;
        try {
          const data = (await res.json()) as { error?: string };
          if (data?.error) message = data.error;
        } catch {
          /* keep default */
        }
        setError({ kind: "request", message });
        return;
      }

      // Otherwise read the NDJSON progress stream line by line.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalResult:
        | (CheckResult | DomainCheckResult | HashCheckResult)
        | null = null;
      let streamError: string | null = null;

      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        bump();
        buffer += decoder.decode(chunk, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const evt = JSON.parse(line) as {
            type: "start" | "source" | "done" | "error";
            total?: number;
            sources?: SourceMeta[];
            result?:
              | (CheckResult & DomainCheckResult & HashCheckResult)
              | SourceResult;
            error?: string;
          };

          if (evt.type === "start") {
            setProgress({
              total: evt.total ?? evt.sources?.length ?? 0,
              metas: evt.sources ?? [],
              settled: {},
            });
          } else if (evt.type === "source") {
            const sr = evt.result as SourceResult;
            setProgress((p) =>
              p ? { ...p, settled: { ...p.settled, [sr.source.id]: sr } } : p,
            );
          } else if (evt.type === "done") {
            finalResult = evt.result as
              | CheckResult
              | DomainCheckResult
              | HashCheckResult;
          } else if (evt.type === "error") {
            streamError = evt.error ?? "The lookup failed. Please try again.";
          }
        }
      }

      if (streamError) {
        setError({ kind: "request", message: streamError });
      } else if (finalResult) {
        // Cache the completed result so Back/Forward to this indicator restores
        // instantly — `canonical` is the exact key the URL was built from.
        resultsCache.current.set(canonical, finalResult);
        setResult(finalResult);
      } else {
        setError({
          kind: "request",
          message:
            "The server returned an unexpected response. Please try again.",
        });
      }
    } catch {
      // A history navigation aborted this lookup (signal.reason === NAV_ABORT):
      // the popstate handler owns the next state, so don't surface an error.
      // Otherwise it's a network drop or the watchdog firing on a stalled stream.
      if (controller.signal.reason !== NAV_ABORT) {
        setError({
          kind: "request",
          message: controller.signal.aborted
            ? "This check is taking longer than expected. Please try again."
            : "Couldn't reach the server. Check your connection and try again.",
        });
      }
    } finally {
      if (watchdog) clearTimeout(watchdog);
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
    const indicator = isHashResult(result)
      ? result.hash
      : isDomainResult(result)
        ? result.domain
        : result.ip;
    runCheck(indicator, { refresh: true });
  }

  // Follow a related indicator from a result: jump to the top and run a fresh
  // check.
  function pivot(value: string) {
    setQuery(value);
    window.scrollTo({ top: 0, behavior: "smooth" });
    runCheck(value);
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="sketch-shadow relative rounded-lg border border-border bg-card p-4 sm:p-5">
        <div className="mb-2 font-mono text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
          Indicator lookup
        </div>
        <h1 className="mb-4 text-2xl font-semibold tracking-tight sm:text-[1.7rem]">
          Check an IP, domain, or file&nbsp;hash
        </h1>

        {/* Plain and minimal: a flat input box and the Check button as separate
            elements, with a little space between them. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            runCheck(query);
          }}
          className="flex flex-col gap-3 sm:flex-row"
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
                "h-11 rounded-none border-0 bg-transparent pl-9 font-mono text-sm shadow-none placeholder:text-sm focus-visible:ring-0",
                query ? "pr-9" : "pr-3",
              )}
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  if (error?.kind === "input") setError(null);
                  inputRef.current?.focus();
                }}
                aria-label="Clear input"
                className="absolute right-2 flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          <Button
            type="submit"
            disabled={loading || !query.trim() || (!detected && !bulkPreview)}
            className="h-11 min-w-[7rem] shrink-0 rounded-md px-5 text-sm font-medium"
          >
            {loading ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Checking…
              </>
            ) : (
              "Check"
            )}
          </Button>
        </form>

        <div className="mt-3 min-h-7 text-sm">
          {!trimmed ? (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Search className="size-4" />
              Type or paste an indicator and we&apos;ll detect the type for you.
            </span>
          ) : bulkPreview ? (
            <span className="inline-flex flex-wrap items-center gap-1.5 text-primary">
              <Network className="size-4" />
              {bulkPreview.length === 1
                ? "Detected an IPv6 address"
                : `Detected ${bulkPreview.length} IP addresses`}
              <span className="text-muted-foreground">, bulk geolocation</span>
            </span>
          ) : detected ? (
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
          ) : (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <ShieldQuestion className="size-4" />
              Not a recognized IOC yet. Paste an IP, domain, or file hash.
            </span>
          )}
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

      {loading && !isBulk && (
        <SearchProgress progress={progress} indicator={pending} mode={mode} />
      )}

      {!loading && !error && !result && !bulkRows && (
        <EmptyState detected={detected} />
      )}

      {!loading && bulkRows && <BulkGeoResults rows={bulkRows} />}

      {!loading && result && (
        <CheckResults result={result} onRefresh={refresh} onPivot={pivot} />
      )}
    </div>
  );
}

function BulkProgress({ count }: { count: number }) {
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

function EmptyState({ detected }: { detected: Mode | null }) {
  // Before a type is recognized (the default on first load), describe all three
  // IOCs so the tool doesn't read as IP-only; once detection has picked a type,
  // tailor the copy to what that lookup will actually return.
  const copy = !detected
    ? "Paste an IP address, domain, or file hash above, we'll detect the type, then tell you what it is, where it lives, and whether any threat-intel source has flagged it, summarized into one risk score."
    : detected === "ip"
      ? "Enter an IPv4 address above and we'll tell you what kind of address it is, where it's located, and whether any threat-intel source has flagged it, summarized into one risk score."
      : detected === "domain"
        ? "Enter a domain above and we'll tell you when it was registered, where it resolves, and whether any threat-intel source has flagged it, summarized into one risk score."
        : "Paste a file hash (MD5, SHA-1, or SHA-256) above and we'll tell you what the file is, its name and type, any malware family it belongs to, and whether threat-intel sources have flagged it.";

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
        idle
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
}: {
  error: CheckError;
  examples: string[];
  onRetry: () => void;
  onExample: (value: string) => void;
}) {
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

/** Whole-second stopwatch label: "8s", or "1:07" once past a minute. */
function fmtElapsed(seconds: number): string {
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function SearchProgress({
  progress,
  indicator,
  mode,
}: {
  progress: Progress | null;
  indicator: string;
  mode: Mode;
}) {
  const noun =
    mode === "ip" ? "address" : mode === "domain" ? "domain" : "file";
  const total = progress?.total ?? 0;
  const done = progress ? Object.keys(progress.settled).length : 0;
  const metas = progress?.metas ?? [];
  // The most recently settled source, for the "currently doing" caption.
  const lastSettled = progress
    ? Object.values(progress.settled).sort(
        (a, b) => b.durationMs - a.durationMs,
      )[0]
    : undefined;
  const allSettled = total > 0 && done >= total;

  // Worst-case remaining wait = the longest timeout among the sources still
  // out (they run in parallel, so the slowest pending one bounds the finish).
  // As slow sources land this only shrinks, so the countdown never ticks up.
  // Falls back to all-source / 10s before any source has settled.
  const pendingMetas = metas.filter((m) => !progress?.settled[m.id]);
  const etaMs = pendingMetas.length
    ? Math.max(...pendingMetas.map((m) => m.timeoutMs ?? 8000))
    : metas.length
      ? Math.max(...metas.map((m) => m.timeoutMs ?? 8000))
      : 10000;

  // Tick at 100ms so the bar glides and the countdown ticks down by the second.
  const [startTs] = useState(() => Date.now());
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    if (allSettled) return;
    const id = setInterval(() => setNowTs(Date.now()), 100);
    return () => clearInterval(id);
  }, [allSettled]);
  const elapsedMs = Math.max(0, nowTs - startTs);
  const elapsedS = Math.floor(elapsedMs / 1000);

  // Smooth fill: elapsed time advances it continuously (held just shy of full so
  // it never claims to be done early), while real source completion can push it
  // further ahead — then it snaps to 100% once every source is in.
  const timeFrac = Math.min(0.97, elapsedMs / etaMs);
  const realFrac = total > 0 ? done / total : 0;
  const pct = Math.round((allSettled ? 1 : Math.max(timeFrac, realFrac)) * 100);

  // Countdown: how much of the estimate is left. Once it runs out we keep the
  // bar near-full and switch the label to the honest "finishing up…".
  const remainingS = Math.max(0, Math.ceil((etaMs - elapsedMs) / 1000));
  const countdown = allSettled
    ? "wrapping up…"
    : remainingS > 0
      ? `~${fmtElapsed(remainingS)} left`
      : "finishing up…";

  // Slow-tail awareness: name the still-pending sources and the worst-case wait.
  const maxTimeoutS = Math.round(etaMs / 1000);
  const showSlowNote = elapsedS >= SLOW_THRESHOLD_S && pendingMetas.length > 0;

  return (
    <Card className="sketch-shadow mt-8 overflow-hidden rounded-lg border border-border bg-card">
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 text-xl font-semibold leading-none">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
              Checking this {noun}…
            </div>
            {indicator && (
              <p className="font-mono text-sm break-all text-muted-foreground">
                {indicator}
              </p>
            )}
          </div>
          <div className="text-right leading-none">
            <span className="text-3xl font-semibold tabular-nums text-foreground">
              {pct}%
            </span>
            <div className="text-sm text-muted-foreground">
              <span className="font-mono">{done}</span> of{" "}
              <span className="font-mono">{total || "…"}</span> sources
            </div>
            <div className="mt-1 flex items-center justify-end gap-1 font-mono text-xs tabular-nums text-muted-foreground/70">
              <Clock className="size-3" aria-hidden />
              {countdown}
            </div>
          </div>
        </div>

        <div
          role="progressbar"
          aria-label="Threat-intel sources checked"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={total > 0 ? pct : undefined}
          aria-valuetext={
            total > 0 ? `${done} of ${total} sources checked` : undefined
          }
          className="relative h-3.5 w-full overflow-hidden rounded-sm border border-border bg-muted"
        >
          <div
            className={cn(
              "h-full rounded-sm bg-primary transition-[width] duration-200 ease-linear",
              total === 0 && "w-1/3 animate-pulse",
            )}
            style={total > 0 ? { width: `${Math.max(pct, 3)}%` } : undefined}
          />
          {/* Shimmer over the not-yet-filled portion so the bar never looks
              frozen while it waits on the slow tail. */}
          {total > 0 && !allSettled && (
            <div
              className="pointer-events-none absolute inset-y-0 right-0 animate-pulse bg-primary/25"
              style={{ left: `${Math.max(pct, 3)}%` }}
            />
          )}
        </div>

        {/* Screen-reader-only narration: one concise, polite announcement per
            settled source. The visible source grid below updates too often to
            announce in full, so it's left out of the live region. */}
        <p className="sr-only" role="status" aria-live="polite">
          {total > 0
            ? `${done} of ${total} sources checked${
                lastSettled ? `, last in ${lastSettled.source.name}` : ""
              }`
            : "Reaching out to threat-intel sources…"}
        </p>

        <p className="text-sm text-muted-foreground">
          {lastSettled
            ? `Last in: ${lastSettled.source.name}. Querying the rest…`
            : "Reaching out to threat-intel sources…"}
        </p>

        {showSlowNote && (
          <p className="flex items-start gap-1.5 font-mono text-xs text-amber-600 dark:text-amber-400">
            <Clock className="mt-0.5 size-3 shrink-0" aria-hidden />
            <span>
              Waiting on {pendingMetas.length} slow{" "}
              {pendingMetas.length === 1 ? "source" : "sources"}
              {pendingMetas.length <= 4
                ? `, ${pendingMetas.map((m) => m.name).join(", ")}`
                : ""}
              . These time out at ~{maxTimeoutS}s.
            </span>
          </p>
        )}

        {metas.length > 0 && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {metas.map((meta) => {
              const settled = progress?.settled[meta.id];
              // A still-pending source past the slow threshold is a laggard
              // about to time out — flag it amber so it doesn't read as stuck.
              const rowSlow = !settled && elapsedS >= SLOW_THRESHOLD_S;
              const s = progressStatus(settled);
              const Icon = rowSlow ? Clock : s.icon;
              const slowCls = "text-amber-600 dark:text-amber-400";
              return (
                <div
                  key={meta.id}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-md border border-foreground/10 bg-muted/40 px-3 py-2 transition-colors",
                    settled && "bg-background",
                    rowSlow && "border-amber-500/30",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon
                      className={cn(
                        "size-4 shrink-0",
                        rowSlow ? slowCls : s.cls,
                        !rowSlow && s.spin && "animate-spin",
                      )}
                    />
                    <span className="truncate text-sm font-medium">
                      {meta.name}
                    </span>
                  </span>
                  {settled ? (
                    <span className={cn("shrink-0 text-xs tabular-nums", s.cls)}>
                      {s.label}
                    </span>
                  ) : (
                    <span
                      className={cn(
                        "flex shrink-0 items-center gap-1 text-xs",
                        rowSlow ? slowCls : "text-muted-foreground/60",
                      )}
                    >
                      {rowSlow && <Clock className="size-3" aria-hidden />}
                      {rowSlow ? "slow…" : "checking…"}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
