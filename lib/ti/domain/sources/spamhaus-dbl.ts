import { Resolver } from "node:dns/promises";
import type { SourceFinding, TiSource } from "../../types";

const ZONE = "dbl.spamhaus.org";

// DBL return codes: 127.0.1.x. See https://www.spamhaus.org/faq/section/DNSBL%20Usage
const CODE_MEANING: Record<string, string> = {
  "127.0.1.2": "spam domain",
  "127.0.1.4": "phishing domain",
  "127.0.1.5": "malware domain",
  "127.0.1.6": "botnet C2 domain",
  "127.0.1.102": "abused legit spam",
  "127.0.1.103": "abused spammed redirector",
  "127.0.1.104": "abused legit phishing",
  "127.0.1.105": "abused legit malware",
  "127.0.1.106": "abused legit botnet C2",
};

// 127.0.1.255 (and 127.255.255.x) signal "query refused / open resolver", not a listing.
function isBlockedCode(addr: string): boolean {
  return addr === "127.0.1.255" || addr.startsWith("127.255.255.");
}

function isAbusedLegit(addr: string): boolean {
  return addr.startsWith("127.0.1.10");
}

/** Spamhaus DBL - domain block list, queried over DNS (no key). */
export const spamhausDblSource: TiSource = {
  meta: {
    id: "spamhaus-dbl",
    name: "Spamhaus DBL",
    url: "https://www.spamhaus.org/dbl/",
    category: "dnsbl",
    requiresKey: false,
    weight: 0.85,
  },
  isEnabled: () => true,
  async check(domain): Promise<SourceFinding> {
    const resolver = new Resolver({ timeout: 4000, tries: 1 });
    try {
      const addrs = await resolver.resolve4(`${domain}.${ZONE}`);

      if (addrs.length === 0 || addrs.every(isBlockedCode)) {
        return {
          status: "ok",
          score: 0,
          summary:
            addrs.length === 0
              ? "Not listed"
              : "Query refused (open-resolver limit)",
        };
      }

      const listed = addrs.filter((a) => !isBlockedCode(a));
      const meanings = listed.map((a) => CODE_MEANING[a] ?? `listed (${a})`);
      const abusedOnly = listed.every(isAbusedLegit);

      return {
        status: "ok",
        malicious: !abusedOnly,
        // Direct listings are high-confidence; abused-legit are softer.
        score: abusedOnly ? 45 : 80,
        categories: meanings,
        summary: `Listed on Spamhaus DBL: ${meanings.join(", ")}`,
        details: { codes: listed, meanings },
        raw: addrs,
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOTFOUND" || code === "ENODATA") {
        return { status: "ok", score: 0, summary: "Not listed" };
      }
      return {
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
