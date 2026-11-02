import { parseDomain } from "@/lib/domain";
import { type AnyCheckResult, isDomainResult, isHashResult } from "./types";

/**
 * The subject, cut into the part the eye should land on and the rest, for the
 * hero's subject line. The parts are plain substrings, separators included,
 * so they join back into exactly the subject and the line copies as one
 * string.
 *
 * For a name the strong part is the registrable domain: on
 * `login.microsoftonline.com.secure-verify.xyz` the brand sits in the labels
 * anyone can mint, and the part someone actually registered is the last two.
 * For an address it is the last group, the one that picks out this host. A
 * file has no part that matters more than another and stays plain.
 */

export type SubjectPart = { text: string; strong: boolean };

export function domainParts(domain: string): SubjectPart[] {
  const registrable = parseDomain(domain)?.registrable;
  const cut = domain.length - (registrable?.length ?? 0);
  // Cut the string the reader sees, not the parser's normalized copy, and only
  // where the two agree, so the parts always join back into `domain`.
  if (!registrable || domain.slice(cut).toLowerCase() !== registrable) return plain(domain);
  return [
    ...(cut > 0 ? [{ text: domain.slice(0, cut), strong: false }] : []),
    { text: domain.slice(cut), strong: true },
  ];
}

export function ipParts(ip: string): SubjectPart[] {
  // The last separator of either family; on an IPv4-mapped IPv6 address that
  // is the last dot, so the same octet is picked out as on plain IPv4.
  const cut = Math.max(ip.lastIndexOf("."), ip.lastIndexOf(":")) + 1;
  // No separator, or one at the very end (`2001:db8::`): nothing to pick out.
  if (cut === 0 || cut === ip.length) return plain(ip);
  return [
    { text: ip.slice(0, cut), strong: false },
    { text: ip.slice(cut), strong: true },
  ];
}

export function subjectParts(result: AnyCheckResult): SubjectPart[] {
  if (isHashResult(result)) return plain(result.hash);
  if (isDomainResult(result)) return domainParts(result.domain);
  return ipParts(result.ip);
}

function plain(text: string): SubjectPart[] {
  return [{ text, strong: false }];
}
