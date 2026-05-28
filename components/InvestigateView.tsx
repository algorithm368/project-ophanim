"use client";

import { useRef, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  Search,
  Share2,
  ShieldQuestion,
  X,
  XCircle,
} from "lucide-react";
import { detectIOC, refangIOC } from "@/lib/ioc";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { InvestigationGraph } from "@/components/graph/InvestigationGraph";
import { addResult, useInvestigation } from "@/components/graph/investigation";
import type {
  CheckResult,
  DomainCheckResult,
  HashCheckResult,
} from "@/lib/ti/types";

type Status =
  | { kind: "idle" }
  | { kind: "checking"; value: string }
  | { kind: "done"; value: string }
  | { kind: "error"; value: string; message: string };

export function InvestigateView() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);
  const { nodes } = useInvestigation();

  const loading = status.kind === "checking";
  const detected = detectIOC(query);

  function onQueryChange(value: string) {
    setQuery(value);
    if (status.kind === "error") setStatus({ kind: "idle" });
  }

  async function runCheck(target: string) {
    const value = refangIOC(target);
    if (!value || loading) return;

    const type = detectIOC(value);
    if (!type) {
      setStatus({
        kind: "error",
        value,
        message: `"${value}" isn't a recognized IP, domain, or hash.`,
      });
      return;
    }

    setStatus({ kind: "checking", value });

    const endpoint =
      type === "ip"
        ? "/api/check"
        : type === "domain"
          ? "/api/check-domain"
          : "/api/check-hash";
    const body =
      type === "ip"
        ? { ip: value }
        : type === "domain"
          ? { domain: value }
          : { hash: value };

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok || !res.body) {
        let message = `Lookup failed (HTTP ${res.status}).`;
        try {
          const d = (await res.json()) as { error?: string };
          if (d?.error) message = d.error;
        } catch {
          /* keep default */
        }
        setStatus({ kind: "error", value, message });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalResult: CheckResult | DomainCheckResult | HashCheckResult | null =
        null;

      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const evt = JSON.parse(line) as {
            type: string;
            result?: CheckResult & DomainCheckResult & HashCheckResult;
          };
          if (evt.type === "done" && evt.result) finalResult = evt.result;
        }
      }

      if (finalResult) {
        addResult(finalResult);
        setStatus({ kind: "done", value });
        setQuery("");
        inputRef.current?.focus();
      } else {
        setStatus({
          kind: "error",
          value,
          message: "Unexpected response from server.",
        });
      }
    } catch {
      setStatus({
        kind: "error",
        value,
        message: "Couldn't reach the server. Check your connection.",
      });
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="sketch-box sketch-shadow relative border-2 border-dashed border-foreground/30 bg-card/50 p-3.5 sm:p-4">
        <div className="font-hand mb-3 flex items-center gap-2 text-xl font-bold text-foreground/75 sm:text-2xl">
          <Share2 className="size-5 -rotate-6 text-primary" />
          Build your investigation
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
              aria-label="IOC to add to graph"
              placeholder="Paste an IP, domain, or file hash to add to the graph"
              className={cn(
                "h-12 rounded-none border-0 bg-transparent pl-10 font-mono text-lg shadow-none focus-visible:ring-0",
                query ? "pr-11" : "pr-3",
              )}
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setStatus({ kind: "idle" });
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
            disabled={loading || !query.trim() || !detected}
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
                Add to graph
              </>
            )}
          </Button>
        </form>

        <div className="mt-3 min-h-7 font-hand text-base">
          {status.kind === "idle" && !query && (
            <span className="text-muted-foreground">
              {nodes.length === 0
                ? "Enter the first IOC to start building your investigation graph."
                : `${nodes.length} node${nodes.length === 1 ? "" : "s"} in graph. Add more or click a node to pivot.`}
            </span>
          )}
          {status.kind === "idle" && query && !detected && (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <ShieldQuestion className="size-4" />
              Not a recognized IOC yet. Paste an IP, domain, or file hash.
            </span>
          )}
          {status.kind === "idle" && query && detected && (
            <span className="text-primary">
              Detected {detected === "ip" ? "an" : "a"}{" "}
              {detected === "ip"
                ? "IP address"
                : detected === "domain"
                  ? "domain"
                  : "file hash"}
              .
            </span>
          )}
          {status.kind === "checking" && (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Checking{" "}
              <span className="font-mono text-foreground">{status.value}</span>
              …
            </span>
          )}
          {status.kind === "done" && (
            <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-4" />
              <span className="font-mono">{status.value}</span> added to graph.
            </span>
          )}
          {status.kind === "error" && (
            <span className="inline-flex items-center gap-1.5 text-red-600 dark:text-red-400">
              <XCircle className="size-4" />
              {status.message}
            </span>
          )}
        </div>
      </div>

      {nodes.length === 0 && (
        <Card className="mt-10 border-dashed bg-card/50">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Share2 className="size-6" />
            </span>
            <div className="space-y-1">
              <p className="font-heading text-base font-medium">
                No nodes yet
              </p>
              <p className="mx-auto max-w-md text-sm text-muted-foreground">
                Enter an IP address, domain, or file hash above to start
                building your investigation graph. Related indicators will be
                discovered and linked automatically.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <InvestigationGraph onPivot={runCheck} />
    </div>
  );
}
