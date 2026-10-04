import type { SourceFinding, TiSource } from "../types";
import { errorMessage, isTimeout, postJson } from "../http";
import { byCodeUnit } from "../sort";

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

/** ThreatFox confidence (0-100) → score, floored at 60 for any IOC hit. */
export function threatFoxScore(confidence: number): number {
  return Math.min(100, Math.max(60, confidence));
}

/** Earliest first sighting and newest last sighting across a ThreatFox
 *  answer. Both lean on ThreatFox's timestamp format sorting chronologically
 *  by code unit, the same promise the last-seen pick already relied on. */
export function threatFoxWindow(
  entries: { first_seen?: string; last_seen?: string }[],
): { firstSeen?: string; lastSeen?: string } {
  const dated = (key: "first_seen" | "last_seen") =>
    entries
      .map((e) => e[key])
      .filter((s): s is string => Boolean(s))
      .sort(byCodeUnit);
  return { firstSeen: dated("first_seen")[0], lastSeen: dated("last_seen").at(-1) };
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
      const { ok, status, data } = await postJson<ThreatFoxResponse>(
        "https://threatfox-api.abuse.ch/api/v1/",
        signal,
        { query: "search_ioc", search_term: ip },
        { "Auth-Key": key },
      );

      if (data?.query_status === "no_result") {
        return {
          status: "ok",
          score: 0,
          summary: "No malware IOCs reference this IP",
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
      const { firstSeen, lastSeen } = threatFoxWindow(entries);

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
          firstSeen,
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
