import type { SourceFinding, TiSource } from "../types";
import { errorMessage, getJson, isTimeout } from "../http";

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

/** OTX pulse count → 0-100 (IP weighting: 25 base + 10 per pulse). */
export function otxScore(pulseCount: number): number {
  return pulseCount > 0 ? Math.min(100, 25 + pulseCount * 10) : 0;
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
    // The /general endpoint is slow for pulse-heavy indicators (10s+ seen), so
    // give it extra headroom rather than timing out.
    timeoutMs: 15000,
  },
  isEnabled: () => Boolean(process.env.OTX_API_KEY),
  async check(ip, signal): Promise<SourceFinding> {
    const key = process.env.OTX_API_KEY;
    if (!key) return { status: "skipped" };
    try {
      const { ok, status, data } = await getJson<OtxResponse>(
        `https://otx.alienvault.com/api/v1/indicators/IPv4/${ip}/general`,
        signal,
        { "X-OTX-API-KEY": key },
      );
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

      return {
        status: "ok",
        malicious: pulseCount >= 3,
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
