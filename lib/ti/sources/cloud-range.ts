import type { SourceFinding, TiSource } from "../types";
import { errorMessage, isTimeout } from "../http";
import { cloudPrefixes, matchPrefix } from "../cloud-ranges";

/**
 * Which cloud provider announces an address, from the providers' own published
 * prefix lists.
 *
 * `lib/ti/cloud.ts` already answers a coarser version of this from the ASN, and
 * still does when this source cannot reach a provider. What the published lists
 * add is the detail the ASN cannot carry: the region an address sits in and the
 * service it belongs to. "AWS eu-west-1 EC2" and "Cloudflare edge" lead to
 * different next steps, and neither is what a generic "hosting or datacenter
 * infrastructure" flag conveys today.
 *
 * Context only, weight 0. Being on a cloud provider is neither incriminating
 * nor exonerating: it is where most of the internet lives. It changes what an
 * abuse report *means*, which is a judgement for the analyst, and for a shared
 * edge like Cloudflare it is the reason a report about the address may say
 * nothing about the site behind it.
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
  async check(ip, signal): Promise<SourceFinding> {
    try {
      const prefixes = await cloudPrefixes(signal);
      if (prefixes.length === 0) {
        return { status: "error", error: "No provider list could be fetched" };
      }
      const hit = matchPrefix(ip, prefixes);
      if (!hit) {
        return { status: "ok", summary: "Not in a published cloud range" };
      }

      const detail = [hit.region, hit.service].filter(Boolean).join(", ");
      const where = detail ? ` (${detail})` : "";
      return {
        status: "ok",
        categories: ["cloud-hosted"],
        summary: `${hit.provider}${where}, announced in ${hit.cidr}`,
        details: {
          provider: hit.provider,
          region: hit.region,
          service: hit.service,
          cidr: hit.cidr,
        },
        geo: { isHosting: true },
      };
    } catch (err) {
      return {
        status: isTimeout(err) ? "timeout" : "error",
        error: errorMessage(err),
      };
    }
  },
};
