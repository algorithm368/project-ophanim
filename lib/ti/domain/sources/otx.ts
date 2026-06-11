import type { SourceFinding, TiSource } from "../../types";
import { errorMessage, getJson, isTimeout } from "../../http";
import { fetchOtxMalwareRelations } from "../../otx-malware";

interface OtxResponse {
  pulse_info?: {
    count?: number;
    pulses?: { name?: string; tags?: string[] }[];
  };
  error?: string;
}

/** OTX pulse count → domain nudge score: capped low (35), 2 per pulse. */
export function otxDomainScore(pulseCount: number): number {
  return pulseCount > 0 ? Math.min(35, pulseCount * 2) : 0;
}

/** AlienVault OTX - community pulse intelligence for domains (free API key). */
export const otxDomainSource: TiSource = {
  meta: {
    id: "otx",
    name: "AlienVault OTX",
    url: "https://otx.alienvault.com",
    category: "reputation",
    requiresKey: true,
    // Pulse count is noisy for domains (popular infra accumulates references),
    // so OTX only nudges the score - authoritative calls come from other feeds.
    weight: 0.5,
    keyEnv: "OTX_API_KEY",
    // The /general endpoint is slow for pulse-heavy indicators (10s+ seen), so
    // give it extra headroom rather than timing out.
    timeoutMs: 15000,
  },
  isEnabled: () => Boolean(process.env.OTX_API_KEY),
  async check(domain, signal): Promise<SourceFinding> {
    const key = process.env.OTX_API_KEY;
    if (!key) return { status: "skipped" };
    const headers = { "X-OTX-API-KEY": key };
    try {
      // /general for the verdict; /malware (one extra parallel GET) for the
      // sample hashes seen contacting this domain. Best-effort.
      const [{ ok, status, data }, relations] = await Promise.all([
        getJson<OtxResponse>(
          `https://otx.alienvault.com/api/v1/indicators/domain/${domain}/general`,
          signal,
          headers,
        ),
        fetchOtxMalwareRelations(
          `https://otx.alienvault.com/api/v1/indicators/domain/${domain}/malware`,
          headers,
          signal,
        ),
      ]);
      if (!ok || !data) {
        return { status: "error", error: data?.error ?? `HTTP ${status}` };
      }

      const pulseCount = data.pulse_info?.count ?? 0;
      const pulses = data.pulse_info?.pulses ?? [];
      const tags = Array.from(
        new Set(pulses.flatMap((p) => p.tags ?? [])),
      ).slice(0, 12);

      // Pulses include benign reference domains, so keep this a sub-threshold
      // nudge: it shows in the breakdown but won't flag a domain on its own.
      const score = otxDomainScore(pulseCount);

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
