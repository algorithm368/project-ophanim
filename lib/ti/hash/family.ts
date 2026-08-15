import type { HashContext } from "../types";

/**
 * Tokens that are never a malware family: AV vendor scan-type prefixes,
 * platforms, and generic/heuristic markers. Matched case-insensitively against
 * whole label segments.
 */
const STOPWORDS = new Set([
  // scan-type / generic
  "trojan", "trojandownloader", "downloader", "dropper", "droppr", "backdoor",
  "worm", "virus", "ransom", "ransomware", "adware", "pua", "pup", "riskware",
  "risktool", "hacktool", "spyware", "keylogger", "banker", "bank", "rootkit",
  "bootkit", "exploit", "exp", "agent", "heur", "heuristic", "gen", "generic",
  "genericml", "malware", "malgent", "packed", "packer", "obfuscated", "injector",
  "inject", "cryptor", "crypt", "behaveslike", "application", "program", "tool",
  "suspicious", "unwanted", "variant", "ml", "ai", "cloud", "static", "common",
  "trojanspy", "trojandropper", "trojanransom", "not", "a", "of",
  // platforms
  "win32", "win64", "win", "w32", "w64", "x86", "x64", "msil", "android", "linux",
  "unix", "osx", "macos", "mac", "ios", "js", "jsc", "vbs", "vba", "html", "php",
  "python", "perl", "ps1", "powershell", "elf", "apk", "dos", "script", "o97m",
  "x97m", "w97m", "multi", "boot",
]);

/** Split a detection label into candidate segments on the usual separators. */
function segments(label: string): string[] {
  return label.split(/[.\-:_/\s]+/).filter(Boolean);
}

/**
 * Parse the most likely family name out of a set of AV detection labels.
 * Heuristic: a family token appears capitalized in at least one label (e.g.
 * "Upatre", "Mirai", "Emotet"), is not a stopword, and is >=3 chars. Variants
 * ("afcl", "gen") are lowercase and fall out; platform/type/generic tokens are
 * stopwords. The token seen most often wins, ties break toward the longer then
 * earlier token. Returns the original casing of the winning token.
 */
export function parseFamilyFromDetections(names: string[]): string | undefined {
  const stats = new Map<
    string,
    { original: string; count: number; capitalized: boolean; order: number }
  >();
  let order = 0;
  for (const name of names) {
    if (!name) continue;
    for (const seg of segments(name)) {
      const key = seg.toLowerCase();
      if (STOPWORDS.has(key) || key.length < 3) continue;
      const capitalized = /^[A-Z]/.test(seg);
      const prev = stats.get(key);
      if (prev) {
        prev.count += 1;
        prev.capitalized = prev.capitalized || capitalized;
      } else {
        stats.set(key, { original: seg, count: 1, capitalized, order: order++ });
      }
    }
  }

  const entries = [...stats.values()];
  const pick = (pool: typeof entries) =>
    pool.toSorted(
      (a, b) =>
        b.count - a.count ||
        b.original.length - a.original.length ||
        a.order - b.order,
    )[0]?.original;

  // Prefer tokens that showed up capitalized; fall back to any longer token.
  return (
    pick(entries.filter((e) => e.capitalized)) ??
    pick(entries.filter((e) => e.original.length >= 5))
  );
}

/**
 * The family for a hash: an explicit family set by a source wins; otherwise
 * parse it out of the unioned detection labels.
 */
export function resolveFamily(ctx: HashContext): string | undefined {
  if (ctx.malwareFamily?.trim()) return ctx.malwareFamily.trim();
  return parseFamilyFromDetections(ctx.detectionNames ?? []);
}
