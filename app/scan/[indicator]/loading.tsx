import { ResultSkeleton } from "@/components/result-skeleton";

/** Shown from the click until the server responds. See the note in
 *  app/check/[ioc]/loading.tsx: this file cannot name the indicator. */
export default function Loading() {
  return (
    <main className="relative min-h-full">
      <ResultSkeleton />
    </main>
  );
}
