/**
 * Plain-language summaries shown in the verdict "summary card".
 *
 * These are pure functions (no React) so they can be unit-tested directly;
 * `components/CheckResults.tsx` imports them for rendering. Keep them honest:
 * the card must never describe something the data doesn't support.
 */
import { HASH_ALGO_LABEL } from "@/lib/hash";
import { FLAG_THRESHOLD } from "./aggregate";
import type {
  CheckResult,
  CheckStats,
  DomainCheckResult,
  HashCheckResult,
  HistorySnapshot,
  SourceResult,
  Verdict,
} from "./types";

/** The minimal result shape the narrative + score explanation need. */
export type ResultLike = {
  riskScore: number;
  verdict: Verdict;
  checkedAt: string;
  cached?: boolean;
  sources: SourceResult[];
  stats: CheckStats;
  history?: HistorySnapshot[];
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
 * Opening sentence. An "unknown" verdict means no scoring source returned data,
 * so `riskScore` is a placeholder 0 — say "no information", never "0/100",
 * which would read as a clean result.
 */
function headline(subject: string, result: ResultLike): string {
  if (result.verdict === "unknown") {
    return `This ${subject} ${VERDICT_PHRASE.unknown}, no scoring TI source returned data, so this is "no information", not a clean result.`;
  }
  return `This ${subject} ${VERDICT_PHRASE[result.verdict]}, scoring ${result.riskScore}/100.`;
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
    const asnNum = geo.asn ? (geo.asn.match(/^AS\d+/)?.[0] ?? geo.asn) : "";
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
 * Plain-language account of how the aggregate score was reached, mirroring
 * aggregateRisk(): a weighted blend that leans on the strongest trusted signal,
 * with a floor when a source reports a definitive malicious listing.
 */
export function scoreExplanation(result: ResultLike): string[] {
  const scored = result.sources.filter(
    (s) =>
      s.status === "ok" &&
      typeof s.score === "number" &&
      (s.source.weight ?? 1) > 0,
  );
  if (scored.length === 0) return [];

  const dominant = scored.reduce((a, b) => {
    const effA = (a.score ?? 0) * (a.source.weight ?? 1);
    const effB = (b.score ?? 0) * (b.source.weight ?? 1);
    return effB > effA ? b : a;
  });

  const out = [
    `The ${result.riskScore}/100 is weighted most heavily toward ${dominant.source.name} (which rated it ${dominant.score ?? 0}), blended with the weighted average across ${scored.length} scoring source${scored.length === 1 ? "" : "s"}. More authoritative feeds count for more, so the dominant source isn't always the highest raw score.`,
  ];

  const hardMalicious = result.sources.find(
    (s) => s.status === "ok" && s.malicious === true,
  );
  if (hardMalicious) {
    out.push(
      `${hardMalicious.source.name} has it on a definitive malicious listing, which holds the score at 75 or above.`,
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
  const skipped = scoring.filter((s) => s.status === "skipped").length;
  return {
    total: scoring.length,
    responded,
    flagged,
    clean: Math.max(0, responded - flagged),
    errored,
    rateLimited,
    skipped,
  };
}
