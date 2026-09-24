import { parseIP } from "@/lib/ip";
import { count } from "@/lib/text";
import { hostFromUrl } from "@/lib/url";
import type { MergedIndicator } from "./merge";

/**
 * The findings from a scan that change what an analyst does next.
 *
 * Every rule here reads something the scan itself observed, never a third
 * party's opinion: the engines' own verdicts are already on the page as
 * verdicts, and repeating them as a flag would double-count one source. What
 * these add is the reading of the capture that no passive source can make,
 * which is the reason this page exists.
 *
 * A flag is a claim about the page that loaded, not about the site. A kit can
 * build its form after a click or serve something harmless when it recognises a
 * scanner, so the wording says what was seen rather than what the site is.
 */
export interface RedFlag {
  /** Stable id, so a flag can be tested and styled without matching prose. */
  id: string;
  /** One clause, in the past tense of what the scanner saw. */
  label: string;
  /** The section holding the evidence, so the flag can link to it. */
  section: string;
}

/**
 * How new a name or a certificate has to be to count.
 *
 * One number for both, chosen by the owner. Worth knowing what it costs: Let's
 * Encrypt issues 90-day certificates and renews with 30 days left, so an
 * ordinary site's certificate is under 30 days old for a third of its life and
 * this fires on a great many sites that are perfectly fine. Lowering the
 * certificate half to about 7 would leave the domain rule doing most of the
 * work; both are one edit here.
 */
export const NEW_DOMAIN_DAYS = 30;
export const NEW_CERTIFICATE_DAYS = 30;

const DAY_MS = 86_400_000;

/** Days between an ISO instant and `now`, or undefined when it will not parse.
 *  A date in the future (a clock skewed either way) reads as zero rather than
 *  as a negative age. */
function daysSince(iso: string | undefined, now: number): number | undefined {
  if (!iso) return undefined;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return undefined;
  return Math.max(0, Math.floor((now - then) / DAY_MS));
}

/** "today" for the day it happened, otherwise "N days ago". A domain
 *  registered this morning reading as "0 days ago" is the one case where the
 *  count is least readable and the fact matters most. */
export function ago(days: number): string {
  return days === 0 ? "today" : `${count(days, "day")} ago`;
}

/**
 * How old the domain is, preferring the WHOIS instant over the rounded age.
 *
 * Cloudflare reports a creation date and urlscan reports a day count, and the
 * exact instant is the sharper of the two: a domain created this morning reads
 * as "0 days" either way, but only one of them can say when.
 */
export function domainAgeDays(m: MergedIndicator, now: number): number | undefined {
  // A bare address has no registration. `distillResult` now drops the 0 urlscan
  // reports for one, and this keeps a batch cached before that from flagging
  // an IP as a domain registered today.
  const host = m.detail.domain ?? hostFromUrl(m.detail.finalUrl ?? "");
  if (host && parseIP(host)) return undefined;
  return daysSince(m.detail.domainCreated, now) ?? m.detail.domainAgeDays;
}

/** Where a password form posts, when that is off the site. */
function crossDomainFormHost(m: MergedIndicator): string | undefined {
  return m.capability.forms.find((f) => f.crossDomain && f.host)?.host;
}

/**
 * Every red flag this scan raises, strongest first.
 *
 * Order is the order they are listed in, and it is deliberate: a credential
 * form posting off-site decides a case on its own, an executable download
 * nearly does, and the three remaining are strong context rather than a
 * verdict.
 *
 * `now` is a parameter rather than read inside, matching `relativeTime`: it
 * keeps the function pure, and the age of a domain is exactly the kind of
 * thing a test needs to pin.
 */
export function redFlagsFor(m: MergedIndicator, now: number): RedFlag[] {
  const flags: RedFlag[] = [];
  const d = m.detail;

  const postsTo = crossDomainFormHost(m);
  if (m.capability.passwordField && postsTo) {
    flags.push({
      id: "credential-exfil",
      label: `A password field posts to ${postsTo}, a different domain`,
      section: "dom",
    });
  }

  if (m.capability.downloadLinks.length > 0) {
    flags.push({
      id: "executable-download",
      label: `${count(m.capability.downloadLinks.length, "link")} to a file that runs when opened`,
      section: "payload",
    });
  }

  const age = domainAgeDays(m, now);
  if (age !== undefined && age < NEW_DOMAIN_DAYS) {
    flags.push({
      id: "new-domain",
      label: `The domain was registered ${ago(age)}`,
      section: "identity",
    });
  }

  if (d.tlsAgeDays !== undefined && d.tlsAgeDays < NEW_CERTIFICATE_DAYS) {
    flags.push({
      id: "new-certificate",
      label: `The certificate was issued ${ago(d.tlsAgeDays)}`,
      section: "certs",
    });
  }

  if (d.maliciousRequestCount !== undefined && d.maliciousRequestCount > 0) {
    flags.push({
      id: "malicious-requests",
      label: `${count(d.maliciousRequestCount, "request")} went to a host already flagged`,
      section: "network",
    });
  }

  return flags;
}
