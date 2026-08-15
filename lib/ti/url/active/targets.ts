import type { IOCType } from "@/lib/ioc";
import { parseIP } from "@/lib/ip";
import { parseDomain } from "@/lib/domain";
import { parseUrl } from "@/lib/url";

/**
 * The URLs an active scan would submit for an indicator.
 *
 * A URL scans itself. A domain scans its https root. An IP scans **both**
 * ports, because a bare address carries no scheme to infer one from and the two
 * routinely serve different things: a redirect stub on 80 and the real
 * application on 443, or a default vhost on 443 while 80 hosts the payload.
 * Submitting one would report half the host while looking complete.
 *
 * A hash has no address to visit, so it gets nothing rather than a guess.
 *
 * Every returned URL is canonical and carries no userinfo: credentials in a URL
 * are a signal for the local heuristics, never something to hand a third party.
 */
export function scanTargetsFor(indicator: string, kind: IOCType): string[] {
  if (kind === "hash") return [];

  if (kind === "url") {
    const parsed = parseUrl(indicator);
    return parsed ? [parsed.canonical] : [];
  }

  if (kind === "ip") {
    const ip = parseIP(indicator);
    if (!ip) return [];
    // An IPv6 literal has to be bracketed or the authority is unparseable.
    const host = ip.version === 6 ? `[${ip.ip}]` : ip.ip;
    return [`http://${host}/`, `https://${host}/`];
  }

  const domain = parseDomain(indicator);
  return domain ? [`https://${domain.domain}/`] : [];
}
