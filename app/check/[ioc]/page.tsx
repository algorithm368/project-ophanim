import type { Metadata } from "next";
import Checker from "@/components/Checker";
import { detectIOC } from "@/lib/ioc";
import {
  getCachedDomainResult,
  getCachedHashResult,
  getCachedResult,
} from "@/lib/ti/cache";

interface PageProps {
  params: Promise<{ ioc: string }>;
}

const VERDICT_LABEL: Record<string, string> = {
  clean: "Clean",
  low: "Low risk",
  suspicious: "Suspicious",
  malicious: "Malicious",
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { ioc } = await params;
  const decoded = decodeURIComponent(ioc);

  // Best-effort: if a prior check is cached, surface its verdict in the title.
  let verdictLabel: string | undefined;
  const kind = detectIOC(decoded);
  if (kind) {
    const cached =
      kind === "domain"
        ? await getCachedDomainResult(decoded)
        : kind === "hash"
          ? await getCachedHashResult(decoded)
          : await getCachedResult(decoded);
    if (cached?.verdict) verdictLabel = VERDICT_LABEL[cached.verdict];
  }

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
  return (
    <main className="relative min-h-full overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-96 bg-gradient-to-b from-primary/8 via-primary/3 to-transparent"
      />
      <div className="relative">
        <Checker key={decoded} initialQuery={decoded} />
      </div>
    </main>
  );
}
