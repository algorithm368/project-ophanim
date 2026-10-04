import { parseIP } from "@/lib/ip";

/**
 * Extract the lowercased hostname from a URL string, or undefined when it can't
 * be parsed (no scheme, empty, garbage). Used to turn distribution URLs into a
 * pivotable domain and to render their host.
 */
export function hostFromUrl(url: string): string | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host || undefined;
  } catch {
    return undefined;
  }
}

/** Longest URL accepted as an indicator. Beyond this it is a payload, not an
 *  address, and every downstream cache key and API would carry the weight. */
const MAX_URL_LENGTH = 2048;

/** A URL parsed into the parts the pipeline needs, plus one canonical string. */
export interface ParsedUrl {
  /** scheme://host[:port]/path[?query], no fragment, no userinfo. Cache key. */
  canonical: string;
  scheme: "http" | "https";
  /** punycode, lowercase, no trailing root dot */
  host: string;
  /** only set when the port is not the scheme default */
  port?: number;
  /** always starts with "/", original case preserved */
  path: string;
  /** without the leading "?", original case preserved */
  query?: string;
  /** "user:pass" when present. Stripped from `canonical`, kept for heuristics. */
  userinfo?: string;
  /** true when the host is an IP literal rather than a name */
  isIpHost: boolean;
}

const DEFAULT_PORT: Record<string, string> = { "http:": "80", "https:": "443" };

/**
 * True when the input is URL-shaped rather than a bare hostname: it carries a
 * scheme, a path, or a query. `detectIOC` uses this to choose between url and
 * domain, so a bare "evil.com" keeps its existing domain behaviour while
 * "evil.com/login" does not lose its path.
 */
export function looksLikeUrl(input: string): boolean {
  const value = input.trim();
  if (!value) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return true;
  // Strip the leading authority, then look for a path or query behind it.
  const rest = value.replace(/^[^/?#]*/, "");
  return rest.startsWith("/") || rest.startsWith("?");
}

/**
 * Parse and canonicalize a URL indicator. Returns null for anything that is not
 * a checkable http(s) URL.
 *
 * Canonicalization exists so one URL has one cache key. The fragment is dropped
 * because a browser never sends it to the server, so it cannot affect a lookup
 * and keeping it would split the cache. Scheme and host are lowercased but the
 * path and query are not: path comparison is case-sensitive on most servers, and
 * folding it would make two different resources look like one.
 */
export function parseUrl(input: string): ParsedUrl | null {
  const raw = input.trim();
  if (!raw || raw.length > MAX_URL_LENGTH) return null;

  // A scheme-less input is assumed https. An explicit non-http scheme is
  // rejected rather than coerced, so "javascript:" never becomes an indicator.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  // URL already lowercases and punycodes the hostname; drop the root dot.
  const host = url.hostname.replace(/\.$/, "");
  if (!host) return null;

  let userinfo: string | undefined;
  if (url.username) {
    userinfo = url.password ? `${url.username}:${url.password}` : url.username;
  }

  const port =
    url.port && url.port !== DEFAULT_PORT[url.protocol]
      ? Number(url.port)
      : undefined;
  // An http(s) URL always has a path, "/" at the least.
  const path = url.pathname;
  const query = url.search ? url.search.slice(1) : undefined;

  const authority = port ? `${host}:${port}` : host;
  const search = query ? `?${query}` : "";
  const canonical = `${url.protocol}//${authority}${path}${search}`;

  return {
    canonical,
    scheme: url.protocol === "http:" ? "http" : "https",
    host,
    port,
    path,
    query,
    userinfo,
    isIpHost: parseIP(host) !== null,
  };
}
