import type { SourceFinding, TiSource } from "../types";
import { errorMessage, getJson, isTimeout } from "../http";

interface CriminalIpPort {
  port?: number;
  has_vulnerability?: boolean;
}

interface CriminalIpResponse {
  status?: number;
  message?: string;
  issue?: string[];
  tags?: string[];
  ip_scoring?: {
    inbound?: string;
    outbound?: string;
    is_malicious?: boolean;
  };
  current_open_ports?: {
    TCP?: CriminalIpPort[];
    UDP?: CriminalIpPort[];
  };
}

const LEVEL: Record<string, number> = {
  safe: 0,
  low: 10,
  moderate: 40,
  dangerous: 70,
  critical: 90,
};

/** Criminal IP (AI Spera): IP risk scoring & attack surface (API key). */
export const criminalIpSource: TiSource = {
  meta: {
    id: "criminal-ip",
    name: "Criminal IP",
    url: "https://www.criminalip.io",
    category: "reputation",
    requiresKey: true,
    weight: 0.8,
    keyEnv: "CRIMINALIP_API_KEY",
  },
  isEnabled: () => Boolean(process.env.CRIMINALIP_API_KEY),
  async check(ip, signal): Promise<SourceFinding> {
    const key = process.env.CRIMINALIP_API_KEY;
    if (!key) return { status: "skipped" };
    try {
      const { ok, status, data } = await getJson<CriminalIpResponse>(
        `https://api.criminalip.io/v1/asset/ip/report/summary?ip=${ip}`,
        signal,
        { "x-api-key": key },
      );
      // The free plan returns "limit exceeded" (often HTTP 200 with a message)
      // once the daily quota is spent; treat that as a quota state, not an error.
      if (status === 429 || /limit\s*exceed|quota|too many/i.test(data?.message ?? "")) {
        return {
          status: "rate_limited",
          summary: data?.message ?? "Daily quota exceeded",
        };
      }
      if (!ok || !data?.ip_scoring) {
        return { status: "error", error: data?.message ?? `HTTP ${status}` };
      }

      const scoring = data.ip_scoring;
      const inbound = scoring.inbound?.toLowerCase() ?? "";
      const outbound = scoring.outbound?.toLowerCase() ?? "";
      const score = Math.max(LEVEL[inbound] ?? 0, LEVEL[outbound] ?? 0);

      const openPorts =
        (data.current_open_ports?.TCP?.length ?? 0) +
        (data.current_open_ports?.UDP?.length ?? 0);
      const categories = [...(data.issue ?? []), ...(data.tags ?? [])].slice(
        0,
        12,
      );

      return {
        status: "ok",
        malicious: scoring.is_malicious === true || score >= 70,
        score,
        categories,
        summary: `Inbound risk ${scoring.inbound ?? "?"}, outbound ${
          scoring.outbound ?? "?"
        }${openPorts ? ` · ${openPorts} open port(s)` : ""}`,
        details: {
          inbound: scoring.inbound,
          outbound: scoring.outbound,
          isMalicious: scoring.is_malicious,
          openPorts,
          issues: data.issue ?? [],
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
