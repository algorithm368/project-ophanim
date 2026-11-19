"use client";

import { useRef } from "react";
import { usePathname } from "next/navigation";
import { modeRouteFor } from "@/lib/route-mode";
import { detectIOC, type LookupType } from "@/lib/ioc";
import CheckResults from "@/components/CheckResults";
import { IDLE } from "@/components/CheckResults/use-research";
import { SearchBox } from "@/components/Checker/search-box";

/**
 * The inert shell a route shows before its cached result has been read.
 *
 * Inert is the point. An earlier draft used `<Checker>` itself as the
 * fallback, which starts a live lookup the moment it mounts with an
 * `initialQuery` and no `initialResult`: the request would then be thrown away
 * when the cached result arrived, turning one navigation into two lookups.
 *
 * **It reads the path rather than taking props, and that is what stops it
 * shifting.** Each of these routes shows this shell twice in a row, first as
 * `loading.tsx` while the server is still thinking, then as the page's own
 * Suspense fallback while Redis is read. `loading.tsx` accepts no params, so
 * anything passed in could only ever be given to the second of the two, and the
 * pair drifted exactly that way: the shell went from a grey bar to the
 * indicator's text mid-navigation, and the scan route was left standing in the
 * lookup shape entirely, growing a search box that then vanished. Derived from
 * the pathname, both renders are the same render.
 *
 * Both modes lead with a search box, so both shells stand one in. What still
 * differs is the container: `/check/[ioc]` gives `<Checker>` a bare `<main>`
 * and lets it bring its own page container, while `/scan/[indicator]` puts the
 * container on the `<main>` itself. Getting that wrong is visible, and was: a
 * lookup shell inside the scan page's `<main>` is doubly padded, so the
 * fallback sits inset from the report that replaces it.
 */
export function ResultSkeleton() {
  const route = modeRouteFor(usePathname());
  // Neither mode means this is mounted somewhere it was not designed for; the
  // lookup shape is the one with a container of its own, so it is the safe
  // guess.
  const lookup = route?.mode !== "active";
  const indicator = route?.indicator;

  return (
    <div className={lookup ? "mx-auto w-full max-w-7xl px-4 py-6" : undefined}>
      {lookup ? (
        <LookupShell indicator={indicator ?? ""} />
      ) : (
        <>
          <div className="sweep h-12 w-full rounded-lg" />
          <div className="mt-5 rounded-lg border border-foreground/12 p-4">
            <div className="sweep h-7 w-56 rounded" />
            <div className="sweep mt-4 h-3 w-11/12 rounded" />
            <div className="sweep mt-2 h-3 w-3/4 rounded" />
          </div>
        </>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        Loading {indicator ?? "the indicator"}.
      </p>
    </div>
  );
}

/**
 * The lookup page's first frame, exactly: the compact search box holding the
 * indicator, and the result view with no result and no progress, which is
 * every tile at its real span with a rule in every slot. It is the same
 * component the live lookup then renders, so the hand-over from this shell to
 * the page is one frame drawn twice rather than a placeholder giving way to a
 * layout. Nothing in it fetches: the research lane is idle and there is no
 * place to draw a globe for.
 */
function LookupShell({ indicator }: Readonly<{ indicator: string }>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const detected = detectIOC(indicator);
  const kind: LookupType = detected === "domain" || detected === "hash" ? detected : "ip";
  return (
    <>
      <SearchBox
        compact
        query={indicator}
        loading
        canSubmit={false}
        inputRef={inputRef}
        onQueryChange={noop}
        onClear={noop}
        onSubmit={noop}
      />
      <CheckResults
        result={null}
        partial={null}
        indicator={indicator}
        kind={kind}
        onRefresh={noop}
        research={IDLE}
      />
    </>
  );
}

function noop() {}
