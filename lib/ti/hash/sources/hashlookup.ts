import type { SourceFinding, TiSource } from "../../types";
import { errorMessage, getJson, isTimeout } from "../../http";
import { algoFromLength } from "@/lib/hash";

interface HashlookupResponse {
  FileName?: string;
  FileSize?: string | number;
  MD5?: string;
  "SHA-1"?: string;
  "SHA-256"?: string;
  source?: string;
  db?: string;
  "hashlookup:trust"?: number;
  /** Present (comma-separated source list) when the hash is known malicious. */
  KnownMalicious?: string;
  message?: string;
}

export function toNumber(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * CIRCL hashlookup - a public, key-free reputation service backed by curated
 * known-files databases (NSRL and others). A hit usually means the file is a
 * known, legitimate file; it also exposes a `KnownMalicious` flag for samples
 * that curated feeds have marked bad.
 */
export const hashlookupSource: TiSource = {
  meta: {
    id: "hashlookup",
    name: "CIRCL hashlookup",
    url: "https://hashlookup.circl.lu",
    category: "reputation",
    requiresKey: false,
    // Authoritative for "known legitimate file", weaker for maliciousness, so
    // it informs the consensus without dominating it.
    weight: 0.4,
  },
  isEnabled: () => true,
  async check(hash, signal): Promise<SourceFinding> {
    const endpoint = algoFromLength(hash);
    if (!endpoint) return { status: "error", error: "Unsupported hash length" };
    try {
      const { ok, status, data } = await getJson<HashlookupResponse>(
        `https://hashlookup.circl.lu/lookup/${endpoint}/${hash}`,
        signal,
      );

      // 404 = not in the known-files corpus. That's neither good nor bad on its
      // own, so emit no score rather than implying anything.
      if (status === 404) {
        return { status: "ok", summary: "Not in the known-files database" };
      }
      if (!ok || !data) {
        return { status: "error", error: data?.message ?? `HTTP ${status}` };
      }

      const fileName = data.FileName?.trim() || undefined;
      const fileSize = toNumber(data.FileSize);
      const origin = data.source || data.db || undefined;
      const trust = data["hashlookup:trust"];
      const knownMalicious = data.KnownMalicious?.trim() || undefined;

      const hashContext = {
        md5: data.MD5?.toLowerCase(),
        sha1: data["SHA-1"]?.toLowerCase(),
        sha256: data["SHA-256"]?.toLowerCase(),
        fileName,
        fileSize,
      };
      const details = {
        source: origin,
        trust,
        fileName,
        fileSize,
        knownMalicious,
      };

      if (knownMalicious) {
        return {
          status: "ok",
          malicious: true,
          score: 85,
          summary: `Flagged as known malicious by ${knownMalicious}`,
          categories: knownMalicious.split(",").map((s) => s.trim()).filter(Boolean),
          hashContext,
          details,
        };
      }

      // A known, non-malicious file is a genuine reassuring signal.
      return {
        status: "ok",
        score: 0,
        summary: `Known legitimate file${origin ? ` (${origin})` : ""}${
          fileName ? `, "${fileName}"` : ""
        }`,
        hashContext,
        details,
      };
    } catch (err) {
      return {
        status: isTimeout(err) ? "timeout" : "error",
        error: errorMessage(err),
      };
    }
  },
};
