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
