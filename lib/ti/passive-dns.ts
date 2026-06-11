import type { PassiveDnsRecord, SourceFinding, TiSource } from "./types";
import { errorMessage, getJson, isTimeout } from "./http";

/** One row of mnemonic's passive-DNS `data` array. */
export interface MnemonicPdnsRow {
  query?: string;
  answer?: string;
  rrtype?: string;
  firstSeenTimestamp?: number;
  lastSeenTimestamp?: number;
}

interface MnemonicPdnsResponse {
  data?: MnemonicPdnsRow[];
}

function isoFromMs(ms?: number): string | undefined {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString();
}

/**
 * Map mnemonic passive-DNS rows to normalized records. For a domain lookup the
 * resolutions are the answers (A/AAAA → IPs, CNAME → canonical host); for an IP
 * lookup they are the query names (the domains that resolved to the IP).
 */
export function parseMnemonicPdns(
  rows: MnemonicPdnsRow[],
  lookup: "ip" | "domain",
): PassiveDnsRecord[] {
  const out: PassiveDnsRecord[] = [];
  for (const r of rows) {
    const rr = (r.rrtype ?? "").toLowerCase();
    let value: string | undefined;
    let type: "ip" | "domain" | undefined;

    if (lookup === "domain") {
      if (rr === "a" || rr === "aaaa") {
        value = r.answer;
        type = "ip";
      } else if (rr === "cname") {
        value = r.answer;
        type = "domain";
      }
    } else if (rr === "a" || rr === "aaaa") {
      // IP lookup: the query name is a domain that resolved to this IP.
      value = r.query;
      type = "domain";
    }

    if (!value || !type) continue;
    out.push({
      value,
      type,
      firstSeen: isoFromMs(r.firstSeenTimestamp),
      lastSeen: isoFromMs(r.lastSeenTimestamp),
      recordType: rr ? rr.toUpperCase() : undefined,
    });
  }
  return out;
}

/**
 * Build a mnemonic passive-DNS source (api.mnemonic.no, no key). Context-only
 * (weight 0): it never moves the verdict, it just contributes historical
 * IP<->domain resolutions. Chosen over OTX passive DNS, which reliably exceeds a
 * 12s timeout.
 */
export function makeMnemonicPassiveDnsSource(opts: {
  id: string;
  lookup: "ip" | "domain";
}): TiSource {
  return {
    meta: {
      id: opts.id,
      name: "mnemonic (passive DNS)",
      url: "https://www.mnemonic.io",
      category: "context",
      requiresKey: false,
      weight: 0,
      timeoutMs: 12000,
    },
    isEnabled: () => true,
    async check(indicator, signal): Promise<SourceFinding> {
      try {
        const { ok, status, data } = await getJson<MnemonicPdnsResponse>(
          `https://api.mnemonic.no/pdns/v3/${encodeURIComponent(indicator)}?limit=200`,
          signal,
          { Accept: "application/json" },
        );
        if (status === 429) {
          return { status: "rate_limited", error: "mnemonic rate limit" };
        }
        if (!ok || !data) {
          return { status: "error", error: `HTTP ${status}` };
        }
        const passiveDns = parseMnemonicPdns(data.data ?? [], opts.lookup);
        if (passiveDns.length === 0) {
          return { status: "ok", summary: "No passive-DNS records" };
        }
        return {
          status: "ok",
          score: 0,
          summary: `${passiveDns.length} passive-DNS resolution${passiveDns.length === 1 ? "" : "s"}`,
          passiveDns,
        };
      } catch (err) {
        return {
          status: isTimeout(err) ? "timeout" : "error",
          error: errorMessage(err),
        };
      }
    },
  };
}
