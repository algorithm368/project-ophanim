import type { SourceFinding, TiSource } from "../types";
import { errorMessage, getJson, isTimeout } from "../http";
import {
  getCachedGreyNoiseIdentification,
  setCachedGreyNoiseIdentification,
  type GreyNoiseIdentification,
} from "../cache";

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

/** GreyNoise classification → 0-100 contribution (malicious 80, benign 0, else 30). */
export function greyNoiseScore(classification: string | undefined): number {
  if (classification === "malicious") return 80;
  if (classification === "benign") return 0;
  return 30;
}

/**
 * Whether GreyNoise is vouching for the address rather than merely having
 * nothing against it.
 *
 * GreyNoise exists to answer "is this benign internet background noise", so a
 * `benign` classification or a RIOT hit (a common business service, e.g. a
 * Microsoft or Google address) is a positive identification, not an absence of
 * reports. Filing it as an allowlist signal is what lets aggregateRisk() weigh
 * it at all: without this the one source that knows 71.6.146.185 is Shodan says
 * nothing the aggregate can hear, and only AbuseIPDB ever set the field.
 */
export function greyNoiseVouches(
  classification: string | undefined,
  riot: boolean | undefined,
): boolean {
  return classification === "benign" || riot === true;
}

/**
 * Build the same finding shape whether GreyNoise just answered live or the
 * answer is a stored identification from a prior, unrelated check. The two
 * paths must agree, since threatTypeOf() and the confidence coverage count
 * only look at `status`, and telling them apart is not the point: the point
 * is that a stale identification still beats none.
 */
function findingFromIdentification(
  id: GreyNoiseIdentification,
  fromCache: boolean,
): SourceFinding {
  const { classification, noise, riot, actor, link, lastSeen } = id;
  const score = greyNoiseScore(classification);

  const categories: string[] = [];
  if (noise) categories.push("internet-scanner");
  if (riot) categories.push("common-business-service");
  categories.push(classification);

  const actorSuffix = actor ? ` (${actor})` : "";
  const scannerSuffix = noise ? " (active scanner)" : "";
  const provenance = fromCache
    ? " — cached identification, today's quota is exhausted"
    : "";

  return {
    status: "ok",
    malicious: classification === "malicious",
    allowlisted: greyNoiseVouches(classification, riot),
    score,
    lastSeen,
    categories,
    summary: `${classification}${actorSuffix}${scannerSuffix}${provenance}`,
    details: { classification, noise, riot, actor, link },
  };
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
      // The free Community API has a tight daily quota; fall back to the last
      // identification this address had rather than surfacing an outage that
      // silently changes threatTypeOf()'s answer (#37).
      if (status === 429 || /limit|quota/i.test(data?.message ?? "")) {
        const cached = await getCachedGreyNoiseIdentification(ip);
        if (cached) return findingFromIdentification(cached, true);
        return {
          status: "rate_limited",
          summary: data?.message ?? "Daily quota exceeded",
        };
      }
      if (!ok || !data) {
        return { status: "error", error: data?.message ?? `HTTP ${status}` };
      }

      const identification: GreyNoiseIdentification = {
        classification: data.classification ?? "unknown",
        noise: data.noise,
        riot: data.riot,
        actor: data.name,
        link: data.link,
        lastSeen: data.last_seen,
      };
      // Fire and forget: an answer the analyst already has should not wait on
      // storing it, and a failed write just means the next quota-exhausted day
      // falls back to whatever identification was cached before this one.
      void setCachedGreyNoiseIdentification(ip, identification);

      return { ...findingFromIdentification(identification, false), raw: data };
    } catch (err) {
      return {
        status: isTimeout(err) ? "timeout" : "error",
        error: errorMessage(err),
      };
    }
  },
};
