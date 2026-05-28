import type { HashCheckResult, HashContext, SourceResult } from "../types";
import type { HashAlgorithm } from "@/lib/hash";
import { hashSources } from "./registry";
import { aggregateRisk, computeStats } from "../aggregate";
import { mergeFields, runAll } from "../orchestrate";

/** Merge file context from whichever sources provide it (first non-empty per field). */
function mergeContext(results: SourceResult[]): HashContext | undefined {
  return mergeFields(
    results
      .filter((r) => r.status === "ok" && r.hashContext)
      .map((r) => r.hashContext as HashContext),
  );
}

export async function checkHash(
  hash: string,
  algorithm: HashAlgorithm,
  onSettled?: (result: SourceResult) => void,
): Promise<HashCheckResult> {
  const results = await runAll(hashSources, hash, onSettled);
  const { riskScore, verdict } = aggregateRisk(results);

  return {
    hash,
    algorithm,
    checkedAt: new Date().toISOString(),
    riskScore,
    verdict,
    context: mergeContext(results),
    sources: results,
    stats: computeStats(results),
  };
}
