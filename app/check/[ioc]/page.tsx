import type { Metadata } from "next";
import { cache } from "react";
import Checker from "@/components/Checker";
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

    let stored: AnyCheckResult | null;
    if (kind === "domain") stored = await getCachedDomainResult(decoded);
    else if (kind === "hash") stored = await getCachedHashResult(decoded);
    else stored = await getCachedResult(decoded);
    if (!stored) return null;

    // `kind` and the route factory's `label` are the same three strings, which
    // is what keeps this reading the keys recordHistory() writes.
    const history = await getHistory(kind, decoded);
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

export default async function CheckPage({ params }: Readonly<PageProps>) {
  const { ioc } = await params;
  const decoded = decodeURIComponent(ioc);
  // A cached permalink renders its result immediately (no client round-trip);
  // an uncached one falls through to the live streaming lookup in Checker.
  const initialResult = await fetchCached(decoded);
  return (
    <main className="relative min-h-full">
      <Checker
        key={decoded}
        initialQuery={decoded}
        initialResult={initialResult}
      />
    </main>
  );
}
