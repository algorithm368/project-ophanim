import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ResultSkeleton } from "@/components/result-skeleton";
import { detectIOC } from "@/lib/ioc";
import type { IOCType } from "@/lib/ioc";
import { getCachedResultFor, getCachedScanBatch } from "@/lib/ti/cache";
import { subjectTargetFor } from "@/lib/ti/subject-target";
import { scanTargetsFor } from "@/lib/ti/url/active/targets";
import type { CheckResult, DomainCheckResult } from "@/lib/ti/types";
import { ScanReport } from "@/components/ScanReport";

interface PageProps {
  params: Promise<{ indicator: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { indicator } = await params;
  const decoded = decodeURIComponent(indicator);
  return {
    title: `Active scan, ${decoded} | Project Ophanim`,
    description: `What ${decoded} serves when it is visited.`,
  };
}

/**
 * The active scan as its own page.
 *
 * The indicator is percent-encoded in the path exactly as `/check/[ioc]` does
 * it, so a URL indicator survives being a path segment. A cached batch renders
 * immediately; an uncached one shows the confirmation, because a scan is never
 * something a page load performs on the analyst's behalf.
 */
export default async function ScanPage({ params }: Readonly<PageProps>) {
  const { indicator } = await params;
  const decoded = decodeURIComponent(indicator);
  const kind = detectIOC(decoded);
  const targets = kind ? scanTargetsFor(decoded, kind) : [];

  // A hash has no address to visit, and an unparseable indicator has nothing to
  // send. Say which, rather than serving an empty scan page.
  if (!kind || targets.length === 0) {
    return (
      <main className="mx-auto w-full max-w-5xl space-y-3 px-4 py-16">
        <h1 className="font-mono text-lg break-all">{decoded}</h1>
        <p className="text-sm text-foreground/75">
          {kind === "hash"
            ? "A file hash has no address to visit, so there is nothing to scan actively. Its reputation is a passive lookup."
            : "This does not parse as an IP, a domain, or a URL, so there is nothing to scan."}
        </p>
        <Link
          href={`/check/${encodeURIComponent(decoded)}`}
          className="inline-block text-sm text-foreground/60 underline underline-offset-2 hover:text-foreground"
        >
          Check it passively instead
        </Link>
      </main>
    );
  }

  return (
    // Same container as Checker on /check, so the scan page and the result page
    // are the same width and the banner rule lines up across both.
    <main className="mx-auto w-full max-w-5xl px-4 py-6">
      <Suspense fallback={<ResultSkeleton />}>
        <CachedScanReport decoded={decoded} kind={kind} />
      </Suspense>
    </main>
  );
}

/**
 * The half that waits on Redis, so the page itself need not.
 *
 * Both reads happen here, and the second one is the point: the subject's
 * identity record used to be fetched from the browser on every single page
 * load, which meant `GET /api/check` and, on a cache miss there, the entire
 * passive fan-out across every registered source, for a card that is not even
 * what this page is about. Read here it costs one more Redis GET alongside the
 * batch, it lands in the first paint instead of arriving late and pushing the
 * report down, and the client only reaches for the network when this misses.
 */
async function CachedScanReport({
  decoded,
  kind,
}: Readonly<{ decoded: string; kind: IOCType }>) {
  const target = subjectTargetFor(decoded, kind);
  const [initialBatch, subject] = await Promise.all([
    getCachedScanBatch(decoded),
    target ? getCachedResultFor(target.subjectKind, target.subject) : null,
  ]);

  return (
    <ScanReport
      indicator={decoded}
      kind={kind}
      initialBatch={initialBatch}
      // Narrowed by the subject kind that produced it: `subjectTargetFor` only
      // ever answers ip or domain, so the url/hash arms of the cache dispatch
      // are unreachable from here.
      initialSubject={(subject as CheckResult | DomainCheckResult) ?? null}
    />
  );
}
