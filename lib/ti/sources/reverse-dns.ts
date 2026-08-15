import type { SourceFinding, TiSource } from "../types";
import { errorMessage, isTimeout } from "../http";
import { RESOLVERS, answers, dohQuery } from "../dns/doh";
import { verifyFcrdns } from "../dns/fcrdns";

/** FCrDNS for an IP via Cloudflare DoH (no key). Context only, no risk score. */
export const reverseDnsSource: TiSource = {
  meta: {
    id: "reverse-dns",
    name: "Reverse DNS (FCrDNS)",
    url: "https://cloudflare-dns.com",
    category: "context",
    requiresKey: false,
    weight: 0,
  },
  isEnabled: () => true,
  async check(ip, signal): Promise<SourceFinding> {
    try {
      const resolve = async (name: string, type: "PTR" | "A" | "AAAA") =>
        answers(await dohQuery(RESOLVERS.cloudflare, name, type, signal));

      const fcrdns = await verifyFcrdns(ip, resolve);
      if (!fcrdns) {
        return { status: "ok", summary: "No PTR record" };
      }
      return {
        status: "ok",
        summary: fcrdns.verified
          ? `PTR ${fcrdns.hostname} (forward-confirmed)`
          : `PTR ${fcrdns.hostname} (unconfirmed, forward record does not match)`,
        details: { hostname: fcrdns.hostname, forwardConfirmed: fcrdns.verified },
        geo: { reverse: fcrdns.hostname, fcrdns },
      };
    } catch (err) {
      return { status: isTimeout(err) ? "timeout" : "error", error: errorMessage(err) };
    }
  },
};
