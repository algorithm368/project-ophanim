import type { DomainContext, SourceFinding, TiSource } from "../../types";
import { errorMessage, getJson, isTimeout } from "../../http";
import { parseDomain } from "../../../domain";
import {
  abuseContact,
  findEntityByRole,
  vcardField,
  type RdapVcardEntity,
} from "../../rdap-shared";

interface RdapEvent {
  eventAction?: string;
  eventDate?: string;
}

interface RdapResponse {
  events?: RdapEvent[];
  entities?: RdapVcardEntity[];
  nameservers?: { ldhName?: string }[];
  status?: string[];
  /** DNSSEC delegation posture from the registry. */
  secureDNS?: { delegationSigned?: boolean };
  errorCode?: number;
  title?: string;
}

export function eventDate(
  events: RdapEvent[] | undefined,
  action: string,
): string | undefined {
  return events?.find((e) => e.eventAction === action)?.eventDate;
}

export function registrarName(
  entities: RdapVcardEntity[] | undefined,
): string | undefined {
  return vcardField(findEntityByRole(entities, "registrar"), "fn");
}

function ageDays(createdAt: string | undefined): number | undefined {
  if (!createdAt) return undefined;
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return undefined;
  return Math.floor((Date.now() - created) / 86_400_000);
}

// Newly-registered domains are disproportionately used for abuse.
export function scoreForAge(age: number | undefined): number {
  if (age === undefined) return 0;
  if (age < 7) return 55;
  if (age < 30) return 40;
  if (age < 90) return 20;
  return 0;
}

/** RDAP registration data (rdap.org) - domain age, registrar, status (no key). */
/**
 * The registry's DNSSEC posture, as a word.
 *
 * Absent is not the same as unsigned: RDAP that never reported secureDNS tells
 * us nothing, while an explicit `false` is the registry saying the delegation
 * is unsigned. Both used to collapse into one nested ternary, and only one of
 * them is a finding.
 */
export function delegationStatus(
  signed: boolean | undefined,
): "signed" | "unsigned" | undefined {
  if (signed === undefined) return undefined;
  return signed ? "signed" : "unsigned";
}

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
      // Authoritative DNSSEC posture from the registry (the resolver's AD flag
      // is a weaker proxy); only set it when RDAP actually reports secureDNS.
      const dnssec = delegationStatus(data.secureDNS?.delegationSigned);
      const abuse = abuseContact(data.entities);

      const context: DomainContext = {
        registrar,
        createdAt,
        updatedAt,
        expiresAt,
        ageDays: age,
        statuses,
        nameservers,
        dnssec,
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
          dnssec,
          abuseContact: abuse?.email,
          abuseOrg: abuse?.org,
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
