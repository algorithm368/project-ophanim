import type { Confidence, GeoResolution } from "../types";
import { countryKeyIndex, countryVoteKey } from "./geokit";
import { byCodeUnit } from "../sort";

/** One resolved IP's own reconciled geo, already voted across providers
 *  (`reconcileGeoInputs`). This module votes a level up: across IPs. */
export interface IpGeoVote {
  ip: string;
  resolution: GeoResolution;
}

/** Below this, one IP's own provider vote is too thin to count toward where
 *  the domain is: a single non-corroborated provider should not get to swing
 *  the pin as hard as an IP three providers agreed on. */
const QUALIFYING_CONFIDENCE: ReadonlySet<Confidence> = new Set(["medium", "high"]);

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

/** One IP's vote, once it has qualified: it has a country, so a name. */
interface Ballot {
  ip: string;
  code?: string;
  name: string;
  city?: string;
}

/** A group's display name. Never empty: a ballot with neither a code nor a
 *  name has no key, so it never forms a group. */
function labelOf(group: CountryGroup): string {
  return group.name || (group.code as string);
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
  const qualifying: Ballot[] = votes.flatMap(({ ip, resolution: r }) =>
    r.country && QUALIFYING_CONFIDENCE.has(r.country.confidence)
      ? [{ ip, code: r.countryCode, name: r.country.value, city: r.city?.value }]
      : [],
  );
  if (qualifying.length === 0) return undefined;

  const index = countryKeyIndex(qualifying.map((b) => ({ code: b.code, name: b.name })));

  const groups = new Map<string, CountryGroup>();
  for (const b of qualifying) {
    const key = countryVoteKey({ countryCode: b.code, country: b.name }, index);
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) {
      existing.ips.push(b.ip);
      // A code-only IP and a name-only IP fill in each other's blank, same as
      // the provider-level country vote, so the winner reads as a full name
      // even when whichever IP happened to be seen first only had a code.
      existing.name ||= b.name;
      existing.code ||= b.code;
    } else {
      groups.set(key, { code: b.code, name: b.name, ips: [b.ip] });
    }
  }
  if (groups.size === 0) return undefined;

  // Tie-broken by the group's own key, not left to arrive-order: a bare
  // count comparator returns 0 on a tie, and Array.sort's stability then just
  // preserves whatever order `votes` happened to arrive in — which can shift
  // between checks of the same domain as DNS answer order rotates.
  const ranked = [...groups.entries()]
    .sort(([keyA, a], [keyB, b]) => b.ips.length - a.ips.length || byCodeUnit(keyA, keyB))
    .map(([, group]) => group);
  const [winner, ...losers] = ranked;
  const agreement = winner.ips.length / qualifying.length;
  const confidence = tierFor(agreement);

  const country: GeoResolution["country"] = {
    value: labelOf(winner),
    confidence,
    score: agreement,
    agreement,
    sources: winner.ips,
    ...(losers.length
      ? { alternatives: losers.map((l) => ({ value: labelOf(l), sources: l.ips })) }
      : {}),
  };

  // City is asserted only when every IP behind the winning country also
  // agreed on the same city; a CDN split across the same country's regions
  // should not get flattened into a single arbitrary city. Dropping missing
  // values before comparing would let one silent IP (no city reported at
  // all) pass as agreement rather than break it, so the raw per-IP values —
  // undefined included — are what unanimity is checked against.
  const winnerCityValues = qualifying
    .filter((b) => winner.ips.includes(b.ip))
    .map((b) => b.city);
  const firstCity = winnerCityValues[0];
  const unanimousCity =
    firstCity !== undefined && winnerCityValues.every((c) => c === firstCity);
  const city: GeoResolution["city"] = unanimousCity
    ? {
        value: firstCity,
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
