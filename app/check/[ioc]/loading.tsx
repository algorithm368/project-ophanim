import { ResultSkeleton } from "@/components/result-skeleton";

/** Shown from the click until the server responds. See the note in
 *  app/scan/[indicator]/loading.tsx: the `<main>` here mirrors page.tsx's, and
 *  the shell itself reads the path rather than taking the indicator, because
 *  loading UI accepts no parameters. */
export default function Loading() {
  return (
    <main className="relative min-h-full">
      <ResultSkeleton />
    </main>
  );
}
