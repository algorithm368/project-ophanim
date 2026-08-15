import type { SourceFinding, TiSource } from "../../types";
import { errorMessage, isTimeout, postForm } from "../../http";

/** Shape of a /v1/url/ response. Probed 2026-08-15: the endpoint exists and
 *  answers 401 without a key, exactly like the /v1/host/ endpoint in use. */
export interface UrlhausUrlResponse {
  query_status: string;
  url_status?: string;
  threat?: string;
  date_added?: string;
  last_online?: string;
  tags?: string[];
  reporter?: string;
}

/**
 * Map a URLhaus URL record to a finding. An offline listing stays malicious,
 * since the URL was weaponized and that is a fact about the URL, but it scores
 * below a live one: an analyst triaging today needs to know whether the thing
 * is still serving.
 */
export function urlhausUrlFinding(data: UrlhausUrlResponse): SourceFinding {
  if (data.query_status !== "ok") {
    return { status: "ok", score: 0, summary: "Not on URLhaus" };
  }
  const online = data.url_status === "online";
  const threat = data.threat ?? "malware";
  return {
    status: "ok",
    malicious: true,
    score: online ? 95 : 75,
    categories: [threat, ...(data.tags ?? [])].filter(Boolean),
    lastSeen: data.last_online ?? data.date_added,
    summary: online
      ? `Live ${threat} URL on URLhaus`
      : `Known ${threat} URL on URLhaus, currently offline`,
    details: {
      urlStatus: data.url_status,
      threat: data.threat,
      dateAdded: data.date_added,
      lastOnline: data.last_online,
      tags: data.tags,
      reporter: data.reporter,
    },
    raw: data,
  };
}

/** URLhaus (abuse.ch) URL-level lookup. One abuse.ch Auth-Key covers ThreatFox
 *  and URLhaus, so this reuses THREATFOX_API_KEY as the host-level source does. */
export const urlhausUrlSource: TiSource = {
  meta: {
    id: "urlhaus-url",
    name: "URLhaus (URL)",
    url: "https://urlhaus.abuse.ch",
    category: "blocklist",
    requiresKey: true,
    keyEnv: "THREATFOX_API_KEY",
    weight: 1,
  },
  isEnabled: () => Boolean(process.env.THREATFOX_API_KEY),
  async check(url, signal): Promise<SourceFinding> {
    const key = process.env.THREATFOX_API_KEY;
    if (!key) return { status: "skipped" };
    try {
      const { ok, status, data } = await postForm<UrlhausUrlResponse>(
        "https://urlhaus-api.abuse.ch/v1/url/",
        signal,
        { url },
        { "Auth-Key": key },
      );
      if (!ok || !data) {
        return { status: "error", error: `HTTP ${status}` };
      }
      return urlhausUrlFinding(data);
    } catch (err) {
      return {
        status: isTimeout(err) ? "timeout" : "error",
        error: errorMessage(err),
      };
    }
  },
};
