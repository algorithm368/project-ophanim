/**
 * The homepage at rest: headline and search on the left, `aside` (the source
 * rail) on the right. Only rendered when `Checker` is given an `idleAside`,
 * which only `/` does, so /check never takes this path.
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
    // Same column as the banner (max-w-7xl, px-4), so the headline starts under
    // the wordmark and the rail ends under the banner's controls on any width.
    <div className="mx-auto grid w-full max-w-7xl flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_330px]">
      <div className="flex flex-col justify-center px-4 py-12 md:pr-10">
        <div className="w-full max-w-[560px]">
          <h1 className="text-3xl leading-[1.1] font-bold tracking-[-0.02em] sm:text-[2rem]">
            Check an IP,
            <br />
            domain, or file hash.
          </h1>
          <p className="mt-2.5 mb-6 max-w-[420px] text-[0.95rem] text-muted-foreground">
            Every source is asked in parallel, then the answers are folded into one verdict.
          </p>
          {search}
          <div className="mt-3 flex flex-wrap items-center gap-2">{chips}</div>
          <div className="mt-2 min-h-7 text-sm">{hint}</div>
          {error}
        </div>
      </div>
      {aside}
    </div>
  );
}
