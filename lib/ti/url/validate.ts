import { parseDomain } from "@/lib/domain";
import { parseIP } from "@/lib/ip";
import { parseUrl } from "@/lib/url";

export interface UrlProblem {
  message: string;
  status: 400 | 422;
  /** Why the indicator is out of scope, echoed to the client like the other
   *  routes do for reserved names. */
  scope?: string;
}

/**
 * Decide whether a URL is checkable, returning null when it is.
 *
 * Kept separate from the route so the decision is unit-testable: it composes
 * three parsers and the reserved and non-routable cases are exactly the kind of
 * rule that regresses without anyone noticing.
 *
 * A URL carrying credentials is deliberately accepted. That shape is a phishing
 * signal the heuristics need to see, so rejecting it at the boundary would
 * discard the finding; the credentials are stripped from the canonical form
 * before anything is sent to a third party.
 */
export function urlIndicatorProblem(raw: string): UrlProblem | null {
  const parsed = parseUrl(raw);
  if (!parsed) return { message: "Invalid URL", status: 400 };

  const ip = parseIP(parsed.host);
  if (ip) {
    if (ip.isPrivate || ip.isReserved) {
      return {
        message: `Cannot check non-routable address: ${ip.scopeNote ?? "reserved range"}`,
        status: 422,
        scope: ip.scopeNote,
      };
    }
    return null;
  }

  const domain = parseDomain(parsed.host);
  if (!domain) return { message: "Invalid host in URL", status: 400 };
  if (domain.isReserved) {
    return {
      message: `Cannot check special-use domain: ${domain.scopeNote}`,
      status: 422,
      scope: domain.scopeNote,
    };
  }
  return null;
}
