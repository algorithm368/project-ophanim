import type { SourceFinding, TiSource } from "../../types";
import { errorMessage, getJson, isTimeout } from "../../http";

interface PdThreat {
  name?: string;
  category?: string;
}
interface PdFeed {
  name?: string;
  category?: string;
  organization?: string;
}
interface PdResponse {
  iid?: number;
  indicator?: string;
  type?: string;
  risk?: string; // none | low | medium | high | critical | unknown | retired
  threats?: PdThreat[] | null;
  /** Open-source feeds this indicator appears on. */
  feeds?: PdFeed[] | null;
  /** "YYYY-MM-DD HH:MM:SS" UTC — first added / most recently seen. */
  stamp_added?: string;
  stamp_seen?: string;
  error?: string;
}

/** Pulsedive stamps are "YYYY-MM-DD HH:MM:SS" in UTC; normalize to ISO so the
 *  profile card's first/last-seen rows render consistently with other sources. */
export function pdIso(stamp: string | undefined): string | undefined {
  if (!stamp) return undefined;
  const d = new Date(stamp.replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
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

/** Pulsedive — indicator risk + threat labels (free API key). */
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
      // Look the indicator up by value: info.php returns the full record
      // (risk + threats) in one call. explore.php returns only summary rows
      // without threats, so it cannot be used for enrichment. A 404 means
      // Pulsedive has no record — absence is not a clean signal.
      const { ok, status, data } = await getJson<PdResponse>(
        `https://pulsedive.com/api/info.php?indicator=${encodeURIComponent(
          hash,
        )}&key=${encodeURIComponent(key)}`,
        signal,
      );

      if (status === 404) {
        return { status: "ok", summary: "Not indexed by Pulsedive" };
      }
      if (!ok || !data || data.error) {
        return { status: "error", error: data?.error ?? `HTTP ${status}` };
      }

      const score = riskToScore(data.risk);
      const threats = [
        ...new Set(
          (data.threats ?? [])
            .map((t) => t.name)
            .filter((v): v is string => Boolean(v)),
        ),
      ];
      const feeds = [
        ...new Set(
          (data.feeds ?? [])
            .map((f) => f.name)
            .filter((v): v is string => Boolean(v)),
        ),
      ].slice(0, 10);
      const firstSeen = pdIso(data.stamp_added);
      const lastSeen = pdIso(data.stamp_seen);

      const hashContext =
        threats.length || firstSeen || lastSeen
          ? {
              detectionNames: threats.length ? threats : undefined,
              firstSeen,
              lastSeen,
            }
          : undefined;

      return {
        status: "ok",
        malicious: data.risk === "high" || data.risk === "critical",
        score,
        categories: threats.slice(0, 10),
        summary: `Pulsedive risk: ${data.risk ?? "unknown"}${
          threats.length ? ` (${threats.slice(0, 3).join(", ")})` : ""
        }`,
        hashContext,
        details: feeds.length ? { feeds } : undefined,
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
