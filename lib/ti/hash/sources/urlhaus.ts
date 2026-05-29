import type { SourceFinding, TiSource } from "../../types";
import { errorMessage, isTimeout, postForm } from "../../http";

interface UrlhausUrlEntry {
  url?: string;
  url_status?: string;
  filename?: string | null;
}

interface UrlhausPayloadResponse {
  query_status?: string;
  md5_hash?: string;
  sha256_hash?: string;
  file_type?: string;
  file_size?: number | string;
  signature?: string | null;
  firstseen?: string | null;
  lastseen?: string | null;
  url_count?: number | string;
  urls?: UrlhausUrlEntry[];
}

function toNumber(value: number | string | undefined): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * URLhaus (abuse.ch) - tracks malware payloads and the URLs that distribute
 * them. A hit identifies the file (type + malware family) and shows where it
 * was being served. URLhaus indexes payloads by MD5/SHA-256 only.
 *
 * abuse.ch services share one Auth-Key, so this reuses THREATFOX_API_KEY.
 */
export const urlhausHashSource: TiSource = {
  meta: {
    id: "urlhaus",
    name: "URLhaus",
    url: "https://urlhaus.abuse.ch",
    category: "reputation",
    requiresKey: true,
    weight: 0.9,
    keyEnv: "THREATFOX_API_KEY",
    // abuse.ch is EU-hosted; give it headroom for the sin1 round trip.
    timeoutMs: 15000,
  },
  isEnabled: () => Boolean(process.env.THREATFOX_API_KEY),
  async check(hash, signal): Promise<SourceFinding> {
    const key = process.env.THREATFOX_API_KEY;
    if (!key) return { status: "skipped" };

    // URLhaus payload lookups accept MD5 or SHA-256, not SHA-1.
    const field =
      hash.length === 32
        ? "md5_hash"
        : hash.length === 64
          ? "sha256_hash"
          : null;
    if (!field) {
      return {
        status: "skipped",
        summary: "MD5/SHA-256 only — paste an MD5 or SHA-256 hash for URLhaus",
      };
    }

    try {
      const { ok, status, data } = await postForm<UrlhausPayloadResponse>(
        "https://urlhaus-api.abuse.ch/v1/payload/",
        signal,
        { [field]: hash },
        { "Auth-Key": key },
      );

      if (data?.query_status === "no_results") {
        return { status: "ok", summary: "Not seen in URLhaus payloads" };
      }
      if (!ok || data?.query_status !== "ok") {
        return {
          status: "error",
          error: data?.query_status ?? `HTTP ${status}`,
        };
      }

      const family = data.signature?.trim() || undefined;
      const urlCount = toNumber(data.url_count) ?? data.urls?.length ?? 0;
      const onlineUrls =
        data.urls?.filter((u) => u.url_status === "online").length ?? 0;

      return {
        status: "ok",
        malicious: true,
        score: 90,
        categories: [family, "malware-download"].filter(Boolean) as string[],
        lastSeen: data.lastseen ?? undefined,
        summary: `Malware payload${
          family ? ` (${family})` : ""
        } distributed via ${urlCount} URL(s)${
          onlineUrls ? `, ${onlineUrls} still online` : ""
        }`,
        hashContext: {
          md5: data.md5_hash,
          sha256: data.sha256_hash,
          fileType: data.file_type,
          fileSize: toNumber(data.file_size),
          malwareFamily: family,
          firstSeen: data.firstseen ?? undefined,
          lastSeen: data.lastseen ?? undefined,
        },
        details: {
          fileType: data.file_type,
          signature: family,
          urlCount,
          onlineUrls,
          sampleUrls: data.urls?.slice(0, 5).map((u) => u.url).filter(Boolean),
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
