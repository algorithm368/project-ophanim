import { ageMark, type Vital } from "@/lib/ti/identity";
import { parseIP } from "@/lib/ip";
import { hostFromUrl } from "@/lib/url";
import type { MergedIndicator } from "./merge";
import { domainAgeDays, type RedFlag } from "./red-flags";

/**
 * The scan's headline facts, as the passive page's vitals strip draws its own.
 *
 * Four fixed slots, in the order a reader asks about a visit: did it answer,
 * who served it, how new is its certificate, how new is its name. The last two
 * are the two ages the red flags are raised on, so a flag and the fact behind
 * it sit in the same place every time, and the slot turns red when it is one.
 * Hops are not a slot: the caption under the class already says how many there
 * were and from where.
 */
export function scanVitals(m: MergedIndicator, flags: RedFlag[], now: number): Vital[] {
  const raised = new Set(flags.map((f) => f.id));
  return [
    statusVital(m),
    serverVital(m),
    certificateVital(m, raised.has("new-certificate")),
    domainVital(m, now, raised.has("new-domain")),
  ];
}

function statusVital(m: MergedIndicator): Vital {
  const { httpStatus, mimeType } = m.detail;
  if (!httpStatus) return { key: "status", label: "Status", value: "None", sub: "no response recorded", absent: true };
  return { key: "status", label: "Status", value: httpStatus, sub: mimeType };
}

/** "AS13335": urlscan reports the prefix and Cloudflare does not. */
function asLabel(asn: string | undefined): string | undefined {
  return asn ? `AS${asn.replace(/^AS/i, "")}` : undefined;
}

function serverVital(m: MergedIndicator): Vital {
  const { server, asn, country } = m.detail;
  const sub = [asLabel(asn), country].filter(Boolean).join(", ") || undefined;
  if (!server) return { key: "server", label: "Server", value: "Unnamed", sub, absent: true };
  return { key: "server", label: "Server", value: server, sub };
}

function certificateVital(m: MergedIndicator, flagged: boolean): Vital {
  const { tlsAgeDays, tlsIssuer, tlsValidDays, finalUrl } = m.detail;
  if (tlsAgeDays === undefined) {
    const plain = finalUrl?.startsWith("http://");
    return {
      key: "certificate",
      label: "Certificate",
      value: plain ? "No TLS" : "Unknown",
      sub: plain ? "served over plain http" : "not reported",
      absent: true,
    };
  }
  const sub = [tlsIssuer && `issued by ${tlsIssuer}`, tlsValidDays && `valid ${tlsValidDays} days`]
    .filter(Boolean)
    .join(", ");
  return { key: "certificate", label: "Certificate", ...ageMark(tlsAgeDays), sub: sub || undefined, flagged };
}

/** The registration date as a date, when the engine gave one that parses. */
function registered(created: string | undefined): string | undefined {
  if (!created) return undefined;
  const at = Date.parse(created);
  return Number.isNaN(at) ? created : new Date(at).toISOString().slice(0, 10);
}

function domainVital(m: MergedIndicator, now: number, flagged: boolean): Vital {
  const host = m.detail.domain ?? hostFromUrl(m.detail.finalUrl ?? "");
  if (host && parseIP(host)) {
    return { key: "domain", label: "Domain", value: "None", sub: "a bare address, nothing registered", absent: true };
  }
  const age = domainAgeDays(m, now);
  const date = registered(m.detail.domainCreated);
  const sub = [date && `registered ${date}`, m.detail.registrar].filter(Boolean).join(", ") || undefined;
  if (age === undefined) return { key: "domain", label: "Domain", value: "Unknown", sub: sub ?? "no registration date", absent: true };
  return { key: "domain", label: "Domain", ...ageMark(age), sub, flagged };
}
