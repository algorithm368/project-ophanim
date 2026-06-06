import type { SourceFinding, TiSource } from "../../types";
import { errorMessage, isTimeout } from "../../http";
import { RESOLVERS, answers, dohQuery, type DohResponse } from "../../dns/doh";
import {
  decodeCaa,
  dnssecStatus,
  extractDmarc,
  extractSpf,
  normalizeMxHosts,
  resolversAgree,
} from "../../dns/parse";

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
      // Resolve every record set concurrently in a single batch (one round of
      // parallel DoH queries, not two). A records are queried at two resolvers
      // (DNSSEC DO bit set) for an agreement check; the rest go to Cloudflare.
      const [aCf, aGoogle, aaaa, mx, ns, txt, soa, cname, caa, dmarcTxt] =
        await Promise.all([
          dohQuery(CF, domain, "A", signal, true),
          dohQuery(RESOLVERS.google, domain, "A", signal, true),
          dohQuery(CF, domain, "AAAA", signal),
          dohQuery(CF, domain, "MX", signal),
          dohQuery(CF, domain, "NS", signal),
          dohQuery(CF, domain, "TXT", signal),
          dohQuery(CF, domain, "SOA", signal),
          dohQuery(CF, domain, "CNAME", signal),
          dohQuery(CF, domain, "CAA", signal),
          dohQuery(CF, `_dmarc.${domain}`, "TXT", signal),
        ]);

      const resolvedIps = answers(aCf);
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

      const aSets = [answers(aCf), answers(aGoogle)];
      const resolverAgreement = resolversAgree(aSets);
      const dnssec = dnssecStatus([aCf, aGoogle] as (DohResponse | null)[]);

      const resolves = resolvedIps.length > 0 || ipv6.length > 0;
      const nxdomain = aCf?.Status === 3;

      let summary: string;
      if (resolves) {
        const first = resolvedIps[0] ?? ipv6[0];
        const hostCount = resolvedIps.length + ipv6.length;
        const extra =
          hostCount > 1
            ? ` (+${hostCount - 1} more host${hostCount - 1 > 1 ? "s" : ""})`
            : "";
        const mail =
          mxHosts.length > 0
            ? ` Mail routed via ${mxHosts[0]}.`
            : " No MX present; not mail-bearing.";
        const disagree = resolverAgreement ? "" : " Resolvers disagree on the A record.";
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
          resolverAgreement,
          nxdomain,
        },
        domainContext: {
          resolvedIps,
          ipv6,
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
          resolverAgreement,
        },
        raw: { aCf, aGoogle, aaaa, mx, ns, txt, soa, cname, caa, dmarcTxt },
      };
    } catch (err) {
      return { status: isTimeout(err) ? "timeout" : "error", error: errorMessage(err) };
    }
  },
};
