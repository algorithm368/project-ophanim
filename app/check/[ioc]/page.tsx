import type { Metadata } from "next";
import { cache, Suspense } from "react";
import Checker from "@/components/Checker";
import { ResultSkeleton } from "@/components/result-skeleton";
import { detectIOC } from "@/lib/ioc";
import { getCachedResultFor, getCachedScanBatch } from "@/lib/ti/cache";
import { getHistory } from "@/lib/ti/history";
import { readScanCredentials } from "@/lib/ti/url/active/credentials";
import type { KnownScan } from "@/components/CheckResults/active-scan";
import type { AnyCheckResult } from "@/lib/ti/types";
import type { UrlCheckResult } from "@/lib/ti/url/types";

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
  result: AnyCheckResult | UrlCheckResult | null;
  /** Whether this indicator has ever been actively scanned, and whether this
   *  deployment could scan it at all. Answered here rather than fetched by
   *  `ActiveScanCard`, which used to spend a client round-trip on a question
   *  this page was already holding a Redis connection open for, and which on
   *  a batch still running would set the scan engines polling as a side
   *  effect of somebody opening the passive page. */
  knownScan: KnownScan;
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
  const configured = readScanCredentials().any;
  const kind = detectIOC(decoded);
  if (!kind) return { result: null, knownScan: { batch: null, configured } };

  // `kind` and the route factory's `label` are the same strings, which is what
  // keeps this reading the keys recordHistory() writes. The history read is
  // speculative, mirroring the route's own cache branch: discarded on a miss.
  const [stored, history, batch] = await Promise.all([
    getCachedResultFor(kind, decoded),
    getHistory(kind, decoded),
    getCachedScanBatch(decoded),
  ]);

  return {
    result: stored ? { ...stored, cached: true, history } : null,
    knownScan: { batch, configured },
  };
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
  const { result, knownScan } = await fetchCached(decoded);
  return (
    <Checker
      key={decoded}
      initialQuery={decoded}
      initialResult={result}
      knownScan={knownScan}
    />
  );
}

export default async function CheckPage({ params }: Readonly<PageProps>) {
  const { ioc } = await params;
  const decoded = decodeURIComponent(ioc);
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
