import type { RelatedIndicator, SourceFinding, TiSource } from "../types";
import { errorMessage, getText, isTimeout } from "../http";

const ENDPOINT = "https://api.hackertarget.com/reverseiplookup/";
// Shared-hosting / CDN IPs can co-host thousands of unrelated domains; cap the
// surfaced set so the relations list stays meaningful and bounded.
const MAX_DOMAINS = 40;

/** True when the body is HackerTarget's free-tier quota message, not a result. */
export function isQuotaExceeded(text: string): boolean {
  return /api count exceeded|increase quota|too many|rate.?limit/i.test(text);
}

/**
 * Parse HackerTarget's reverse-IP text body (one host per line) into a distinct,
 * lowercased domain list. Non-host lines (error sentences, the queried IP, bare
 * IPs) are dropped — a line only survives if it looks like a real hostname.
 */
export function parseReverseIp(text: string, ip: string): string[] {
  const hosts = text
    .split("\n")
    .map((line) => line.trim().toLowerCase().replace(/\.$/, ""))
    .filter((line) => line !== ip && /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(line));
  return [...new Set(hosts)];
}

/**
 * HackerTarget reverse-IP lookup — the other domains currently hosted on an IP
 * (shared-hosting / co-tenant reveal). No key required; the free tier is rate
 * limited (~50/day), surfaced as `rate_limited` rather than an error. Context
 * only (weight 0): co-tenancy is not itself a risk signal, it just feeds the
 * related-indicator pivots.
 */
export const reverseIpSource: TiSource = {
  meta: {
    id: "reverse-ip",
    name: "Reverse IP (HackerTarget)",
    url: "https://hackertarget.com/reverse-ip-lookup/",
    category: "context",
    requiresKey: false,
    weight: 0,
  },
  isEnabled: () => true,
  async check(ip, signal): Promise<SourceFinding> {
    try {
      const { ok, status, text } = await getText(
        `${ENDPOINT}?q=${encodeURIComponent(ip)}`,
        signal,
      );
      if (isQuotaExceeded(text)) {
        return {
          status: "rate_limited",
          summary: "Reverse-IP lookup quota exceeded (HackerTarget free tier)",
        };
      }
      if (!ok) return { status: "error", error: `HTTP ${status}` };

      const domains = parseReverseIp(text, ip);
      if (domains.length === 0) {
        return { status: "ok", summary: "No other domains found on this IP" };
      }

      const shown = domains.slice(0, MAX_DOMAINS);
      const relations: RelatedIndicator[] = shown.map((value) => ({
        value,
        type: "domain",
        relation: "hosted",
      }));

      const capped = domains.length > MAX_DOMAINS;
      return {
        status: "ok",
        summary: `${domains.length} domain${domains.length === 1 ? "" : "s"} share this IP${
          capped ? ` (showing ${MAX_DOMAINS})` : ""
        }`,
        details: { domainCount: domains.length, domains: shown },
        relations,
        raw: text.trim(),
      };
    } catch (err) {
      return {
        status: isTimeout(err) ? "timeout" : "error",
        error: errorMessage(err),
      };
    }
  },
};
