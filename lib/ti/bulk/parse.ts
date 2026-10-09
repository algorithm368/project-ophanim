import { detectIOC, refangIOC } from "@/lib/ioc";
import { parseIP } from "@/lib/ip";
import { parseDomain } from "@/lib/domain";
import { isInternalName } from "./internal";
import type { BulkKind, InvalidInput } from "./types";

export const WEB_CAP = 1000;

export interface BulkItem {
  indicator: string;
  kind: BulkKind;
  display?: string;
  note?: string;
  internal?: boolean;
}

export interface ParsedBulk {
  items: BulkItem[];
  invalid: InvalidInput[];
  duplicates: number;
}

type Checked = { item: BulkItem } | { reason: string };

const CIDR = /^[0-9a-f:.]+\/\d{1,3}$/i;
const SINGLE_LABEL = /^[a-z][a-z0-9-]*$/i;
const LEADING_ZERO = /(^|\.)0\d/;

// Anything that would make the URL parser read a path, port, user or query
// instead of the whole token as a host.
const NOT_HOST = /[/?#@:\\%]/;

/** Punycode for a Unicode name. The WHATWG URL parser does the same IDNA
 *  mapping as `domainToASCII` from `node:url`, and unlike it also runs in the
 *  browser, where the /bulk page previews a paste. A token the parser refuses
 *  comes back lowercased and still non-ASCII, so it is reported as not an IP
 *  or domain. */
function toAscii(value: string): string {
  if (!/[^\x00-\x7f]/.test(value)) return value;
  const lower = value.toLowerCase();
  if (NOT_HOST.test(lower)) return lower;
  try {
    return new URL(`http://${lower}`).hostname;
  } catch {
    return lower;
  }
}

function checkIp(value: string): Checked {
  const ip = parseIP(value);
  if (!ip || ip.isPrivate || ip.isReserved) return { reason: `Non-routable address, ${ip?.scopeNote ?? "reserved"}` };
  const item: BulkItem = { indicator: ip.ip, kind: "ip" };
  if (LEADING_ZERO.test(value)) item.note = `Read as ${ip.ip}, written with leading zeros`;
  return { item };
}

function checkDomain(value: string, original: string): Checked {
  const d = parseDomain(value);
  if (!d || d.isReserved) return { reason: `Special-use domain, ${d?.scopeNote ?? "reserved"}` };
  const item: BulkItem = { indicator: d.domain, kind: "domain" };
  if (original !== value) item.display = original;
  if (isInternalName(d.domain)) item.internal = true;
  return { item };
}

function check(token: string): Checked {
  const refanged = refangIOC(token);
  if (CIDR.test(refanged)) return { reason: "CIDR range, not expanded" };
  const value = toAscii(refanged);
  const kind = detectIOC(value);
  if (kind === "hash" || kind === "url") return { reason: `Not supported in bulk, ${kind}` };
  if (kind === "ip") return checkIp(value);
  if (kind === "domain") return checkDomain(value, refanged);
  if (SINGLE_LABEL.test(value)) return { item: { indicator: value.toLowerCase(), kind: "domain", internal: true } };
  return { reason: "Not an IP or domain" };
}

export function parseBulkInput(text: string): ParsedBulk {
  const out: ParsedBulk = { items: [], invalid: [], duplicates: 0 };
  const seen = new Set<string>();
  for (const token of text.split(/[\s,;]+/).filter(Boolean)) {
    const checked = check(token);
    if ("reason" in checked) {
      out.invalid.push({ input: token, reason: checked.reason });
      continue;
    }
    const key = `${checked.item.kind}:${checked.item.indicator.toLowerCase()}`;
    if (seen.has(key)) {
      out.duplicates++;
      continue;
    }
    seen.add(key);
    out.items.push(checked.item);
  }
  return out;
}

export function invalidSummary(invalid: InvalidInput[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { reason } of invalid) {
    const head = reason.split(",")[0];
    out[head] = (out[head] ?? 0) + 1;
  }
  return out;
}
