import type { Metadata } from "next";
import { cache } from "react";
import Checker from "@/components/Checker";
import { detectIOC } from "@/lib/ioc";
import {
  getCachedDomainResult,
  getCachedHashResult,
  getCachedResult,
} from "@/lib/ti/cache";
import type {
  CheckResult,
  DomainCheckResult,
  HashCheckResult,
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
 *  generateMetadata and the page share a single cache read. */
const fetchCached = cache(
  async (
    decoded: string,
  ): Promise<CheckResult | DomainCheckResult | HashCheckResult | null> => {
    const kind = detectIOC(decoded);
    if (!kind) return null;
    if (kind === "domain") return getCachedDomainResult(decoded);
    if (kind === "hash") return getCachedHashResult(decoded);
    return getCachedResult(decoded);
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
    ? `${decoded} — ${verdictLabel} | Project Ophanim`
    : `${decoded} | Project Ophanim`;

  return {
    title,
    description: `Threat-intelligence reputation for ${decoded}.`,
  };
}

export default async function CheckPage({ params }: PageProps) {
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
