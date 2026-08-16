import { errorMessage, getJson, isTimeout } from "../../http";
import { byCodeUnit } from "../../sort";
import type {
  ResearchCert,
  ResearchData,
  ResearchFinding,
  ResearchProvider,
} from "../types";
import { count } from "@/lib/text";

/** Default number of certificates to surface. */
const MAX_CERTS = 12;
/** Cap on listed subdomains so a sprawling cert history stays readable. */
const MAX_SUBDOMAINS = 30;

type CrtshData = Extract<ResearchData, { type: "crtsh" }>;

interface CrtshEntry {
  issuer_name?: string;
  common_name?: string;
  name_value?: string;
  not_before?: string;
  not_after?: string;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/** Parse a crt.sh JSON response into cert records + discovered subdomains.
 *  Subdomains are gathered from every cert's SAN list (name_value), lowercased,
 *  deduped, and limited to hosts under the queried domain. Pure. */
export function parseCrtsh(
  payload: unknown,
  domain: string,
  limit = MAX_CERTS,
): Omit<CrtshData, "type"> {
  if (!Array.isArray(payload)) return { certs: [], subdomains: [] };

  const apex = domain.toLowerCase();
  const suffix = `.${apex}`;
  const subdomains = new Set<string>();
  const certs: ResearchCert[] = [];

  for (const entry of payload as CrtshEntry[]) {
    for (const name of (entry?.name_value ?? "").split("\n")) {
      const host = name.trim().toLowerCase();
      if (host.includes("*")) continue;
      if (host !== apex && host.endsWith(suffix)) subdomains.add(host);
    }
    if (certs.length < limit) {
      certs.push({
        issuer: str(entry?.issuer_name) ?? "Unknown CA",
        commonName: str(entry?.common_name),
        notBefore: str(entry?.not_before),
        notAfter: str(entry?.not_after),
      });
    }
  }

  return {
    certs,
    subdomains: [...subdomains].sort(byCodeUnit).slice(0, MAX_SUBDOMAINS),
  };
}

/** crt.sh certificate-transparency search (no key). Surfaces the cert history
 *  and the subdomains those certs reveal for a domain. crt.sh is slow (~15s is
 *  normal) and intermittently 404s / returns HTML under load, so we give it a
 *  roomy budget, retry once, and treat a non-JSON body as "nothing found"
 *  rather than a hard error (the CertSpotter scored source already covers
 *  certs). The bare query is used deliberately: the exclude=expired /
 *  deduplicate filters push work onto crt.sh's database and make it *slower*. */
export const crtshProvider: ResearchProvider = {
  meta: {
    id: "crtsh",
    name: "crt.sh",
    url: "https://crt.sh",
    timeoutMs: 20000,
  },
  supports: ["domain"],
  isEnabled: () => true,
  async check(indicator, _kind, signal): Promise<ResearchFinding> {
    const url = `https://crt.sh/?q=${encodeURIComponent(indicator)}&output=json`;
    try {
      let ok = false;
      let data: unknown = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await getJson<unknown>(url, signal);
        ok = res.ok;
        data = res.data;
        // ok with parseable JSON, or a definitive empty — stop. Retry only the
        // flaky failures (5xx / 404 / HTML body that parsed to null).
        if (ok && data !== null) break;
        if (res.status >= 400 && res.status < 500 && res.status !== 404) break;
      }

      const parsed = parseCrtsh(data, indicator);
      if (parsed.certs.length === 0) {
        return { status: "empty", summary: "No certificates found" };
      }
      const subs = parsed.subdomains.length;
      const subdomainPart = subs ? `, ${count(subs, "subdomain")}` : "";
      return {
        status: "ok",
        summary: `${parsed.certs.length} certs${subdomainPart}`,
        link: `https://crt.sh/?q=${encodeURIComponent(indicator)}`,
        data: { type: "crtsh", ...parsed },
      };
    } catch (err) {
      return {
        status: isTimeout(err) ? "timeout" : "error",
        error: errorMessage(err),
      };
    }
  },
};
