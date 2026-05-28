import type { DomainContext, SourceFinding, TiSource } from "../../types";
import { errorMessage, getJson, isTimeout } from "../../http";
import { parseDomain } from "../../../domain";

interface RdapEvent {
  eventAction?: string;
  eventDate?: string;
}

interface RdapVcard {
  vcardArray?: [string, unknown[]];
}

interface RdapEntity extends RdapVcard {
  roles?: string[];
}

interface RdapResponse {
  events?: RdapEvent[];
  entities?: RdapEntity[];
  nameservers?: { ldhName?: string }[];
  status?: string[];
  errorCode?: number;
  title?: string;
}

function eventDate(events: RdapEvent[] | undefined, action: string): string | undefined {
  return events?.find((e) => e.eventAction === action)?.eventDate;
}

function registrarName(entities: RdapEntity[] | undefined): string | undefined {
  const reg = entities?.find((e) => e.roles?.includes("registrar"));
  const vcard = reg?.vcardArray?.[1];
  if (!Array.isArray(vcard)) return undefined;
  for (const entry of vcard) {
    if (Array.isArray(entry) && entry[0] === "fn" && typeof entry[3] === "string") {
      return entry[3];
    }
  }
  return undefined;
}

function ageDays(createdAt: string | undefined): number | undefined {
  if (!createdAt) return undefined;
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return undefined;
  return Math.floor((Date.now() - created) / 86_400_000);
}

// Newly-registered domains are disproportionately used for abuse.
function scoreForAge(age: number | undefined): number {
  if (age === undefined) return 0;
  if (age < 7) return 55;
  if (age < 30) return 40;
  if (age < 90) return 20;
  return 0;
}

/** RDAP registration data (rdap.org) - domain age, registrar, status (no key). */
export const rdapSource: TiSource = {
  meta: {
    id: "rdap",
    name: "RDAP / WHOIS",
    url: "https://rdap.org",
    category: "context",
    requiresKey: false,
    // Age is a soft signal, not authoritative - low weight.
    weight: 0.4,
  },
  isEnabled: () => true,
  async check(domain, signal): Promise<SourceFinding> {
    const registrable = parseDomain(domain)?.registrable ?? domain;
    try {
      const { ok, status, data } = await getJson<RdapResponse>(
        `https://rdap.org/domain/${registrable}`,
        signal,
      );
      if (status === 404) {
        return { status: "ok", score: 0, summary: "No RDAP record found" };
      }
      if (!ok || !data) {
        return { status: "error", error: data?.title ?? `HTTP ${status}` };
      }

      const createdAt = eventDate(data.events, "registration");
      const updatedAt = eventDate(data.events, "last changed");
      const expiresAt = eventDate(data.events, "expiration");
      const age = ageDays(createdAt);
      const registrar = registrarName(data.entities);
      const nameservers = (data.nameservers ?? [])
        .map((n) => n.ldhName?.toLowerCase())
        .filter((n): n is string => Boolean(n));
      const statuses = data.status ?? [];

      const context: DomainContext = {
        registrar,
        createdAt,
        updatedAt,
        expiresAt,
        ageDays: age,
        statuses,
        nameservers,
      };

      const score = scoreForAge(age);
      // Registry holds usually mean the domain was suspended (often for abuse).
      const onHold = statuses.some((s) => /hold|pendingDelete/i.test(s));

      let summary: string;
      if (age !== undefined) {
        const label =
          age < 30
            ? `Registered ${age} day(s) ago, newly created`
            : `Registered ${Math.floor(age / 365) || "<1"} year(s) ago`;
        summary = registrar ? `${label}, via ${registrar}` : label;
      } else {
        summary = registrar ? `Registered via ${registrar}` : "Registration data available";
      }

      return {
        status: "ok",
        score: Math.max(score, onHold ? 35 : 0),
        categories: onHold ? ["registry-hold"] : [],
        summary,
        domainContext: context,
        details: {
          registrar,
          createdAt,
          updatedAt,
          expiresAt,
          ageDays: age,
          statuses,
          nameservers,
        },
        raw: data,
      };
    } catch (err) {
      return {
        status: isTimeout(err) ? "timeout" : "error",
        error: errorMessage(err),
      };
    }
  },
};
