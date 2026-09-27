/**
 * A mode's landing page at rest: headline and search on the left, `aside` (a
 * health rail) on the right. `/` renders it through `Checker` when given an
 * `idleAside`, so /check never takes this path, and `/scan` through
 * `ScanSearch`.
 *
 * The content lines up with the banner's column (max-w-7xl, px-4), but the
 * rail's surface runs on to the window's right edge, like a departures board.
 * `--bleed` is how far past the column that is; the rail pads its rows by it
 * so their numbers still end under the banner's controls.
 */
export function Board({
  heading,
  lede,
  search,
  hint,
  chips,
  error,
  aside,
}: Readonly<{
  heading: React.ReactNode;
  lede: React.ReactNode;
  search: React.ReactNode;
  hint: React.ReactNode;
  chips: React.ReactNode;
  error: React.ReactNode;
  aside: React.ReactNode;
}>) {
  return (
    <div className="grid w-full flex-1 grid-cols-1 [--bleed:max(0px,calc((100vw_-_80rem)/2))] md:grid-cols-[minmax(0,1fr)_calc(330px_+_var(--bleed))]">
      <div className="flex flex-col justify-center px-4 pt-14 pb-16 md:pr-12 md:pl-[calc(1rem_+_var(--bleed))] md:pb-[14vh]">
        <div className="w-full max-w-[600px]">
          <h1 className="text-[2.25rem] leading-[1.05] font-bold tracking-[-0.025em] md:text-[2.75rem]">
            {heading}
          </h1>
          <p className="mt-4 mb-8 max-w-[440px] text-base text-muted-foreground">{lede}</p>
          {search}
          <div className="mt-3.5 flex flex-wrap items-center gap-2">{chips}</div>
          <div className="mt-3 min-h-7 text-sm">{hint}</div>
          {error}
        </div>
      </div>
      {aside}
    </div>
  );
}
