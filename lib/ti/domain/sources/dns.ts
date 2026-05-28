import type { SourceFinding, TiSource } from "../../types";
import { errorMessage, getJson, isTimeout } from "../../http";

interface DohAnswer {
  name?: string;
  type?: number;
  data?: string;
}

interface DohResponse {
  Status?: number;
  Answer?: DohAnswer[];
}

const DOH_URL = "https://cloudflare-dns.com/dns-query";

async function query(
  name: string,
  type: "A" | "AAAA" | "MX" | "NS",
  signal: AbortSignal,
): Promise<DohResponse | null> {
  const { data } = await getJson<DohResponse>(
    `${DOH_URL}?name=${encodeURIComponent(name)}&type=${type}`,
    signal,
    { Accept: "application/dns-json" },
  );
  return data;
}

function answers(res: DohResponse | null): string[] {
  return (res?.Answer ?? [])
    .map((a) => a.data?.replace(/\.$/, ""))
    .filter((d): d is string => Boolean(d));
}

/** DNS-over-HTTPS resolution (Cloudflare) - context only, no risk score. */
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
      const [a, aaaa, mx, ns] = await Promise.all([
        query(domain, "A", signal),
        query(domain, "AAAA", signal),
        query(domain, "MX", signal),
        query(domain, "NS", signal),
      ]);

      const resolvedIps = answers(a);
      const ipv6 = answers(aaaa);
      // MX answers look like "10 mail.example.com." - keep just the host.
      const mxHosts = answers(mx).map((m) => m.split(/\s+/).pop() ?? m);
      const nsHosts = answers(ns);

      const resolves = resolvedIps.length > 0 || ipv6.length > 0;
      const nxdomain = a?.Status === 3;

      // Analyst close-note: state the observed resolution posture + a short read.
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
        summary = `Live infrastructure at check time. Apex resolves to ${first}${extra}.${mail}`;
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
          nxdomain,
        },
        domainContext: {
          resolvedIps,
          ipv6,
          mx: mxHosts,
          nameservers: nsHosts,
        },
        raw: { a, aaaa, mx, ns },
      };
    } catch (err) {
      return {
        status: isTimeout(err) ? "timeout" : "error",
        error: errorMessage(err),
      };
    }
  },
};
