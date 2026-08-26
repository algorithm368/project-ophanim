import { ResultSkeleton } from "@/components/result-skeleton";

/** Shown from the click until the server responds. Prefetched by the router,
 *  so it appears even while the function is still cold. It cannot name the
 *  indicator: loading UI components accept no parameters. */
export default function Loading() {
  return (
    <main className="relative min-h-full">
      <ResultSkeleton />
    </main>
  );
}
