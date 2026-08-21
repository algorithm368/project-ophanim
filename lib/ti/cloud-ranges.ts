import { getJson, getText } from "./http";

/** A provider's published prefix, with whatever detail they publish alongside. */
export interface CloudPrefix {
  cidr: string;
  provider: string;
  region?: string;
  service?: string;
}

export interface CloudMatch {
  provider: string;
  region?: string;
  service?: string;
  cidr: string;
}

interface AwsRanges {
  prefixes?: { ip_prefix?: string; region?: string; service?: string }[];
}

interface GcpRanges {
  prefixes?: { ipv4Prefix?: string; service?: string; scope?: string }[];
}

const AWS_URL = "https://ip-ranges.amazonaws.com/ip-ranges.json";
const GCP_URL = "https://www.gstatic.com/ipranges/cloud.json";
const CLOUDFLARE_URL = "https://www.cloudflare.com/ips-v4";

// Providers publish these on a schedule measured in hours, and the cost of a
// stale entry is a slightly wrong label, so the refresh is lazy and generous.
const TTL_MS = 12 * 60 * 60 * 1000;

/** IPv4 dotted-quad to a 32-bit unsigned integer, or null when it will not parse. */
export function ipv4ToInt(ip: string): number | null {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** Whether an IPv4 address falls inside a CIDR block. */
export function inCidr(ip: string, cidr: string): boolean {
  const [network, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const target = ipv4ToInt(ip);
  const base = ipv4ToInt(network);
  if (target === null || base === null) return false;
  if (bits === 0) return true;
  // Shifting by 32 is a no-op in JS, hence the guard above.
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (target & mask) >>> 0 === (base & mask) >>> 0;
}

/** First prefix containing the address. Linear, which is fine at ~10k entries. */
export function matchPrefix(ip: string, prefixes: CloudPrefix[]): CloudMatch | undefined {
  let best: CloudPrefix | undefined;
  let bestBits = -1;
  for (const prefix of prefixes) {
    if (!inCidr(ip, prefix.cidr)) continue;
    // Prefer the most specific match: AWS publishes a broad AMAZON prefix and
    // narrower per-service ones covering the same space, and the narrow one is
    // the informative answer.
    const bits = Number(prefix.cidr.split("/")[1]);
    if (bits > bestBits) {
      bestBits = bits;
      best = prefix;
    }
  }
  return best ? { ...best } : undefined;
}

export function parseAws(data: AwsRanges): CloudPrefix[] {
  return (data.prefixes ?? [])
    .filter((p) => p.ip_prefix)
    .map((p) => ({
      cidr: p.ip_prefix as string,
      provider: "Amazon Web Services",
      region: p.region && p.region !== "GLOBAL" ? p.region : undefined,
      // "AMAZON" is the catch-all that covers every other service, so it says
      // nothing that the provider name has not already said.
      service: p.service && p.service !== "AMAZON" ? p.service : undefined,
    }));
}

export function parseGcp(data: GcpRanges): CloudPrefix[] {
  return (data.prefixes ?? [])
    .filter((p) => p.ipv4Prefix)
    .map((p) => ({
      cidr: p.ipv4Prefix as string,
      provider: "Google Cloud",
      region: p.scope && p.scope !== "global" ? p.scope : undefined,
      service: p.service,
    }));
}

export function parseCloudflare(text: string): CloudPrefix[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("/"))
    .map((cidr) => ({ cidr, provider: "Cloudflare" }));
}

let cache: { prefixes: CloudPrefix[]; fetchedAt: number } | null = null;
let inflight: Promise<CloudPrefix[]> | null = null;

/**
 * The published prefix set, refreshed at most twice a day.
 *
 * Each provider is fetched independently and a failure drops only that
 * provider: a partial answer is a correct answer about the providers that did
 * respond, and the ASN table in `cloud.ts` still covers the rest.
 */
export async function cloudPrefixes(signal: AbortSignal): Promise<CloudPrefix[]> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache.prefixes;
  if (inflight) return inflight;

  inflight = (async () => {
    const [aws, gcp, cloudflare] = await Promise.allSettled([
      getJson<AwsRanges>(AWS_URL, signal),
      getJson<GcpRanges>(GCP_URL, signal),
      getText(CLOUDFLARE_URL, signal),
    ]);

    const prefixes: CloudPrefix[] = [];
    if (aws.status === "fulfilled" && aws.value.ok && aws.value.data) {
      prefixes.push(...parseAws(aws.value.data));
    }
    if (gcp.status === "fulfilled" && gcp.value.ok && gcp.value.data) {
      prefixes.push(...parseGcp(gcp.value.data));
    }
    if (cloudflare.status === "fulfilled" && cloudflare.value.ok) {
      prefixes.push(...parseCloudflare(cloudflare.value.text ?? ""));
    }

    // Only cache a useful answer, so a total outage retries on the next lookup
    // instead of pinning an empty set for twelve hours.
    if (prefixes.length > 0) cache = { prefixes, fetchedAt: Date.now() };
    return prefixes;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** Reset the module cache. Tests only. */
export function resetCloudPrefixCache(): void {
  cache = null;
}
