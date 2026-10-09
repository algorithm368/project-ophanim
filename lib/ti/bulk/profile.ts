import type { TiSource } from "../types";
import { sources } from "../registry";
import { domainSources } from "../domain/registry";
import { sourceWeight } from "../weight";
import { parseIP } from "@/lib/ip";
import { METERED_IDS, type Bucket, type BulkKind, type MeteredId, type MeteredKeyEnv } from "./types";

/** Sources that can set `allowlisted`. They feed computeFloor's vouch count
 *  even at weight 0, so dropping one would change a score. */
export const VOUCHING_IDS: ReadonlySet<string> = new Set(["scanner-id", "tranco", "abuseipdb", "greynoise"]);

/** Whole-feed downloads that answer per IP from memory: free at any scale. */
export const PASS0_IDS: ReadonlySet<string> = new Set(["feodo", "et-open", "ipsum", "spamhaus-drop"]);

const METERED: ReadonlySet<string> = new Set(METERED_IDS);

export function isMetered(id: string): id is MeteredId {
  return METERED.has(id);
}

export function registryFor(kind: BulkKind): TiSource[] {
  return kind === "ip" ? sources : domainSources;
}

/** A source is left out of bulk only when it cannot move aggregateRisk. */
export function inBulkProfile(source: TiSource): boolean {
  return sourceWeight(source.meta) > 0 || VOUCHING_IDS.has(source.meta.id);
}

export function familyOf(kind: BulkKind, indicator: string): 4 | 6 {
  return kind === "ip" ? (parseIP(indicator)?.version ?? 4) : 4;
}

// Same rule as checkIp's supportsFamily: unset means IPv4 only. Restated here
// rather than imported from ../check, which imports the quota ledger.
const supports = (s: TiSource, family: 4 | 6) => (s.meta.families ?? [4]).includes(family);

export function pass1Sources(kind: BulkKind, family: 4 | 6 = 4): TiSource[] {
  return registryFor(kind).filter(
    (s) => inBulkProfile(s) && !isMetered(s.meta.id) && (kind === "domain" || supports(s, family)),
  );
}

export function pass0Sources(family: 4 | 6): TiSource[] {
  return sources.filter((s) => PASS0_IDS.has(s.meta.id) && supports(s, family));
}

// VirusTotal (500 a day, 4 a minute) and GreyNoise (50 a day) are too small to
// spend on a list, so bulk leaves them to /check. A bulk row that reads "full"
// has had every source bulk asks, which is these and the free ones.
// A quiet IP's blind spot is fresh brute force and scanning, which AbuseIPDB
// sees first.
const IP_ORDER: MeteredId[] = ["abuseipdb", "otx"];
const DOMAIN_ORDER: MeteredId[] = ["safebrowsing"];

/** The key pools pass 2 can spend, which is all the quota strip shows. */
export const PASS2_KEY_ENVS: readonly MeteredKeyEnv[] = ["ABUSEIPDB_API_KEY", "OTX_API_KEY", "GOOGLE_SAFE_BROWSING_API_KEY"];

const ORDER: Record<BulkKind, Record<Bucket, MeteredId[]>> = {
  ip: { A: IP_ORDER, B: IP_ORDER, C: IP_ORDER, D: [] },
  domain: { A: DOMAIN_ORDER, B: DOMAIN_ORDER, C: DOMAIN_ORDER, D: [] },
};

export function pass2Ids(kind: BulkKind, bucket: Bucket): MeteredId[] {
  return [...ORDER[kind][bucket]];
}

export function sourceById(kind: BulkKind, id: string): TiSource | undefined {
  return registryFor(kind).find((s) => s.meta.id === id);
}
