import type { SourceFinding, TiSource } from "../../types";
import { errorMessage, isTimeout } from "../../http";
import { cloudPrefixes, matchPrefix } from "../../cloud-ranges";
import { RESOLVERS, answers, dohQuery } from "../../dns/doh";

// A supplement, not the main path: two live domains tested against the real
// pipeline both resolved straight into a provider's own IPv4 range with an
// empty CNAME, so this rarely fires. It is free and already one DoH query
// away, and it catches the case the prefix list misses - a CDN edge reached
// only through the hostname, never a raw address this source can match (#59).
const CNAME_SUFFIXES: { suffix: string; provider: string }[] = [
  { suffix: ".cloudfront.net", provider: "Amazon Web Services" },
  { suffix: ".azureedge.net", provider: "Microsoft Azure" },
  { suffix: ".googleusercontent.com", provider: "Google Cloud" },
];

function providerFromCname(cnames: string[]): string | undefined {
  return cnames
    .map((name) => name.toLowerCase().replace(/\.$/, ""))
    .map((name) => CNAME_SUFFIXES.find((s) => name.endsWith(s.suffix)))
    .find((hit) => hit !== undefined)?.provider;
}

/**
 * Which cloud provider a domain currently resolves into, from the providers'
 * own published prefix lists. The IP version of this source
 * (`lib/ti/sources/cloud-range.ts`) answers "this address is the provider's
 * edge"; a domain match answers something weaker. Behind a shared edge like
 * Cloudflare the origin server is not visible from here, so the claim this
 * source supports is "resolves behind X", never "is X" - `subject-record.ts`
 * renders the two differently for exactly this reason (#59).
 *
 * Context only, weight 0, for the same reason as the IP version: which
 * provider a domain sits behind is neither incriminating nor exonerating.
 */
export const cloudRangeSource: TiSource = {
  meta: {
    id: "cloud-range",
    name: "Cloud provider ranges",
    url: "https://ip-ranges.amazonaws.com/ip-ranges.json",
    category: "context",
    requiresKey: false,
    weight: 0,
  },
  isEnabled: () => true,
  async check(domain, signal): Promise<SourceFinding> {
    try {
      const [aRes, cnameRes, prefixes] = await Promise.all([
        // DO bit matches dnsSource, so the request is shared within a search.
        dohQuery(RESOLVERS.cloudflare, domain, "A", signal, true),
        dohQuery(RESOLVERS.cloudflare, domain, "CNAME", signal),
        cloudPrefixes(signal),
      ]);
      if (prefixes.length === 0) {
        return { status: "error", error: "No provider list could be fetched" };
      }

      const ips = answers(aRes);
      const hit = ips.map((ip) => matchPrefix(ip, prefixes)).find((m) => m !== undefined);
      if (hit) {
        const detail = [hit.region, hit.service].filter(Boolean).join(", ");
        const where = detail ? ` (${detail})` : "";
        return {
          status: "ok",
          categories: ["cloud-hosted"],
          summary: `Resolves behind ${hit.provider}${where}, announced in ${hit.cidr}`,
          details: {
            provider: hit.provider,
            region: hit.region,
            service: hit.service,
            cidr: hit.cidr,
          },
        };
      }

      const cnameProvider = providerFromCname(answers(cnameRes));
      if (cnameProvider) {
        return {
          status: "ok",
          categories: ["cloud-hosted"],
          summary: `Resolves behind ${cnameProvider}, via its CNAME`,
          details: { provider: cnameProvider },
        };
      }

      return { status: "ok", summary: "Does not resolve into a published cloud range" };
    } catch (err) {
      return {
        status: isTimeout(err) ? "timeout" : "error",
        error: errorMessage(err),
      };
    }
  },
};
