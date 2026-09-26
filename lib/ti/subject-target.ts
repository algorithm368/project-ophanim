import type { IOCType } from "@/lib/ioc";
import { parseUrl } from "@/lib/url";

/** The two kinds of thing an active scan can have an identity record for. A
 *  hash has no address to visit, so it never reaches this. */
export type SubjectKind = "ip" | "domain";

export interface SubjectTarget {
  subjectKind: SubjectKind;
  /** The indicator the identity lookup is actually about. */
  subject: string;
  /** The path/query that was scanned but is not part of that identity. Only a
   *  url indicator has one. */
  context?: string;
}

/**
 * What identity lookup answers for a scanned indicator, and how to reach it.
 *
 * A url indicator's subject is its host, not the URL itself, so this resolves
 * to the ip/domain the host actually is; `context` carries the path and query
 * that were scanned, which belong to the scan rather than to the host.
 *
 * This lives in lib rather than beside the scan report because both sides of
 * the page need it: the server reads the subject's cached record with it before
 * rendering, and the client falls back to fetching that same subject on a miss.
 * Two copies would mean the fetch could ask about a different thing than the
 * cache read did.
 */
export function subjectTargetFor(
  indicator: string,
  kind: IOCType,
): SubjectTarget | null {
  if (kind === "ip") return { subjectKind: "ip", subject: indicator };
  if (kind === "domain") return { subjectKind: "domain", subject: indicator };
  if (kind === "url") {
    const parsed = parseUrl(indicator);
    if (!parsed) return null;
    const query = parsed.query ? "?" + parsed.query : "";
    const context =
      parsed.path !== "/" || query ? parsed.path + query : undefined;
    return {
      subjectKind: parsed.isIpHost ? "ip" : "domain",
      subject: parsed.host,
      context,
    };
  }
  return null;
}
