import type { DomainCheckResult, SourceResult } from "../types";
import { domainSources } from "./registry";
import { runAll } from "../orchestrate";
import { assembleDomainResult } from "../assemble";

export async function checkDomain(
  domain: string,
  onSettled?: (result: SourceResult) => void,
): Promise<DomainCheckResult> {
  const results = await runAll(domainSources, domain, onSettled);
  return assembleDomainResult(domain, results, new Date().toISOString());
}
