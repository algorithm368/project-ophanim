import { Resolver } from "node:dns/promises";
import type { SourceFinding, TiSource } from "../types";
import { reverseOctets } from "../../ip";

interface Zone {
  zone: string;
  name: string;
}

// Public DNSBLs queryable over plain DNS without an account.
const ZONES: Zone[] = [
  { zone: "zen.spamhaus.org", name: "Spamhaus ZEN" },
  { zone: "bl.spamcop.net", name: "SpamCop" },
  { zone: "b.barracudacentral.org", name: "Barracuda" },
  { zone: "dnsbl.dronebl.org", name: "DroneBL" },
  { zone: "dnsbl-1.uceprotect.net", name: "UCEPROTECT-1" },
  { zone: "all.s5h.net", name: "s5h.net" },
];

type ZoneState = "listed" | "clean" | "blocked" | "error";

interface ZoneResult {
  name: string;
  zone: string;
  state: ZoneState;
  codes?: string[];
}

// 127.255.255.x is used by several DNSBLs to signal "query blocked / rate limited",
// not an actual listing of the target IP.
function isBlockedCode(addr: string): boolean {
  return addr.startsWith("127.255.255.");
}

async function queryZone(
  reversed: string,
  zone: Zone,
  timeoutMs: number,
): Promise<ZoneResult> {
  const resolver = new Resolver({ timeout: timeoutMs, tries: 1 });
  try {
    const addrs = await resolver.resolve4(`${reversed}.${zone.zone}`);
    if (addrs.length === 0) {
      return { name: zone.name, zone: zone.zone, state: "clean" };
    }
    if (addrs.every(isBlockedCode)) {
      return { name: zone.name, zone: zone.zone, state: "blocked" };
    }
    return {
      name: zone.name,
      zone: zone.zone,
      state: "listed",
      codes: addrs.filter((a) => !isBlockedCode(a)),
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // Not listed: the hostname simply doesn't exist.
    if (code === "ENOTFOUND" || code === "ENODATA") {
      return { name: zone.name, zone: zone.zone, state: "clean" };
    }
    return { name: zone.name, zone: zone.zone, state: "error" };
  }
}

/** DNS blocklist lookups across several public zones (no key). */
export const dnsblSource: TiSource = {
  meta: {
    id: "dnsbl",
    name: "DNS Blocklists",
    url: "https://www.spamhaus.org",
    category: "dnsbl",
    requiresKey: false,
    // Spam-reputation feeds are a weaker signal than malware/abuse feeds, and
    // some public zones (e.g. UCEPROTECT) list broadly - keep their pull modest.
    weight: 0.5,
  },
  isEnabled: () => true,
  async check(ip): Promise<SourceFinding> {
    const reversed = reverseOctets(ip);
    // node:dns has no AbortSignal support; bound each zone with its own timeout.
    const results = await Promise.all(
      ZONES.map((z) => queryZone(reversed, z, 3500)),
    );

    const listed = results.filter((r) => r.state === "listed");
    const blocked = results.filter((r) => r.state === "blocked");
    const errored = results.filter((r) => r.state === "error");
    const checked = ZONES.length - blocked.length - errored.length;

    // Each listing adds risk, but a single noisy listing shouldn't dominate -
    // confidence comes from consensus across independent zones.
    const score =
      listed.length > 0
        ? Math.min(90, 20 + (listed.length - 1) * 18)
        : 0;

    let summary: string;
    if (listed.length > 0) {
      summary = `Listed on ${listed.length} blocklist(s): ${listed
        .map((r) => r.name)
        .join(", ")}`;
    } else if (checked > 0) {
      summary = `Not listed on ${checked} blocklist(s)`;
    } else {
      summary = "All blocklist queries were blocked or failed";
    }

    return {
      status: checked === 0 ? "error" : "ok",
      error: checked === 0 ? "No blocklist could be queried" : undefined,
      // Only a strong multi-zone consensus is a hard "malicious" call.
      malicious: listed.length >= 3,
      score,
      categories: listed.map((r) => r.name),
      summary,
      details: {
        listedOn: listed.map((r) => `${r.name} (${r.codes?.join(", ")})`),
        checked,
        blocked: blocked.map((r) => r.name),
        errored: errored.map((r) => r.name),
        zones: results,
      },
      raw: results,
    };
  },
};
