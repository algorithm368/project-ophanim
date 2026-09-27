/**
 * The homepage at rest: headline and search on the left, `aside` (the source
 * rail) on the right. Only rendered when `Checker` is given an `idleAside`,
 * which only `/` does, so /check never takes this path.
 *
 * The content lines up with the banner's column (max-w-7xl, px-4), but the
 * rail's surface runs on to the window's right edge, like a departures board.
 * `--bleed` is how far past the column that is; the rail pads its rows by it
 * so their numbers still end under the banner's controls.
 */
export function Board({
  search,
  hint,
  chips,
  error,
  aside,
}: Readonly<{
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
            Check an IP,
            <br />
            domain, or file hash.
          </h1>
          <p className="mt-4 mb-8 max-w-[440px] text-base text-muted-foreground">
            Every source is asked in parallel, then the answers are folded into one verdict.
          </p>
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
