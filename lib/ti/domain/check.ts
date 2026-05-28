import type { DomainCheckResult, DomainContext, SourceResult } from "../types";
import { domainSources } from "./registry";
import { aggregateRisk, computeStats } from "../aggregate";
import { mergeFields, runAll } from "../orchestrate";

/** Merge domain context from whichever sources provide it (first non-empty per field). */
function mergeContext(results: SourceResult[]): DomainContext | undefined {
  return mergeFields(
    results
      .filter((r) => r.status === "ok" && r.domainContext)
      .map((r) => r.domainContext as DomainContext),
  );
}

export async function checkDomain(
  domain: string,
  onSettled?: (result: SourceResult) => void,
): Promise<DomainCheckResult> {
  const results = await runAll(domainSources, domain, onSettled);
  const { riskScore, verdict } = aggregateRisk(results);

  return {
    domain,
    checkedAt: new Date().toISOString(),
    riskScore,
    verdict,
    context: mergeContext(results),
    sources: results,
    stats: computeStats(results),
  };
}
