import type { DohResponse } from "./doh";

/** Strip surrounding quotes and concatenate split TXT chunks. */
function cleanTxt(txt: string): string {
  return txt.replace(/^"|"$/g, "").replace(/"\s+"/g, "");
}

export function extractSpf(txt: string[]): string | undefined {
  return txt.map(cleanTxt).find((t) => t.toLowerCase().startsWith("v=spf1"));
}

export function extractDmarc(txt: string[]): string | undefined {
  return txt.map(cleanTxt).find((t) => t.toLowerCase().startsWith("v=dmarc1"));
}

/** "10 mail.example.com" -> "mail.example.com". */
export function normalizeMxHosts(mx: string[]): string[] {
  return mx.map((m) => m.split(/\s+/).pop() ?? m);
}

/**
 * Decode a CAA record into "<tag> <value>" form (e.g. "issue pki.goog").
 * Cloudflare's JSON DoH returns CAA as RFC 3597 generic data ("\# <len> <hex>");
 * decode that. Records already in textual form (e.g. `0 issue "x"`) are
 * returned unchanged, as is anything that fails to parse.
 */
export function decodeCaa(record: string): string {
  const m = /^\\#\s+\d+\s+([0-9a-fA-F\s]+)$/.exec(record);
  if (!m) return record;
  const bytes = m[1]
    .trim()
    .split(/\s+/)
    .map((h) => Number.parseInt(h, 16));
  // Every element must be a real byte. NaN is covered by isInteger, and the
  // upper bound matters because String.fromCodePoint below throws on values
  // above 0x10FFFF where the old fromCharCode silently truncated them.
  if (bytes.length < 2 || bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255))
    return record;
  const tagLen = bytes[1];
  const tag = String.fromCodePoint(...bytes.slice(2, 2 + tagLen));
  const value = String.fromCodePoint(...bytes.slice(2 + tagLen));
  const decoded = `${tag} ${value}`.trim();
  return decoded || record;
}

export function dnssecStatus(
  responses: (DohResponse | null)[],
): "signed" | "unsigned" | "unknown" {
  const answered = responses.filter((r): r is DohResponse => r != null);
  if (answered.length === 0) return "unknown";
  return answered.some((r) => r.AD === true) ? "signed" : "unsigned";
}
