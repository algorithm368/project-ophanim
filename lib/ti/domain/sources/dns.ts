import type { SourceFinding, TiSource } from "../../types";
import { errorMessage, isTimeout } from "../../http";
import {
  RESOLVERS,
  UNFILTERED_RESOLVERS,
  answers,
  dohQuery,
  type DohResponse,
} from "../../dns/doh";
import { ipConsensus, type ResolverVote } from "../../dns/consensus";
import {
  decodeCaa,
  dnssecStatus,
  extractDmarc,
  extractSpf,
  normalizeMxHosts,
} from "../../dns/parse";
import { count } from "@/lib/text";

const CF = RESOLVERS.cloudflare;

/** PTR each resolved IPv4, returning the first hostname per IP. */
async function ptrAll(ips: string[], signal: AbortSignal): Promise<string[]> {
  const names = await Promise.all(
    ips.map(async (ip) => {
      const ptr = `${ip.split(".").reverse().join(".")}.in-addr.arpa`;
      return answers(await dohQuery(CF, ptr, "PTR", signal))[0];
    }),
  );
  // Distinct hostnames only — multiple IPs commonly share one PTR (e.g. both
  // of dns.google's IPs reverse to "dns.google").
  return [...new Set(names.filter((n): n is string => Boolean(n)))];
}

/** DNS-over-HTTPS resolution with multi-resolver agreement, records, PTR, DNSSEC. */
export const dnsSource: TiSource = {
  meta: {
    id: "dns",
    name: "DNS Records",
    url: "https://cloudflare-dns.com",
    category: "context",
    requiresKey: false,
    weight: 0,
  },
  isEnabled: () => true,
  async check(domain, signal): Promise<SourceFinding> {
    try {
      // Resolve every record set concurrently in a single batch. The A record
      // is queried at every unfiltered resolver (DNSSEC DO bit set) for a
      // consensus vote; each per-resolver query is caught so one slow resolver
      // yields a non-vote rather than failing the batch. The rest go to
      // Cloudflare.
      const [aByResolver, aaaa, mx, ns, txt, soa, cname, caa, dmarcTxt] =
        await Promise.all([
          Promise.all(
            Object.entries(UNFILTERED_RESOLVERS).map(async ([id, url]) => {
              try {
                return { id, res: await dohQuery(url, domain, "A", signal, true) };
              } catch {
                return { id, res: null as DohResponse | null };
              }
            }),
          ),
          dohQuery(CF, domain, "AAAA", signal),
          dohQuery(CF, domain, "MX", signal),
          dohQuery(CF, domain, "NS", signal),
          dohQuery(CF, domain, "TXT", signal),
          dohQuery(CF, domain, "SOA", signal),
          dohQuery(CF, domain, "CNAME", signal),
          dohQuery(CF, domain, "CAA", signal),
          dohQuery(CF, `_dmarc.${domain}`, "TXT", signal),
        ]);

      // Consensus over the unfiltered pool. A null response is a non-vote.
      const votes: ResolverVote[] = aByResolver.map(({ id, res }) => ({
        resolver: id,
        ips: res === null ? null : answers(res),
      }));
      const consensus = ipConsensus(votes);
      const resolvedIps = consensus.consensusIps;

      // Pull the two anchor responses back out for NXDOMAIN + DNSSEC.
      const aCf = aByResolver.find((r) => r.id === "cloudflare")?.res ?? null;
      const aGoogle = aByResolver.find((r) => r.id === "google")?.res ?? null;
      const ipv6 = answers(aaaa);
      const mxHosts = normalizeMxHosts(answers(mx));
      const nsHosts = answers(ns);
      const txtRecords = answers(txt);
      const dmarcRecords = answers(dmarcTxt);
      // Parse the TXT/CAA-derived fields once; they feed both `details` and
      // `domainContext` below.
      const spf = extractSpf(txtRecords);
      const dmarc = extractDmarc(dmarcRecords);
      const caaRecords = answers(caa).map(decodeCaa);
      const reverse = await ptrAll(resolvedIps, signal);

      const dnssec = dnssecStatus([aCf, aGoogle] as (DohResponse | null)[]);

      const resolves = resolvedIps.length > 0 || ipv6.length > 0;
      const nxdomain = aCf?.Status === 3;

      let summary: string;
      if (resolves) {
        const first = resolvedIps[0] ?? ipv6[0];
        const hostCount = resolvedIps.length + ipv6.length;
        const extra =
          hostCount > 1 ? ` (+${count(hostCount - 1, "more host")})` : "";
        const mail =
          mxHosts.length > 0
            ? ` Mail routed via ${mxHosts[0]}.`
            : " No MX present; not mail-bearing.";
        const disagree =
          consensus.bucket === "low"
            ? ` Resolvers split on the A record, ${consensus.agreeCount} of ${consensus.respondingResolvers} agree.`
            : "";
        summary = `Live infrastructure at check time. Apex resolves to ${first}${extra}.${mail}${disagree}`;
      } else if (nxdomain) {
        summary =
          "Apex returns NXDOMAIN. No live infrastructure (parked, expired, or sinkholed); not currently actionable as a host.";
      } else {
        summary =
          "DNS zone present but no A/AAAA at the apex; domain not serving content directly at time of check.";
      }

      return {
        status: "ok",
        summary,
        details: {
          resolvesTo: resolvedIps,
          ipv6,
          mx: mxHosts,
          nameservers: nsHosts,
          reverse,
          spf,
          dmarc,
          caa: caaRecords,
          dnssec,
          resolverConsensus: consensus,
          nxdomain,
        },
        domainContext: {
          resolvedIps,
          ipv6,
          nxdomain,
          mx: mxHosts,
          nameservers: nsHosts,
          reverse,
          txt: txtRecords,
          spf,
          dmarc,
          caa: caaRecords,
          soa: answers(soa)[0],
          cname: answers(cname),
          dnssec,
          resolverConsensus: consensus,
        },
        raw: { aCf, aGoogle, aaaa, mx, ns, txt, soa, cname, caa, dmarcTxt },
      };
    } catch (err) {
      return { status: isTimeout(err) ? "timeout" : "error", error: errorMessage(err) };
    }
  },
};
