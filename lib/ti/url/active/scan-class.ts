import { countryName } from "@/lib/ti/identity";
import { contentCategory, PARKING_NS } from "@/lib/ti/indicator-class";
import { formatBytes, formatDate } from "@/lib/ti/narrative";
import { count } from "@/lib/text";
import { hostFromUrl } from "@/lib/url";
import type { ScanDetail, ScanDownload } from "./detail";
import type { MergedIndicator } from "./merge";
import { ago, domainAgeDays, NEW_DOMAIN_DAYS } from "./red-flags";
import type { PastScan } from "./types";

/**
 * What a scanned indicator turned out to be, in the words the scan page's hero
 * sets large.
 *
 * The passive page answers "what kind of thing is this" from records other
 * people keep (`indicator-class.ts`). This answers the same question from the
 * visit: what a victim who followed the link would actually have been handed.
 * It is a description, not a verdict. The engines' verdict is stated beside it
 * on the page, and a class like "Web page" must never be read as "safe", which
 * is why none of the labels below says anything about safety.
 *
 * The ladder is ordered by what each rung changes for the reader, the same rule
 * the passive ladders follow. Nothing loading wins outright, because everything
 * under it would be describing an absence. A file comes next, because a URL
 * that is a file is not a page at all and every page rung below would be
 * describing nothing. Then the rungs where the page takes something from the
 * visitor or hands them something, then the ones where it serves nothing of its
 * own, then what the site says it is about.
 */
export type ScanClassKind =
  | "no-answer"
  | "file"
  | "harvest"
  | "lure"
  | "login"
  | "open-directory"
  | "parked"
  | "default"
  | "categorised"
  | "page";

export interface ScanClass {
  kind: ScanClassKind;
  /** One to three words, set large. */
  label: string;
  /** The evidence that put it on this rung, as one line. */
  caption: string;
}

type Context = { m: MergedIndicator; now: number; previous?: PastScan[] };
type Rung = (ctx: Context) => ScanClass | null;

/** Whether the visit produced anything at all to describe. */
function loaded(d: ScanDetail): boolean {
  return Boolean(
    d.httpStatus || d.finalUrl || d.requestCount > 0 || d.downloads?.length,
  );
}

/**
 * Nothing answered.
 *
 * When an earlier scan of the same indicator was flagged, the silence is itself
 * the finding: a phishing page that answered last week and answers nothing now
 * has most likely been taken down, and saying so is more use than "no answer".
 */
const noAnswer: Rung = ({ m, previous }) => {
  if (m.engines.length > 0 && loaded(m.detail)) return null;
  // The scanner's own reason, when it gave one: "could not resolve" and "timed
  // out" are different findings, and both are more than "nothing".
  const error = m.incomplete.find((e) => e.error)?.error;
  const why = error ? ` (${error})` : "";
  const flagged = previous?.find((p) => p.malicious);
  const caption = flagged
    ? `nothing loaded now${why}, it was flagged on ${formatDate(flagged.at)}, so it has likely been taken down`
    : `nothing loaded${why}, which is not the same as clean`;
  return { kind: "no-answer", label: "No answer", caption };
};

/** Types a browser renders as a document rather than saving as a file. */
const DOCUMENT_MIME = /^(text\/|application\/(xhtml\+xml|xml|json|javascript))/i;

const EXECUTABLE_DESC = /executable|PE32|\bELF\b|Mach-O|MS-DOS|\bDLL\b|installer|Dalvik|script text/i;
const EXECUTABLE_MIME = /x-dosexec|x-msdownload|x-executable|x-elf|x-mach-binary|x-sharedlib|android\.package-archive|x-msi\b|x-sh\b|x-bat\b/i;
const EXECUTABLE_EXT = /\.(exe|msi|scr|dll|com|pif|bat|cmd|ps1|vbs|vbe|js|jse|wsf|hta|jar|apk|dmg|pkg|app|deb|rpm|lnk|elf|bin|sh)$/i;
const ARCHIVE_MIME = /zip|x-rar|x-7z|gzip|x-tar|x-iso9660|x-apple-diskimage|vnd\.ms-cab/i;
const ARCHIVE_EXT = /\.(zip|rar|7z|gz|tgz|tar|iso|img|cab)$/i;

