import { parseIPv4 } from "@/lib/ip";
import { parseDomain } from "@/lib/domain";
import { parseHash } from "@/lib/hash";

export type IOCType = "ip" | "domain" | "hash";

/**
 * Undo the common "defang" conventions analysts use so an IOC isn't clickable
 * when shared in tickets, chat, or email: e.g. `evil[.]com`, `185.220.101[.]1`,
 * `hxxps://bad[.]site`, `mail[at]evil[dot]com`. We refang pasted input back to
 * its real form so it still resolves to a checkable indicator. A clean value
 * passes through untouched.
 */
export function refangIOC(input: string): string {
  const value = input.trim();
  if (!value) return value;
  return value
    // hxxp / hXXps -> http / https (the trailing "s" is preserved).
    .replace(/h[xt]{2}p/gi, "http")
    // Bracketed / parenthesized / worded dot separators -> "."
    .replace(/[[({]\s*(?:\.|dot|punto)\s*[\])}]/gi, ".")
    .replace(/\s+dot\s+/gi, ".")
    // Escaped dots from some CSV / log exports.
    .replace(/\\\./g, ".")
    // Defanged scheme + "@" separators.
    .replace(/[[({]\s*:\s*[\])}]/g, ":")
    .replace(/[[({]\s*(?:\/\/)\s*[\])}]/g, "//")
    .replace(/[[({]\s*(?:@|at)\s*[\])}]/gi, "@")
    .trim();
}

/**
 * Best-effort guess at which kind of IOC a string is, so the UI can pick the
 * right checker without the user choosing. Input is refanged first, then matched
 * against the three non-overlapping shapes: a hash is bare hex (no dots), an
 * IPv4 is dotted decimals, and a domain needs a dotted label with an alphabetic
 * TLD (parseDomain rejects IP literals), so the order here only resolves which
 * parser claims it, not genuine ambiguity.
 */
export function detectIOC(input: string): IOCType | null {
  const value = refangIOC(input);
  if (!value) return null;
  if (parseHash(value)) return "hash";
  if (parseIPv4(value)) return "ip";
  if (parseDomain(value)) return "domain";
  return null;
}
