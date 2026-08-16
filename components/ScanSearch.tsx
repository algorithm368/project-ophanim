"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, Link2, Network, Radar, ShieldQuestion, X } from "lucide-react";
import { modeHref } from "@/lib/route-mode";
import {
  isScanProblem,
  readScanInput,
  type ScanInput,
  type ScanInputProblem,
} from "@/lib/scan-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** One per shape of thing that can be scanned. A hash is deliberately absent:
 *  it has no address to visit, and offering it would teach the wrong thing. */
const EXAMPLE_CHIPS = [
  { value: "google.com", label: "google.com", icon: Globe },
  { value: "1.1.1.1", label: "1.1.1.1", icon: Network },
  { value: "https://cloudflare.com/", label: "a full URL", icon: Link2 },
];

/**
 * What the box makes of what is typed, in one line under it.
 *
 * The three states are an empty box, an input that cannot be scanned and says
 * why, and a readable list of the exact URLs an engine would fetch. items-start
 * on the first two because both wrap to a second line on a phone, where a
 * centered icon floats away from the first word.
 */
function InputHint({
  read,
}: Readonly<{ read: ScanInput | ScanInputProblem | null }>) {
  if (!read) {
    return (
      <span className="inline-flex items-start gap-1.5 text-muted-foreground">
        <Radar className="mt-0.5 size-4 shrink-0" />
        Type or paste an address and we&apos;ll show exactly what would be
        visited.
      </span>
    );
  }

  if (isScanProblem(read)) {
    return (
      <span className="inline-flex items-start gap-1.5 text-muted-foreground">
        <ShieldQuestion className="mt-0.5 size-4 shrink-0" />
        {read.message}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5 text-primary">
      Would visit
      {read.targets.map((target) => (
        <span key={target} className="font-mono text-foreground">
          {target}
        </span>
      ))}
      <span className="text-muted-foreground">
        ·{" "}
        {read.targets.length === 1
          ? "once per engine"
          : "both ports, once per engine"}
      </span>
    </span>
  );
}

/**
 * The active mode's search box.
 *
 * The passive box on the home page and this one take the same shapes of input
 * and look the same on purpose, because the difference between them is not the
 * typing: it is that this one leads to something that visits the address. So it
 * says up front exactly which URLs that would be, and it still hands off to the
 * scan page rather than starting anything, keeping the confirmation the one
 * place a scan can begin.
 */
export function ScanSearch() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");

  const read = readScanInput(query);
  const ready = read !== null && !isScanProblem(read);

  function go(value: string) {
    const parsed = readScanInput(value);
    if (!parsed || isScanProblem(parsed)) return;
    router.push(modeHref("active", parsed.indicator));
  }

  return (
    <div className="sketch-shadow relative rounded-lg border border-border bg-card p-4 sm:p-5">
      <div className="mb-2 flex items-center gap-2 font-mono text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
        <Radar className="size-3.5" />
        Active scan
      </div>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight sm:text-[1.7rem]">
        Visit an IP, domain, or&nbsp;URL
      </h1>
      <p className="mb-4 text-sm text-foreground/70">
        Everything under the passive reading comes from records other people
        already keep. This is the one thing here that goes and looks, through
        urlscan.io and Cloudflare, and nothing leaves this machine until you
        confirm it on the next page.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          go(query);
        }}
        className="flex flex-col gap-3 sm:flex-row"
      >
        <div className="relative flex flex-1 items-center rounded-md border border-input bg-background transition-colors focus-within:border-foreground/50">
          <Radar className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            inputMode="text"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            aria-label="Address to scan"
            placeholder="IP, domain, or URL"
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
          aria-label="Open the scan"
          disabled={!ready}
          className="h-11 w-11 shrink-0 rounded-md p-0"
        >
          <Radar className="size-4" />
        </Button>
      </form>

      {/* What would be visited, named before the analyst commits to anything.
          An IP becomes two URLs, and seeing that here is the point. */}
      <div className="mt-3 min-h-7 text-sm">
        <InputHint read={read} />
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
              go(value);
            }}
            className="group inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 font-mono text-xs text-foreground/80 transition-colors hover:border-foreground/40 hover:text-foreground"
          >
            <ChipIcon className="size-3.5 text-muted-foreground transition-colors group-hover:text-foreground" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
