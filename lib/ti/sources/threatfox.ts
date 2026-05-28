import type { SourceFinding, TiSource } from "../types";
import { errorMessage, isTimeout } from "../http";

interface ThreatFoxEntry {
  ioc?: string;
  threat_type?: string;
  threat_type_desc?: string;
  malware?: string;
  malware_printable?: string;
  confidence_level?: number;
  first_seen?: string;
  last_seen?: string;
  tags?: string[] | null;
}

interface ThreatFoxResponse {
  query_status?: string;
  data?: ThreatFoxEntry[] | string;
}

/** ThreatFox (abuse.ch): malware IOC database (free abuse.ch Auth-Key). */
export const threatFoxSource: TiSource = {
  meta: {
    id: "threatfox",
    name: "ThreatFox",
    url: "https://threatfox.abuse.ch",
    category: "reputation",
    requiresKey: true,
    weight: 0.95,
    keyEnv: "THREATFOX_API_KEY",
  },
  isEnabled: () => Boolean(process.env.THREATFOX_API_KEY),
  async check(ip, signal): Promise<SourceFinding> {
    const key = process.env.THREATFOX_API_KEY;
    if (!key) return { status: "skipped" };
    try {
      const res = await fetch("https://threatfox-api.abuse.ch/api/v1/", {
        method: "POST",
        signal,
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Auth-Key": key,
        },
        body: JSON.stringify({ query: "search_ioc", search_term: ip }),
      });
      const text = await res.text();
      let data: ThreatFoxResponse | null = null;
      try {
        data = text ? (JSON.parse(text) as ThreatFoxResponse) : null;
      } catch {
        data = null;
      }

      if (data?.query_status === "no_result") {
        return {
          status: "ok",
          score: 0,
          summary: "No malware IOCs reference this IP",
        };
      }
      if (!res.ok || data?.query_status !== "ok" || !Array.isArray(data.data)) {
        const msg =
          typeof data?.data === "string" ? data.data : data?.query_status;
        return { status: "error", error: msg ?? `HTTP ${res.status}` };
      }

      const entries = data.data;
      const confidence = Math.max(
        0,
        ...entries.map((e) => e.confidence_level ?? 0),
      );
      const score = Math.min(100, Math.max(60, confidence));
      const malwares = Array.from(
        new Set(
          entries.map((e) => e.malware_printable || e.malware).filter(Boolean),
        ),
      ) as string[];
      const threatTypes = Array.from(
        new Set(entries.map((e) => e.threat_type).filter(Boolean)),
      ) as string[];
      const tags = Array.from(
        new Set(entries.flatMap((e) => e.tags ?? [])),
      ).slice(0, 10);
      const lastSeen = entries
        .map((e) => e.last_seen)
        .filter(Boolean)
        .sort()
        .at(-1);

      return {
        status: "ok",
        malicious: true,
        score,
        categories: [...threatTypes, ...malwares, ...tags].slice(0, 12),
        lastSeen: lastSeen ?? undefined,
        summary: `Linked to ${
          malwares.join(", ") || "malware"
        } across ${entries.length} IOC(s)`,
        details: {
          iocCount: entries.length,
          malware: malwares,
          threatTypes,
          confidenceLevel: confidence,
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
