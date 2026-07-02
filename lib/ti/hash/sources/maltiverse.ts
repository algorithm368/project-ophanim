import type { RelatedIndicator, SourceFinding, TiSource } from "../../types";
import { errorMessage, getJson, isTimeout } from "../../http";
import { detectIOC } from "@/lib/ioc";

interface MaltiverseSample {
  classification?: string; // malicious | suspicious | neutral | whitelist
  filename?: string | string[];
  filetype?: string;
  size?: number;
  // Verified against the live public API: detection labels live in
  // blacklist[].description, and contacted_host is an array of bare
  // host/IP strings (not objects).
  blacklist?: { description?: string }[] | null;
  contacted_host?: string[] | null;
  tag?: string[] | null;
  error?: string;
}

/** classification → score; undefined when neutral/unknown (absence ≠ clean). */
export function classificationScore(c: string | undefined): {
  score: number | undefined;
  malicious: boolean;
  allowlisted: boolean;
} {
  if (c === "malicious") return { score: 85, malicious: true, allowlisted: false };
  if (c === "suspicious") return { score: 50, malicious: false, allowlisted: false };
  if (c === "whitelist") return { score: 0, malicious: false, allowlisted: true };
  return { score: undefined, malicious: false, allowlisted: false };
}

/**
 * Maltiverse — sample classification + related indicators. The /sample
 * endpoint is public, so this runs without a key; a MALTIVERSE_API_KEY (free
 * account) is sent when present to raise the rate limit.
 */
export const maltiverseSource: TiSource = {
  meta: {
    id: "maltiverse",
    name: "Maltiverse",
    url: "https://maltiverse.com",
    category: "reputation",
    requiresKey: false,
    weight: 0.7,
    keyEnv: "MALTIVERSE_API_KEY",
    timeoutMs: 12000,
  },
  isEnabled: () => true,
  async check(hash, signal): Promise<SourceFinding> {
    // Maltiverse sample lookups are keyed by SHA-256 only.
    if (hash.length !== 64) {
      return {
        status: "skipped",
        summary: "SHA-256 only, paste a SHA-256 hash to query Maltiverse",
      };
    }

    const key = process.env.MALTIVERSE_API_KEY;
    const headers: Record<string, string> = key
      ? { Authorization: `Bearer ${key}` }
      : {};

    try {
      const { ok, status, data } = await getJson<MaltiverseSample>(
        `https://api.maltiverse.com/sample/${hash}`,
        signal,
        headers,
      );

      if (status === 404) {
        return { status: "ok", summary: "Not indexed by Maltiverse" };
      }
      if (!ok || !data || data.error) {
        return { status: "error", error: data?.error ?? `HTTP ${status}` };
      }

      const { score, malicious, allowlisted } = classificationScore(
        data.classification,
      );
      // blacklist[].description is sometimes a single label, sometimes a
      // comma-joined set ("ransomware,wcry,..."); split into distinct chips.
      const detectionNames = [
        ...new Set(
          (data.blacklist ?? [])
            .flatMap((b) => (b.description ?? "").split(","))
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      ].slice(0, 12);

      const relations: RelatedIndicator[] = [];
      const seen = new Set<string>();
      for (const h of data.contacted_host ?? []) {
        if (typeof h !== "string" || !h || seen.has(h)) continue;
        seen.add(h);
        relations.push({
          value: h,
          type: detectIOC(h) === "ip" ? "ip" : "domain",
          relation: "contacts",
        });
        if (relations.length >= 10) break;
      }

      const rawNames = Array.isArray(data.filename)
        ? data.filename
        : data.filename
          ? [data.filename]
          : [];
      const fileNames = [
        ...new Set(rawNames.filter((n): n is string => Boolean(n && n.trim()))),
      ];
      const name = fileNames[0];
      const tags = [
        ...new Set((data.tag ?? []).filter((t): t is string => Boolean(t))),
      ].slice(0, 15);

      return {
        status: "ok",
        malicious,
        allowlisted,
        score,
        categories: detectionNames,
        summary: `Maltiverse classification: ${data.classification ?? "unknown"}`,
        hashContext: {
          sha256: hash,
          fileName: name,
          fileNames: fileNames.length ? fileNames : undefined,
          fileType: data.filetype,
          fileSize: data.size,
          detectionNames: detectionNames.length ? detectionNames : undefined,
          tags: tags.length ? tags : undefined,
        },
        relations: relations.length ? relations : undefined,
        details: tags.length ? { tags } : undefined,
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