/** The last path segment of a URL, decoded, or undefined for a bare host. */
export function fileNameOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const segment = new URL(url).pathname.split("/").pop();
    return segment ? decodeURIComponent(segment) : undefined;
  } catch {
    return undefined;
  }
}

/** The download that *is* the scanned URL, as opposed to one the page started. */
export function servedDownload(m: MergedIndicator): ScanDownload | undefined {
  const urls = new Set([m.detail.finalUrl, ...m.targets].filter(Boolean));
  return m.detail.downloads?.find((d) => d.url && urls.has(d.url));
}

/** Executable, archive or neither, reading the sniffed type before the served
 *  type before the name, in the order they are hard to lie with. */
export function fileKind(
  description: string | undefined,
  mime: string | undefined,
  name: string | undefined,
): "Executable file" | "Archive" | "File" {
  if (description && EXECUTABLE_DESC.test(description)) return "Executable file";
  if (mime && EXECUTABLE_MIME.test(mime)) return "Executable file";
  if (name && EXECUTABLE_EXT.test(name)) return "Executable file";
  if (mime && ARCHIVE_MIME.test(mime)) return "Archive";
  if (name && ARCHIVE_EXT.test(name)) return "Archive";
  return "File";
}

/** The scanned URL is a file rather than a page. */
const servedFile: Rung = ({ m }) => {
  const d = m.detail;
  const download = servedDownload(m);
  const fileMime = Boolean(d.mimeType) && !DOCUMENT_MIME.test(d.mimeType ?? "");
  if (!download && !fileMime) return null;

  const name = download?.filename ?? fileNameOf(d.finalUrl ?? m.targets[0]);
  const mime = download?.mimeType ?? d.mimeType;
  const label = fileKind(download?.description, mime, name);
  const caption = download
    ? [download.description ?? mime, formatBytes(download.size)].filter(Boolean).join(", ")
    : `served as ${mime}`;
  return { kind: "file", label, caption };
};

