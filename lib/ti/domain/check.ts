import type { DomainCheckResult, SourceResult } from "../types";
import { domainSources } from "./registry";
import { runAll } from "../orchestrate";
import { withRequestMemo } from "../request-memo";
import { assembleDomainResult } from "../assemble";

export async function checkDomain(
  domain: string,
  onSettled?: (result: SourceResult) => void,
): Promise<DomainCheckResult> {
  // One search is one memo scope, so identical upstream requests made by
  // parallel sources are shared (see request-memo.ts).
  const results = await withRequestMemo(() => runAll(domainSources, domain, onSettled));
  return assembleDomainResult(domain, results, new Date().toISOString());
}
