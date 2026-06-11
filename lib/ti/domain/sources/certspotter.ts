import type {
  CertificateRecord,
  SourceFinding,
  TiSource,
} from "../../types";
import { errorMessage, getJson, isTimeout } from "../../http";
import { parseDomain } from "../../../domain";

interface CertspotterIssuance {
  dns_names?: string[];
  issuer?: { friendly_name?: string; name?: string };
  not_before?: string;
  not_after?: string;
}

// Cap how many issuances we parse so a shared cert with a huge SAN list (or a
// busy apex) can't pin the event loop.
const MAX_ENTRIES = 5000;

/** Pull a readable issuer label (organization, else common name) from a full DN. */
export function issuerLabel(dn: string | undefined): string {
  if (!dn) return "Unknown CA";
  const o = /O=([^,]+)/.exec(dn)?.[1]?.trim();
  if (o) return o.replace(/^"|"$/g, "");
  const cn = /CN=([^,]+)/.exec(dn)?.[1]?.trim();
  return cn ?? dn;
}

/** Parse Cert Spotter issuances into normalized certificate records + subdomains. */
export function parseCertspotter(
  issuances: CertspotterIssuance[],
  apex: string,
): { certificates: CertificateRecord[]; subdomains: string[] } {
  const apexLc = apex.toLowerCase();
  const certificates: CertificateRecord[] = [];
  const subdomains = new Set<string>();

  for (const c of issuances.slice(0, MAX_ENTRIES)) {
    const names = (c.dns_names ?? [])
      .map((n) => n.trim().toLowerCase())
      .filter(Boolean);

    for (const raw of names) {
      // Strip wildcard prefix; keep names under the apex, drop the bare apex.
      const name = raw.replace(/^\*\./, "").trim();
      if (!name || name === apexLc) continue;
      if (name.endsWith(`.${apexLc}`)) subdomains.add(name);
    }

    const sans = [...new Set(names)];
    const commonName =
      sans.find((n) => n === apexLc || n.endsWith(`.${apexLc}`)) ?? sans[0];

    certificates.push({
      issuer: c.issuer?.friendly_name?.trim() || issuerLabel(c.issuer?.name),
      commonName,
      sans,
      firstSeen: c.not_before,
      notAfter: c.not_after,
    });
  }

  return { certificates, subdomains: [...subdomains] };
}

/**
 * Certificate-transparency lookup via Cert Spotter (SSLMate). Context-only
 * (weight 0): never moves the verdict, just surfaces observed certificates and
 * the subdomains derived from their SAN lists. No key required; an optional
 * `CERTSPOTTER_API_KEY` raises the unauthenticated rate limit when present.
 * (Chosen over crt.sh, which is frequently slow or 502s.)
 */
export const certSpotterSource: TiSource = {
  meta: {
    id: "certspotter",
    name: "Cert Spotter (CT logs)",
    url: "https://sslmate.com/certspotter",
    category: "context",
    requiresKey: false,
    weight: 0,
    timeoutMs: 12000,
  },
  isEnabled: () => true,
  async check(domain, signal): Promise<SourceFinding> {
    const apex = parseDomain(domain)?.registrable ?? domain;
    const key = process.env.CERTSPOTTER_API_KEY;
    try {
      const { ok, status, data } = await getJson<CertspotterIssuance[]>(
        `https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(apex)}&include_subdomains=true&expand=dns_names&expand=issuer`,
        signal,
        key ? { Authorization: `Bearer ${key}` } : {},
      );
      if (status === 429) {
        return { status: "rate_limited", error: "Cert Spotter rate limit" };
      }
      if (!ok || !Array.isArray(data)) {
        return { status: "error", error: `HTTP ${status}` };
      }
      if (data.length === 0) {
        return { status: "ok", summary: "No certificate-transparency records" };
      }

      const { certificates, subdomains } = parseCertspotter(data, apex);
      const summary =
        `${certificates.length} certificate${certificates.length === 1 ? "" : "s"} in CT logs` +
        (subdomains.length
          ? `, ${subdomains.length} subdomain${subdomains.length === 1 ? "" : "s"}`
          : "");

      return {
        status: "ok",
        score: 0,
        summary,
        certificates,
        subdomains,
      };
    } catch (err) {
      return {
        status: isTimeout(err) ? "timeout" : "error",
        error: errorMessage(err),
      };
    }
  },
};
