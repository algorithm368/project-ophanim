import { Resolver } from "node:dns/promises";
import type { SourceFinding, TiSource } from "../../types";

/** Parse an MHR TXT record: "<last_seen_unix_ts> <detection_percentage>". */
export function parseCymruTxt(txt: string): {
  lastSeen: string | undefined;
  detection: number;
} {
  const [tsRaw, detectRaw] = txt.split(/\s+/);
  const lastSeenTs = Number(tsRaw);
  return {
    lastSeen: Number.isFinite(lastSeenTs)
      ? new Date(lastSeenTs * 1000).toISOString()
      : undefined,
    detection: Number(detectRaw),
  };
}

/**
 * MHR detection rate → score. Presence in MHR means it's known malware; the
 * rate refines confidence, but a fresh sample can read low, so floor at 50
 * (cap 95). A missing/unparseable rate falls back to 60.
 */
export function cymruScore(detection: number): number {
  return Number.isFinite(detection) ? Math.min(95, Math.max(50, detection)) : 60;
}

/**
 * Team Cymru Malware Hash Registry - a free, key-free reputation feed queried
 * over DNS. A TXT record at "<hash>.malware.hash.cymru.com" returns the last
 * time the sample was seen plus its AV detection rate. MHR indexes MD5 and
 * SHA-1 hashes only.
 */
export const cymruMhrSource: TiSource = {
  meta: {
    id: "cymru-mhr",
    name: "Team Cymru MHR",
    url: "https://www.team-cymru.com/mhr",
    category: "reputation",
    requiresKey: false,
    weight: 0.7,
  },
  isEnabled: () => true,
  async check(hash): Promise<SourceFinding> {
    if (hash.length !== 32 && hash.length !== 40) {
      return { status: "ok", summary: "MHR supports MD5/SHA-1 only" };
    }

    // node:dns has no AbortSignal support; bound the lookup with its own timeout.
    const resolver = new Resolver({ timeout: 4000, tries: 1 });
    try {
      const records = await resolver.resolveTxt(`${hash}.malware.hash.cymru.com`);
      const txt = records.map((chunks) => chunks.join("")).join(" ").trim();
      const { lastSeen, detection } = parseCymruTxt(txt);
      const score = cymruScore(detection);

      return {
        status: "ok",
        malicious: true,
        score,
        lastSeen,
        summary: `Known malware in Team Cymru MHR${
          Number.isFinite(detection) ? ` (${detection}% AV detection)` : ""
        }`,
        hashContext: { lastSeen },
        details: {
          detectionRate: Number.isFinite(detection) ? detection : undefined,
          lastSeen,
        },
        raw: txt,
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // NXDOMAIN / no record = the hash isn't a known malware sample.
      if (code === "ENOTFOUND" || code === "ENODATA") {
        return { status: "ok", summary: "Not in Team Cymru MHR" };
      }
      return {
        status: code === "ETIMEOUT" ? "timeout" : "error",
        error: code ?? (err instanceof Error ? err.message : String(err)),
      };
    }
  },
};
