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

/** True when every non-empty answer set is identical (order-insensitive). */
export function resolversAgree(answerSets: string[][]): boolean {
  const nonEmpty = answerSets.filter((s) => s.length > 0);
  if (nonEmpty.length < 2) return true;
  const canon = (s: string[]) => [...s].sort().join(",");
  const first = canon(nonEmpty[0]);
  return nonEmpty.every((s) => canon(s) === first);
}

export function dnssecStatus(
  responses: (DohResponse | null)[],
): "signed" | "unsigned" | "unknown" {
  const answered = responses.filter((r): r is DohResponse => r != null);
  if (answered.length === 0) return "unknown";
  return answered.some((r) => r.AD === true) ? "signed" : "unsigned";
}
