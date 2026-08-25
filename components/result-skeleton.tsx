/**
 * The inert shell a route shows before its cached result has been read.
 *
 * Inert is the point. An earlier draft used `<Checker>` itself as the
 * fallback, which starts a live lookup the moment it mounts with an
 * `initialQuery` and no `initialResult`: the request would then be thrown away
 * when the cached result arrived, turning one navigation into two lookups.
 *
 * The left rail is a placeholder for `SectionNav`, which renders only once
 * there are results. Without it here the whole content column shifts sideways
 * at the moment the result lands.
 */
export function ResultSkeleton({
  indicator,
}: Readonly<{ indicator?: string }>) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="flex gap-4">
        {/* Reserves the SectionNav rail's width so the column never moves. */}
        <div aria-hidden className="hidden w-14 shrink-0 lg:block" />

        <div className="min-w-0 flex-1">
          {/* Search box */}
          <div className="sweep h-12 w-full rounded-lg" />

          <div className="mt-5 rounded-lg border border-foreground/12 p-4">
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
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        Loading {indicator ?? "the indicator"}.
      </p>
    </div>
  );
}
