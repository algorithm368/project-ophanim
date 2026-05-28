import type { SourceFinding, TiSource } from "../types";
import { errorMessage, getJson, isTimeout } from "../http";

interface GreyNoiseResponse {
  ip?: string;
  noise?: boolean;
  riot?: boolean;
  classification?: "benign" | "malicious" | "unknown";
  name?: string;
  link?: string;
  last_seen?: string;
  message?: string;
}

/** GreyNoise Community API: internet scanner classification (free API key required). */
export const greyNoiseSource: TiSource = {
  meta: {
    id: "greynoise",
    name: "GreyNoise",
    url: "https://www.greynoise.io",
    category: "scanner",
    requiresKey: true,
    weight: 0.8,
    keyEnv: "GREYNOISE_API_KEY",
  },
  isEnabled: () => Boolean(process.env.GREYNOISE_API_KEY),
  async check(ip, signal): Promise<SourceFinding> {
    const key = process.env.GREYNOISE_API_KEY;
    if (!key) return { status: "skipped" };
    try {
      const { ok, status, data } = await getJson<GreyNoiseResponse>(
        `https://api.greynoise.io/v3/community/${ip}`,
        signal,
        { key },
      );

      // 404 = IP not observed scanning the internet.
      if (status === 404) {
        return {
          status: "ok",
          score: 0,
          summary: "Not observed scanning the internet",
        };
      }
      if (!ok || !data) {
        return { status: "error", error: data?.message ?? `HTTP ${status}` };
      }

      const classification = data.classification ?? "unknown";
      const score =
        classification === "malicious" ? 80 : classification === "benign" ? 0 : 30;

      const categories: string[] = [];
      if (data.noise) categories.push("internet-scanner");
      if (data.riot) categories.push("common-business-service");
      categories.push(classification);

      return {
        status: "ok",
        malicious: classification === "malicious",
        score,
        lastSeen: data.last_seen,
        categories,
        summary: `${classification}${data.name ? ` (${data.name})` : ""}${
          data.noise ? " (active scanner)" : ""
        }`,
        details: {
          classification,
          noise: data.noise,
          riot: data.riot,
          actor: data.name,
          link: data.link,
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
