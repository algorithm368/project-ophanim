import { classifyCategory, type ThreatType } from "./threat-type";
import type { SourceResult, Verdict } from "./types";

/**
 * The band a positively identified research scanner is capped at.
 *
 * This is a policy, and it is worth being explicit about what it decides.
 *
 * `71.6.146.185` is one of Shodan's census hosts. It says so in its own PTR
 * record, `pirate.census.shodan.io`. VirusTotal and AbuseIPDB both assert
 * `malicious` on it, and they are not wrong: it does connect to every routable
 * address on the internet, and the 1365 AbuseIPDB reports behind that number
 * are real people reporting real port scans.
 *
 * So the evidence is sound and the word is still wrong. "Malicious" asserts
 * intent to harm, and an operator that publishes its ranges, names its hosts
 * after itself and runs an opt-out page is not concealing anything. Reading
 * "malicious" there costs the tool its credibility on the first address an
 * analyst recognises, and it teaches them to discount the verdict everywhere
 * else.
 *
 * "Suspicious" keeps the address in front of the analyst, keeps it blockable,
 * and stops short of a claim the evidence does not support. What the analyst
 * does about Shodan is their policy, and the card now carries what they need to
 * decide: the operator's name, the threat type, and the confidence.
 *
 * Deliberately narrow. It requires a positive identification, not an absence of
 * evidence, so it can only fire on an address that named itself. A scanner that
 * also runs a C2 keeps its floor and its malicious verdict, because the cap is
 * lifted the moment a source reports something other than scanning.
 */
export const SCANNER_CAP: Verdict = "suspicious";

/** Sources whose categories identify what an address is, not what it did. */
const IDENTIFIERS = new Set(["scanner-id", "greynoise"]);

/** Categories that describe scanning rather than an attack. */
const SCAN_CATEGORIES = new Set([
  "internet-scanner",
  "research-scanner",
  "port scan",
  "benign",
]);

/**
 * Threat types that outrank a scanner identification.
 *
 * Deliberately not "any category that is not a scan category". Abuse reports
 * are filed by whoever was scanned, using their own judgement of what happened,
 * and the reports behind 71.6.146.185 are categorised "Brute-Force" and
 * "Hacking" by people describing a port scan. Reading those as evidence of
 * something beyond scanning lifts the cap on exactly the address it exists for.
 *
 * These four come from malware feeds rather than victim reports: Feodo,
 * ThreatFox and URLhaus assert them about infrastructure they have observed
 * serving something, which is a different claim from "this connected to me".
 */
const BEYOND_SCANNING: ThreatType[] = ["c2", "malware", "ransomware", "phishing"];

/** Only asked of sources that answered: applyScannerPolicy filters first. */
function reportsMoreThanScanning(s: SourceResult): boolean {
  return (s.categories ?? []).some((c) => {
    const type = classifyCategory(c);
    return type !== undefined && BEYOND_SCANNING.includes(type);
  });
}

/** True when a source positively identified this address as a research scanner. */
export function isIdentifiedScanner(sources: SourceResult[]): boolean {
  return sources.some(
    (s) =>
      s.status === "ok" &&
      IDENTIFIERS.has(s.source.id) &&
      s.allowlisted === true &&
      (s.categories ?? []).some((c) =>
        SCAN_CATEGORIES.has(c.trim().toLowerCase()),
      ),
  );
}

/**
 * Hold an identified research scanner at `suspicious`.
 *
 * The score is untouched, as with the corroboration rule in `aggregateRisk`:
 * this is a statement about what the evidence supports calling the address, not
 * about how much of it there is.
 */
export function applyScannerPolicy(
  verdict: Verdict,
  sources: SourceResult[],
): { verdict: Verdict; capped: boolean } {
  if (verdict !== "malicious" || !isIdentifiedScanner(sources)) {
    return { verdict, capped: false };
  }
  // Anything reported beyond scanning lifts the cap: a scanner that also serves
  // malware is not being described by "scanner".
  const flagging = sources.filter(
    (s) => s.status === "ok" && (s.malicious === true || (s.score ?? 0) >= 40),
  );
  if (flagging.some(reportsMoreThanScanning)) {
    return { verdict, capped: false };
  }
  return { verdict: SCANNER_CAP, capped: true };
}
