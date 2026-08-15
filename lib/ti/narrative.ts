/**
 * Plain-language summaries shown in the verdict "summary card".
 *
 * These are pure functions (no React) so they can be unit-tested directly;
 * `components/CheckResults.tsx` imports them for rendering. Keep them honest:
 * the card must never describe something the data doesn't support.
 */
import { HASH_ALGO_LABEL } from "@/lib/hash";
import { FLAG_THRESHOLD, MALICIOUS_FLOOR } from "./aggregate";
import { ENGINE_NAME } from "./url/active/engines";
import type { MergedScan } from "./url/active/merge";
import type {
  CheckResult,
  CheckStats,
  DomainCheckResult,
  HashContext,
  HashCheckResult,
  HistorySnapshot,
  ScoreBreakdown,
  SourceResult,
  Verdict,
} from "./types";

/**
 * VT sandbox behaviour tags -> plain verb phrases, so a wall of tags reads as one
 * sentence ("When run, it sets up persistence, encrypts data, and deletes
 * itself."). Only tags with a phrase here contribute; unmapped tags are skipped.
 */
const BEHAVIOR_TAG_PHRASES: Record<string, string> = {
  PERSISTENCE: "sets itself to run again after reboot",
  CRYPTO: "uses encryption",
  RANSOM: "encrypts files for ransom",
  SELF_DELETE: "deletes itself after running",
  EXECUTES_DROPPED_FILE: "runs files it drops on disk",
  DOWNLOADER: "downloads more payloads",
  SPREADING: "spreads to other machines",
  INJECTION: "injects code into other processes",
  PROCESS_INJECTION: "injects code into other processes",
  KEYLOGGER: "logs keystrokes",
  STEALER: "steals saved data",
  CREDENTIAL_THEFT: "steals credentials",
  TUNNELING: "tunnels its network traffic",
  SSH_COMMUNICATION: "communicates over SSH",
  OBFUSCATED: "hides its code (obfuscated)",
  PACKED: "is packed to hide its code",
  LONG_SLEEPS: "stalls to slip past analysis",
  DIRECT_CPU_CLOCK_ACCESS: "uses timing tricks to detect analysis",
  DETECT_DEBUG_ENVIRONMENT: "checks for a debugger",
  DETECT_SANDBOX: "checks whether it is in a sandbox",
  CHECKS_BIOS: "checks the BIOS to spot virtual machines",
  CHECKS_NETWORK_ADAPTERS: "inspects network adapters",
  CHECKS_USER_INPUT: "waits for real user activity",
  CALLS_WMI: "uses WMI to query the system",
  MACRO_CREATE_OLE: "creates OLE/COM objects",
  SETS_PROCESS_NAME: "disguises its process name",
  RUNTIME_MODULES: "loads extra modules at runtime",
};

/** Oxford-comma join: ["a"] -> "a", ["a","b","c"] -> "a, b, and c". */
function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

/** Lowercase the first character so a label reads mid-sentence. */
function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

/**
 * One plain-language sentence of what the sample does at runtime. Prefers VT
 * behaviour tags (mapped to phrases); when there are none, falls back to the
 * readable, sentence-shaped capability labels (e.g. "Adds Run key to start
 * application") and skips machine-token signatures ("stack_pivot") that wouldn't
 * make a grammatical sentence. Returns undefined when nothing usable is present,
 * so callers can omit the line rather than print a broken one.
 */
