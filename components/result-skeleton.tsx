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
 * The two callers hold different amounts of chrome, so `variant` says which
 * shape to stand in for rather than guessing:
 *
 * - `lookup` stands in for `<Checker>` on `/check/[ioc]`, which brings its own
 *   page container and leads with a search box.
 * - `scan` stands in for `<ScanReport>` on `/scan/[indicator]`, where the
 *   page's own `<main>` is the container and there is no search box at all.
 *
 * Getting this wrong is visible: a `lookup` skeleton inside the scan page's
 * `<main>` is doubly padded, so the fallback sits inset from the report that
 * replaces it.
 */
export function ResultSkeleton({
  indicator,
  variant = "lookup",
}: Readonly<{ indicator?: string; variant?: "lookup" | "scan" }>) {
  const lookup = variant === "lookup";
  return (
    <div className={lookup ? "mx-auto w-full max-w-5xl px-4 py-6" : undefined}>
      {/* Search box, which only the lookup shell has. */}
      {lookup && <div className="sweep h-12 w-full rounded-lg" />}

      <div className={lookup ? "mt-5" : undefined}>
        <div className="rounded-lg border border-foreground/12 p-4">
          {indicator ? (
            <p className="font-mono text-lg break-all text-foreground">
              {indicator}
            </p>
          ) : (
            <div className="sweep h-6 w-56 rounded" />
          )}
          <div className="sweep mt-3 h-1.5 w-full rounded-full" />
          <div className="sweep mt-4 h-3 w-11/12 rounded" />
          <div className="sweep mt-2 h-3 w-3/4 rounded" />
        </div>

        <div className="mt-5 rounded-lg border border-foreground/12 p-4">
          <div className="sweep h-3 w-24 rounded" />
          <div className="sweep mt-4 h-3 w-2/3 rounded" />
          <div className="sweep mt-2 h-3 w-1/2 rounded" />
        </div>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        Loading {indicator ?? "the indicator"}.
      </p>
    </div>
  );
}
