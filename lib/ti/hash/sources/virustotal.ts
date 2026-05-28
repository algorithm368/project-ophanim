import type {
  IndicatorType,
  RelatedIndicator,
  SourceFinding,
  TiSource,
} from "../../types";
import { errorMessage, getJson, isTimeout } from "../../http";

interface VtRelationList {
  data?: { id?: string }[];
}

/**
 * Pull what the sample reaches out to: contacted IPs + domains, the highest-
 * value pivots for a malware investigation. Best-effort, two parallel calls.
 */
async function fetchHashRelations(
  hash: string,
  signal: AbortSignal,
  headers: Record<string, string>,
): Promise<RelatedIndicator[]> {
  const fetchList = async (
    kind: "contacted_ips" | "contacted_domains",
  ): Promise<RelatedIndicator[]> => {
    try {
      const { ok, data } = await getJson<VtRelationList>(
        `https://www.virustotal.com/api/v3/files/${hash}/${kind}?limit=8`,
        signal,
        headers,
      );
      if (!ok || !Array.isArray(data?.data)) return [];
      const type: IndicatorType = kind === "contacted_ips" ? "ip" : "domain";
      const values = data.data
        .map((d) => d?.id)
        .filter((v): v is string => typeof v === "string" && v.length > 0);
      return [...new Set(values)]
        .slice(0, 6)
        .map((value) => ({ value, type, relation: "contacts" }));
    } catch {
      return [];
    }
  };
  const [ips, doms] = await Promise.all([
    fetchList("contacted_ips"),
    fetchList("contacted_domains"),
  ]);
  return [...ips, ...doms];
}

interface VtFileResponse {
  data?: {
    attributes?: {
      last_analysis_stats?: {
        harmless?: number;
        malicious?: number;
        suspicious?: number;
        undetected?: number;
        timeout?: number;
      };
      type_description?: string;
      type_tag?: string;
      size?: number;
      md5?: string;
      sha1?: string;
      sha256?: string;
      magic?: string;
      meaningful_name?: string;
      names?: string[];
      reputation?: number;
      tags?: string[];
      first_submission_date?: number;
      last_analysis_date?: number;
      popular_threat_classification?: {
        suggested_threat_label?: string;
        popular_threat_name?: { value?: string }[];
      };
    };
  };
  error?: { message?: string; code?: string };
}

function isoFromEpoch(seconds?: number): string | undefined {
  if (!seconds) return undefined;
  return new Date(seconds * 1000).toISOString();
}

/** VirusTotal v3 - multi-engine file detection by hash (free API key required). */
export const virusTotalHashSource: TiSource = {
  meta: {
    id: "virustotal",
    name: "VirusTotal",
    url: "https://www.virustotal.com",
    category: "reputation",
    requiresKey: true,
    weight: 1,
    keyEnv: "VIRUSTOTAL_API_KEY",
  },
  isEnabled: () => Boolean(process.env.VIRUSTOTAL_API_KEY),
  async check(hash, signal): Promise<SourceFinding> {
    const key = process.env.VIRUSTOTAL_API_KEY;
    if (!key) return { status: "skipped" };
    try {
      const headers = { "x-apikey": key };
      const [main, relations] = await Promise.all([
        getJson<VtFileResponse>(
          `https://www.virustotal.com/api/v3/files/${hash}`,
          signal,
          headers,
        ),
        fetchHashRelations(hash, signal, headers),
      ]);
      const { ok, status, data } = main;

      // 404 = VT has never seen this file. That isn't a clean result, so emit
      // no score and let the verdict stay inconclusive unless another feed hits.
      if (status === 404) {
        return { status: "ok", summary: "File not found in VirusTotal" };
      }
      if (!ok || !data?.data?.attributes) {
        return {
          status: "error",
          error: data?.error?.message ?? `HTTP ${status}`,
        };
      }

      const attr = data.data.attributes;
      const stats = attr.last_analysis_stats ?? {};
      const malicious = stats.malicious ?? 0;
      const suspicious = stats.suspicious ?? 0;
      const total =
        (stats.harmless ?? 0) +
        malicious +
        suspicious +
        (stats.undetected ?? 0) +
        (stats.timeout ?? 0);

      const score = Math.min(100, malicious * 8 + suspicious * 3);
      const threatLabel =
        attr.popular_threat_classification?.suggested_threat_label;
      const family =
        attr.popular_threat_classification?.popular_threat_name?.[0]?.value;
      const names = Array.from(
        new Set([attr.meaningful_name, ...(attr.names ?? [])].filter(Boolean)),
      ) as string[];

      return {
        status: "ok",
        malicious: malicious >= 3,
        score,
        categories: [threatLabel, ...(attr.tags ?? [])]
          .filter(Boolean)
          .slice(0, 10) as string[],
        summary: `${malicious}/${total} engines detect this file${
          threatLabel ? ` as ${threatLabel}` : ""
        }`,
        hashContext: {
          md5: attr.md5,
          sha1: attr.sha1,
          sha256: attr.sha256,
          fileName: names[0],
          fileNames: names.slice(0, 6),
          fileType: attr.type_description,
          mimeType: attr.type_tag,
          fileSize: attr.size,
          malwareFamily: family,
          threatLabel,
          magic: attr.magic,
          firstSeen: isoFromEpoch(attr.first_submission_date),
          lastSeen: isoFromEpoch(attr.last_analysis_date),
        },
        details: {
          maliciousEngines: malicious,
          suspiciousEngines: suspicious,
          harmlessEngines: stats.harmless ?? 0,
          totalEngines: total,
          typeDescription: attr.type_description,
          threatLabel,
          reputation: attr.reputation,
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
