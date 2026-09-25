import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cache, Suspense } from "react";
import Checker from "@/components/Checker";
import { ResultSkeleton } from "@/components/result-skeleton";
import { detectIOC } from "@/lib/ioc";
import { modeHref } from "@/lib/route-mode";
import { getCachedResultFor } from "@/lib/ti/cache";
import { getHistory } from "@/lib/ti/history";
import type { AnyCheckResult } from "@/lib/ti/types";

interface PageProps {
  params: Promise<{ ioc: string }>;
}

const VERDICT_LABEL: Record<string, string> = {
  clean: "Clean",
  low: "Low risk",
  suspicious: "Suspicious",
  malicious: "Malicious",
};

/** Everything this page reads out of Redis, in one pass. */
interface CachedPage {
  result: AnyCheckResult | null;
}

/** Read everything cached for an indicator. Memoized per request so
 *  generateMetadata and the page share a single set of reads.
 *
 *  The result mirrors what the API's cache branch returns, not just the stored
 *  value: the `cached` flag and the history are added there, and a permalink
 *  that dropped them rendered a five-hour-old result labelled "re-check" with
 *  no reputation timeline, which is the one page where the timeline is most
 *  wanted. */
const fetchCached = cache(async (decoded: string): Promise<CachedPage> => {
  const kind = detectIOC(decoded);
  if (!kind || kind === "url") return { result: null };

  // `kind` and the route factory's `label` are the same strings, which is what
  // keeps this reading the keys recordHistory() writes. The history read is
  // speculative, mirroring the route's own cache branch: discarded on a miss.
  const [stored, history] = await Promise.all([
    getCachedResultFor(kind, decoded),
    getHistory(kind, decoded),
  ]);

  return { result: stored ? { ...stored, cached: true, history } : null };
});

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { ioc } = await params;
  const decoded = decodeURIComponent(ioc);

  // Best-effort: if a prior check is cached, surface its verdict in the title.
  const { result } = await fetchCached(decoded);
  const verdictLabel = result?.verdict
    ? VERDICT_LABEL[result.verdict]
    : undefined;

  const title = verdictLabel
    ? `${decoded}, ${verdictLabel} | Project Ophanim`
    : `${decoded} | Project Ophanim`;

  return {
    title,
    description: `Threat-intelligence reputation for ${decoded}.`,
  };
}

/** The half that waits on Redis. Split out so the page itself can return
 *  without awaiting it, which is what lets the shell paint first. */
async function CachedChecker({ decoded }: Readonly<{ decoded: string }>) {
  const { result } = await fetchCached(decoded);
  return <Checker key={decoded} initialQuery={decoded} initialResult={result} />;
}

export default async function CheckPage({ params }: Readonly<PageProps>) {
  const { ioc } = await params;
  const decoded = decodeURIComponent(ioc);
  // A URL has no passive reading. Old links to one land on its scan page, which
  // shows past scans without starting a new one.
  if (detectIOC(decoded) === "url") redirect(modeHref("active", decoded));
  // Only `params` is awaited here. The cache read happens inside the boundary
  // below, so the shell reaches the browser without waiting on Redis. A cached
  // permalink still renders its result server-side; an uncached one falls
  // through to the live streaming lookup in Checker.
  return (
    <main className="relative min-h-full">
      <Suspense fallback={<ResultSkeleton />}>
        <CachedChecker decoded={decoded} />
      </Suspense>
    </main>
  );
}
