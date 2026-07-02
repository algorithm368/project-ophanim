import type { SourceResult } from "../types";

/**
 * Source name-trust order, highest trust first. Submitted-name sources
 * (real filenames people uploaded) rank above VirusTotal's engine/submission
 * names, which rank above hashlookup's known-file corpus name. Sources not
 * listed fall to DEFAULT_RANK. Used only to break vote-count ties.
 */
const NAME_TRUST_ORDER = [
  "malwarebazaar",
  "triage",
  "hybrid-analysis",
  "maltiverse",
  "virustotal",
  "hashlookup",
];
const DEFAULT_RANK = 100;

function trustRank(sourceId: string): number {
  const i = NAME_TRUST_ORDER.indexOf(sourceId);
  return i === -1 ? DEFAULT_RANK : i;
}

/** Generic / auto-generated names that carry no identifying value. */
const DENYLIST = new Set([
  // base placeholders
  "file", "sample", "sample.bin", "unknown", "malware", "tmp", "temp",
  "a.out", "output",
  // generic binaries
  "virus", "trojan", "payload", "dropper", "dump", "bin", "data",
  "file.exe", "sample.exe", "malware.exe",
  // sandbox / scanner auto-names
  "sample.dll", "sample.doc", "target", "artifact", "run.exe", "test.exe",
  "vti-rescan",
  // OS placeholders
  "desktop.ini", "thumbs.db", "new folder", "document", "untitled",
  "download", "setup.exe", "install.exe",
]);

const HEX_RE = /^[0-9a-f]+$/;
const HASH_LENGTHS = new Set([32, 40, 64]);

/** Name with a trailing `.ext` removed (only when there is a stem before it). */
function stripExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function isJunk(name: string, hashes: Set<string>): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return true;
  // Equal to a full hash, or a hash with an extension appended.
  if (hashes.has(n)) return true;
  const base = stripExt(n);
  if (hashes.has(base)) return true;
  // Bare hex string of hash length (with or without an extension).
  if (HEX_RE.test(base) && HASH_LENGTHS.has(base.length)) return true;
  // Generic placeholder (matched against the full name and the extension-less stem).
  if (DENYLIST.has(n) || DENYLIST.has(base)) return true;
  // A URL, not a filename (URL-detonation sandboxes report the analyzed URL
  // as the sample "target").
  if (n.includes("://")) return true;
  // Pure numeric, single character, or extension-only (".exe").
  if (/^\d+$/.test(base)) return true;
  if (base.length <= 1) return true;
  if (/^\.[^.]+$/.test(n)) return true;
  return false;
}

interface Vote {
  display: string;
  sources: Set<string>;
  bestRank: number;
}

/**
 * Vote the best single filename out of everything the sources reported.
 * One vote per distinct (source, name); the winner is the name backed by the
 * most distinct sources, breaking ties by source name-trust then lexically.
 * Junk names (hash-as-name, bare hex, generic placeholders) are dropped.
 */
export function resolveFileName(
  results: SourceResult[],
  hashes: { md5?: string; sha1?: string; sha256?: string },
): { fileName?: string; fileNames?: string[] } {
  const hashSet = new Set(
    [hashes.md5, hashes.sha1, hashes.sha256]
      .filter((h): h is string => Boolean(h))
      .map((h) => h.toLowerCase()),
  );

  const votes = new Map<string, Vote>();

  for (const r of results) {
    if (r.status !== "ok" || !r.hashContext) continue;
    const ctx = r.hashContext;
    const names = ctx.fileNames?.length
      ? ctx.fileNames
      : ctx.fileName
        ? [ctx.fileName]
        : [];
    const rank = trustRank(r.source.id);
    const seen = new Set<string>();
    for (const raw of names) {
      if (typeof raw !== "string") continue;
      const name = raw.trim();
      if (!name || isJunk(name, hashSet)) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue; // one vote per (source, name)
      seen.add(key);
      const existing = votes.get(key);
      if (existing) {
        existing.sources.add(r.source.id);
        existing.bestRank = Math.min(existing.bestRank, rank);
      } else {
        votes.set(key, { display: name, sources: new Set([r.source.id]), bestRank: rank });
      }
    }
  }

  if (votes.size === 0) return { fileName: undefined, fileNames: undefined };

  const ranked = [...votes.values()].sort((a, b) => {
    if (b.sources.size !== a.sources.size) return b.sources.size - a.sources.size;
    if (a.bestRank !== b.bestRank) return a.bestRank - b.bestRank;
    return a.display.toLowerCase().localeCompare(b.display.toLowerCase());
  });

  return {
    fileName: ranked[0].display,
    fileNames: ranked.map((v) => v.display),
  };
}
