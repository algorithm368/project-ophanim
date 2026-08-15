import { parseDomain } from "../../../domain";
import { errorMessage, isTimeout } from "../../http";

/**
 * What the page that loaded can do.
 *
 * Every field describes the DOM the scanner captured, and nothing more. A kit
 * can build its form only after a click, or serve a harmless page when it
 * recognises a scanner, so "no password field" here means "not in the page that
 * loaded" and the UI must say it that way. `error` is the separate case: the
 * DOM could not be read at all, which is not an observation about the page.
 */
export interface ScanCapability {
  passwordField: boolean;
  forms: FormTarget[];
  downloadLinks: string[];
  error?: string;
}

/** Where one form posts. */
export interface FormTarget {
  /** Absolute where it resolves, otherwise the attribute as written. */
  action: string;
  host?: string;
  /** True only when the target's registrable domain differs from the page's.
   *  A different host under the same site is ordinary architecture. */
  crossDomain: boolean;
}

/** Nothing found, and nothing wrong. Shared so "empty" is one value. */
export const EMPTY_CAPABILITY: ScanCapability = {
  passwordField: false,
  forms: [],
  downloadLinks: [],
};

/** Enough to show the pattern without turning a row into a wall. */
const MAX_LISTED = 8;

/** Extensions that execute, install, or unpack to something that does. A link
 *  to one of these is a delivery mechanism, whatever the page says it is. */
const EXECUTABLE = new Set([
  "exe", "msi", "scr", "bat", "cmd", "com", "pif", "ps1", "vbs", "vbe", "js",
  "jse", "wsf", "hta", "jar", "apk", "dmg", "pkg", "app", "deb", "rpm", "lnk",
  "dll", "iso", "img", "zip", "rar", "7z", "cab", "gz",
]);

const PASSWORD_INPUT = /<input\b[^>]*\btype\s*=\s*["']?password\b/i;
const FORM_TAG = /<form\b[^>]*>/gi;
const ANCHOR_HREF = /<a\b[^>]*\bhref\s*=\s*["']([^"']*)["']/gi;
const ATTR = (name: string) =>
  new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");

/** The attribute's value, or undefined when the tag does not carry it. */
function attr(tag: string, name: string): string | undefined {
  const match = ATTR(name).exec(tag);
  if (!match) return undefined;
  const value = match[1] ?? match[2] ?? match[3];
  return value === "" ? undefined : value;
}

/** Registrable domain of a hostname, for comparing two hosts as one site. */
function siteOf(host: string): string {
  return parseDomain(host)?.registrable ?? host.toLowerCase();
}

/** Resolve href against the page, returning both the absolute form and its
 *  host. A scheme with no host (mailto:, javascript:) yields no host, which is
 *  what keeps it from being called cross-domain. */
function resolve(
  href: string,
  pageUrl: string,
): { absolute: string; host?: string } {
  try {
    const url = new URL(href, pageUrl);
    return {
      absolute: url.href,
      host: url.hostname ? url.hostname.toLowerCase() : undefined,
    };
  } catch {
    return { absolute: href };
  }
}

/** Whether a path points at something that runs when it is opened. */
function isExecutable(pathname: string): boolean {
  const dot = pathname.lastIndexOf(".");
  if (dot === -1) return false;
  return EXECUTABLE.has(pathname.slice(dot + 1).toLowerCase());
}

/**
 * Read the captured DOM for the three things that decide a phishing case: does
 * it ask for a password, where does the form send it, and does the page hand
 * over something executable.
 *
 * This is deliberately a scan for markup rather than a parse into a tree. The
 * input is one scanner-rendered document read for three signals, and a real
 * parser would buy correctness on malformed markup we do not act on anyway.
 */
export function analyzeDom(html: string, pageUrl: string): ScanCapability {
  if (!html) return EMPTY_CAPABILITY;

  const pageHost = resolve(pageUrl, pageUrl).host;
  const pageSite = pageHost ? siteOf(pageHost) : undefined;

  const forms: FormTarget[] = [];
  const seenForms = new Set<string>();
  for (const [tag] of html.matchAll(FORM_TAG)) {
    if (forms.length >= MAX_LISTED) break;
    const raw = attr(tag, "action");
    // A form with no action posts back to the page it is on.
    const { absolute, host } = resolve(raw ?? pageUrl, pageUrl);
    if (seenForms.has(absolute)) continue;
    seenForms.add(absolute);
    forms.push({
      action: absolute,
      ...(host ? { host } : {}),
      crossDomain: Boolean(host && pageSite && siteOf(host) !== pageSite),
    });
  }

  const downloadLinks: string[] = [];
  const seenLinks = new Set<string>();
  for (const [, href] of html.matchAll(ANCHOR_HREF)) {
    if (downloadLinks.length >= MAX_LISTED) break;
    if (!href) continue;
    const { absolute } = resolve(href, pageUrl);
    let pathname: string;
    try {
      pathname = new URL(absolute, pageUrl).pathname;
    } catch {
      continue;
    }
    if (!isExecutable(pathname) || seenLinks.has(absolute)) continue;
    seenLinks.add(absolute);
    downloadLinks.push(absolute);
  }

  return {
    passwordField: PASSWORD_INPUT.test(html),
    forms,
    downloadLinks,
  };
}

/**
 * Fetch the scanner's copy of the rendered DOM and read it.
 *
 * Reading the scanner costs one request and touches the target zero times,
 * which is the whole reason this runs against `domURL` rather than the site.
 * A failure returns an error rather than an empty reading: "we could not look"
 * and "we looked and found nothing" are different claims.
 */
export async function fetchCapability(
  domUrl: string,
  pageUrl: string,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<ScanCapability> {
  try {
    const res = await fetch(domUrl, { headers, signal });
    if (!res.ok) {
      return { ...EMPTY_CAPABILITY, error: `DOM unavailable, HTTP ${res.status}` };
    }
    // Both engines serve the DOM gzipped with Content-Encoding set, so fetch
    // decompresses it before we see it.
    return analyzeDom(await res.text(), pageUrl);
  } catch (err) {
    return {
      ...EMPTY_CAPABILITY,
      error: isTimeout(err) ? "DOM fetch timed out" : errorMessage(err),
    };
  }
}