export function hashBehaviorSummary(
  ctx: HashContext | undefined,
): string | undefined {
  const seen = new Set<string>();
  const phrases: string[] = [];
  for (const tag of ctx?.behaviorTags ?? []) {
    const phrase = BEHAVIOR_TAG_PHRASES[tag.toUpperCase()];
    if (!phrase || seen.has(phrase)) continue;
    seen.add(phrase);
    phrases.push(phrase);
    if (phrases.length >= 5) break;
  }
  if (phrases.length) return `When run, it ${joinList(phrases)}.`;

  // Fallback: multi-word capability labels that read as verb phrases. Skip
  // machine tokens ("stack_pivot") and family/label leaks ("Family: SectopRAT",
  // "SectopRAT payload", "Detects AnimateClipper") that aren't behaviour.
  const capSeen = new Set<string>();
  const caps: string[] = [];
  for (const c of ctx?.capabilities ?? []) {
    const label = c.label.trim();
    if (!/\s/.test(label) || label.includes("_")) continue;
    if (/\b(family|payload|variant)\b/i.test(label)) continue;
    if (/^detect(s|ed)?\b/i.test(label)) continue;
    // Must read as "it <verb> …": drop adjective/noun-initial labels like
    // "Suspicious use of X" that would produce "it suspicious use of X".
    if (/^(suspicious|possible|potential|known|generic|anomalous)\b/i.test(label))
      continue;
    const key = label.toLowerCase();
    if (capSeen.has(key)) continue;
    capSeen.add(key);
    caps.push(lowerFirst(label));
    if (caps.length >= 4) break;
  }
  if (caps.length >= 2) return `When run, it ${joinList(caps)}.`;
  return undefined;
}

/** The minimal result shape the narrative + score explanation need. */
export type ResultLike = {
  riskScore: number;
  verdict: Verdict;
  checkedAt: string;
  cached?: boolean;
  sources: SourceResult[];
  stats: CheckStats;
  history?: HistorySnapshot[];
  scoreBreakdown?: ScoreBreakdown;
};