function joinTwo(items: string[]): string {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, 2).join(", ")}, and ${items.length - 2} more`;
}

/** What turns a login page into a harvest, each as a caption fragment. */
function harvestSignals({ m, now }: Context): string[] {
  const signals: string[] = [];
  const brands = m.detail.verdicts.overall.brands ?? [];
  if (brands.length) signals.push(`imitates ${joinTwo(brands)}`);
  const host = m.capability.forms.find((f) => f.crossDomain && f.host)?.host;
  if (host) signals.push(`form posts to ${host}`);
  const age = domainAgeDays(m, now);
  if (age !== undefined && age < NEW_DOMAIN_DAYS) {
    signals.push(`domain registered ${ago(age)}`);
  }
  return signals;
}

/**
 * A password field with a reason to distrust it.
 *
 * A password field alone is every login page on the internet, so it takes one
 * more thing: the form leaving the site, an engine naming the brand being
 * copied, or a name too young to be the real service's. Any one of those is
 * enough; the caption names whichever were seen.
 */
const harvest: Rung = (ctx) => {
  const cap = ctx.m.capability;
  if (cap.error || !cap.passwordField) return null;
  const signals = harvestSignals(ctx);
  if (signals.length === 0) return null;
  return { kind: "harvest", label: "Credential harvest", caption: signals.join(", ") };
};

/**
 * The page hands the visitor a file.
 *
 * Either it started a download on its own as it loaded, which the scanner's
 * browser caught, or it links to something that runs when opened. Ranked under
 * a harvest because a harvest has already taken what it came for by the time
 * the form is submitted, and above a plain login page because a login page
 * offering an installer is no longer a plain login page.
 */
const lure: Rung = ({ m }) => {
  const served = servedDownload(m);
  const started = (m.detail.downloads ?? []).filter((d) => d !== served);
  const offered = m.capability.downloadLinks;
  if (started.length === 0 && offered.length === 0) return null;

  const names = [
    ...started.map((d) => d.filename ?? fileNameOf(d.url)),
    ...offered.map((link) => fileNameOf(link)),
  ].filter((n): n is string => Boolean(n));
  const unique = [...new Set(names)];
  const verb = started.length > 0 ? "downloads" : "offers";
  const caption = unique.length
    ? `${verb} ${joinTwo(unique)}`
    : `${verb} ${count(started.length + offered.length, "file")}`;
  return { kind: "lure", label: "Download lure", caption };
};

function ageWords(days: number): string {
  if (days < 30) return ago(days);
  const years = Math.floor(days / 365);
  if (years >= 1) return `${count(years, "year")} ago`;
  return `${count(Math.floor(days / 30), "month")} ago`;
}

/** A password field and nothing that makes it suspicious. */
const login: Rung = ({ m, now }) => {
  const cap = m.capability;
  if (cap.error || !cap.passwordField) return null;
  const parts = [
    cap.forms.length > 0
      ? "form posts to the same site"
      : "password field with no form around it",
  ];
  const age = domainAgeDays(m, now);
  if (age !== undefined) parts.push(`domain registered ${ageWords(age)}`);
  return { kind: "login", label: "Login page", caption: parts.join(", ") };
};

/** A server listing its own files. On an address from a threat feed that is
 *  usually the payload shelf, so it is named rather than filed as a page. */
const openDirectory: Rung = ({ m }) => {
  const match = /^index of (\S+)/i.exec(m.detail.title ?? "");
  if (!match) return null;
  return {
    kind: "open-directory",
    label: "Open directory",
    caption: `lists the files in ${match[1]}`,
  };
};

/** A parking page's title. Tied to the word "domain" or to a name, because a
 *  bare "for sale" is also every used-car lot on the web. */
const FOR_SALE = /domain( name)? (is |may be )?for sale|\.[a-z]{2,} is for sale|buy this domain|domain parking|parked free/i;

function parkedHow(d: ScanDetail): string | undefined {
  if (d.title && FOR_SALE.test(d.title)) return "for sale page";
  if (d.contentCategories?.some((c) => /parked/i.test(c))) return "filed as Parked by Cloudflare";
  return undefined;
}

/** Held by a registrar or a parking service rather than serving anything. */
const parked: Rung = ({ m }) => {
  const d = m.detail;
  const how = parkedHow(d);
  const ns = d.nameservers?.find((n) => PARKING_NS.test(n));
  if (!how && !ns) return null;
  const caption = [how ?? "parking page", ns ? `held at ${ns}` : undefined]
    .filter(Boolean)
    .join(", ");
  return { kind: "parked", label: "Parked", caption };
};

/** Titles a web server shows before anyone has deployed anything on it. */
const DEFAULT_TITLES: [RegExp, string][] = [
  [/welcome to nginx/i, "nginx welcome page"],
  [/welcome to openresty/i, "OpenResty welcome page"],
  [/apache2? .*default page|^it works!?$/i, "Apache default page"],
  [/^iis windows|internet information services/i, "IIS default page"],
  [/test page for the (apache|nginx|http)/i, "server test page"],
];

/** What one scanned URL served, when it was a default page or an error. */
function servedNothing(d: ScanDetail): { words: string; empty: boolean } | undefined {
  const title = d.title ?? "";
  const named = DEFAULT_TITLES.find(([re]) => re.test(title));
  if (named) return { words: named[1], empty: true };
  const status = Number.parseInt(d.httpStatus ?? "", 10);
  if (status >= 400) return { words: `HTTP ${status}`, empty: status === 404 };
  return undefined;
}

/** ":80" or ":443", for telling an address's two services apart in one line. */
function portOf(target: string): string {
  try {
    const url = new URL(target);
    return `:${url.port || (url.protocol === "https:" ? "443" : "80")}`;
  } catch {
    return target;
  }
}

/**
 * Every scanned URL served a default page or an error.
 *
 * Checked per URL rather than on the folded reading, because a bare address is
 * scanned on two ports and the folded title comes from whichever answered
 * first: an nginx welcome on :80 in front of a real application on :443 is not
 * a default page, and reading only the fold would call it one.
 */
const defaultPage: Rung = ({ m }) => {
  const readable = m.perTarget.filter((t) => t.engines.length > 0);
  const readings = readable.length
    ? readable.map((t) => ({ target: t.target, detail: t.detail }))
    : [{ target: m.targets[0] ?? "", detail: m.detail }];
  const served: { target: string; words: string; empty: boolean }[] = [];
  for (const r of readings) {
    const nothing = servedNothing(r.detail);
    if (!nothing) return null;
    served.push({ target: r.target, ...nothing });
  }

  const several = served.length > 1;
  const parts = served.map((s) => (several ? `${s.words} on ${portOf(s.target)}` : s.words));
  if (served.every((s) => s.empty)) parts.push("nothing deployed at /");
  const anyDefault = served.some((s) => !s.words.startsWith("HTTP "));
  return {
    kind: "default",
    label: anyDefault ? "Default page" : "Error page",
    caption: parts.join(", "),
  };
};

/** What the site says it is about, when Cloudflare has filed it. */
const categorised: Rung = ({ m }) => {
  const d = m.detail;
  const cat = contentCategory(d.contentCategories);
  if (!cat) return null;
  const rest = (d.contentCategories ?? []).filter((c) => c !== cat && contentCategory([c]));
  const via = d.categoryInheritedFrom ? `, via ${d.categoryInheritedFrom}` : "";
  const caption = rest.length ? rest.join(", ").toLowerCase() : "filed by Cloudflare";
  return { kind: "categorised", label: cat, caption: `${caption}${via}` };
};

function clip(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * A page, and nothing on the rungs above says more about it.
 *
 * The caption says what the page did not do, since that is what put it on
 * this rung: its title and host are in the sentence under it. Scoped to the
 * page that loaded, and silent about the markup when nobody read it, because
 * an unread page did not show "no password field", it showed nothing.
 */
const page: Rung = ({ m }) => ({
  kind: "page",
  label: "Web page",
  caption: m.capability.error
    ? "its markup was not read"
    : "no password field and no file offered in the page that loaded",
});

const LADDER: Rung[] = [
  noAnswer,
  servedFile,
  harvest,
  lure,
  login,
  openDirectory,
  parked,
  defaultPage,
  categorised,
  page,
];

/** ", reached in 3 hops from bit.ly" when the trip ended somewhere other than
 *  where it started, which the hero has to say because it shows the end. */
function reachedFrom(m: MergedIndicator): string {
  const hops = m.detail.redirects?.length ?? 0;
  const from = hostFromUrl(m.targets[0] ?? "");
  const to = m.detail.finalUrl ? hostFromUrl(m.detail.finalUrl) : undefined;
  if (hops === 0 || !from || !to || from === to) return "";
  return `, reached in ${count(hops, "hop")} from ${from}`;
}

/** Classify a finished scan by what it served. */
export function classifyScan(
  m: MergedIndicator,
  now: number,
  previous?: PastScan[],
): ScanClass {
  const ctx: Context = { m, now, previous };
  for (const rung of LADDER) {
    const hit = rung(ctx);
    if (!hit) continue;
    if (hit.kind === "no-answer") return hit;
    return { ...hit, caption: `${hit.caption}${reachedFrom(m)}` };
  }
  // Unreachable: `page` always answers. Kept so the return type is honest.
  return { kind: "page", label: "Web page", caption: "untitled" };
}

/** "a" or "an", by the sound of the first letter. Good enough for the nouns
 *  below, none of which starts with a silent consonant or a long u. */
function article(noun: string): string {
  return /^[aeiou]/i.test(noun) ? `An ${noun}` : `A ${noun}`;
}

/** What a served file is for, in the words a reader would use rather than the
 *  sniffer's. */
function fileNoun(file: ScanDownload | undefined, mime: string | undefined, name: string | undefined): string {
  const desc = file?.description ?? "";
  if (/MS Windows|PE32|MS-DOS/i.test(desc)) return "Windows program";
  if (/\bELF\b/.test(desc)) return "Linux program";
  if (/Mach-O/.test(desc)) return "macOS program";
  if (/Dalvik|android/i.test(`${desc} ${mime ?? ""}`) || /\.apk$/i.test(name ?? "")) return "Android app";
  if (/Java archive/i.test(desc) || /\.jar$/i.test(name ?? "")) return "Java program";
  const kind = fileKind(file?.description, mime, name);
  if (kind === "Archive") return "archive";
  if (kind === "Executable file") return "program";
  return "file";
}

/** The first sentence: what it is, what it calls itself, and where it lives. */
function whatItIs(m: MergedIndicator, klass: ScanClass, host: string): string {
  const d = m.detail;
  const titled = d.title ? ` titled "${clip(d.title)}"` : "";
  switch (klass.kind) {
    case "file": {
      // No size or type here: the caption right above already states both.
      const served = servedDownload(m);
      const name = served?.filename ?? fileNameOf(d.finalUrl ?? m.targets[0]);
      const what = article(fileNoun(served, served?.mimeType ?? d.mimeType, name));
      const named = name ? `, ${name},` : "";
      return `${what}${named} delivered straight from ${host}.`;
    }
    case "harvest":
      return `A credential harvest page${titled} on ${host}.`;
    case "lure":
      return `A download lure page${titled} on ${host}.`;
    case "login":
      return `A sign-in page${titled} on ${host}.`;
    case "open-directory":
      return `An open directory listing on ${host}.`;
    case "parked":
      return `A parked domain, ${host}.`;
    case "default":
      return klass.label === "Default page"
        ? `A bare web server at ${host}, with no site deployed on it.`
        : `A web server at ${host} answering only with errors.`;
    case "categorised":
      return `${article(`${klass.label.toLowerCase()} site`)}${titled} on ${host}.`;
    default:
      return `A web page${titled} on ${host}.`;
  }
}

/** Countries that take "the" in running text. */
const WITH_THE = /^(United |Netherlands|Philippines|Czech|Bahamas|Gambia|Maldives|Seychelles|Dominican|Central African|Marshall|Solomon|Comoros|Cayman|British|Falkland|Faroe)/;

/** "Omegatech LTD" out of "OMEGATECH-AS Omegatech LTD, SC": the network's
 *  handle and its registry country are the registry's filing, not a name. */
function networkOwner(asnName: string | undefined): string | undefined {
  if (!asnName) return undefined;
  const name = asnName
    .replace(/^[A-Z0-9][A-Z0-9_.-]*\s+-\s+/, "")
    .replace(/^[A-Z0-9][A-Z0-9_.-]*-[A-Z0-9]+\s+(?=[A-Z][a-z])/, "")
    .replace(/,\s*[A-Z]{2}$/, "")
    .trim();
  return name || undefined;
}

/** The second sentence: what serves it, whose network, which country. Nothing
 *  when none of the three was reported, rather than a sentence of blanks. */
function whereItRuns(d: ScanDetail): string | undefined {
  const owner = networkOwner(d.asnName);
  const place = countryName(d.country);
  const where = place && WITH_THE.test(place) ? `the ${place}` : place;
  const parts = [
    d.server ? ` by ${d.server}` : "",
    owner ? ` from ${owner}` : "",
    where ? ` in ${where}` : "",
  ].join("");
  return parts ? `It is served${parts}.` : undefined;
}

/**
 * What the scanned thing is, as a sentence or two to read under the class.
 *
 * Not a verdict. The engines' verdict is the tag under the capture; this says
 * what a victim would have been looking at, what it calls itself, and who runs
 * the machine serving it, which is the part the class and its caption leave
 * out. Nothing when nothing answered, because the caption already says so and
 * a sentence here would only say it again.
 */
export function describeScan(m: MergedIndicator, klass: ScanClass): string | undefined {
  if (klass.kind === "no-answer") return undefined;
  const d = m.detail;
  const host = hostFromUrl(d.finalUrl ?? m.targets[0] ?? "") ?? d.domain ?? m.targets[0];
  if (!host) return undefined;
  return [whatItIs(m, klass, host), whereItRuns(d)].filter(Boolean).join(" ");
}
