"use client";

import { Loader2, RefreshCw, SearchX, ServerCrash } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { CheckError, Mode } from "./types";

export function BulkProgress({ count }: Readonly<{ count: number }>) {
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
// A URL is the exception: passive mode does not look one up, so its copy says
// where it goes instead.
const EMPTY_STATE_COPY: Record<Mode | "none", string> = {
  none: "Paste an IP address, domain, or file hash above, we'll detect the type, then tell you what it is, where it lives, and whether any threat-intel source has flagged it, summarized into one risk score.",
  ip: "Enter an IPv4 address above and we'll tell you what kind of address it is, where it's located, and whether any threat-intel source has flagged it, summarized into one risk score.",
  domain:
    "Enter a domain above and we'll tell you when it was registered, where it resolves, and whether any threat-intel source has flagged it, summarized into one risk score.",
  hash: HASH_EMPTY_COPY,
  url: "A URL is not looked up passively. Press Enter to open its scan page, where the app visits it and reports what it found.",
};

export function EmptyState({ detected }: Readonly<{ detected: Mode | null }>) {
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

export function ErrorState({
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