export function aggregateCategories(
  sources: SourceResult[],
): { name: string; count: number; sources: string[] }[] {
  const map = new Map<
    string,
    { name: string; count: number; sources: string[] }
  >();
  for (const s of sources) {
    if (s.status !== "ok" || !s.categories) continue;
    for (const raw of s.categories) {
      const name = raw.trim();
      if (!name || name.toLowerCase() === "none") continue;
      const key = name.toLowerCase();
      const entry = map.get(key) ?? { name, count: 0, sources: [] };
      entry.count += 1;
      if (!entry.sources.includes(s.source.name)) {
        entry.sources.push(s.source.name);
      }
      map.set(key, entry);
    }
  }
  // Count-tied categories keep insertion order (sort is stable), so callers
  // that pass sources strongest-first get that source's own ordering — an
  // alphabetical tiebreak would promote junk tags like "academico" over a
  // threat label merely because it sorts earlier.
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

export function joinPlace(parts: (string | undefined)[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const v = (p ?? "").trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out.join(", ");
}

export function formatBytes(bytes?: number): string | undefined {
  if (bytes === undefined || bytes < 0) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDate(value?: string): string | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return value;
  return new Date(ms).toLocaleDateString();
}

const VERDICT_PHRASE: Record<Verdict, string> = {
  malicious: "is almost certainly malicious",
  suspicious: "looks suspicious",
  low: "carries only low-level risk",
  clean: "looks clean",
  unknown: "could not be conclusively rated",
};

/**
 * Opening sentence. The verdict phrase carries the severity in words (the UI
 * shows a matching qualitative risk level, not a raw number), so we never render
 * the 0-100 score here. An "unknown" verdict means no scoring source returned
 * data, so it reads as "no information", never a clean result.
 */
function headline(subject: string, result: ResultLike): string {
  if (result.verdict === "unknown") {
    return `This ${subject} ${VERDICT_PHRASE.unknown}, no scoring TI source returned data, so this is "no information", not a clean result.`;
  }
  return `This ${subject} ${VERDICT_PHRASE[result.verdict]}.`;
}

/** Render a domain's age in the largest unit that stays accurate. */
function formatAge(ageDays: number): string {
  if (ageDays < 60) {
    return `${ageDays} ${ageDays === 1 ? "day" : "days"} ago`;
  }
  if (ageDays < 365) {
    return `about ${Math.round(ageDays / 30)} months ago`;
  }
  const years = Math.round(ageDays / 365);
  return `about ${years} ${years === 1 ? "year" : "years"} ago`;
}

/** Bare platform/architecture words that some feeds emit as "categories" but
 *  which don't read as a reason a file is malicious. */
const PLATFORM_NOISE = new Set([
  "windows",
  "linux",
  "macos",
  "osx",
  "android",
  "ios",
  "win32",
  "win64",
  "x86",
  "x64",
  "x86-64",
  "amd64",
  "arm",
  "arm64",
]);

/** File-format / delivery tags (mostly VirusTotal type tags) that describe
 *  what a file *is*, not why it was flagged — "flagged it for peexe" reads as
 *  if being a PE executable were the offense. */
const FORMAT_NOISE = new Set([
  "peexe",
  "pedll",
  "pe32",
  "pe64",
  "exe",
  "dll",
  "elf",
  "macho",
  "mach-o",
  "apk",
  "dex",
  "jar",
  "class",
  "msi",
  "lnk",
  "com",
  "assembly",
  "mono",
  "dotnet",
  ".net",
  "executable",
  "binary",
  "script",
  "powershell",
  "ps1",
  "vbs",
  "js",
  "javascript",
  "jscript",
  "html",
  "hta",
  "wsf",
  "bat",
  "cmd",
  "sh",
  "shell",
  "python",
  "doc",
  "docx",
  "docm",
  "xls",
  "xlsx",
  "xlsm",
  "ppt",
  "pptx",
  "pdf",
  "rtf",
  "swf",
  "zip",
  "rar",
  "7z",
  "7zip",
  "gzip",
  "gz",
  "tar",
  "iso",
  "img",
  "archive",
  "document",
  "attachment",
  "file",
  "sample",
  "text",
  "txt",
  "xml",
  "json",
  "email",
  "eml",
]);

/** Keep junk out of the "flagged it for …" reason clause: md5/sha1/sha256 or
 *  imphash hex blobs (which some sources list as categories), bare platform
 *  words, and file-format tags are not threat categories. */
function isMeaningfulCategory(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return false;
  if (/^[0-9a-f]{32}$|^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(n)) return false;
  if (PLATFORM_NOISE.has(n)) return false;
  if (FORMAT_NOISE.has(n)) return false;
  return true;
}

/** Shared "what the TI sources say" sentences, used by every narrative. */
/** The IP's announced BGP prefix, from the RIPEstat routing source. */
function bgpPrefix(result: ResultLike): string | undefined {
  const ripe = result.sources.find(
    (s) => s.source.id === "ripestat" && s.status === "ok",
  );
  const prefix = (ripe?.details as { prefix?: string } | undefined)?.prefix;
  return typeof prefix === "string" && prefix.length > 0 ? prefix : undefined;
}

/** AbuseIPDB confidence below this is treated as noise — stale or disputed
 *  reports. A clean IP can carry hundreds of reports at ~0% confidence, so the
 *  raw count alone is not a sound signal; we gate on the confidence score. */
const ABUSE_SIGNIFICANT = 25;

/** A faithful "historical activity" clause built from signals we actually
 *  assess: AbuseIPDB report volume (gated by confidence) and prior reputation
 *  snapshots. Passive DNS is deliberately excluded — it records which hostnames
 *  resolved on the IP, not whether they were malicious, so claiming "no
 *  malicious pDNS" would overstate what we check. Returns "" when neither signal
 *  is available. */
function abuseHistoryClause(result: ResultLike): string {
  const parts: string[] = [];

  const abuse = result.sources.find(
    (s) => s.source.id === "abuseipdb" && s.status === "ok",
  );
  if (abuse) {
    const reports = (abuse.details as { totalReports?: number } | undefined)
      ?.totalReports;
    // AbuseIPDB's confidence rides on the source's score (0-100).
    const confidence = abuse.score ?? 0;
    if (typeof reports === "number") {
      parts.push(
        reports > 0 && confidence >= ABUSE_SIGNIFICANT
          ? `${reports} AbuseIPDB report${reports === 1 ? "" : "s"} at ${confidence}% confidence`
          : "no significant AbuseIPDB reports",
      );
    }
  }

  const history = result.history ?? [];
  if (history.length > 0) {
    const priorBad = history.some(
      (h) => h.verdict === "malicious" || h.verdict === "suspicious",
    );
    parts.push(
      priorBad ? "prior malicious history" : "no prior malicious history",
    );
  }

  return parts.length ? `${parts.join(" and ")} on record` : "";
}

export function threatSentences(
  result: ResultLike,
  noun: string,
  historyClause = "",
): string[] {
  // Only scoring (weighted) feeds count as "TI sources" here: context-only
  // sources like geolocation/RDAP respond "ok" but can never flag, so counting
  // them would inflate the denominator (issue #5).
  const scoringSources = result.sources.filter(
    (x) => x.status === "ok" && (x.source.weight ?? 1) > 0,
  );
  const responded = scoringSources.length;
  const out: string[] = [];
  // The sources that actually flagged it (same predicate as computeStats).
  const flaggedSources = scoringSources.filter(
    (x) => x.malicious === true || (x.score ?? 0) >= FLAG_THRESHOLD,
  );
  if (flaggedSources.length > 0) {
    // Categories must come from the flagging sources only, so the "for …"
    // clause reflects why it was flagged — not labels from quiet/context
    // sources. Rank flagging sources by effective signal so the strongest
    // feed's own ordering leads (VirusTotal lists its threat label first),
    // and only take single-source categories from that strongest feed —
    // unconfirmed tags from weaker feeds (e.g. arbitrary OTX pulse tags) are
    // too noisy for the headline.
    const byStrength = [...flaggedSources].sort(
      (a, b) =>
        (b.score ?? 0) * (b.source.weight ?? 1) -
        (a.score ?? 0) * (a.source.weight ?? 1),
    );
    const strongest = byStrength[0].source.name;
    const cats = aggregateCategories(byStrength)
      .filter((c) => c.count >= 2 || c.sources.includes(strongest))
      .map((c) => c.name)
      .filter(isMeaningfulCategory)
      .slice(0, 3);
    out.push(
      `${flaggedSources.length} of ${responded} TI sources flagged it${
        cats.length ? ` for ${cats.join(", ")}` : ""
      }.`,
    );
    const flaggedBy = byStrength.map((x) => x.source.name).slice(0, 4);
    out.push(`Flagged by ${flaggedBy.join(", ")}.`);
  } else if (responded > 0) {
    out.push(
      `None of the ${responded} TI sources flagged this ${noun}${
        historyClause ? `, with ${historyClause}` : ""
      }.`,
    );
  }

  return out;
}

export function buildNarrative(result: CheckResult): string[] {
  const geo = result.geo;
  const sentences: string[] = [];

  sentences.push(headline("address", result));

  // What the address is: network type woven with its operator and ASN.
  if (geo) {
    let typePhrase: string;
    let tail = "";
    if (geo.isProxy) {
      // When ip-api flags both proxy and hosting, keep both facts — the profile
      // card shows both trait chips, so collapsing to "anonymizer" alone would
      // drop the datacenter context (issue #9).
      typePhrase = geo.isHosting
        ? "an anonymizer (proxy, VPN, or Tor) on hosting/datacenter infrastructure"
        : "an anonymizer (proxy, VPN, or Tor)";
      tail = ", so the real origin is hidden";
    } else if (geo.isHosting) {
      typePhrase = "hosting or datacenter infrastructure";
    } else if (geo.isMobile) {
      typePhrase = "a mobile carrier (cellular) address";
    } else {
      // No proxy/hosting/mobile flag means ip-api did not classify the type —
      // that's "unclassified", not positive evidence of an end-user network, so
      // hedge it the way classifyType() does ("Residential / Other") rather than
      // asserting it as fact (issue #10).
      typePhrase = "likely a residential or business endpoint";
    }
    const operator = geo.isp || geo.org || geo.asnOrg || "";
    const op = operator ? ` operated by ${operator}` : "";
    // ip-api's ASN field bundles the org name; keep just the AS number here.
    const asnNum = geo.asn ? (/^AS\d+/.exec(geo.asn)?.[0] ?? geo.asn) : "";
    const asn = asnNum ? ` (${asnNum})` : "";
    const prefix = bgpPrefix(result);
    const prefixClause = prefix
      ? ` with an active BGP prefix of ${prefix}`
      : "";
    sentences.push(
      `It is ${typePhrase}${op}${asn}${prefixClause}${tail}.`.replace(
        /\.\.$/,
        ".",
      ),
    );
  }

  // Where it is, plus its reverse-DNS identity.
  const where = joinPlace([geo?.city, geo?.region, geo?.country]);
  if (where && geo?.reverse) {
    sentences.push(
      `It is geolocated to ${where}, with reverse DNS ${geo.reverse}.`,
    );
  } else if (where) {
    sentences.push(`It is geolocated to ${where}.`);
  } else if (geo?.reverse) {
    sentences.push(`Its reverse DNS is ${geo.reverse}.`);
  }

  return [
    ...sentences,
    ...threatSentences(result, "address", abuseHistoryClause(result)),
  ];
}

export function buildDomainNarrative(result: DomainCheckResult): string[] {
  const ctx = result.context;
  const sentences: string[] = [];

  if (ctx?.nxdomain && result.verdict === "unknown") {
    // assembleDomainResult downgrades clean→unknown for NXDOMAIN: the generic
    // unknown headline ("no scoring TI source returned data") would be false
    // here — sources did respond, their absence-of-listing just proves nothing
    // for a name that doesn't exist.
    sentences.push(
      "This domain does not exist in DNS (NXDOMAIN), it appears unregistered, expired, or taken down. Blocklists have nothing live to rate, so this is \"no information\", not a clean bill.",
    );
  } else {
    sentences.push(headline("domain", result));
  }

  // What the domain is: maturity, registrar, and content category in one read.
  const categories = ctx?.categories ?? [];
  const catText = categories.length
    ? `, categorized as ${categories.slice(0, 2).join(", ").toLowerCase()}`
    : "";
  if (ctx?.ageDays !== undefined) {
    const ageText = formatAge(ctx.ageDays);
    const reg = ctx.registrar ? ` through ${ctx.registrar}` : "";
    // Three honest tiers so a 45-day domain isn't called "established" (issue #6):
    // newly (<30d), a neutral middle (<1yr), and established (≥1yr).
    const lead =
      ctx.ageDays < 30
        ? `It is a newly registered domain, created ${ageText}${reg}`
        : ctx.ageDays < 365
          ? `It was registered ${ageText}${reg}`
          : `It is an established domain, registered ${ageText}${reg}`;
    sentences.push(`${lead}${catText}.`.replace(/\.\.$/, "."));
  } else if (ctx?.registrar) {
    sentences.push(
      `It was registered through ${ctx.registrar}${catText}.`.replace(
        /\.\.$/,
        ".",
      ),
    );
  } else if (catText) {
    sentences.push(`It is${catText.replace(/^,\s*/, " ")}.`);
  }

  // Infrastructure: where the domain points right now.
  const ips = ctx?.resolvedIps ?? [];
  const mx = ctx?.mx ?? [];
  if (ips.length > 0) {
    const extra = ips.length - 1;
    const hosts =
      extra > 0 ? ` and ${extra} other host${extra > 1 ? "s" : ""}` : "";
    const mail = mx.length ? `, with mail handled by ${mx[0]}` : "";
    sentences.push(`It currently resolves to ${ips[0]}${hosts}${mail}.`);
  } else if (ctx?.nxdomain && result.verdict !== "unknown") {
    // Flagged-but-NXDOMAIN (e.g. a taken-down C2 still on blocklists): the
    // verdict stands, but say plainly that the name is currently dead. The
    // unknown case already leads with NXDOMAIN, so don't repeat it.
    sentences.push(
      "It currently returns NXDOMAIN, the name no longer exists in DNS (unregistered, expired, or taken down).",
    );
  } else if (
    ctx &&
    (ctx.nameservers?.length ?? 0) > 0 &&
    (ctx.ipv6?.length ?? 0) === 0
  ) {
    // Only claim non-resolution when the domain is clearly delegated (has NS
    // records) yet maps to no address. Empty IP fields on their own can simply
    // mean DNS wasn't resolved, and asserting "parked/taken down" would be a
    // false statement about missing data (issue #4).
    sentences.push(
      "It does not currently resolve to an address (parked, expired, or taken down).",
    );
  }

  return [...sentences, ...threatSentences(result, "domain")];
}

export function buildHashNarrative(result: HashCheckResult): string[] {
  const ctx = result.context;
  const hasData = result.sources.some(
    (s) => s.status === "ok" && s.score !== undefined,
  );
  const sentences: string[] = [];

  // An unrated file is genuinely unknown, not clean - say so plainly.
  if (result.verdict === "unknown" && !ctx) {
    sentences.push(
      `No threat-intel source has this ${HASH_ALGO_LABEL[result.algorithm]} hash on record, so it can't be rated. That isn't the same as safe, the file may simply be new or unseen.`,
    );
    return [...sentences, ...threatSentences(result, "file")];
  }

  sentences.push(headline("file", result));

  // What the file is: family, type, size, name woven into one read.
  if (ctx) {
    const parts: string[] = [];
    if (ctx.malwareFamily) {
      parts.push(`identified as ${ctx.malwareFamily}`);
    } else if (ctx.threatLabel) {
      parts.push(`classified as ${ctx.threatLabel}`);
    }
    const type = ctx.fileType ?? ctx.mimeType;
    const size = formatBytes(ctx.fileSize);
    if (type) {
      // Size is a trailing parenthetical, not an "of {size}" infix; the article
      // matches the type's initial sound; and a redundant " file" is dropped
      // when the type already names the kind ("PDF document", "PE32 executable").
      const article = /^[aeiou]/i.test(type) ? "an" : "a";
      const noun =
        /\b(file|document|executable|text|image|archive|script|library)\b/i.test(
          type,
        )
          ? ""
          : " file";
      parts.push(`${article} ${type}${noun}${size ? ` (${size})` : ""}`);
    } else if (size) parts.push(`${size} in size`);
    if (parts.length) {
      // fileName is the best-known name, not provably the earliest seen.
      const name = ctx.fileName ? `, seen as "${ctx.fileName}"` : "";
      sentences.push(`It is ${parts.join(", ")}${name}.`);
    } else if (ctx.fileName) {
      sentences.push(`It has been seen as "${ctx.fileName}".`);
    }
    if (ctx.firstSeen) {
      const d = formatDate(ctx.firstSeen);
      if (d) sentences.push(`First observed ${d}.`);
    }
  } else if (!hasData) {
    sentences.push("No source returned metadata describing the file.");
  }

  return [...sentences, ...threatSentences(result, "file")];
}

/**
 * Plain-language account of how the aggregate score was reached. Reads the
 * intermediates aggregateRisk() recorded in `result.scoreBreakdown` rather than
 * re-deriving them, so the explanation can never drift from the score.
 */
export function scoreExplanation(result: ResultLike): string[] {
  const bd = result.scoreBreakdown;

  // A forced-benign override (e.g. EICAR) supersedes the blend entirely.
  if (bd?.benignOverride === "eicar-test-file") {
    return [
      "Forced clean, this is the EICAR standard anti-malware test file, a benign artifact used to verify scanners. Vendor detections are expected and do not make it harmful.",
    ];
  }

  const scored = result.sources.filter(
    (s) =>
      s.status === "ok" &&
      typeof s.score === "number" &&
      (s.source.weight ?? 1) > 0,
  );
  if (scored.length === 0) return [];

  const dominant = bd?.dominantSourceId
    ? result.sources.find((s) => s.source.id === bd.dominantSourceId)
    : undefined;
  const dominantName = dominant?.source.name ?? "the strongest source";
  const dominantScore = dominant?.score ?? 0;

  const out = [
    `The ${result.riskScore}/100 is weighted most heavily toward ${dominantName} (which rated it ${dominantScore}), blended with the weighted average across ${scored.length} scoring source${scored.length === 1 ? "" : "s"}. More authoritative feeds count for more, so the dominant source isn't always the highest raw score.`,
  ];

  if (bd?.floorApplied && bd.floorValue) {
    const by = bd.flooredBy
      ? result.sources.find((s) => s.source.id === bd.flooredBy)?.source.name
      : undefined;
    const byText = by ? ` by ${by}` : "";
    out.push(
      bd.floorValue >= MALICIOUS_FLOOR
        ? `It has a definitive malicious listing${byText}, which holds the score at ${bd.floorValue} or above.`
        : `Two or more agreeing listings${byText} raised the score to a floor of ${bd.floorValue}.`,
    );
  }

  if (bd?.allowlistSuppressed) {
    out.push(
      "An allowlist source vouches for this indicator, so a weak listing did not raise the floor.",
    );
  }

  if (bd?.borderline) {
    out.push(
      "This score sits within five points of a verdict boundary, so treat the label as borderline.",
    );
  }

  return out;
}

/**
 * Detector-consensus tallies for the verdict card's "Detector consensus" strip.
 *
 * Only *scoring* feeds (weight > 0) are detectors here: context-only sources
 * like geolocation/RDAP (weight 0) respond "ok" but can never flag, so counting
 * them as responding/clean detectors inflates the tally and contradicts the
 * narrative's "of N TI sources" (issue #8 — the in-card sibling of issue #5).
 */
export function consensusBuckets(result: ResultLike): {
  total: number;
  responded: number;
  flagged: number;
  clean: number;
  errored: number;
  rateLimited: number;
  skipped: number;
  noKey: number;
  unsupported: number;
} {
  const scoring = result.sources.filter((s) => (s.source.weight ?? 1) > 0);
  const responded = scoring.filter((s) => s.status === "ok").length;
  const flagged = scoring.filter(
    (s) =>
      s.status === "ok" &&
      (s.malicious === true || (s.score ?? 0) >= FLAG_THRESHOLD),
  ).length;
  const errored = scoring.filter(
    (s) => s.status === "error" || s.status === "timeout",
  ).length;
  const rateLimited = scoring.filter((s) => s.status === "rate_limited").length;
  const skips = scoring.filter((s) => s.status === "skipped");
  // Not every skip is a missing key. A source that cannot answer for this IP
  // family is skipped with `enabled: true`, because nothing is wrong with its
  // configuration; reporting it as "no key" would send an analyst hunting for
  // credentials that would not help.
  const noKey = skips.filter((s) => !s.enabled).length;
  return {
    total: scoring.length,
    responded,
    flagged,
    clean: Math.max(0, responded - flagged),
    errored,
    rateLimited,
    skipped: skips.length,
    noKey,
    unsupported: skips.length - noKey,
  };
}

/** Hostname of a URL, or undefined when it will not parse. */
function hostOf(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

/** A field label placed mid-sentence. `lowerFirst` alone would turn "HTTP
 *  status" into "hTTP status", so a leading acronym is left standing.
 *  Exported so the scan page writes the same label the paragraph does. */
export function midSentence(label: string): string {
  return /^[A-Z]{2,}/.test(label) ? label : lowerFirst(label);
}

/** "once" / "twice" / "3 times", so the common cases read as English. */
function countWord(n: number): string {
  if (n === 1) return "once";
  if (n === 2) return "twice";
  return `${n} times`;
}

/**
 * The paragraph an analyst pastes into a ticket.
 *
 * Every sentence is conditional on the data behind it, and there are no
 * template slots: a field the scan did not report produces no clause at all
 * rather than a clause saying "unknown". This is the one place in the feature
 * where a bug becomes an analyst asserting something false in a case, so the
 * rule is absolute, and the tests include a property check over every subset of
 * the inputs.
 *
 * Claims about the page are scoped to the page that loaded, never to the site,
 * because a kit can serve one thing to a scanner and another to a victim.
 */
export function buildScanNarrative(merged: MergedScan): string[] {
  // Nothing finished means nothing was observed. No paragraph is the honest
  // output; a headline here would be a claim built on no evidence.
  if (merged.engines.length === 0) return [];

  const d = merged.detail;
  const cap = merged.capability;
  const sentences: string[] = [];

  const finalHost = hostOf(d.finalUrl);
  const targetHost = hostOf(merged.target);
  const hops = d.redirects?.length ?? 0;
  const served = d.httpStatus ? `, answering HTTP ${d.httpStatus}` : "";

  // 1. Where it ends up. The redirect is the first thing an analyst needs, and
  //    a destination under a different name is the finding itself.
  if (hops > 0 && finalHost) {
    sentences.push(
      `This URL redirects ${countWord(hops)}, to ${finalHost}${served}.`,
    );
  } else if (finalHost && targetHost && finalHost !== targetHost) {
    sentences.push(`This URL ends up at ${finalHost}${served}.`);
  } else if (d.httpStatus) {
    sentences.push(`This URL answered HTTP ${d.httpStatus} when it was visited.`);
  }

  // 2. What the page can do, strictly as observed in the captured DOM. When the
  //    DOM was never read, nothing is said: silence beats a false absence.
  //    Title and password field share a sentence when both are present, so the
  //    qualifier "the page that loaded" is stated once rather than drummed.
  const password = !cap.error && cap.passwordField;
  if (d.title && password) {
    sentences.push(
      `The page that loaded is titled "${d.title}" and carries a password field.`,
    );
  } else if (d.title) {
    sentences.push(`The page that loaded is titled "${d.title}".`);
  } else if (password) {
    sentences.push("The page that loaded carries a password field.");
  }

  if (!cap.error) {
    const crossDomain = cap.forms.filter((f) => f.crossDomain && f.host);
    if (crossDomain.length > 0) {
      const hosts = [...new Set(crossDomain.map((f) => f.host as string))];
      sentences.push(
        `Its form posts to ${joinList(hosts)}, a different domain from the one shown.`,
      );
    }
    if (cap.downloadLinks.length > 0) {
      const count = cap.downloadLinks.length;
      const shown = cap.downloadLinks.slice(0, 3);
      const files = shown
        .map((link) => link.split("/").pop())
        .filter((name): name is string => Boolean(name));
      const hosts = [
        ...new Set(shown.map((link) => hostOf(link)).filter(Boolean)),
      ] as string[];
      const from = hosts.length ? `, served from ${joinList(hosts)}` : "";
      sentences.push(
        `It links to ${count} file${count === 1 ? "" : "s"} that ${count === 1 ? "executes" : "execute"} when opened, ${joinList(files)}${from}.`,
      );
    }
  }

  // 3. How new the name and the certificate are. An exact WHOIS instant beats a
  //    rounded age, so it wins when both are present.
  const created = formatDate(d.domainCreated);
  if (created) {
    sentences.push(`Its domain was registered on ${created}.`);
  } else if (d.domainAgeDays !== undefined) {
    sentences.push(`Its domain was registered ${formatAge(d.domainAgeDays)}.`);
  }

  if (d.tlsAgeDays !== undefined || d.tlsIssuer) {
    const issuer = d.tlsIssuer ? `issued by ${d.tlsIssuer}` : "issued";
    const age =
      d.tlsAgeDays !== undefined
        ? `is ${d.tlsAgeDays} ${d.tlsAgeDays === 1 ? "day" : "days"} old, ${issuer}`
        : `was ${issuer}`;
    const valid =
      d.tlsValidDays !== undefined ? `, valid for ${d.tlsValidDays} days` : "";
    sentences.push(`Its certificate ${age}${valid}.`);
  }

  if (d.riskCategories?.length) {
    sentences.push(
      `Cloudflare puts the domain in ${joinList(d.riskCategories)}.`,
    );
  }

  if (d.siblingDomains?.length) {
    sentences.push(
      `Its robots.txt names ${joinList(d.siblingDomains)}, ${d.siblingDomains.length === 1 ? "a sibling domain" : "sibling domains"} worth checking too.`,
    );
  }

  // 4. What the scanners concluded, attributed, because an unattributed verdict
  //    cannot be defended when it is questioned in a ticket.
  const names = merged.engines.map((e) => ENGINE_NAME[e]);
  if (d.verdicts.overall.malicious) {
    const categories = d.verdicts.overall.categories?.length
      ? ` as ${joinList(d.verdicts.overall.categories)}`
      : "";
    sentences.push(`It was flagged${categories} by ${joinList(names)}.`);
  } else {
    sentences.push(
      `Neither ${names.length === 1 ? "the scanner that ran" : "scanner"} flagged it, which is an absence of evidence rather than a clean bill.`,
    );
  }

  // 5. Disagreement is itself a finding: a site answering differently by
  //    visitor is what a kit dodging scanners does.
  for (const disagreement of merged.disagreements) {
    const readings = disagreement.values
      .map((v) => `${ENGINE_NAME[v.engine]} saw ${v.value}`)
      .join(", ");
    sentences.push(
      `The scanners disagree on ${midSentence(disagreement.field)}: ${readings}.`,
    );
  }

  // 6. An engine that did not finish is named, so the reading is not mistaken
  //    for the whole picture.
  for (const entry of merged.incomplete) {
    const reason =
      entry.status === "running" ? "was still scanning" : `did not finish (${entry.error ?? entry.status})`;
    sentences.push(`${ENGINE_NAME[entry.engine]} ${reason}.`);
  }

  return sentences;
}
