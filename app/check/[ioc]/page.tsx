import type { Metadata } from "next";
import { cache, Suspense } from "react";
import Checker from "@/components/Checker";
import { ResultSkeleton } from "@/components/result-skeleton";
import { detectIOC } from "@/lib/ioc";
import {
  getCachedDomainResult,
  getCachedHashResult,
  getCachedResult,
} from "@/lib/ti/cache";
import { getHistory } from "@/lib/ti/history";
import type {
  AnyCheckResult,
} from "@/lib/ti/types";

interface PageProps {
  params: Promise<{ ioc: string }>;
}

const VERDICT_LABEL: Record<string, string> = {
  clean: "Clean",
  low: "Low risk",
  suspicious: "Suspicious",
  malicious: "Malicious",
};

/** Read the cached result for an indicator (or null). Memoized per request so
 *  generateMetadata and the page share a single cache read.
 *
 *  Mirrors what the API's cache branch returns, not just the stored value: the
 *  `cached` flag and the history are added there, and a permalink that dropped
 *  them rendered a five-hour-old result labelled "re-check" with no reputation
 *  timeline, which is the one page where the timeline is most wanted. The
 *  history read is the same one the route makes, on a cache hit only. */
const fetchCached = cache(
  async (
    decoded: string,
  ): Promise<AnyCheckResult | null> => {
    const kind = detectIOC(decoded);
    if (!kind) return null;

    let getCached: (indicator: string) => Promise<AnyCheckResult | null> =
      getCachedResult;
    if (kind === "domain") getCached = getCachedDomainResult;
    else if (kind === "hash") getCached = getCachedHashResult;

    // `kind` and the route factory's `label` are the same three strings, which
    // is what keeps this reading the keys recordHistory() writes. Speculative,
    // mirroring the route's own cache branch: discard history on a miss.
    const [stored, history] = await Promise.all([
      getCached(decoded),
      getHistory(kind, decoded),
    ]);
    if (!stored) return null;

    return { ...stored, cached: true, history };
  },
);

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { ioc } = await params;
  const decoded = decodeURIComponent(ioc);

  // Best-effort: if a prior check is cached, surface its verdict in the title.
  const cached = await fetchCached(decoded);
  const verdictLabel = cached?.verdict
    ? VERDICT_LABEL[cached.verdict]
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
  const initialResult = await fetchCached(decoded);
  return (
    <Checker
      key={decoded}
      initialQuery={decoded}
      initialResult={initialResult}
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
      <Suspense fallback={<ResultSkeleton indicator={decoded} />}>
        <CachedChecker decoded={decoded} />
      </Suspense>
    </main>
  );
}
