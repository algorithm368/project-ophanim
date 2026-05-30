import type { RelatedIndicator, SourceFinding, TiSource } from "../../types";
import { errorMessage, getJson, isTimeout } from "../../http";

interface PdProperty {
  indicator?: string;
  type?: string; // ip | domain | url | sha256 | ...
}
interface PdResponse {
  iid?: number;
  indicator?: string;
  risk?: string; // none | low | medium | high | critical | unknown
  threats?: { name?: string }[] | null;
  properties?: { dns?: unknown };
  // Pulsedive returns linked indicators under different keys per plan; the
  // adapter reads any that are present (verify live before committing).
  links?: PdProperty[] | null;
  error?: string;
}

/** Pulsedive risk band → 0-100 contribution. Returns undefined when unknown. */
export function riskToScore(risk: string | undefined): number | undefined {
  switch (risk) {
    case "critical":
      return 90;
    case "high":
      return 75;
    case "medium":
      return 45;
    case "low":
      return 20;
    case "none":
      return 0;
    default:
      return undefined;
  }
}

function linkType(t: string | undefined): RelatedIndicator["type"] | undefined {
  if (t === "ip") return "ip";
  if (t === "domain") return "domain";
  if (t === "sha256" || t === "md5" || t === "sha1") return "hash";
  return undefined;
}

/** Pulsedive — indicator risk + linked indicators (free API key). */
export const pulsediveSource: TiSource = {
  meta: {
    id: "pulsedive",
    name: "Pulsedive",
    url: "https://pulsedive.com",
    category: "reputation",
    requiresKey: true,
    weight: 0.6,
    keyEnv: "PULSEDIVE_API_KEY",
    timeoutMs: 12000,
  },
  isEnabled: () => Boolean(process.env.PULSEDIVE_API_KEY),
  async check(hash, signal): Promise<SourceFinding> {
    const key = process.env.PULSEDIVE_API_KEY;
    if (!key) return { status: "skipped" };
    try {
      const url = `https://pulsedive.com/api/explore.php?q=ioc%3D${encodeURIComponent(
        hash,
      )}&limit=1&pretty=1&key=${encodeURIComponent(key)}`;
      const { ok, status, data } = await getJson<{
        results?: PdResponse[];
        error?: string;
      }>(url, signal);

      const hit = data?.results?.[0];
      if (!ok) {
        return { status: "error", error: data?.error ?? `HTTP ${status}` };
      }
      if (!hit) {
        return { status: "ok", summary: "Not indexed by Pulsedive" };
      }

      const score = riskToScore(hit.risk);
      const threats = (hit.threats ?? [])
        .map((t) => t.name)
        .filter((v): v is string => Boolean(v));
      const relations: RelatedIndicator[] = (hit.links ?? [])
        .map((l) => {
          const type = linkType(l.type);
          // A linked file is a related sample, not something the file
          // "contacts" — keep the C2/network label for ip/domain links only.
          return type && l.indicator
            ? {
                value: l.indicator,
                type,
                relation: type === "hash" ? "similar" : "contacts",
              }
            : null;
        })
        .filter((r): r is RelatedIndicator => r !== null)
        .slice(0, 8);

      return {
        status: "ok",
        malicious: hit.risk === "high" || hit.risk === "critical",
        score,
        categories: threats.slice(0, 10),
        summary: `Pulsedive risk: ${hit.risk ?? "unknown"}${
          threats.length ? ` (${threats.slice(0, 3).join(", ")})` : ""
        }`,
        hashContext: threats.length ? { detectionNames: threats } : undefined,
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
