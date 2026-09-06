import type { Confidence, GeoResolution } from "../types";
import { countryKeyIndex, countryVoteKey } from "./geokit";

/** One resolved IP's own reconciled geo, already voted across providers
 *  (`reconcileGeoInputs`). This module votes a level up: across IPs. */
export interface IpGeoVote {
  ip: string;
  resolution: GeoResolution;
}

/** Below this, one IP's own provider vote is too thin to count toward where
 *  the domain is: a single non-corroborated provider should not get to swing
 *  the pin as hard as an IP three providers agreed on. */
const QUALIFYING_CONFIDENCE: Confidence[] = ["medium", "high"];

function tierFor(agreement: number): Confidence {
  if (agreement === 1) return "high";
  if (agreement > 0.5) return "medium";
  return "low";
}

interface CountryGroup {
  code?: string;
  name: string;
  ips: string[];
}

/**
 * Vote across a domain's consensus-resolved IPs for one pinned location, the
 * same shape (`GeoResolution`) a single IP gets from `reconcileGeoInputs` so
 * the rest of the app (Origin claim, flag, dissent note) never has to know
 * the difference. Each qualifying IP is one equal-weight vote; unlike the
 * provider-level vote, there is no reliability ranking between IPs, only
 * between how well-corroborated each IP's own answer was.
 *
 * Only country (+ city, when the winning IPs agree on one) is voted. ASN and
 * coordinates are properties of one IP, not of "the domain", and averaging
 * or picking among them across unrelated IPs would assert a precision this
 * vote does not have.
 */
export function voteAcrossIps(votes: IpGeoVote[]): GeoResolution | undefined {
  const qualifying = votes.filter((v) =>
    QUALIFYING_CONFIDENCE.includes(v.resolution.country?.confidence ?? "low"),
  );
  if (qualifying.length === 0) return undefined;

  const index = countryKeyIndex(
    qualifying.map((v) => ({
      code: v.resolution.countryCode,
      name: v.resolution.country?.value,
    })),
  );

  const groups = new Map<string, CountryGroup>();
  for (const v of qualifying) {
    const key = countryVoteKey(
      { countryCode: v.resolution.countryCode, country: v.resolution.country?.value },
      index,
    );
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) {
      existing.ips.push(v.ip);
      // A code-only IP and a name-only IP fill in each other's blank, same as
      // the provider-level country vote, so the winner reads as a full name
      // even when whichever IP happened to be seen first only had a code.
      existing.name ||= v.resolution.country?.value ?? "";
      existing.code ||= v.resolution.countryCode;
    } else {
      groups.set(key, {
        code: v.resolution.countryCode,
        name: v.resolution.country?.value ?? "",
        ips: [v.ip],
      });
    }
  }
  if (groups.size === 0) return undefined;

  const ranked = [...groups.values()].sort((a, b) => b.ips.length - a.ips.length);
  const [winner, ...losers] = ranked;
  const agreement = winner.ips.length / qualifying.length;
  const confidence = tierFor(agreement);

  const country: GeoResolution["country"] = {
    value: winner.name || winner.code || "",
    confidence,
    score: agreement,
    agreement,
    sources: winner.ips,
    ...(losers.length
      ? { alternatives: losers.map((l) => ({ value: l.name || l.code || "", sources: l.ips })) }
      : {}),
  };

  // City is asserted only when every IP behind the winning country also
  // agreed on the same city; a CDN split across the same country's regions
  // should not get flattened into a single arbitrary city.
  const winningCities = new Set(
    qualifying
      .filter((v) => winner.ips.includes(v.ip))
      .map((v) => v.resolution.city?.value)
      .filter((c): c is string => Boolean(c)),
  );
  const city: GeoResolution["city"] =
    winningCities.size === 1
      ? {
          value: [...winningCities][0],
          confidence,
          score: agreement,
          agreement,
          sources: winner.ips,
        }
      : undefined;

  return {
    country,
    countryCode: winner.code || undefined,
    city,
    flags: { isHosting: false, isProxy: false, isMobile: false, sources: {} },
    // Voters, not providers: how many resolved IPs made it into this vote.
    providerCount: qualifying.length,
  };
}
