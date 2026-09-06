import type { SourceFinding, TiSource } from "../../types";
import { errorMessage, isTimeout } from "../../http";
import { RESOLVERS, answers, dohQuery, resolveA } from "../../dns/doh";
import { verifyFcrdns } from "../../dns/fcrdns";

/**
 * Domain FCrDNS: resolves the domain's current IP, then runs the same
 * forward-confirmed reverse DNS check the IP pipeline's reverseDnsSource
 * already does (PTR the IP, forward-resolve the hostname, confirm it points
 * back). Context-only, same as its IP-side counterpart: a mismatch is common
 * on legitimate shared hosting and CDN edges that never bother maintaining an
 * accurate PTR, so it is far weaker evidence than an RPKI failure and does
 * not move the score.
 */
export const domainFcrdnsSource: TiSource = {
  meta: {
    id: "fcrdns",
    name: "Reverse DNS (FCrDNS)",
    url: "https://cloudflare-dns.com",
    category: "context",
    requiresKey: false,
    weight: 0,
  },
  isEnabled: () => true,
  async check(domain, signal): Promise<SourceFinding> {
    try {
      const ip = (await resolveA(domain, signal))[0];
      if (!ip) {
        return { status: "ok", summary: "No resolved IP to verify" };
      }

      const resolve = async (name: string, type: "PTR" | "A" | "AAAA") =>
        answers(await dohQuery(RESOLVERS.cloudflare, name, type, signal));

      const fcrdns = await verifyFcrdns(ip, resolve);
      if (!fcrdns) {
        return { status: "ok", summary: `${ip} has no PTR record` };
      }

      return {
        status: "ok",
        summary: fcrdns.verified
          ? `${ip} PTR ${fcrdns.hostname} (forward-confirmed)`
          : `${ip} PTR ${fcrdns.hostname} (unconfirmed, forward record does not match)`,
        details: { ip, hostname: fcrdns.hostname, forwardConfirmed: fcrdns.verified },
      };
    } catch (err) {
      return { status: isTimeout(err) ? "timeout" : "error", error: errorMessage(err) };
    }
  },
};
