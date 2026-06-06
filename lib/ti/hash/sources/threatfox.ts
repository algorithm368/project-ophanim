import type { SourceFinding, TiSource } from "../../types";
import { errorMessage, isTimeout, postJson } from "../../http";

interface ThreatFoxEntry {
  threat_type?: string;
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

/** ThreatFox confidence (0-100) → score, floored at 60 for any IOC hit. */
export function threatFoxScore(confidence: number): number {
  return Math.min(100, Math.max(60, confidence));
}

/** ThreatFox (abuse.ch) - malware IOC database, hash lookup (free Auth-Key). */
export const threatFoxHashSource: TiSource = {
  meta: {
    id: "threatfox",
    name: "ThreatFox",
    url: "https://threatfox.abuse.ch",
    category: "reputation",
    requiresKey: true,
    weight: 0.95,
    keyEnv: "THREATFOX_API_KEY",
    // abuse.ch is EU-hosted; give it headroom for the sin1 round trip.
    timeoutMs: 15000,
  },
  isEnabled: () => Boolean(process.env.THREATFOX_API_KEY),
  async check(hash, signal): Promise<SourceFinding> {
    const key = process.env.THREATFOX_API_KEY;
    if (!key) return { status: "skipped" };
    try {
      const { ok, status, data } = await postJson<ThreatFoxResponse>(
        "https://threatfox-api.abuse.ch/api/v1/",
        signal,
        { query: "search_hash", hash },
        { "Auth-Key": key },
      );

      // Absence from a malware-only IOC DB isn't a clean signal, so no score.
      if (
        data?.query_status === "no_result" ||
        data?.query_status === "illegal_hash"
      ) {
        return {
          status: "ok",
          summary: "No malware IOCs reference this hash",
        };
      }
      if (!ok || data?.query_status !== "ok" || !Array.isArray(data.data)) {
        const msg =
          typeof data?.data === "string" ? data.data : data?.query_status;
        return { status: "error", error: msg ?? `HTTP ${status}` };
      }

      const entries = data.data;
      const confidence = Math.max(
        0,
        ...entries.map((e) => e.confidence_level ?? 0),
      );
      const score = threatFoxScore(confidence);
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
        hashContext: {
          malwareFamily: malwares[0],
          tags: tags.length ? tags : undefined,
          lastSeen: lastSeen ?? undefined,
        },
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
