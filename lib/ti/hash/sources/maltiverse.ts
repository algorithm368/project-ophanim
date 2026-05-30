import type { RelatedIndicator, SourceFinding, TiSource } from "../../types";
import { errorMessage, getJson, isTimeout } from "../../http";
import { hostFromUrl } from "@/lib/url";

interface MaltiverseSample {
  classification?: string; // malicious | suspicious | neutral | whitelist
  filename?: string | string[];
  filetype?: string;
  size?: number;
  // Detection labels and related indicators vary by record; read defensively.
  antivirus?: { name?: string; description?: string }[] | null;
  blacklist?: { description?: string }[] | null;
  contacted_host?: { hostname?: string; ip_addr?: string }[] | null;
  download_url?: { url?: string }[] | null;
}

/** classification → score; undefined when neutral/unknown (absence ≠ clean). */
function classificationScore(c: string | undefined): {
  score: number | undefined;
  malicious: boolean;
} {
  if (c === "malicious") return { score: 85, malicious: true };
  if (c === "suspicious") return { score: 50, malicious: false };
  if (c === "whitelist") return { score: 0, malicious: false };
  return { score: undefined, malicious: false };
}

/** Maltiverse — sample classification + related indicators (free bearer key). */
export const maltiverseSource: TiSource = {
  meta: {
    id: "maltiverse",
    name: "Maltiverse",
    url: "https://maltiverse.com",
    category: "reputation",
    requiresKey: true,
    weight: 0.7,
    keyEnv: "MALTIVERSE_API_KEY",
    timeoutMs: 12000,
  },
  isEnabled: () => Boolean(process.env.MALTIVERSE_API_KEY),
  async check(hash, signal): Promise<SourceFinding> {
    const key = process.env.MALTIVERSE_API_KEY;
    if (!key) return { status: "skipped" };

    // Maltiverse sample lookups are keyed by SHA-256 only.
    if (hash.length !== 64) {
      return {
        status: "skipped",
        summary: "SHA-256 only — paste a SHA-256 hash to query Maltiverse",
      };
    }

    try {
      const { ok, status, data } = await getJson<MaltiverseSample>(
        `https://api.maltiverse.com/sample/${hash}`,
        signal,
        { Authorization: `Bearer ${key}` },
      );

      if (status === 404) {
        return { status: "ok", summary: "Not indexed by Maltiverse" };
      }
      if (!ok || !data) {
        return { status: "error", error: `HTTP ${status}` };
      }

      const { score, malicious } = classificationScore(data.classification);
      const detectionNames = (data.antivirus ?? [])
        .map((a) => a.description || a.name)
        .filter((v): v is string => Boolean(v));

      const relations: RelatedIndicator[] = [];
      const seen = new Set<string>();
      for (const h of data.contacted_host ?? []) {
        const v = h.hostname || h.ip_addr;
        if (v && !seen.has(v)) {
          seen.add(v);
          relations.push({
            value: v,
            type: h.hostname ? "domain" : "ip",
            relation: "contacts",
          });
        }
      }
      const distributionUrls = [
        ...new Set(
          (data.download_url ?? [])
            .map((d) => d.url)
            .filter((v): v is string => Boolean(v)),
        ),
      ].slice(0, 8);
      for (const u of distributionUrls) {
        const host = hostFromUrl(u);
        if (host && !seen.has(host)) {
          seen.add(host);
          relations.push({ value: host, type: "domain", relation: "distribution" });
        }
      }

      const name = Array.isArray(data.filename)
        ? data.filename[0]
        : data.filename;

      return {
        status: "ok",
        malicious,
        score,
        categories: detectionNames.slice(0, 10),
        summary: `Maltiverse classification: ${data.classification ?? "unknown"}`,
        hashContext: {
          sha256: hash,
          fileName: name,
          fileType: data.filetype,
          fileSize: data.size,
          detectionNames: detectionNames.length ? detectionNames : undefined,
          distributionUrls: distributionUrls.length ? distributionUrls : undefined,
        },
        relations: relations.slice(0, 10).length ? relations.slice(0, 10) : undefined,
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
