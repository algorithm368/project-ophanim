"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  CircleX,
  FileDigit,
  Gauge,
  Globe,
  Loader2,
  Network,
  PenLine,
  RefreshCw,
  Search,
  SearchX,
  ServerCrash,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Sparkles,
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
import { detectIOC, refangIOC, extractIps } from "@/lib/ioc";
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

export default function Checker({ initialQuery }: { initialQuery?: string }) {
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
  >(null);
  const [bulkRows, setBulkRows] = useState<GeoRow[] | null>(null);
  const [bulkPending, setBulkPending] = useState(0);
  const [isBulk, setIsBulk] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Captures the mount-time runCheck so the init effect can fire it once without
  // listing the (re-created-each-render) function as a dependency.
  const runCheckRef = useRef(runCheck);
  const didInit = useRef(false);

  // On first mount: auto-run the check for a permalinked IOC (/check/<ioc>), or
  // focus the empty input for a fresh search.
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    if (initialQuery && detectIOC(initialQuery)) {
      runCheckRef.current(initialQuery);
    } else {
      inputRef.current?.focus();
    }
  }, [initialQuery]);

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

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson",
        },
        body: JSON.stringify(body),
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
        setResult(finalResult);
      } else {
        setError({
          kind: "request",
          message:
            "The server returned an unexpected response. Please try again.",
        });
      }
    } catch {
      setError({
        kind: "request",
        message:
          "Couldn't reach the server. Check your connection and try again.",
      });
    } finally {
      setLoading(false);
      setProgress(null);
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

  // Follow a related indicator from a result or the investigation graph: jump
  // to the top and run a fresh check, which folds it into the graph too.
  function pivot(value: string) {
    setQuery(value);
    window.scrollTo({ top: 0, behavior: "smooth" });
    runCheck(value);
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="sketch-box sketch-shadow relative border-2 border-dashed border-foreground/30 bg-card/50 p-3.5 sm:p-4">
        <div className="font-hand mb-3 flex items-center gap-2 text-xl font-bold text-foreground/75 sm:text-2xl">
          <PenLine className="size-5 -rotate-12 text-primary" />
          Got an IOC? Let&apos;s check it.
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            runCheck(query);
          }}
          className="flex flex-col gap-3 sm:flex-row"
        >
          <div className="sketch-box relative flex-1 overflow-hidden border-2 border-foreground/30 bg-background transition-colors focus-within:border-primary">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
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
                "h-12 rounded-none border-0 bg-transparent pl-10 font-mono text-lg shadow-none placeholder:text-base focus-visible:ring-0 sm:placeholder:text-lg",
                query ? "pr-11" : "pr-3",
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
                className="absolute top-1/2 right-3 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          <Button
            type="submit"
            size="lg"
            disabled={loading || !query.trim() || (!detected && !bulkPreview)}
            className="font-hand sketch-shadow-primary h-12 rotate-1 rounded-[16px_26px_14px_24px/24px_14px_26px_16px] border-2 border-primary/50 px-7 text-lg font-bold transition-transform hover:rotate-0 hover:bg-primary/90"
          >
            {loading ? (
              <>
                <Loader2 className="size-5 animate-spin" />
                Checking…
              </>
            ) : (
              <>
                <Search className="size-5" />
                Check it!
              </>
            )}
          </Button>
        </form>

        <div className="mt-3 min-h-7 font-hand text-base">
          {!trimmed ? (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Sparkles className="size-4 text-primary" />
              Type or paste an indicator and we&apos;ll detect the type for you.
            </span>
          ) : bulkPreview ? (
            <span className="inline-flex flex-wrap items-center gap-1.5 text-primary">
              <Network className="size-4" />
              {bulkPreview.length === 1
                ? "Detected an IPv6 address"
                : `Detected ${bulkPreview.length} IP addresses`}{" "}
              <span className="text-muted-foreground">— bulk geolocation</span>
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
    <Card className="sketch-shadow mt-8 overflow-hidden rounded-[22px_34px_18px_30px/30px_18px_34px_22px] border-2 border-foreground/20 bg-gradient-to-br from-primary/8 to-transparent">
      <CardContent className="flex items-center gap-3 py-8">
        <Loader2 className="size-6 animate-spin text-primary" />
        <div className="font-hand text-2xl font-bold">
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
    ? "Paste an IP address, domain, or file hash above — we'll detect the type, then tell you what it is, where it lives, and whether any threat-intel source has flagged it, summarized into one risk score."
    : detected === "ip"
      ? "Enter an IPv4 address above and we'll tell you what kind of address it is, where it's located, and whether any threat-intel source has flagged it, summarized into one risk score."
      : detected === "domain"
        ? "Enter a domain above and we'll tell you when it was registered, where it resolves, and whether any threat-intel source has flagged it, summarized into one risk score."
        : "Paste a file hash (MD5, SHA-1, or SHA-256) above and we'll tell you what the file is, its name and type, any malware family it belongs to, and whether threat-intel sources have flagged it.";

  return (
    <Card className="mt-10 border-dashed bg-card/50">
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <ShieldQuestion className="size-6" />
        </span>
        <div className="space-y-1">
          <p className="font-heading text-base font-medium">
            Ready when you are
          </p>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            {copy}
          </p>
        </div>
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

  const accent = isInput
    ? {
        border: "border-amber-500/40",
        wash: "from-amber-500/12",
        badge:
          "border-amber-500/40 bg-amber-500/12 text-amber-600 dark:text-amber-400",
        text: "text-amber-600 dark:text-amber-400",
        headline: "Hmm, that doesn't look right",
      }
    : {
        border: "border-red-500/40",
        wash: "from-red-500/12",
        badge: "border-red-500/40 bg-red-500/12 text-red-600 dark:text-red-400",
        text: "text-red-600 dark:text-red-400",
        headline: "Couldn't run the check",
      };

  return (
    <Card
      className={cn(
        "sketch-shadow mt-8 overflow-hidden rounded-[22px_34px_18px_30px/30px_18px_34px_22px] border-2 bg-gradient-to-br to-transparent",
        accent.border,
        accent.wash,
      )}
    >
      <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
        <span
          className={cn(
            "flex size-14 -rotate-3 items-center justify-center rounded-[16px_22px_14px_20px/20px_14px_22px_16px] border-2",
            accent.badge,
          )}
        >
          <Icon className="size-7" />
        </span>

        <div className="space-y-1.5">
          <p
            className={cn(
              "font-hand text-3xl font-bold leading-none",
              accent.text,
            )}
          >
            {accent.headline}
          </p>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
            {error.message}
          </p>
        </div>

        {isInput ? (
          <div className="flex flex-wrap items-center justify-center gap-2.5">
            <span className="font-hand text-lg text-muted-foreground">
              try one →
            </span>
            {examples.map((s, i) => (
              <Button
                key={s}
                type="button"
                variant="outline"
                size="sm"
                className={cn(
                  "rounded-[14px_20px_12px_22px/20px_12px_22px_14px] border-2 border-dashed font-mono transition-transform hover:rotate-0",
                  i % 2 === 0 ? "-rotate-2" : "rotate-2",
                )}
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
            className="font-hand sketch-shadow-primary rotate-1 rounded-[16px_26px_14px_24px/24px_14px_26px_16px] border-2 border-primary/50 px-6 text-lg font-bold transition-transform hover:rotate-0 hover:bg-primary/90"
          >
            <RefreshCw className="size-4" />
            Try again
          </Button>
        )}
      </CardContent>
    </Card>
  );
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
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const metas = progress?.metas ?? [];
  // The most recently settled source, for the "currently doing" caption.
  const lastSettled = progress
    ? Object.values(progress.settled).sort(
        (a, b) => b.durationMs - a.durationMs,
      )[0]
    : undefined;

  return (
    <Card className="sketch-shadow mt-8 overflow-hidden rounded-[22px_34px_18px_30px/30px_18px_34px_22px] border-2 border-foreground/20 bg-gradient-to-br from-primary/8 to-transparent duration-300 animate-in fade-in slide-in-from-bottom-2">
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="space-y-0.5">
            <div className="font-hand flex items-center gap-2 text-2xl font-bold leading-none">
              <Loader2 className="size-5 animate-spin text-primary" />
              Checking this {noun}…
            </div>
            {indicator && (
              <p className="font-mono text-sm break-all text-muted-foreground">
                {indicator}
              </p>
            )}
          </div>
          <div className="font-hand text-right leading-none">
            <span className="text-3xl font-bold tabular-nums text-primary">
              {pct}%
            </span>
            <div className="text-sm text-muted-foreground">
              <span className="font-mono">{done}</span> of{" "}
              <span className="font-mono">{total || "…"}</span> sources
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
          className="h-3.5 w-full overflow-hidden rounded-full border-2 border-foreground/15 bg-muted"
        >
          <div
            className={cn(
              "h-full rounded-full bg-primary transition-[width] duration-500 ease-out",
              total === 0 && "w-1/3 animate-pulse",
            )}
            style={total > 0 ? { width: `${Math.max(pct, 3)}%` } : undefined}
          />
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

        <p className="font-hand text-base text-muted-foreground">
          {lastSettled
            ? `Last in: ${lastSettled.source.name}. Querying the rest…`
            : "Reaching out to threat-intel sources…"}
        </p>

        {metas.length > 0 && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {metas.map((meta) => {
              const settled = progress?.settled[meta.id];
              const s = progressStatus(settled);
              const Icon = s.icon;
              return (
                <div
                  key={meta.id}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-[12px_16px_10px_14px/14px_10px_16px_12px] border border-foreground/10 bg-muted/40 px-3 py-2 transition-colors",
                    settled && "bg-background",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon
                      className={cn(
                        "size-4 shrink-0",
                        s.cls,
                        s.spin && "animate-spin",
                      )}
                    />
                    <span className="truncate text-sm font-medium">
                      {meta.name}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-xs tabular-nums",
                      settled ? s.cls : "text-muted-foreground/60",
                    )}
                  >
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
