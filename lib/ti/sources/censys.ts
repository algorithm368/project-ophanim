import type { SourceFinding, TiSource } from "../types";
import { errorMessage, getJson, isTimeout } from "../http";

interface CensysLabel {
  value?: string;
}

interface CensysService {
  port?: number;
  protocol?: string;
  transport_protocol?: string;
  labels?: CensysLabel[];
}

interface CensysResponse {
  error?: string;
  detail?: string;
  result?: {
    resource?: {
      ip?: string;
      service_count?: number;
      services?: CensysService[];
      labels?: CensysLabel[];
      location?: { country?: string; city?: string };
      autonomous_system?: { asn?: number; name?: string };
    };
  };
}

const RISKY_LABELS = new Set([
  "remote_access",
  "database",
  "iot",
  "open_dir",
  "open_directory",
  "login_page",
  "tarpit",
  "honeypot",
]);

/** Censys Platform: host scan data: open services, ASN, location (Personal Access Token). */
export const censysSource: TiSource = {
  meta: {
    id: "censys",
    name: "Censys",
    url: "https://platform.censys.io",
    category: "scanner",
    requiresKey: true,
    weight: 0.5,
    keyEnv: "CENSYS_API_SECRET",
  },
  isEnabled: () => Boolean(process.env.CENSYS_API_SECRET),
  async check(ip, signal): Promise<SourceFinding> {
    const token = process.env.CENSYS_API_SECRET;
    if (!token) return { status: "skipped" };
    try {
      const { ok, status, data } = await getJson<CensysResponse>(
        `https://api.platform.censys.io/v3/global/asset/host/${ip}`,
        signal,
        { Authorization: `Bearer ${token}` },
      );

      if (status === 404) {
        return { status: "ok", score: 0, summary: "Host not found in Censys" };
      }
      if (!ok || !data?.result?.resource) {
        return {
          status: "error",
          error: data?.error ?? data?.detail ?? `HTTP ${status}`,
        };
      }

      const r = data.result.resource;
      const services = r.services ?? [];
      const ports = services.map((s) => s.port).filter(Boolean) as number[];
      const labels = Array.from(
        new Set(
          [
            ...(r.labels ?? []),
            ...services.flatMap((s) => s.labels ?? []),
          ]
            .map((l) => l.value)
            .filter((v): v is string => Boolean(v)),
        ),
      );
      const risky = labels.filter((l) => RISKY_LABELS.has(l.toLowerCase()));

      let score = 0;
      if (services.length) score += Math.min(30, services.length * 3);
      if (risky.length) score += 25;
      score = Math.min(100, score);

      return {
        status: "ok",
        score,
        categories: labels.slice(0, 12),
        summary: services.length
          ? `${services.length} exposed service(s)${
              risky.length ? ` · ${risky.join(", ")}` : ""
            }`
          : "No exposed services",
        details: {
          ports,
          services: services
            .map((s) => (s.port ? `${s.port}/${s.protocol ?? "?"}` : null))
            .filter(Boolean),
          labels,
          asn: r.autonomous_system?.asn,
          asName: r.autonomous_system?.name,
          country: r.location?.country,
          city: r.location?.city,
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
