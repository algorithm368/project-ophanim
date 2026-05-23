export interface ParsedIPv4 {
  ip: string;
  octets: [number, number, number, number];
  isPrivate: boolean;
  isReserved: boolean;
  /** Why the address can't be meaningfully checked against TI feeds. */
  scopeNote?: string;
}

const IPV4_RE =
  /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

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
  let isPrivate = false;
  let isReserved = false;
  let scopeNote: string | undefined;

  if (a === 10) {
    isPrivate = true;
    scopeNote = "Private network (RFC 1918)";
  } else if (a === 172 && b >= 16 && b <= 31) {
    isPrivate = true;
    scopeNote = "Private network (RFC 1918)";
  } else if (a === 192 && b === 168) {
    isPrivate = true;
    scopeNote = "Private network (RFC 1918)";
  } else if (a === 127) {
    isReserved = true;
    scopeNote = "Loopback (RFC 1122)";
  } else if (a === 169 && b === 254) {
    isReserved = true;
    scopeNote = "Link-local (RFC 3927)";
  } else if (a === 100 && b >= 64 && b <= 127) {
    isReserved = true;
    scopeNote = "Carrier-grade NAT (RFC 6598)";
  } else if (a === 0) {
    isReserved = true;
    scopeNote = "This network (RFC 1122)";
  } else if (a >= 224) {
    isReserved = true;
    scopeNote = a >= 240 ? "Reserved (RFC 1112)" : "Multicast (RFC 5771)";
  }

  return {
    ip: octets.join("."),
    octets,
    isPrivate,
    isReserved,
    scopeNote,
  };
}

/** Reverse the octets for DNSBL queries: 1.2.3.4 -> 4.3.2.1 */
export function reverseOctets(ip: string): string {
  return ip.split(".").reverse().join(".");
}
