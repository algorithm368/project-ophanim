import { FLAG_THRESHOLD } from "./aggregate";
import type { SourceResult, Verdict } from "./types";

/**
 * What kind of threat an indicator is, as opposed to how bad it is.
 *
 * A closed vocabulary on purpose. Source categories are a heterogeneous mess:
 * AbuseIPDB emits its own report taxonomy mixed with *usage* types ("Fixed Line
 * ISP"), the DNSBL adapter emits the names of the lists it checked ("Spamhaus
 * ZEN"), Kaspersky emits AV signature strings, and VirusTotal emits sandbox
 * behaviour tags. Passing any of that through to a verdict label would produce
 * "malicious, fixed line isp", which is what the narrative currently does.
 */
export type ThreatType =
  | "c2"
  | "malware"
  | "ransomware"
  | "phishing"
  | "spam"
  | "scanner"
  | "brute force"
  | "web attack"
  | "ddos"
  | "exploit"
  | "compromised host"
  | "anonymizer";

/**
 * Only the catch-alls are ranked, and only so a specific sibling beats them on
 * a tie. Everything else is equal: an address that both spams and brute-forces
 * is not better described by one than the other, so the tie falls through to
 * the order the source listed them in, which is the source's own ranking.
 */
const CATCH_ALL: Partial<Record<ThreatType, true>> = {
  malware: true,
  exploit: true,
  "compromised host": true,
};

/**
 * Exact category strings, lowercased, mapped to a type. Built from the
 * categories live sources actually emitted across a nine-indicator sweep rather
 * than from what their documentation claims.
 */
const EXACT: Record<string, ThreatType> = {
  // AbuseIPDB report taxonomy
  "port scan": "scanner",
  hacking: "web attack",
  "web app attack": "web attack",
  "sql injection": "web attack",
  "bad web bot": "web attack",
  "brute-force": "brute force",
  "ssh": "brute force",
  "ftp brute-force": "brute force",
  "email spam": "spam",
  "web spam": "spam",
  "blog spam": "spam",
  "forum spam": "spam",
  "ddos attack": "ddos",
  phishing: "phishing",
  "exploited host": "compromised host",
  "compromised": "compromised host",
  "open proxy": "anonymizer",
  "vpn ip": "anonymizer",

  // Tor
  tor: "anonymizer",
  "tor-exit": "anonymizer",

  // GreyNoise
  "internet-scanner": "scanner",

  // Blocklist and malware feeds
  "botnet_cc": "c2",
  c2: "c2",
  "malware-download": "malware",
  malware: "malware",
  "generic malware": "malware",
  ransomware: "ransomware",
  exploit: "exploit",
};

/**
 * Substring rules, applied only when no exact match won. Ordered, first hit
 * wins, so the specific patterns precede the generic ones.
 */
const PATTERNS: [RegExp, ThreatType][] = [
  [/ransom|wannacry|wanna|wcry|wanacrypt/, "ransomware"],
  [/\bc2\b|botnet|command.?and.?control/, "c2"],
  [/phish/, "phishing"],
  [/\bspam\b/, "spam"],
  [/brute.?force/, "brute force"],
  [/\bscan(ner|ning)?\b/, "scanner"],
  [/\bddos\b/, "ddos"],
  // No bare /\btor\b/ here: EXACT already covers the Tor categories, and as a
  // substring rule it matched an unrelated VirusTotal label on EICAR.
  [/\bproxy\b|\bvpn\b/, "anonymizer"],
  [/exploit|cve-\d{4}-\d+|ms\d{2}-\d{3}/, "exploit"],
  [/trojan|backdoor|worm|dropper|stealer|rootkit|\bmalware\b/, "malware"],
];

/**
 * Category strings that describe what an address *is* rather than what it did.
 * AbuseIPDB reports these alongside abuse categories and they currently reach
 * the narrative, which is how "flagged it for Fixed Line ISP" happens.
 */
const USAGE_NOISE = new Set([
  "fixed line isp",
  "data center/web hosting/transit",
  "commercial",
  "organization",
  "government",
  "military",
  "university/college/school",
  "library",
  "content delivery network",
  "search engine spider",
  "reserved",
  "common-business-service",
]);

/** True when a raw category describes the host's role, not a threat. */
export function isUsageCategory(raw: string): boolean {
  return USAGE_NOISE.has(raw.trim().toLowerCase());
}

/** Map one raw source category onto the closed vocabulary, or undefined. */
export function classifyCategory(raw: string): ThreatType | undefined {
  const key = raw.trim().toLowerCase();
  if (!key || USAGE_NOISE.has(key)) return undefined;
  const exact = EXACT[key];
  if (exact) return exact;
  for (const [pattern, type] of PATTERNS) {
    if (pattern.test(key)) return type;
  }
  return undefined;
}

