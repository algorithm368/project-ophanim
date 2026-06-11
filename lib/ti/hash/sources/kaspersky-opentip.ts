import type { SourceFinding, TiSource } from "../../types";
import { errorMessage, getJson, isTimeout } from "../../http";

interface KasperskyResponse {
  Zone?: string; // Red | Yellow | Green | Grey
  FileGeneralInfo?: {
    FileStatus?: string;
    Type?: string;
    Size?: number;
    Md5?: string;
    Sha1?: string;
    Sha256?: string;
    FirstSeen?: string;
    LastSeen?: string;
    /** Authenticode signer, when the file is signed. */
    Signer?: string;
    /** How many times Kaspersky's network has seen this file. */
    HitsCount?: number;
  };
  DetectionsInfo?: { DetectionName?: string }[] | null;
}

/** Kaspersky OpenTIP zone → score + malicious flag. Grey/unknown = no score. */
export function zoneToScore(zone: string | undefined): {
  score: number | undefined;
  malicious: boolean;
} {
  switch (zone) {
    case "Red":
      return { score: 90, malicious: true };
    case "Yellow":
      return { score: 45, malicious: false };
    case "Green":
      return { score: 0, malicious: false };
    default:
      return { score: undefined, malicious: false };
  }
}

/** Kaspersky OpenTIP — authoritative hash reputation zone (free API key). */
export const kasperskyOpenTipSource: TiSource = {
  meta: {
    id: "kaspersky-opentip",
    name: "Kaspersky OpenTIP",
    url: "https://opentip.kaspersky.com",
    category: "reputation",
    requiresKey: true,
    weight: 0.9,
    keyEnv: "KASPERSKY_OPENTIP_API_KEY",
    timeoutMs: 12000,
  },
  isEnabled: () => Boolean(process.env.KASPERSKY_OPENTIP_API_KEY),
  async check(hash, signal): Promise<SourceFinding> {
    const key = process.env.KASPERSKY_OPENTIP_API_KEY;
    if (!key) return { status: "skipped" };
    try {
      const { ok, status, data } = await getJson<KasperskyResponse>(
        `https://opentip.kaspersky.com/api/v1/search/hash?request=${encodeURIComponent(
          hash,
        )}`,
        signal,
        { "x-api-key": key },
      );

      if (status === 404) {
        return { status: "ok", summary: "Not found in Kaspersky OpenTIP" };
      }
      if (!ok || !data) {
        return { status: "error", error: `HTTP ${status}` };
      }

      const { score, malicious } = zoneToScore(data.Zone);
      const detections = (data.DetectionsInfo ?? [])
        .map((d) => d.DetectionName)
        .filter((v): v is string => Boolean(v));
      const info = data.FileGeneralInfo;

      return {
        status: "ok",
        malicious,
        score,
        categories: detections.slice(0, 10),
        summary: `Kaspersky zone: ${data.Zone ?? "Unknown"}${
          detections.length ? ` — ${detections[0]}` : ""
        }`,
        hashContext: {
          md5: info?.Md5?.toLowerCase(),
          sha1: info?.Sha1?.toLowerCase(),
          sha256: info?.Sha256?.toLowerCase(),
          fileType: info?.Type,
          fileSize: info?.Size,
          firstSeen: info?.FirstSeen,
          lastSeen: info?.LastSeen,
          detectionNames: detections.length ? detections : undefined,
        },
        details: {
          zone: data.Zone,
          fileStatus: info?.FileStatus,
          firstSeen: info?.FirstSeen,
          lastSeen: info?.LastSeen,
          signer: info?.Signer,
          hitsCount: info?.HitsCount,
          detections,
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
