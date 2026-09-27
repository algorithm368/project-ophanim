"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, Link2, Network, Radar, ShieldQuestion } from "lucide-react";
import { modeHref } from "@/lib/route-mode";
import {
  isScanProblem,
  readScanInput,
  type ScanInput,
  type ScanInputProblem,
} from "@/lib/scan-input";
import { Board } from "@/components/Checker/board";
import { JoinedSearchBox } from "@/components/Checker/search-box";

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
 * The active mode's landing page: the search box on the board, with the
 * engines' health as its rail.
 *
 * The passive box on the home page and this one take the same shapes of input
 * and look the same on purpose, because the difference between them is not the
 * typing: it is that this one leads to something that visits the address. So it
 * says up front exactly which URLs that would be, and it still hands off to the
 * scan page rather than starting anything, keeping the confirmation the one
 * place a scan can begin.
 */
export function ScanSearch({ aside }: Readonly<{ aside: React.ReactNode }>) {
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

  const chips = (
    <>
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
    </>
  );

  return (
    <Board
      heading={
        <>
          Visit an IP,
          <br />
          domain, or URL.
        </>
      }
      lede="The one thing here that goes and looks. Nothing is visited until you confirm it on the next page."
      search={
        <JoinedSearchBox
          query={query}
          loading={false}
          canSubmit={ready}
          inputRef={inputRef}
          onQueryChange={setQuery}
          onClear={() => {
            setQuery("");
            inputRef.current?.focus();
          }}
          onSubmit={() => go(query)}
          label="Address to scan"
          placeholder="IP, domain, or URL"
          action="Open the scan"
          icon={Radar}
        />
      }
      chips={chips}
      // What would be visited, named before the analyst commits to anything.
      // An IP becomes two URLs, and seeing that here is the point.
      hint={<InputHint read={read} />}
      error={null}
      aside={aside}
    />
  );
}
