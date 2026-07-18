import { getJson } from "../../http";

interface MalpediaFamily {
  description?: string;
  urls?: string[];
}

const BASE = "https://malpedia.caad.fkie.fraunhofer.de/api/get/family";
const PLATFORMS = ["win", "elf", "osx", "apk", "js"];

/**
 * Candidate Malpedia family ids for a family name, most likely first. Malpedia
 * keys families as `<platform>.<slug>`; most malware is Windows, so `win.`
 * leads. The slug is the name lowercased with non-alphanumerics stripped.
 */
export function familyToMalpediaIds(family: string): string[] {
  const slug = family.toLowerCase().replace(/[^a-z0-9]/g, "");
  return PLATFORMS.map((p) => `${p}.${slug}`);
}

/**
 * Fetch a family description from Malpedia (public API, no key). Tries the
 * platform-prefixed ids in order, stopping at the first hit; returns the
 * description plus up to five reference URLs. Any miss/timeout yields undefined,
 * so the caller degrades to showing just the family name.
 */
export async function fetchFamilyDescription(
  family: string,
  signal: AbortSignal,
): Promise<{ description?: string; refs?: string[] } | undefined> {
  for (const id of familyToMalpediaIds(family)) {
    const { ok, data } = await getJson<MalpediaFamily>(`${BASE}/${id}`, signal);
    if (ok && data && (data.description || data.urls?.length)) {
      return {
        description: data.description?.trim() || undefined,
        refs: data.urls?.length ? data.urls.slice(0, 5) : undefined,
      };
    }
  }
  return undefined;
}
