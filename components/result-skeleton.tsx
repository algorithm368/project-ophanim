"use client";

import { usePathname } from "next/navigation";
import { detectIOC } from "@/lib/ioc";
import { modeRouteFor } from "@/lib/route-mode";
import { FrameSkeleton } from "@/components/CheckResults/pending";

/**
 * The inert shell a route shows before its cached result has been read.
 *
 * Inert is the point. An earlier draft used `<Checker>` itself as the
 * fallback, which starts a live lookup the moment it mounts with an
 * `initialQuery` and no `initialResult`: the request would then be thrown away
 * when the cached result arrived, turning one navigation into two lookups.
 *
 * There is no placeholder for `SectionNav` here, and there must not be one.
 * That rail is `position: fixed` in the left gutter, so it takes no width out
 * of the flow at any breakpoint; a spacer reserving room for it would indent
 * this shell past where the real content lands and then jump left when the
 * content mounted, which is the shift it was meant to prevent.
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
      <div className="sweep h-12 w-full rounded-lg" />

      <div className="mt-5">
        {lookup ? (
          // The finished page's own shape, every tile at its final span, so the
          // result replaces placeholders rather than replacing a layout.
          <FrameSkeleton
            indicator={indicator}
            kind={indicator ? (detectIOC(indicator) ?? undefined) : undefined}
          />
        ) : (
          <div className="rounded-lg border border-foreground/12 p-4">
            <div className="sweep h-7 w-56 rounded" />
            <div className="sweep mt-4 h-3 w-11/12 rounded" />
            <div className="sweep mt-2 h-3 w-3/4 rounded" />
          </div>
        )}
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        Loading {indicator ?? "the indicator"}.
      </p>
    </div>
  );
}
