import type { GeoInput } from "../../geo/reconcile";
import type { ResolverConsensus, SourceFinding, TiSource } from "../../types";
import { errorMessage, isTimeout } from "../../http";
import { UNFILTERED_RESOLVERS, answers, dohQuery } from "../../dns/doh";
import { ipConsensus, type ResolverVote } from "../../dns/consensus";
import { reconcileGeoInputs } from "../../geo/reconcile";
import { voteAcrossIps, type IpGeoVote } from "../../geo/vote-ips";
import { ipApiSource } from "../../sources/ipapi";
import { ipWhoIsSource } from "../../sources/ipwhois";
import { ipInfoSource } from "../../sources/ipinfo";
import { ipGeolocationSource } from "../../sources/ipgeolocation";
import { freeIpApiSource } from "../../sources/freeipapi";

/** The same free/keyed geo-only providers the IP pipeline votes across,
 *  reused here one IP at a time. */
const GEO_PROVIDERS: TiSource[] = [
  ipApiSource,
  ipWhoIsSource,
  ipInfoSource,
  ipGeolocationSource,
  freeIpApiSource,
];

/** Every enabled provider's raw geo for one IP, silently dropping a provider
 *  that errored, timed out, or is disabled (no key) — reconcileGeoInputs
 *  already tolerates a thin or empty input list. */
async function geoForIp(ip: string, signal: AbortSignal): Promise<GeoInput[]> {
  const settled = await Promise.all(
    GEO_PROVIDERS.map(async (source) => {
      if (!source.isEnabled()) return null;
      try {
        const finding = await source.check(ip, signal);
        return finding.status === "ok" && finding.geo
          ? { id: source.meta.id, geo: finding.geo }
          : null;
      } catch {
        return null;
      }
    }),
  );
  return settled.filter((v): v is GeoInput => v !== null);
}

/** Every resolver/provider call below swallows its own failure into a
 *  non-vote so one flaky one cannot sink the whole source — the same pattern
 *  dnsSource uses. That means an aborted signal reads as "nothing answered"
 *  unless checked explicitly; without this, a timeout would misreport as a
 *  clean "no consensus" / "no provider located" ok result instead of timing
 *  out itself. */
function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("The operation was aborted.", "TimeoutError");
}

/**
 * Multi-resolver A-record consensus, same mechanism dnsSource uses. Resolved
 * here rather than read off dnsSource's result, because sources in this
 * pipeline run in parallel and never depend on one another's output.
 *
 * Within a search the queries themselves are shared (request-memo.ts), and the
 * DO bit is set to match dnsSource's, so both sources vote on the same live
 * answers: the "IP confidence" and "Geo confidence" cards here agree with the
 * DNS Records group even on a GeoDNS/anycast name. Run on its own, outside a
 * search, this still makes its own queries.
 */
async function resolveConsensus(domain: string, signal: AbortSignal): Promise<ResolverConsensus> {
  const votes: ResolverVote[] = await Promise.all(
    Object.entries(UNFILTERED_RESOLVERS).map(async ([resolver, url]) => {
      try {
        return { resolver, ips: answers(await dohQuery(url, domain, "A", signal, true)) };
      } catch {
        return { resolver, ips: null };
      }
    }),
  );
  return ipConsensus(votes);
}

/**
 * Domain Geo: pins where a domain's DNS currently points by geolocating the
 * A record(s) resolvers agree on, then voting across those IPs. Context-only
 * (weight 0) — this never scores or moves the verdict, it only answers
 * "Origin" the same way the IP dossier already does. See lib/ti/geo/vote-ips.ts
 * for the cross-IP vote itself; this source only wires DNS consensus to it.
 */
export const dnsGeoSource: TiSource = {
  meta: {
    id: "dns-geo",
    name: "Domain Geo",
    url: "https://cloudflare-dns.com",
    category: "context",
    requiresKey: false,
    weight: 0,
  },
  isEnabled: () => true,
  async check(domain, signal): Promise<SourceFinding> {
    try {
      const consensus = await resolveConsensus(domain, signal);
      throwIfAborted(signal);
      const domainContext = { originResolverConsensus: consensus };
      const ips = consensus.consensusIps;
      if (ips.length === 0) {
        return { status: "ok", summary: "No consensus A record to geolocate", domainContext };
      }

      const perIp = (
        await Promise.all(
          ips.map(async (ip): Promise<IpGeoVote | null> => {
            const resolution = reconcileGeoInputs(await geoForIp(ip, signal));
            return resolution ? { ip, resolution } : null;
          }),
        )
      ).filter((v): v is IpGeoVote => v !== null);
      throwIfAborted(signal);

      const geoResolution = voteAcrossIps(perIp);
      if (!geoResolution?.country) {
        return {
          status: "ok",
          summary: "No provider located the resolved IP(s)",
          domainContext,
        };
      }

      const city = geoResolution.city ? `, ${geoResolution.city.value}` : "";
      return {
        status: "ok",
        summary: `${geoResolution.country.value}${city}, from ${perIp.length} resolved IP(s)`,
        geoResolution,
        domainContext,
      };
    } catch (err) {
      return { status: isTimeout(err) ? "timeout" : "error", error: errorMessage(err) };
    }
  },
};
