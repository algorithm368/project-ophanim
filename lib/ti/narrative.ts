/**
 * Plain-language summaries shown in the verdict "summary card".
 *
 * These are pure functions (no React) so they can be unit-tested directly;
 * `components/CheckResults.tsx` imports them for rendering. Keep them honest:
 * the card must never describe something the data doesn't support.
 */
import { HASH_ALGO_LABEL } from "@/lib/hash";
import { count } from "@/lib/text";
import { FLAG_THRESHOLD } from "./aggregate";
import { isUsageCategory } from "./threat-type";
import { ENGINE_NAME } from "./url/active/engines";
import type { MergedScan } from "./url/active/merge";
import type { ScanDetail } from "./url/active/detail";
import type {
  CheckResult,
  CheckStats,
  DomainCheckResult,
  GeoContext,
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
/** Whether a capability label reads as "it <verb> …" rather than as a machine
 *  token ("stack_pivot"), a family/label leak ("SectopRAT payload", "Detects
 *  AnimateClipper"), or an adjective-initial phrase ("Suspicious use of X")
 *  that would produce "it suspicious use of X". */
function readsAsBehavior(label: string): boolean {
  if (!/\s/.test(label) || label.includes("_")) return false;
  if (/\b(family|payload|variant)\b/i.test(label)) return false;
  if (/^detect(s|ed)?\b/i.test(label)) return false;
  return !/^(suspicious|possible|potential|known|generic|anomalous)\b/i.test(
    label,
  );
}

/** The first `cap` distinct values of `mapped`, in order, skipping the ones it
 *  maps away. One pass with a seen-set, which is what both behaviour passes
 *  below were doing inline. */
function firstDistinct<T>(
  items: readonly T[],
  cap: number,
  mapped: (item: T) => string | undefined,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const value = mapped(item);
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    out.push(value);
    if (out.length >= cap) break;
  }
  return out;
}

export function hashBehaviorSummary(
  ctx: HashContext | undefined,
): string | undefined {
  const phrases = firstDistinct(
    ctx?.behaviorTags ?? [],
    5,
    (tag) => BEHAVIOR_TAG_PHRASES[tag.toUpperCase()],
  );
  if (phrases.length) return `When run, it ${joinList(phrases)}.`;

  // Fallback: multi-word capability labels that read as verb phrases.
  const caps = firstDistinct(ctx?.capabilities ?? [], 4, (c) => {
    const label = c.label.trim();
    return readsAsBehavior(label) ? lowerFirst(label) : undefined;
  });
  if (caps.length >= 2) return `When run, it ${joinList(caps)}.`;
  return undefined;
}

/**
 * Plain-language sentences explaining why a clean-verdict file reads as
 * clean, one per positive signal actually present: a verified digital
 * signature, a unanimous harmless sandbox detonation, a zero-malicious
 * engine tally, and — when it applies — a prevalence caveat. Each stands as
 * its own sentence so an analyst sees exactly which evidence backs the
 * verdict, not a single line that blurs them together. Returns [] when
 * nothing applies, since most clean verdicts are simply "nothing on
 * record", a different and weaker claim than these — never invent a reason
 * where the data has none.
 */
