import type { SourceFinding, TiSource } from "../../types";
import { errorMessage, getJson, isTimeout } from "../../http";
import { vtDefinitive } from "../../vt-verdict";
import {
  detectionNames,
  fileRelationsFromVt,
  type VtRelationships,
} from "../../vt-relationships";
import { dllRank } from "../../dll-dictionary";

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
      /** Per-engine verdicts; only "malicious" entries carry a label. */
      last_analysis_results?: Record<
        string,
        { category?: string; result?: string | null }
      >;
      /** Community up/down votes on the file's harmfulness. */
      total_votes?: { harmless?: number; malicious?: number };
      type_description?: string;
      type_tag?: string;
      size?: number;
      md5?: string;
      sha1?: string;
      sha256?: string;
      magic?: string;
      ssdeep?: string;
      /** Import hash (PE imports) — absent for non-PE / packed files. */
      imphash?: string;
      tlsh?: string;
      meaningful_name?: string;
      names?: string[];
      reputation?: number;
      tags?: string[];
      first_submission_date?: number;
      last_analysis_date?: number;
      times_submitted?: number;
      popular_threat_classification?: {
        suggested_threat_label?: string;
        popular_threat_name?: { value?: string }[];
      };
      /** PE static import table: the DLLs (and functions) the binary imports. */
      pe_info?: {
        import_list?: {
          library_name?: string;
          imported_functions?: string[];
        }[];
      };
      /** Authenticode parse. `verified` is a human string ("Signed",
       *  "Unsigned", "Invalid Signature"); `signers` is a ";"-joined chain,
       *  leaf certificate first. Present (with PE version-resource fields
       *  like `product`/`description`) even on unsigned files, so `verified`
       *  is the only field that actually means "has a checked signature". */
      signature_info?: {
        verified?: string;
        signers?: string;
      };
      /** Per-sandbox detonation verdict, keyed by sandbox name. */
      sandbox_verdicts?: Record<
        string,
        { category?: string; confidence?: number }
      >;
    };
    /** Inline relationship pivots fetched via the `?relationships=` param. */
    relationships?: VtRelationships;
  };
  error?: { message?: string; code?: string };
}

/** The leaf certificate's name from VT's ";"-joined signer chain. */
export function primarySigner(signers: string | undefined): string | undefined {
  return signers?.split(";")[0]?.trim() || undefined;
}

/** Harmless only when every sandbox that detonated the file agrees — a single
 *  dissenting sandbox is enough to withhold the claim entirely. */
export function sandboxVerdictFromVt(
  verdicts: Record<string, { category?: string; confidence?: number }> | undefined,
): { sandboxes: string[]; confidence?: number } | undefined {
  const entries = Object.entries(verdicts ?? {});
  if (entries.length === 0 || !entries.every(([, v]) => v.category === "harmless")) {
    return undefined;
  }
  const confidence = entries
    .map(([, v]) => v.confidence)
    .find((c): c is number => typeof c === "number");
  return { sandboxes: entries.map(([name]) => name), confidence };
}

export function isoFromEpoch(seconds?: number): string | undefined {
  if (!seconds) return undefined;
  return new Date(seconds * 1000).toISOString();
}

/** VT vendor stats → 0-100 (file weighting: 8× malicious + 3× suspicious). */
export function vtFileScore(malicious: number, suspicious: number): number {
  return Math.min(100, malicious * 8 + suspicious * 3);
}

/**
 * PE `import_list` → imported DLLs (base name + function count), deduped and
 * ordered so capability-revealing libraries lead over UI/CRT boilerplate. Capped
 * for the readout. Returns [] for non-PE files (no import table).
 */
export function importedDllsFromVt(
  imports:
    | { library_name?: string; imported_functions?: string[] }[]
    | undefined,
  cap = 14,
): { name: string; count?: number }[] {
  if (!Array.isArray(imports)) return [];
  const byName = new Map<string, number>();
  for (const imp of imports) {
    const name = imp.library_name?.replace(/^.*[\\/]/, "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    byName.set(key, (byName.get(key) ?? 0) + (imp.imported_functions?.length ?? 0));
  }
  return [...byName.entries()]
    .map(([name, count]) => ({ name, count: count || undefined }))
    .sort(
      (a, b) =>
        dllRank(a.name) - dllRank(b.name) || (b.count ?? 0) - (a.count ?? 0),
    )
    .slice(0, cap);
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
      // One request: the contacted/dropped/parent pivots ride along on the main
      // file GET via ?relationships=, instead of the old 7-request fan-out
      // (main + 4 indicator-rel + 2 url-rel). itw_urls is Enterprise-only and
      // contacted_urls returns no usable URL inline, so both are dropped — this
      // keeps a hash lookup at 1 VT request under the 500/day, 4/min free key.
      const { ok, status, data } = await getJson<VtFileResponse>(
        `https://www.virustotal.com/api/v3/files/${hash}?relationships=contacted_ips,contacted_domains,dropped_files,execution_parents`,
        signal,
        headers,
      );

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

      const score = vtFileScore(malicious, suspicious);
      const threatLabel =
        attr.popular_threat_classification?.suggested_threat_label;
      const family =
        attr.popular_threat_classification?.popular_threat_name?.[0]?.value;
      const names = Array.from(
        new Set([attr.meaningful_name, ...(attr.names ?? [])].filter(Boolean)),
      ) as string[];

      const relations = fileRelationsFromVt(data.data.relationships);
      const detections = detectionNames(attr.last_analysis_results);
      const dlls = importedDllsFromVt(attr.pe_info?.import_list);
      const votes = attr.total_votes;
      const hasVotes = Boolean(votes && (votes.harmless || votes.malicious));
      const signed = attr.signature_info?.verified === "Signed";
      const signer = signed ? primarySigner(attr.signature_info?.signers) : undefined;
      const sandboxVerdict = sandboxVerdictFromVt(attr.sandbox_verdicts);

      return {
        status: "ok",
        malicious: vtDefinitive(malicious, total),
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
          fileNames: names.slice(0, 12),
          fileType: attr.type_description,
          mimeType: attr.type_tag,
          fileSize: attr.size,
          malwareFamily: family,
          threatLabel,
          magic: attr.magic,
          importedDlls: dlls.length ? dlls : undefined,
          imphash: attr.imphash,
          ssdeep: attr.ssdeep,
          tlsh: attr.tlsh,
          firstSeen: isoFromEpoch(attr.first_submission_date),
          lastSeen: isoFromEpoch(attr.last_analysis_date),
          // Names the engines assigned — the hash profile card renders none of
          // these, so they also surface in `details` (the raw disclosure).
          detectionNames: detections.length ? detections : undefined,
          detectionRatio: { malicious, total },
          signed: signed || undefined,
          signer,
          sandboxVerdict,
          timesSubmitted: attr.times_submitted,
        },
        details: {
          maliciousEngines: malicious,
          suspiciousEngines: suspicious,
          harmlessEngines: stats.harmless ?? 0,
          totalEngines: total,
          typeDescription: attr.type_description,
          threatLabel,
          reputation: attr.reputation,
          // Similarity/clustering digests — no profile row renders these.
          imphash: attr.imphash,
          ssdeep: attr.ssdeep,
          tlsh: attr.tlsh,
          detections: detections.length ? detections.slice(0, 8) : undefined,
          communityVotes: hasVotes
            ? { harmless: votes?.harmless ?? 0, malicious: votes?.malicious ?? 0 }
            : undefined,
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
