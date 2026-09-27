"use client";

import {
  FileDigit,
  Globe,
  Link2,
  Loader2,
  Network,
  Search,
  ShieldQuestion,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { IconType, Mode } from "./types";

/** Human label + icon per IOC type, shared by the toggle and detection hint. */
export const MODE_META: Record<Mode, { label: string; icon: IconType }> = {
  ip: { label: "IP address", icon: Network },
  domain: { label: "domain", icon: Globe },
  hash: { label: "file hash", icon: FileDigit },
  url: { label: "URL", icon: Link2 },
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
export const EXAMPLES = [IP_EXAMPLES[0], DOMAIN_EXAMPLES[0], HASH_EXAMPLES[0]];

// Quick-start chips shown under the search box: one clickable example per type.
export const EXAMPLE_CHIPS: {
  value: string;
  label: string;
  icon: IconType;
}[] = [
  { value: IP_EXAMPLES[0], label: IP_EXAMPLES[0], icon: Network },
  { value: DOMAIN_EXAMPLES[0], label: DOMAIN_EXAMPLES[0], icon: Globe },
  { value: HASH_EXAMPLES[0], label: "eicar test hash", icon: FileDigit },
];

/**
 * What the box has made of what is typed, in one line under it.
 *
 * Four states in the order they occur: nothing typed, a paste of many
 * addresses, a recognized indicator (with the canonical form when it differs
 * from the input), and something not recognized yet.
 */
export function DetectionHint({
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
  // Passive mode has no reading of a URL: submitting one opens its scan page.
  if (detected === "url") {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5 text-primary">
        <DetectedIcon className="size-4" />
        Detected a URL
        <span className="text-muted-foreground">, opens an active scan</span>
      </span>
    );
  }
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

/**
 * The search box, in whichever size the page is showing.
 *
 * The compact form is the same control, shorter and stuck to the top: it takes
 * over once a result is on screen so the box stays in reach without pushing the
 * verdict off it. One component rather than two near-copies, which is what they
 * were, and what let them drift a class at a time.
 *
 * The scan page uses it too, in its compact form, which is why the wording is a
 * prop: an analyst on `/scan` cannot scan a hash, and offering one in the
 * placeholder would teach the wrong thing.
 */
export function SearchBox({
  compact,
  query,
  loading,
  canSubmit,
  inputRef,
  onQueryChange,
  onClear,
  onSubmit,
  label = "IOC to check",
  placeholder = "IP, domain, or file hash",
  action = "Check",
  joined = false,
}: Readonly<{
  compact: boolean;
  query: string;
  loading: boolean;
  canSubmit: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onQueryChange: (value: string) => void;
  onClear: () => void;
  onSubmit: () => void;
  /** Accessible name of the input. */
  label?: string;
  placeholder?: string;
  /** Accessible name of the submit button. */
  action?: string;
  /** One field with the submit inside it, for the homepage board. */
  joined?: boolean;
}>) {
  if (joined) {
    return (
      <JoinedSearchBox
        query={query}
        loading={loading}
        canSubmit={canSubmit}
        inputRef={inputRef}
        onQueryChange={onQueryChange}
        onClear={onClear}
        onSubmit={onSubmit}
        label={label}
        placeholder={placeholder}
        action={action}
      />
    );
  }
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
          aria-label={label}
          placeholder={placeholder}
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
        aria-label={action}
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

/** The landing pages' search: a single field, the submit a ↵ key inside its
 *  right edge rather than a separate button beside it. */
export function JoinedSearchBox({
  query,
  loading,
  canSubmit,
  inputRef,
  onQueryChange,
  onClear,
  onSubmit,
  label,
  placeholder,
  action,
  icon: Icon = Search,
}: Readonly<{
  query: string;
  loading: boolean;
  canSubmit: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onQueryChange: (value: string) => void;
  onClear: () => void;
  onSubmit: () => void;
  label: string;
  placeholder: string;
  action: string;
  icon?: IconType;
}>) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="relative flex h-13 items-center rounded-md border border-input bg-background transition-colors focus-within:border-foreground/60"
    >
      <Icon className="pointer-events-none absolute left-4 size-4 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        inputMode="text"
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        aria-label={label}
        placeholder={placeholder}
        className="h-full flex-1 rounded-none border-0 bg-transparent pr-2 pl-11 dark:bg-transparent font-mono text-[0.95rem] shadow-none focus-visible:ring-0"
      />
      {query && (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear input"
          className="flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      )}
      <button
        type="submit"
        aria-label={action}
        disabled={!canSubmit}
        className="mx-2.5 flex h-7 min-w-8 items-center justify-center rounded border border-border px-1.5 font-mono text-xs text-muted-foreground transition-colors enabled:border-foreground/40 enabled:text-foreground enabled:hover:bg-accent"
      >
        {loading ? <Loader2 className="size-3.5 animate-spin" /> : "↵"}
      </button>
    </form>
  );
}