export function hashCleanSummary(ctx: HashContext | undefined): string[] {
  const sentences: string[] = [];

  if (ctx?.signed) {
    sentences.push(
      ctx.signer
        ? `It carries a digital signature from ${ctx.signer} that Authenticode verified as valid.`
        : "It carries a digital signature that Authenticode verified as valid.",
    );
  }

  if (ctx?.sandboxVerdict) {
    const { sandboxes, confidence } = ctx.sandboxVerdict;
    const via = sandboxes.length ? joinList(sandboxes) : "sandbox analysis";
    const confidenceSuffix = confidence !== undefined ? ` (${confidence}% confidence)` : "";
    sentences.push(
      `Detonated in ${via}, it showed no malicious behaviour${confidenceSuffix}.`,
    );
  }

  const ratio = ctx?.detectionRatio;
  if (ratio && ratio.total > 0 && ratio.malicious === 0) {
    sentences.push(`None of the ${count(ratio.total, "engine")} that scanned it flagged anything.`);
  }

  // A single-submission file has no track record behind it yet, only this
  // one look, so the clean signals above rest on thinner evidence than a
  // widely-seen file would — worth saying plainly rather than leaving the
  // reader to assume otherwise.
  if (ctx?.timesSubmitted === 1) {
    sentences.push(
      "It has only been submitted once, so this reading is a first look rather than an established track record.",
    );
  }

  return sentences;
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

function joinPlace(parts: (string | undefined)[]): string {
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

/**
 * How a domain's age is introduced.
 *
 * Three honest tiers so a 45-day-old domain is not called "established": newly
 * registered under 30 days, a neutral middle under a year, established beyond
 * it.
 */
function ageLead(ageDays: number): string {
  if (ageDays < 30) return "It is a newly registered domain, created";
  if (ageDays < 365) return "It was registered";
  return "It is an established domain, registered";
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
  // AbuseIPDB reports what an address is used for alongside what it did, and
  // both arrive as categories. Left in, the clause reads "flagged it for Fixed
  // Line ISP, web app attack", which puts a connection type in a list of
  // accusations.
  if (isUsageCategory(n)) return false;
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
      const significant = reports > 0 && confidence >= ABUSE_SIGNIFICANT;
      parts.push(
        significant
          ? `${count(reports, "AbuseIPDB report")} at ${confidence}% confidence`
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
  // Everything with anything adverse to say, flagging or not. Reporting only
  // the flagging count understates the evidence: 103.83.237.2 has six sources
  // reporting against it, including a live Spamhaus ZEN listing at 38, and read
  // as "1 of 13 TI sources flagged it".
  const adverseSources = scoringSources.filter(
    (x) => x.malicious === true || (x.score ?? 0) > 0,
  );
  const belowThreshold = adverseSources.length - flaggedSources.length;
  /**
   * The "and there is more" clause. "N more sources" only makes sense when
   * something was flagged to be more than; with nothing flagged it becomes a
   * concession instead, so the conjunction changes with it.
   */
  function alsoClause(anyFlagged: boolean): string {
    if (belowThreshold === 0) return "";
    const subject = count(
      belowThreshold,
      anyFlagged ? "more source" : "source",
    );
    const verb = belowThreshold === 1 ? "reports" : "report";
    const lead = anyFlagged ? "and" : "though";
    return `, ${lead} ${subject} ${verb} adverse data below the flagging threshold`;
  }

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
      }${alsoClause(true)}.`,
    );
    const flaggedBy = byStrength.map((x) => x.source.name).slice(0, 4);
    out.push(`Flagged by ${flaggedBy.join(", ")}.`);
  } else if (responded > 0) {
    // "None flagged" on its own reads as a clean bill of health, which is wrong
    // when several sources reported against it and merely fell under the line.
    out.push(
      `None of the ${responded} TI sources flagged this ${noun}${alsoClause(false)}${
        historyClause ? `, with ${historyClause}` : ""
      }.`,
    );
  }

  return out;
}

/**
 * What kind of network the address sits on, and what that implies.
 *
 * Proxy is checked first and keeps the hosting fact when both are set: the
 * profile card shows both trait chips, so collapsing to "anonymizer" alone
 * would drop the datacenter context (issue #9). No flag at all means ip-api
 * did not classify the address, which is "unclassified" rather than positive
 * evidence of an end-user network, so the last case hedges rather than
 * asserts (issue #10).
 */
function addressType(geo: GeoContext): { phrase: string; tail: string } {
  if (geo.isProxy) {
    return {
      phrase: geo.isHosting
        ? "an anonymizer (proxy, VPN, or Tor) on hosting/datacenter infrastructure"
        : "an anonymizer (proxy, VPN, or Tor)",
      tail: ", so the real origin is hidden",
    };
  }
  if (geo.isHosting) {
    return { phrase: "hosting or datacenter infrastructure", tail: "" };
  }
  if (geo.isMobile) {
    return { phrase: "a mobile carrier (cellular) address", tail: "" };
  }
  return { phrase: "likely a residential or business endpoint", tail: "" };
}

/** What the address is: network type woven with its operator, ASN and prefix. */
function addressIdentity(geo: GeoContext, result: CheckResult): string {
  const { phrase, tail } = addressType(geo);
  const operator = geo.isp || geo.org || geo.asnOrg || "";
  const op = operator ? ` operated by ${operator}` : "";
  // ip-api's ASN field bundles the org name; keep just the AS number here.
  const asnNum = geo.asn ? (/^AS\d+/.exec(geo.asn)?.[0] ?? geo.asn) : "";
  const asn = asnNum ? ` (${asnNum})` : "";
  const prefix = bgpPrefix(result);
  const prefixClause = prefix ? ` with an active BGP prefix of ${prefix}` : "";
  return `It is ${phrase}${op}${asn}${prefixClause}${tail}.`.replace(
    /\.\.$/,
    ".",
  );
}

/** Where it is, plus its reverse-DNS identity, in whichever of the two are
 *  known. */
function addressLocation(geo: GeoContext | undefined): string | undefined {
  const where = joinPlace([geo?.city, geo?.region, geo?.country]);
  if (where && geo?.reverse) {
    return `It is geolocated to ${where}, with reverse DNS ${geo.reverse}.`;
  }
  if (where) return `It is geolocated to ${where}.`;
  if (geo?.reverse) return `Its reverse DNS is ${geo.reverse}.`;
  return undefined;
}

export function buildNarrative(result: CheckResult): string[] {
  const geo = result.geo;
  const sentences = [headline("address", result)];

  if (geo) sentences.push(addressIdentity(geo, result));
  const location = addressLocation(geo);
  if (location) sentences.push(location);

  return [
    ...sentences,
    ...threatSentences(result, "address", abuseHistoryClause(result)),
  ];
}

/**
 * Where the domain points right now, or why it points nowhere.
 *
 * The three outcomes are deliberately not interchangeable. A flagged-but-
 * NXDOMAIN name (a taken-down C2 still on blocklists) keeps its verdict but is
 * said plainly to be dead; the unknown case already leads with NXDOMAIN, so it
 * is not repeated here. Non-resolution is only claimed for a domain clearly
 * delegated (it has NS records) that still maps to no address: empty IP fields
 * on their own can simply mean DNS was never resolved, and calling that
 * "parked or taken down" would be a false statement about missing data
 * (issue #4).
 */
function domainInfrastructure(result: DomainCheckResult): string | undefined {
  const ctx = result.context;
  const ips = ctx?.resolvedIps ?? [];
  const mx = ctx?.mx ?? [];

  if (ips.length > 0) {
    const extra = ips.length - 1;
    const hosts = extra > 0 ? ` and ${count(extra, "other host")}` : "";
    const mail = mx.length ? `, with mail handled by ${mx[0]}` : "";
    return `It currently resolves to ${ips[0]}${hosts}${mail}.`;
  }
  if (ctx?.nxdomain && result.verdict !== "unknown") {
    return "It currently returns NXDOMAIN, the name no longer exists in DNS (unregistered, expired, or taken down).";
  }
  const delegated = (ctx?.nameservers?.length ?? 0) > 0;
  if (ctx && delegated && (ctx.ipv6?.length ?? 0) === 0) {
    return "It does not currently resolve to an address (parked, expired, or taken down).";
  }
  return undefined;
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
    const lead = `${ageLead(ctx.ageDays)} ${ageText}${reg}`;
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

  const infrastructure = domainInfrastructure(result);
  if (infrastructure) sentences.push(infrastructure);

  return [...sentences, ...threatSentences(result, "domain")];
}

/**
 * The file's type as a noun phrase.
 *
 * Size is a trailing parenthetical rather than an "of {size}" infix; the
 * article matches the type's initial sound; and a redundant " file" is dropped
 * when the type already names the kind ("PDF document", "PE32 executable").
 */
function typePhrase(type: string, size: string | undefined): string {
  const article = /^[aeiou]/i.test(type) ? "an" : "a";
  const names =
    /\b(file|document|executable|text|image|archive|script|library)\b/i.test(
      type,
    );
  const bytes = size ? ` (${size})` : "";
  return `${article} ${type}${names ? "" : " file"}${bytes}`;
}

/** What the file is: family, type, size and name woven into one read, then
 *  when it was first observed. */
function fileIdentitySentences(ctx: HashContext): string[] {
  const parts: string[] = [];
  if (ctx.malwareFamily) parts.push(`identified as ${ctx.malwareFamily}`);
  else if (ctx.threatLabel) parts.push(`classified as ${ctx.threatLabel}`);

  const type = ctx.fileType ?? ctx.mimeType;
  const size = formatBytes(ctx.fileSize);
  if (type) parts.push(typePhrase(type, size));
  else if (size) parts.push(`${size} in size`);

  const out: string[] = [];
  if (parts.length) {
    // fileName is the best-known name, not provably the earliest seen.
    const name = ctx.fileName ? `, seen as "${ctx.fileName}"` : "";
    out.push(`It is ${parts.join(", ")}${name}.`);
  } else if (ctx.fileName) {
    out.push(`It has been seen as "${ctx.fileName}".`);
  }

  const first = formatDate(ctx.firstSeen);
  if (first) out.push(`First observed ${first}.`);
  return out;
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

  if (ctx) {
    sentences.push(...fileIdentitySentences(ctx));
  } else if (!hasData) {
    sentences.push("No source returned metadata describing the file.");
  }

  return [...sentences, ...threatSentences(result, "file")];
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
  adverse: number;
  flagged: number;
  clean: number;
  noRecord: number;
  errored: number;
  rateLimited: number;
  skipped: number;
  noKey: number;
  unsupported: number;
} {
  const scoring = result.sources.filter((s) => (s.source.weight ?? 1) > 0);
  const answered = scoring.filter((s) => s.status === "ok");
  const responded = answered.length;
  // Three states, not two. "Reported something adverse" and "cleared the
  // flagging threshold" are different facts, and reporting only the second
  // understates the evidence badly: an IP listed on Spamhaus ZEN scores 38,
  // two points under FLAG_THRESHOLD, and used to be counted as clean.
  const adverse = answered.filter(
    (s) => s.malicious === true || (s.score ?? 0) > 0,
  ).length;
  const flagged = answered.filter(
    (s) => s.malicious === true || (s.score ?? 0) >= FLAG_THRESHOLD,
  ).length;
  // A source with no score at all has no record of the indicator, which is not
  // the same as having looked and found it clean.
  const noRecord = answered.filter(
    (s) => s.score === undefined && s.malicious !== true,
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
    adverse,
    flagged,
    clean: Math.max(0, responded - adverse - noRecord),
    noRecord,
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
/** 1. Where the URL ends up. The redirect is the first thing an analyst needs,
 *  and a destination under a different name is the finding itself. */
function scanDestination(merged: MergedScan): string[] {
  const d = merged.detail;
  const finalHost = hostOf(d.finalUrl);
  const targetHost = hostOf(merged.target);
  const hops = d.redirects?.length ?? 0;
  const served = d.httpStatus ? `, answering HTTP ${d.httpStatus}` : "";

  if (hops > 0 && finalHost) {
    return [`This URL redirects ${countWord(hops)}, to ${finalHost}${served}.`];
  }
  if (finalHost && targetHost && finalHost !== targetHost) {
    return [`This URL ends up at ${finalHost}${served}.`];
  }
  if (d.httpStatus) {
    return [`This URL answered HTTP ${d.httpStatus} when it was visited.`];
  }
  return [];
}

/**
 * 2. What the page can do, strictly as observed in the captured DOM.
 *
 * When the DOM was never read, nothing is said: silence beats a false absence.
 * Title and password field share a sentence when both are present, so the
 * qualifier "the page that loaded" is stated once rather than drummed.
 */
function scanCapability(merged: MergedScan): string[] {
  const d = merged.detail;
  const cap = merged.capability;
  const sentences: string[] = [];
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
  if (cap.error) return sentences;

  const crossDomain = cap.forms.filter((f) => f.crossDomain && f.host);
  if (crossDomain.length > 0) {
    const hosts = [...new Set(crossDomain.map((f) => f.host as string))];
    sentences.push(
      `Its form posts to ${joinList(hosts)}, a different domain from the one shown.`,
    );
  }

  const downloads = downloadSentence(cap.downloadLinks);
  if (downloads) sentences.push(downloads);

  return sentences;
}

/** The files the page hands over, which is how a page that looks harmless
 *  delivers. Named with where they are served from, since that is often not the
 *  site being looked at. */
function downloadSentence(links: string[]): string | undefined {
  if (links.length === 0) return undefined;
  const shown = links.slice(0, 3);
  const files = shown
    .map((link) => link.split("/").pop())
    .filter((name): name is string => Boolean(name));
  const hosts = [
    ...new Set(shown.map((link) => hostOf(link)).filter(Boolean)),
  ] as string[];
  const from = hosts.length ? `, served from ${joinList(hosts)}` : "";
  const verb = links.length === 1 ? "executes" : "execute";
  return `It links to ${count(links.length, "file")} that ${verb} when opened, ${joinList(files)}${from}.`;
}

/** 3. How new the name and the certificate are, and what the domain is filed
 *  as. An exact WHOIS instant beats a rounded age, so it wins when both are
 *  present. */
function scanProvenance(merged: MergedScan): string[] {
  const d = merged.detail;
  const sentences: string[] = [];

  const created = formatDate(d.domainCreated);
  if (created) {
    sentences.push(`Its domain was registered on ${created}.`);
  } else if (d.domainAgeDays !== undefined) {
    sentences.push(`Its domain was registered ${formatAge(d.domainAgeDays)}.`);
  }

  const cert = certificateSentence(d);
  if (cert) sentences.push(cert);

  // What the site is about, stated before what is wrong with it: the mismatch
  // between the two is the finding, and an analyst reads it in that order.
  if (d.contentCategories?.length) {
    const inherited = d.categoryInheritedFrom
      ? `, inherited from ${d.categoryInheritedFrom}`
      : "";
    sentences.push(
      `Cloudflare categorizes the site as ${joinList(d.contentCategories)}${inherited}.`,
    );
  }

  if (d.riskCategories?.length) {
    sentences.push(`Cloudflare puts the domain in ${joinList(d.riskCategories)}.`);
  }

  const siblings = d.siblingDomains ?? [];
  if (siblings.length) {
    const noun = siblings.length === 1 ? "a sibling domain" : "sibling domains";
    sentences.push(
      `Its robots.txt names ${joinList(siblings)}, ${noun} worth checking too.`,
    );
  }

  return sentences;
}

/** The certificate's age, issuer and validity, in whatever parts were seen. A
 *  certificate days old on a domain days old is the cheapest strong phishing
 *  signal there is. */
function certificateSentence(d: ScanDetail): string | undefined {
  if (d.tlsAgeDays === undefined && !d.tlsIssuer) return undefined;
  const issuer = d.tlsIssuer ? `issued by ${d.tlsIssuer}` : "issued";
  const age =
    d.tlsAgeDays !== undefined
      ? `is ${count(d.tlsAgeDays, "day")} old, ${issuer}`
      : `was ${issuer}`;
  const valid =
    d.tlsValidDays !== undefined ? `, valid for ${d.tlsValidDays} days` : "";
  return `Its certificate ${age}${valid}.`;
}

/**
 * 4 to 6. What the scanners concluded, where they disagreed, and who did not
 * finish.
 *
 * Attributed, because an unattributed verdict cannot be defended when it is
 * questioned in a ticket. Disagreement is itself a finding: a site answering
 * differently by visitor is what a kit dodging scanners does. And an engine
 * that did not finish is named, so the reading is not mistaken for the whole
 * picture.
 */
function scanVerdicts(merged: MergedScan): string[] {
  const d = merged.detail;
  const sentences: string[] = [];
  const names = merged.engines.map((e) => ENGINE_NAME[e]);

  if (d.verdicts.overall.malicious) {
    const categories = d.verdicts.overall.categories?.length
      ? ` as ${joinList(d.verdicts.overall.categories)}`
      : "";
    sentences.push(`It was flagged${categories} by ${joinList(names)}.`);
  } else {
    const subject =
      names.length === 1 ? "the scanner that ran" : "scanner";
    sentences.push(
      `Neither ${subject} flagged it, which is an absence of evidence rather than a clean bill.`,
    );
  }

  for (const disagreement of merged.disagreements) {
    const readings = disagreement.values
      .map((v) => `${ENGINE_NAME[v.engine]} saw ${v.value}`)
      .join(", ");
    sentences.push(
      `The scanners disagree on ${midSentence(disagreement.field)}: ${readings}.`,
    );
  }

  for (const entry of merged.incomplete) {
    const reason =
      entry.status === "running"
        ? "was still scanning"
        : `did not finish (${entry.error ?? entry.status})`;
    sentences.push(`${ENGINE_NAME[entry.engine]} ${reason}.`);
  }

  return sentences;
}

/**
 * The paragraph an analyst pastes into a ticket, from an active scan.
 *
 * Assembled from four readings in the order a case is written: where the URL
 * went, what the page can do, how new the name and its certificate are, and
 * what the scanners made of it. Each section is its own function so the shape
 * of the paragraph is visible here and the conditions live next to the
 * sentences they guard.
 */
export function buildScanNarrative(merged: MergedScan): string[] {
  // Nothing finished means nothing was observed. No paragraph is the honest
  // output; a headline here would be a claim built on no evidence.
  if (merged.engines.length === 0) return [];

  return [
    ...scanDestination(merged),
    ...scanCapability(merged),
    ...scanProvenance(merged),
    ...scanVerdicts(merged),
  ];
}

/**
 * The one sentence of the paragraph that is a reading rather than a restatement.
 *
 * The scan page prints every fact the narrative recites as its own attributed
 * row, so printing the paragraph beside them says the domain's age twice and
 * the certificate's twice more. What survives that de-duplication is the
 * judgement: whether anyone flagged it, and what a nobody-flagged-it actually
 * means. The copy button still carries the whole paragraph, because text pasted
 * into a ticket has to stand on its own without the table beside it.
 *
 * The disagreement and unfinished-engine sentences `scanVerdicts` adds are rows
 * too, in the verdicts and trace sections, which is why only the first is kept.
 */
export function scanJudgement(merged: MergedScan): string | undefined {
  if (merged.engines.length === 0) return undefined;
  return scanVerdicts(merged)[0];
}
