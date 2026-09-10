import { ResultSkeleton } from "@/components/result-skeleton";

/** Shown from the click until the server responds. Prefetched by the router,
 *  so it appears even while the function is still cold.
 *
 *  The `<main>` must match the one in page.tsx exactly, because this shell and
 *  the page's own Suspense fallback render back to back and any difference
 *  between the two containers is a jump. `ResultSkeleton` reads the path for
 *  the rest, since loading UI accepts no parameters. */
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6">
      <ResultSkeleton />
    </main>
  );
}