export interface ThreatTypeVerdict {
  type: ThreatType;
  /** Source ids that supported it, for provenance. */
  sources: string[];
  /** Runners-up, most supported first, so a mixed picture stays visible. */
  also: ThreatType[];
}

/**
 * A source whose categories describe what an indicator *is*, even when it
 * reports no risk.
 *
 * GreyNoise exists to answer "is this internet background noise", and it
 * answers with `classification: benign` plus `actor: "Shodan.io"` for a
 * research scanner. That is a positive identification, not an absence of
 * findings, and excluding it because it did not flag is how 71.6.146.185, a
 * Shodan census host, gets typed "brute force" off the back of abuse reports
 * filed by people who were scanned.
 */
const IDENTIFIERS = new Set(["greynoise", "scanner-id", "tor-project"]);

function contributes(s: SourceResult): boolean {
  if (s.status !== "ok") return false;
  // The weight gate must come after this. An identification source is
  // context-only by design, so scanner-id carries weight 0, and checking the
  // weight first silently excluded the source that exists to answer this
  // question.
  if (IDENTIFIERS.has(s.source.id)) return true;
  if ((s.source.weight ?? 1) === 0) return false;
  return s.malicious === true || (s.score ?? 0) >= FLAG_THRESHOLD;
}

/**
 * What kind of threat the sources describe.
 *
 * Flagging sources contribute, for the same reason the narrative's "flagged
 * for" clause uses them: a quiet source's labels describe what it looked for,
 * not what it found. The identification sources above contribute regardless.
 *
 * Support is counted by distinct sources rather than by category occurrences,
 * so one chatty adapter emitting nine synonyms cannot outvote three
 * independent ones.
 *
 * Returns null when nothing mapped, rather than guessing.
 */
export function threatTypeOf(
  sources: SourceResult[],
  opts: { verdict?: Verdict; benignOverride?: string } = {},
): ThreatTypeVerdict | null {
  // A clean indicator has no threat type, and a forced-benign one least of all.
  // EICAR is flagged by most AV engines by design, so left to the tally alone
  // it typed as a threat while the verdict said clean.
  if (opts.benignOverride) return null;
  if (opts.verdict === "clean" || opts.verdict === "unknown") return null;

  const backers = new Map<ThreatType, Set<string>>();
  for (const s of sources.filter(contributes)) {
    for (const raw of s.categories ?? []) {
      const type = classifyCategory(raw);
      if (!type) continue;
      const set = backers.get(type) ?? new Set<string>();
      set.add(s.source.id);
      backers.set(type, set);
    }
  }
  if (backers.size === 0) return null;

  // An identification source that could not be consulted may have been the
  // tie-breaker. GreyNoise's free tier runs out of daily quota, and when it
  // does 71.6.146.185 stops typing as "scanner" and starts typing as "brute
  // force" off abuse reports filed by the people it scanned. Same address, same
  // code, a different answer depending on how much the tool was used earlier
  // that day. A withheld label is better than one that contradicts itself.
  const identifierMissing = sources.some(
    (s) => IDENTIFIERS.has(s.source.id) && s.status !== "ok",
  );

  const identified = (backing: Set<string>) =>
    [...backing].some((id) => IDENTIFIERS.has(id));

  // Array.sort is stable, so a comparator returning 0 leaves the two types in
  // the order their categories first appeared, which is the reporting source's
  // own ranking.
  const ranked = [...backers.entries()].sort((a, b) => {
    const bySupport = b[1].size - a[1].size;
    if (bySupport !== 0) return bySupport;
    // An identification beats a tally on a tie. 71.6.146.185 draws two backers
    // for "brute force" (abuse reports filed by people it scanned) and two for
    // "scanner", one of which is GreyNoise answering the question directly.
    const byIdentity = Number(identified(b[1])) - Number(identified(a[1]));
    if (byIdentity !== 0) return byIdentity;
    return Number(Boolean(CATCH_ALL[a[0]])) - Number(Boolean(CATCH_ALL[b[0]]));
  });

  // Only a genuine tie is at risk: with a clear winner the missing
  // identification would have had to invent a category to change the outcome.
  const tied = ranked.length > 1 && ranked[0][1].size === ranked[1][1].size;
  if (identifierMissing && tied && !identified(ranked[0][1])) return null;

  return {
    type: ranked[0][0],
    sources: [...ranked[0][1]],
    also: ranked.slice(1, 3).map(([t]) => t),
  };
}
