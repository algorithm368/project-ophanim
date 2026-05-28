import type { SourceFinding, TiSource } from "../../types";
import { errorMessage, getJson, isTimeout } from "../../http";

interface OtxResponse {
  pulse_info?: {
    count?: number;
    pulses?: { name?: string; tags?: string[] }[];
  };
  error?: string;
}

/** AlienVault OTX - community pulse intelligence for file hashes (free key). */
export const otxHashSource: TiSource = {
  meta: {
    id: "otx",
    name: "AlienVault OTX",
    url: "https://otx.alienvault.com",
    category: "reputation",
    requiresKey: true,
    // Pulse references are a weak signal on their own; authoritative calls come
    // from the multi-engine and corpus feeds.
    weight: 0.5,
    keyEnv: "OTX_API_KEY",
    timeoutMs: 15000,
  },
  isEnabled: () => Boolean(process.env.OTX_API_KEY),
  async check(hash, signal): Promise<SourceFinding> {
    const key = process.env.OTX_API_KEY;
    if (!key) return { status: "skipped" };
    try {
      const { ok, status, data } = await getJson<OtxResponse>(
        `https://otx.alienvault.com/api/v1/indicators/file/${hash}/general`,
        signal,
        { "X-OTX-API-KEY": key },
      );
      if (!ok || !data) {
        return { status: "error", error: data?.error ?? `HTTP ${status}` };
      }

      const pulseCount = data.pulse_info?.count ?? 0;
      const pulses = data.pulse_info?.pulses ?? [];
      const tags = Array.from(
        new Set(pulses.flatMap((p) => p.tags ?? [])),
      ).slice(0, 12);

      // No pulses means OTX has nothing on this file - not a clean signal, so
      // emit no score rather than implying the file is safe.
      if (pulseCount === 0) {
        return { status: "ok", summary: "Not referenced in any threat pulse" };
      }

      const score = Math.min(60, 20 + pulseCount * 4);

      return {
        status: "ok",
        score,
        categories: tags,
        summary: `Referenced in ${pulseCount} threat pulse(s)`,
        details: {
          pulseCount,
          pulses: pulses.slice(0, 8).map((p) => p.name).filter(Boolean),
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
