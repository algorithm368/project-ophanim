import type { RelatedIndicator, SourceFinding, TiSource } from "../types";
import { errorMessage, getText, isTimeout } from "../http";

const ENDPOINT = "https://api.hackertarget.com/reverseiplookup/";
// Shared-hosting / CDN IPs can co-host thousands of unrelated domains; cap the
// surfaced set so the relations list stays meaningful and bounded.
const MAX_DOMAINS = 40;

/**
 * Where HackerTarget's free tier stops listing, which is *not* where the names
 * stop existing.
 *
 * These are two different ceilings and conflating them was a real bug. Ours is
 * `MAX_DOMAINS`, a display choice: we know the count and show fewer. Theirs is
 * this, an admission: the API returns 500 lines and says nothing about what it
 * left out. An anycast front door has tens of thousands of names behind it, and
 * this source reported `domainCount: 500` for one, which reads as a measurement
 * of 500 rather than as "at least 500, the API gave up".
 *
 * The distinction earns its keep twice over, because hitting the ceiling is the
 * single most reliable co-tenancy signal we have: see `classifyIpLabel`, which
 * uses `atCeiling` rather than the number to tell a front door from a host.
 */
const PROVIDER_CEILING = 500;

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
 * Turn the parsed name list into the finding, distinguishing a count from a
 * floor.
 *
 * Split out of `check` so the ceiling logic can be tested without a network
 * call, since that distinction is the whole point of this source now: an
 * anycast address reaches `classifyIpLabel` as "at least 500" rather than as
 * "exactly 500", and the difference decides whether the page calls it a front
 * door or a landlord.
 */
export function describeTenancy(domains: string[]): SourceFinding {
  if (domains.length === 0) {
    return { status: "ok", summary: "No other domains found on this IP" };
  }

  const shown = domains.slice(0, MAX_DOMAINS);
  const relations: RelatedIndicator[] = shown.map((value) => ({
    value,
    type: "domain",
    relation: "hosted",
  }));

  const atCeiling = domains.length >= PROVIDER_CEILING;
  const capped = domains.length > MAX_DOMAINS;
  return {
    status: "ok",
    summary: `${atCeiling ? "More than " : ""}${domains.length} ${
      domains.length === 1 ? "domain shares" : "domains share"
    } this IP${capped ? ` (showing ${MAX_DOMAINS})` : ""}`,
    details: {
      domainCount: domains.length,
      // The count above is a floor when this is set, not a measurement.
      // Anything reading `domainCount` has to know which of the two it holds.
      atCeiling,
      domains: shown,
    },
    relations,
  };
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

      return { ...describeTenancy(parseReverseIp(text, ip)), raw: text.trim() };
    } catch (err) {
      return {
        status: isTimeout(err) ? "timeout" : "error",
        error: errorMessage(err),
      };
    }
  },
};
