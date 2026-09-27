"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { modeHref, passiveHref } from "@/lib/route-mode";
import { isScanProblem, readScanInput } from "@/lib/scan-input";
import { SearchBox } from "@/components/Checker/search-box";

/**
 * The box that moves this page to another indicator.
 *
 * The same control `/check` uses, in its compact sticky form, because the two
 * modes are two readings of one workflow and a second search box built for this
 * page would be a second thing to keep in step. Only the wording differs: a
 * hash has no address to visit, so offering one in the placeholder would teach
 * the wrong thing.
 *
 * Submitting always lands on `/scan/<indicator>`. Somebody typing into the box
 * on the active page is asking to scan that thing, and quietly rerouting them
 * to the passive reading would answer a question they did not ask.
 *
 * Validation is `readScanInput`, the same boundary `/api/scan-url` enforces, so
 * the box never accepts what the route would refuse. When it does refuse, the
 * reason is printed: a disabled button with no sentence beside it is the one
 * thing worse than accepting bad input.
 */
export function ScanSearchBar({ indicator }: Readonly<{ indicator: string }>) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(indicator);
  const [navigating, setNavigating] = useState(false);

  const read = readScanInput(query);
  const problem = read && isScanProblem(read) ? read.message : null;
  const target = read && !isScanProblem(read) ? read.indicator : null;
  // Re-submitting the indicator already on screen would be a navigation to
  // here, which does nothing and looks broken. Rescan is its own button.
  const canSubmit = Boolean(target) && target !== indicator;

  return (
    <div className="space-y-1.5">
      <SearchBox
        compact
        query={query}
        loading={navigating}
        canSubmit={canSubmit}
        inputRef={inputRef}
        onQueryChange={(value) => {
          setQuery(value);
          setNavigating(false);
        }}
        onClear={() => {
          setQuery("");
          inputRef.current?.focus();
        }}
        onSubmit={() => {
          if (!canSubmit || !target) return;
          setNavigating(true);
          router.push(modeHref("active", target));
        }}
        label="Indicator to scan"
        placeholder="IP, domain, or URL"
        action="Scan"
      />
      {problem && (
        <p className="px-1 text-xs text-muted-foreground">
          {problem}{" "}
          <a
            href={passiveHref(query.trim())}
            className="underline underline-offset-2 hover:text-foreground"
          >
            Check it passively
          </a>
        </p>
      )}
    </div>
  );
}
