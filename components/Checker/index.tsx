"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { type AnyCheckResult, sourceRowKey } from "@/lib/ti/types";
import type { ParsedIP } from "@/lib/ip";
import { detectIOC, refangIOC, iocFromPath } from "@/lib/ioc";
import type { GeoRow } from "@/lib/ti/geo";
import type { UrlCheckResult } from "@/lib/ti/url/types";
import { buildPartial } from "@/lib/ti/partial";
import { useResearchStream } from "@/components/CheckResults/use-research";
import {
  DetectionHint,
  EXAMPLE_CHIPS,
  EXAMPLES,
  SearchBox,
} from "./search-box";
import { BulkProgress, EmptyState, ErrorState } from "./states";
import type { CheckError, Mode, Progress } from "./types";
import {
  bulkTargets,
  canonicalFor,
  inactivityWatchdog,
  indicatorOf,
  NAV_ABORT,
  prepareCheck,
  requestErrorMessage,
  researchTargetFor,
  researchTargetOf,
  STREAM_INACTIVITY_MS,
  streamLookup,
} from "./lookup";

const loadCheckResults = () => import("../CheckResults");
// SSR enabled so a cached permalink paints its verdict in the initial HTML;
// still code-split via dynamic() so the home page pays nothing for it.
const CheckResults = dynamic(loadCheckResults);
const loadBulkGeo = () => import("../BulkGeoResults");
const BulkGeoResults = dynamic(loadBulkGeo, { ssr: false });

export default function Checker({
  initialQuery,
  initialResult,
}: Readonly<{
  initialQuery?: string;
  /** A server-fetched cached result for a permalink (/check/<ioc>). When present
   *  it is shown immediately on first paint, skipping the client lookup. */
  initialResult?: AnyCheckResult | UrlCheckResult | null;
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
  const resultsCache = useRef<Map<string, AnyCheckResult | UrlCheckResult>>(
    new Map(),
  );
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
    settled?.kind ??
    (pending ? (researchTargetFor(pending)?.kind ?? null) : null);
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
    <div className="mx-auto w-full max-w-7xl px-4 py-6">
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
