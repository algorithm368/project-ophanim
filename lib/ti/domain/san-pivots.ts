import { parseDomain } from "../../domain";

/**
 * Distinct registrable domains in a certificate SAN list that differ from the
 * queried apex — i.e. *other* sites named on the same certificate. Shared certs
 * are an infrastructure pivot (common with a single org's properties, or with a
 * compromised shared host). Wildcards are de-starred; results are capped because
 * multi-tenant certs (CDN universal SSL) can carry many unrelated SANs.
 */
export function crossApexSans(
  sanNames: string[] | undefined,
  apex: string,
  cap = 10,
): string[] {
  const apexLc = apex.toLowerCase();
  const out = new Set<string>();
  for (const raw of sanNames ?? []) {
    if (typeof raw !== "string") continue;
    const name = raw.trim().toLowerCase().replace(/^\*\./, "");
    if (!name || name === apexLc) continue;
    const reg = parseDomain(name)?.registrable;
    if (reg && reg !== apexLc) out.add(reg);
  }
  return [...out].slice(0, cap);
}
