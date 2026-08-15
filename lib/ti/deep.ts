import { byCodeUnit } from "./sort";
import type {
  CertificateRecord,
  PassiveDnsRecord,
  SourceResult,
} from "./types";

// Bound the deep-context arrays so a noisy provider (crt.sh can return thousands
// of certs for a popular apex) can't bloat the cached/streamed payload.
const MAX_CERTS = 60;
const MAX_SUBDOMAINS = 250;
const MAX_PDNS = 150;

/** Earliest of two ISO timestamps (either may be undefined). */
function earliest(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

/** Latest of two ISO timestamps (either may be undefined). */
function latest(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function okSources(results: SourceResult[]): SourceResult[] {
  return results.filter((r) => r.status === "ok");
}

/**
 * Union of certificate-transparency records across sources, deduped by a stable
 * identity (issuer + expiry + common name), newest expiry first.
 */
export function collectCertificates(
  results: SourceResult[],
): CertificateRecord[] | undefined {
  const all = okSources(results).flatMap((r) => r.certificates ?? []);
  if (all.length === 0) return undefined;

  const seen = new Set<string>();
  const out: CertificateRecord[] = [];
  for (const c of all) {
    const key = `${c.issuer}|${c.notAfter ?? ""}|${c.commonName ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  out.sort((a, b) => (b.notAfter ?? "").localeCompare(a.notAfter ?? ""));
  return out.slice(0, MAX_CERTS);
}

/** Union of discovered subdomains across sources, lowercased, deduped, sorted. */
export function collectSubdomains(
  results: SourceResult[],
): string[] | undefined {
  const all = okSources(results).flatMap((r) => r.subdomains ?? []);
  if (all.length === 0) return undefined;

  const uniq = [
    ...new Set(all.map((s) => s.trim().toLowerCase()).filter(Boolean)),
  ];
  uniq.sort(byCodeUnit);
  return uniq.slice(0, MAX_SUBDOMAINS);
}

/**
 * Union of passive-DNS resolutions across sources, deduped by type+value with
 * the widest first/last-seen window merged in, newest last-seen first.
 */
export function collectPassiveDns(
  results: SourceResult[],
): PassiveDnsRecord[] | undefined {
  const all = okSources(results).flatMap((r) => r.passiveDns ?? []);
  if (all.length === 0) return undefined;

  const byKey = new Map<string, PassiveDnsRecord>();
  for (const rec of all) {
    const value = rec.value.trim().toLowerCase();
    if (!value) continue;
    const key = `${rec.type}|${value}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...rec, value });
    } else {
      byKey.set(key, {
        ...prev,
        firstSeen: earliest(prev.firstSeen, rec.firstSeen),
        lastSeen: latest(prev.lastSeen, rec.lastSeen),
        recordType: prev.recordType ?? rec.recordType,
      });
    }
  }
  const out = [...byKey.values()];
  out.sort((a, b) => (b.lastSeen ?? "").localeCompare(a.lastSeen ?? ""));
  return out.slice(0, MAX_PDNS);
}
