import type { SourceFinding, TiSource } from "../../types";
import { errorMessage, isTimeout } from "../../http";
import { resolveA } from "../../dns/doh";
import { fetchNetworkInfo, fetchRpkiStatus, rpkiCategories } from "../../sources/ripestat";

const INVALID_SCORE = 60;

/**
 * RPKI Origin Validation: resolves the domain's current IP, then asks
 * RIPEstat whether the AS actually announcing that IP's route is the one a
 * published ROA authorizes. This sits below DNS entirely — a domain can
 * resolve to a genuinely-controlled IP and still have its traffic diverted
 * by a BGP hijack, which no DNS-level check (consensus, FCrDNS) can see,
 * because the hijack reroutes packets, not names.
 *
 * Weighted moderately (0.4) rather than as a hard listing on an invalid_*
 * result: RPKI deployment is still partial, so "unknown" (no ROA published)
 * is the common case and never scored, but an explicit invalid_asn or
 * invalid_length is a cryptographically-checkable fact, not a heuristic,
 * so it still counts for something even alone.
 */
export const rpkiSource: TiSource = {
  meta: {
    id: "rpki",
    name: "RPKI Origin Validation",
    url: "https://stat.ripe.net",
    category: "reputation",
    requiresKey: false,
    weight: 0.4,
    timeoutMs: 12000,
  },
  isEnabled: () => true,
  async check(domain, signal): Promise<SourceFinding> {
    try {
      const ip = (await resolveA(domain, signal))[0];
      if (!ip) {
        return { status: "ok", summary: "No resolved IP to validate" };
      }

      const net = await fetchNetworkInfo(ip, signal);
      const asn = (net?.asns ?? []).find(Boolean);
      const prefix = net?.prefix;
      if (!asn || !prefix) {
        return { status: "ok", summary: `${ip} is not announced in BGP` };
      }

      const rpkiStatus = await fetchRpkiStatus(asn, prefix, signal);
      // null means the RIPEstat request itself failed — unlike ripeStatSource's
      // best-effort +1 call, this source's whole point is the RPKI answer, so a
      // failed lookup must not read as the specific, different claim "no ROA
      // published" (issue found in review: a RIPEstat outage would otherwise
      // silently report as ok with a fabricated result).
      if (rpkiStatus === null) {
        return { status: "error", error: "RIPEstat RPKI validation lookup failed" };
      }
      const categories = rpkiCategories(rpkiStatus);
      const invalid = categories.length > 0;

      return {
        status: "ok",
        score: invalid ? INVALID_SCORE : undefined,
        categories,
        summary: invalid
          ? `${ip} (${prefix}, AS${asn}) fails RPKI origin validation: ${rpkiStatus}`
          : `${ip} (${prefix}, AS${asn}) RPKI origin: ${rpkiStatus ?? "no ROA published"}`,
        details: { ip, prefix, asn, rpkiStatus },
      };
    } catch (err) {
      return { status: isTimeout(err) ? "timeout" : "error", error: errorMessage(err) };
    }
  },
};
