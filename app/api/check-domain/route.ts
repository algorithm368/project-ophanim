import { parseDomain } from "@/lib/domain";
import { checkDomain } from "@/lib/ti/domain/check";
import { domainSources } from "@/lib/ti/domain/registry";
import {
  getCachedDomainResult,
  setCachedDomainResult,
} from "@/lib/ti/cache";
import { makeIndicatorRoute, type Validated } from "@/lib/ti/route-handler";
import type { DomainCheckResult } from "@/lib/ti/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Validate the domain up front, returning the clean name or an error Response. */
function validateDomain(raw: string | null): Validated<string> {
  if (!raw) {
    return {
      error: Response.json(
        { error: "Missing 'domain' parameter" },
        { status: 400 },
      ),
    };
  }
  const parsed = parseDomain(raw);
  if (!parsed) {
    return {
      error: Response.json({ error: "Invalid domain name" }, { status: 400 }),
    };
  }
  if (parsed.isReserved) {
    return {
      error: Response.json(
        {
          error: `Cannot check special-use domain: ${parsed.scopeNote}`,
          scope: parsed.scopeNote,
        },
        { status: 422 },
      ),
    };
  }
  return { value: parsed.domain };
}

export const { GET, POST } = makeIndicatorRoute<string, DomainCheckResult>({
  paramName: "domain",
  label: "domain",
  sources: domainSources,
  validate: validateDomain,
  getCached: (domain) => getCachedDomainResult(domain),
  setCached: (domain, result) => setCachedDomainResult(domain, result),
  run: (domain, onSettled) => checkDomain(domain, onSettled),
});
