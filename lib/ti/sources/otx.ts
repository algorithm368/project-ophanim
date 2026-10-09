import type { SourceFinding, TiSource } from "../types";
import { errorMessage, getJson, isTimeout } from "../http";
import { apiKey } from "../keys";
import { fetchOtxMalwareRelations } from "../otx-malware";

interface OtxResponse {
  pulse_info?: {
    count?: number;
    pulses?: { name?: string; tags?: string[] }[];
  };
  reputation?: number | null;
  asn?: string;
  country_name?: string;
  error?: string;
}

/** OTX namespaces its indicator API by type; pick the one matching the family. */
export function otxIndicatorType(ip: string): "IPv4" | "IPv6" {
  return ip.includes(":") ? "IPv6" : "IPv4";
}

/**
 * OTX pulse count -> a capped 0-60 contribution.
 *
 * A pulse is a community-authored reference, and being referenced often is a
 * measure of prominence rather than of harm. Microsoft's 13.107.42.14 and
 * OpenDNS's 208.67.222.222 each sit in 50 pulses, and under the old curve
 * (25 + 10 per pulse, saturating at 100) that made both of them "suspicious"
 * on OTX alone: 0.6 x 100 x 0.85 is 51 points before any other source is
 * consulted, which is past the suspicious cutoff by itself.
 *
 * So the curve is flatter and capped below the level where one source can
 * carry a band. Five pulses still cross FLAG_THRESHOLD, so OTX keeps flagging;
 * it just cannot decide the verdict alone, which is the same reasoning that
 * already denies it a hard `malicious` flag.
 */
export const OTX_SCORE_CAP = 60;

export function otxScore(pulseCount: number): number {
  return pulseCount > 0 ? Math.min(OTX_SCORE_CAP, 15 + pulseCount * 5) : 0;
}

/** AlienVault OTX: community pulse intelligence (free API key required). */
export const otxSource: TiSource = {
  meta: {
    id: "otx",
    name: "AlienVault OTX",
    url: "https://otx.alienvault.com",
    category: "reputation",
    requiresKey: true,
    weight: 0.85,
    keyEnv: "OTX_API_KEY",
    families: [4, 6],
    // The /general endpoint is slow for pulse-heavy indicators (10s+ seen), so
    // give it extra headroom rather than timing out.
    timeoutMs: 15000,
  },
  isEnabled: () => Boolean(apiKey("OTX_API_KEY")),
  async check(ip, signal): Promise<SourceFinding> {
    const key = apiKey("OTX_API_KEY");
    if (!key) return { status: "skipped" };
    const headers = { "X-OTX-API-KEY": key };
    const indicator = otxIndicatorType(ip);
    try {
      // /general carries the verdict; /malware (one extra GET, in parallel)
      // adds the sample hashes seen contacting this IP. Best-effort.
      const [{ ok, status, data }, relations] = await Promise.all([
        getJson<OtxResponse>(
          `https://otx.alienvault.com/api/v1/indicators/${indicator}/${ip}/general`,
          signal,
          headers,
        ),
        fetchOtxMalwareRelations(
          `https://otx.alienvault.com/api/v1/indicators/${indicator}/${ip}/malware`,
          headers,
          signal,
        ),
      ]);
      if (!ok || !data) {
        return {
          status: "error",
          error: data?.error ?? `HTTP ${status}`,
        };
      }

      const pulseCount = data.pulse_info?.count ?? 0;
      const pulses = data.pulse_info?.pulses ?? [];
      const tags = Array.from(
        new Set(pulses.flatMap((p) => p.tags ?? [])),
      ).slice(0, 12);

      const score = otxScore(pulseCount);

      // No hard `malicious` flag: pulses are community-authored references,
      // not a curated listing, so they must never trigger aggregateRisk()'s
      // 75 floor on their own. The score still crosses FLAG_THRESHOLD at two
      // pulses, so OTX keeps flagging — it just can't single-handedly floor.
      return {
        status: "ok",
        score,
        categories: tags,
        summary:
          pulseCount > 0
            ? `Referenced in ${pulseCount} threat pulse(s)`
            : "Not referenced in any threat pulse",
        details: {
          pulseCount,
          pulses: pulses.slice(0, 8).map((p) => p.name).filter(Boolean),
          reputation: data.reputation,
          asn: data.asn,
          country: data.country_name,
        },
        relations: relations.length ? relations : undefined,
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
