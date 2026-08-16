export interface ParsedIPv4 {
  ip: string;
  version: 4;
  octets: [number, number, number, number];
  isPrivate: boolean;
  isReserved: boolean;
  /** Why the address can't be meaningfully checked against TI feeds. */
  scopeNote?: string;
}

const IPV4_RE =
  /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * The IPv4 ranges a TI lookup cannot say anything useful about, as a table
 * rather than an if/else chain: every entry answers the same two questions
 * (which kind of non-routable is it, and what do we tell the analyst), so the
 * shared answer is written once per range instead of once per branch. The three
 * RFC 1918 blocks in particular are one range with three prefixes, and reading
 * as three identical branches only invited them to drift apart.
 *
 * Order is match order, and the last two entries depend on it: 240/4 is carved
 * out of the 224-and-above space, so it has to be tested first.
 */
const SPECIAL_IPV4_RANGES: readonly {
  covers: (a: number, b: number) => boolean;
  scope: "private" | "reserved";
  note: string;
}[] = [
  {
    covers: (a, b) =>
      a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168),
    scope: "private",
    note: "Private network (RFC 1918)",
  },
  { covers: (a) => a === 127, scope: "reserved", note: "Loopback (RFC 1122)" },
  {
    covers: (a, b) => a === 169 && b === 254,
    scope: "reserved",
    note: "Link-local (RFC 3927)",
  },
  {
    covers: (a, b) => a === 100 && b >= 64 && b <= 127,
    scope: "reserved",
    note: "Carrier-grade NAT (RFC 6598)",
  },
  { covers: (a) => a === 0, scope: "reserved", note: "This network (RFC 1122)" },
  { covers: (a) => a >= 240, scope: "reserved", note: "Reserved (RFC 1112)" },
  { covers: (a) => a >= 224, scope: "reserved", note: "Multicast (RFC 5771)" },
];

export function parseIPv4(input: string): ParsedIPv4 | null {
  const value = input.trim();
  const m = IPV4_RE.exec(value);
  if (!m) return null;

  const octets = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] as [
    number,
    number,
    number,
    number,
  ];
  if (octets.some((o) => o < 0 || o > 255)) return null;

  const [a, b] = octets;
  const range = SPECIAL_IPV4_RANGES.find((r) => r.covers(a, b));

  return {
    ip: octets.join("."),
    version: 4,
    octets,
    isPrivate: range?.scope === "private",
    isReserved: range?.scope === "reserved",
    scopeNote: range?.note,
  };
}

/** Reverse the octets for DNSBL queries: 1.2.3.4 -> 4.3.2.1 */
export function reverseOctets(ip: string): string {
  return ip.split(".").reverse().join(".");
}

export interface ParsedIPv6 {
  /** Canonical RFC 5952 form (lowercase, zero-compressed). */
  ip: string;
  version: 6;
  isPrivate: boolean;
  isReserved: boolean;
  /** Why the address can't be meaningfully checked against TI feeds. */
  scopeNote?: string;
}

export type ParsedIP = ParsedIPv4 | ParsedIPv6;

/** Expand an IPv6 string to its 8 hextet numbers, or null if malformed. */
function expandIPv6(input: string): number[] | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  // Reject zone IDs (fe80::1%eth0) — not meaningful for geolocation.
  if (s.includes("%")) return null;

  // Fold an embedded IPv4 tail (::ffff:1.2.3.4) into two hextets.
  if (s.includes(".")) {
    const lastColon = s.lastIndexOf(":");
    if (lastColon < 0) return null;
    const v4 = parseIPv4(s.slice(lastColon + 1));
    if (!v4) return null;
    const [a, b, c, d] = v4.octets;
    s =
      s.slice(0, lastColon + 1) +
      ((a << 8) | b).toString(16) +
      ":" +
      ((c << 8) | d).toString(16);
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;

  const parseGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    for (const g of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(Number.parseInt(g, 16));
    }
    return out;
  };

  if (halves.length === 2) {
    const head = parseGroups(halves[0]);
    const tail = parseGroups(halves[1]);
    if (!head || !tail) return null;
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null; // "::" must stand for at least one zero group
    return [...head, ...new Array(missing).fill(0), ...tail];
  }

  const groups = parseGroups(s);
  if (groups?.length !== 8) return null;
  return groups;
}

/** Compress the 8 hextets to canonical RFC 5952 text. */
function canonicalizeIPv6(groups: number[]): string {
  const hex = groups.map((g) => g.toString(16));
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let i = 0; i < 8; i++) {
    if (groups[i] === 0) {
      if (curStart < 0) curStart = i;
      curLen = i - curStart + 1;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }
  if (bestLen < 2) return hex.join(":");
  const head = hex.slice(0, bestStart).join(":");
  const tail = hex.slice(bestStart + bestLen).join(":");
  return `${head}::${tail}`;
}

/** Classify an IPv6 address's scope from its hextets. */
function ipv6Scope(groups: number[]): {
  isPrivate: boolean;
  isReserved: boolean;
  scopeNote?: string;
} {
  const g0 = groups[0];
  const headZero = groups.slice(0, 7).every((g) => g === 0);
  if (headZero && groups[7] === 1)
    return { isPrivate: false, isReserved: true, scopeNote: "Loopback (RFC 4291)" };
  if (groups.every((g) => g === 0))
    return {
      isPrivate: false,
      isReserved: true,
      scopeNote: "Unspecified address (RFC 4291)",
    };
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff)
    return { isPrivate: false, isReserved: true, scopeNote: "IPv4-mapped (RFC 4291)" };
  if ((g0 & 0xffc0) === 0xfe80)
    return { isPrivate: false, isReserved: true, scopeNote: "Link-local (RFC 4291)" };
  if ((g0 & 0xfe00) === 0xfc00)
    return { isPrivate: true, isReserved: false, scopeNote: "Unique local (RFC 4193)" };
  if (g0 === 0x2001 && groups[1] === 0x0db8)
    return { isPrivate: false, isReserved: true, scopeNote: "Documentation (RFC 3849)" };
  if ((g0 & 0xff00) === 0xff00)
    return { isPrivate: false, isReserved: true, scopeNote: "Multicast (RFC 4291)" };
  return { isPrivate: false, isReserved: false };
}

/** The 8 hextets of an IPv6 address as numbers, or null if malformed. Exposed
 *  for callers that need to do bit arithmetic (CIDR containment, ip6.arpa)
 *  rather than re-parse the canonical string. */
export function ipv6Groups(input: string): number[] | null {
  return expandIPv6(input);
}

/** Parse and validate an IPv6 address, canonicalized with scope detection. */
export function parseIPv6(input: string): ParsedIPv6 | null {
  const groups = expandIPv6(input);
  if (!groups) return null;
  return {
    ip: canonicalizeIPv6(groups),
    version: 6,
    ...ipv6Scope(groups),
  };
}

/** Parse an IP of either family: IPv4 first, then IPv6. */
export function parseIP(input: string): ParsedIP | null {
  return parseIPv4(input) ?? parseIPv6(input);
}
