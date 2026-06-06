import { Resolver } from "node:dns/promises";
import type { SourceFinding, TiSource } from "../../types";

const ZONE = "multi.surbl.org";

// multi.surbl.org encodes the lists a domain is on as a bitmask in the last octet.
const BITS: { bit: number; label: string; malicious: boolean }[] = [
  { bit: 8, label: "phishing", malicious: true },
  { bit: 16, label: "malware", malicious: true },
  { bit: 64, label: "abuse", malicious: true },
  { bit: 128, label: "cracked", malicious: true },
];

export function decode(addr: string): { labels: string[]; malicious: boolean } | null {
  // Listings are 127.0.0.<mask>; 127.0.0.255 means the query was refused.
  if (!addr.startsWith("127.0.0.") || addr === "127.0.0.255") return null;
  const mask = Number(addr.split(".")[3]);
  if (!Number.isFinite(mask) || mask === 0) return null;
  const labels: string[] = [];
  let malicious = false;
  for (const { bit, label, malicious: m } of BITS) {
    if (mask & bit) {
      labels.push(label);
      if (m) malicious = true;
    }
  }
  if (labels.length === 0) labels.push(`listed (mask ${mask})`);
  return { labels, malicious };
}

/** SURBL multi - domain reputation block list, queried over DNS (no key). */
export const surblSource: TiSource = {
  meta: {
    id: "surbl",
    name: "SURBL",
    url: "https://www.surbl.org",
    category: "dnsbl",
    requiresKey: false,
    weight: 0.75,
  },
  isEnabled: () => true,
  async check(domain): Promise<SourceFinding> {
    const resolver = new Resolver({ timeout: 4000, tries: 1 });
    try {
      const addrs = await resolver.resolve4(`${domain}.${ZONE}`);
      const decoded = addrs.map(decode).filter((d) => d !== null);

      if (decoded.length === 0) {
        return { status: "ok", score: 0, summary: "Not listed" };
      }

      const labels = Array.from(new Set(decoded.flatMap((d) => d.labels)));
      const malicious = decoded.some((d) => d.malicious);

      return {
        status: "ok",
        malicious,
        score: 65,
        categories: labels,
        summary: `Listed on SURBL: ${labels.join(", ")}`,
        details: { codes: addrs, lists: labels },
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
