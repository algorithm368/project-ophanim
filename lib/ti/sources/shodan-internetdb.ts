import type { SourceFinding, TiSource } from "../types";
import { errorMessage, getJson, isTimeout } from "../http";

interface InternetDbResponse {
  ip: string;
  ports?: number[];
  cpes?: string[];
  hostnames?: string[];
  tags?: string[];
  vulns?: string[];
}

const MALICIOUS_TAGS = new Set([
  "malware",
  "compromised",
  "c2",
  "phishing",
  "botnet",
  "honeypot",
]);

/** Shodan InternetDB: free host exposure data (no key): open ports, CVEs, tags. */
export const shodanInternetDbSource: TiSource = {
  meta: {
    id: "shodan-internetdb",
    name: "Shodan InternetDB",
    url: "https://internetdb.shodan.io",
    category: "scanner",
    requiresKey: false,
    weight: 0.5,
  },
  isEnabled: () => true,
  async check(ip, signal): Promise<SourceFinding> {
    try {
      const { ok, status, data } = await getJson<InternetDbResponse>(
        `https://internetdb.shodan.io/${ip}`,
        signal,
      );

      // 404 = host not indexed (no exposure data found).
      if (status === 404) {
        return {
          status: "ok",
          score: 0,
          summary: "No exposure data indexed for this host",
        };
      }
      if (!ok || !data) {
        return { status: "error", error: `HTTP ${status}` };
      }

      const ports = data.ports ?? [];
      const vulns = data.vulns ?? [];
      const tags = data.tags ?? [];
      const badTags = tags.filter((t) => MALICIOUS_TAGS.has(t.toLowerCase()));

      let score = 0;
      if (vulns.length) score += Math.min(50, 10 + vulns.length * 5);
      if (badTags.length) score += 50;
      score = Math.min(100, score);

      const parts: string[] = [];
      if (ports.length) parts.push(`${ports.length} open port(s)`);
      if (vulns.length) parts.push(`${vulns.length} known CVE(s)`);
      if (badTags.length) parts.push(`tags: ${badTags.join(", ")}`);

      return {
        status: "ok",
        malicious: badTags.length > 0,
        score,
        categories: tags,
        summary: parts.length ? parts.join(" · ") : "Indexed, no notable exposure",
        details: {
          ports,
          vulns,
          tags,
          hostnames: data.hostnames ?? [],
          cpes: data.cpes ?? [],
        },
        raw: data,
      };
    } catch (err) {
      return {
        status: isTimeout(err) ? "timeout" : "error",
        error: errorMessage(err),
      };
    }
  },
};
