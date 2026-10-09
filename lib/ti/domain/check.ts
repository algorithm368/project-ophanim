import type { DomainCheckResult, SourceResult } from "../types";
import { domainSources } from "./registry";
import { runAll } from "../orchestrate";
import { withRequestMemo } from "../request-memo";
import { recordSpend } from "../bulk/quota";
import { assembleDomainResult } from "../assemble";

export async function checkDomain(
  domain: string,
  onSettled?: (result: SourceResult) => void,
): Promise<DomainCheckResult> {
  // One search is one memo scope, so identical upstream requests made by
  // parallel sources are shared (see request-memo.ts).
  const results = await withRequestMemo(() => runAll(domainSources, domain, onSettled));
  // Bulk lookup budgets each metered key against what /check already spent
  // today. Fire and forget: the ledger must never slow or fail a lookup.
  void recordSpend(results);

  return assembleDomainResult(domain, results, new Date().toISOString());
}
