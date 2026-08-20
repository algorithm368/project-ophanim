import type { SourceFinding, TiSource } from "../types";
import { errorMessage, isTimeout } from "../http";
import { RESOLVERS, answers, dohQuery } from "../dns/doh";
import { reversePointer } from "../dns/fcrdns";

/**
 * Reverse-DNS signatures of internet-wide research scanners.
 *
 * These operators publish their scanning ranges and name their hosts so they
 * can be recognised and excluded, which is exactly what makes the PTR record a
 * reliable identifier: a host calling itself `pirate.census.shodan.io` is
 * announcing what it is. Patterns are anchored on a dot boundary so a lookalike
 * domain cannot claim the label by suffix.
 */
const SCANNERS: [RegExp, string][] = [
  [/(^|\.)census\.shodan\.io$/i, "Shodan"],
  [/(^|\.)shodan\.io$/i, "Shodan"],
  [/(^|\.)censys-scanner\.com$/i, "Censys"],
  [/(^|\.)censys\.io$/i, "Censys"],
  [/(^|\.)scanner\.shadowserver\.org$/i, "Shadowserver"],
  [/(^|\.)shadowserver\.org$/i, "Shadowserver"],
  [/(^|\.)binaryedge\.ninja$/i, "BinaryEdge"],
  [/(^|\.)probe\.onyphe\.net$/i, "ONYPHE"],
  [/(^|\.)onyphe\.net$/i, "ONYPHE"],
  [/(^|\.)rapid7\.com$/i, "Rapid7"],
  [/(^|\.)leakix\.net$/i, "LeakIX"],
  [/(^|\.)netsystemsresearch\.com$/i, "Net Systems Research"],
  [/(^|\.)internet-measurement\.com$/i, "Driftnet"],
  [/(^|\.)stretchoid\.com$/i, "Stretchoid"],
  [/(^|\.)security\.ipip\.net$/i, "IPIP"],
  [/(^|\.)aeza-scan\.com$/i, "Aeza"],
  [/(^|\.)bufferover\.run$/i, "BufferOver"],
  [/(^|\.)cyber\.casa$/i, "Cyber Casa"],
  [/(^|\.)scan\.bufferover\.run$/i, "BufferOver"],
  [/(^|\.)openportstats\.com$/i, "OpenPortStats"],
  [/(^|\.)internet-census\.org$/i, "Internet Census"],
  [/(^|\.)recyber\.net$/i, "Recyber"],
  [/(^|\.)alphastrike\.io$/i, "Alpha Strike Labs"],
];

/** The scanner operator a PTR hostname belongs to, or undefined. */
export function scannerOperator(hostname: string | undefined): string | undefined {
  const host = hostname?.trim().replace(/\.$/, "");
  if (!host) return undefined;
  for (const [pattern, operator] of SCANNERS) {
    if (pattern.test(host)) return operator;
  }
  return undefined;
}

/**
 * Identify research scanners from their own reverse DNS.
 *
 * This exists because the identification it provides had a single point of
 * failure. GreyNoise is the only other source that answers "what is this
 * address" rather than "has it been reported", and its free tier runs out of
 * daily quota; when it does, a Shodan census host stops reading as a scanner
 * and starts reading as "brute force" off the abuse reports filed by the people
 * it scanned. A PTR lookup has no quota.
 *
 * Weight 0 and it never accuses. It vouches (`allowlisted`) and it names what
 * the address is, which is the half of the picture the other thirteen scoring
 * sources cannot supply.
 *
 * A scanner is not automatically harmless, and this does not claim it is: the
 * label says who operates it, and an analyst decides what their policy is
 * toward that operator. What it prevents is the tool asserting "brute force"
 * about a host that publicly identifies itself as a census scanner.
 */
export const scannerIdSource: TiSource = {
  meta: {
    id: "scanner-id",
    name: "Research scanner identification",
    url: "https://www.greynoise.io/blog/checking-it-twice-profiling-benign-internet-scanners----2024-edition",
    category: "context",
    requiresKey: false,
    weight: 0,
    families: [4, 6],
  },
  isEnabled: () => true,
  async check(ip, signal): Promise<SourceFinding> {
    try {
      const ptr = answers(
        await dohQuery(RESOLVERS.cloudflare, reversePointer(ip), "PTR", signal),
      );
      const hostname = ptr[0];
      const operator = scannerOperator(hostname);
      if (!operator) {
        return {
          status: "ok",
          summary: hostname
            ? "Not a recognised research scanner"
            : "No PTR record to identify",
        };
      }
      return {
        status: "ok",
        score: 0,
        allowlisted: true,
        categories: ["internet-scanner", "research-scanner"],
        summary: `Research scanner operated by ${operator}, identified by its own PTR ${hostname}`,
        details: { operator, hostname },
      };
    } catch (err) {
      return {
        status: isTimeout(err) ? "timeout" : "error",
        error: errorMessage(err),
      };
    }
  },
};
