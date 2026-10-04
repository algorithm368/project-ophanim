export interface ParsedDomain {
  /** Normalized hostname: lowercased, scheme/path/port stripped. */
  domain: string;
  /** Best-effort registrable domain (eTLD+1), used for WHOIS/RDAP lookups. */
  registrable: string;
  labels: string[];
  /** True for special-use names that can't be meaningfully checked against TI. */
  isReserved: boolean;
  /** Why a reserved name can't be checked. */
  scopeNote?: string;
}

// RFC 2606 / RFC 6761 special-use TLDs that never point at real infrastructure.
const RESERVED_TLDS: Record<string, string> = {
  test: "Reserved for testing (RFC 2606)",
  example: "Reserved for documentation (RFC 2606)",
  invalid: "Reserved as invalid (RFC 2606)",
  localhost: "Loopback name (RFC 6761)",
  local: "mDNS local name (RFC 6762)",
  onion: "Tor hidden service (RFC 7686)",
  internal: "Reserved for private use",
};

// RFC 2606 documentation second-level domains.
const RESERVED_DOMAINS: Record<string, string> = {
  "example.com": "Reserved for documentation (RFC 2606)",
  "example.net": "Reserved for documentation (RFC 2606)",
  "example.org": "Reserved for documentation (RFC 2606)",
};

function reservedNote(labels: string[], registrable: string): string | undefined {
  const tld = labels.at(-1)!;
  return RESERVED_TLDS[tld] ?? RESERVED_DOMAINS[registrable];
}

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
// Label: 1-63 chars, alphanumeric + hyphen, no leading/trailing hyphen.
const LABEL_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

// Common two-level public suffixes, so we keep three labels for e.g. bbc.co.uk.
const MULTI_TLDS = new Set([
  "co.uk", "org.uk", "gov.uk", "ac.uk", "me.uk", "ltd.uk", "plc.uk",
  "co.th", "in.th", "ac.th", "go.th", "or.th", "net.th",
  "com.au", "net.au", "org.au", "edu.au", "gov.au",
  "co.nz", "net.nz", "org.nz",
  "co.jp", "ne.jp", "or.jp", "go.jp",
  "com.br", "com.cn", "com.sg", "com.mx", "com.tr", "com.tw", "com.hk",
  "co.kr", "co.in", "co.za", "co.id", "com.my", "com.ph", "com.vn",
]);

/**
 * Parse and validate a domain name. Accepts bare hostnames or pasted URLs
 * (scheme/path/port are stripped). Returns null for IPs or anything that
 * isn't a syntactically valid registrable hostname.
 */
export function parseDomain(input: string): ParsedDomain | null {
  let value = input.trim().toLowerCase();
  if (!value) return null;

  // Pull the hostname out of anything URL-shaped.
  if (value.includes("/") || value.includes("://") || value.includes("@")) {
    try {
      const withScheme = value.includes("://") ? value : `http://${value}`;
      value = new URL(withScheme).hostname;
    } catch {
      value = value.split("/")[0];
    }
  }

  // Strip a trailing root dot and any :port.
  value = value.replace(/\.$/, "").split(":")[0];
  if (!value) return null;

  // Reject IP literals - those belong in the IP checker.
  if (IPV4_RE.test(value) || value.includes(":")) return null;

  const labels = value.split(".");
  if (labels.length < 2) return null;
  if (!labels.every((l) => LABEL_RE.test(l))) return null;

  // split() never returns an empty list, so there is always a last label.
  const tld = labels.at(-1)!;
  if (!/^[a-z]{2,}$/.test(tld) && !tld.startsWith("xn--")) return null;

  const lastTwo = labels.slice(-2).join(".");
  const registrable =
    labels.length >= 3 && MULTI_TLDS.has(lastTwo)
      ? labels.slice(-3).join(".")
      : lastTwo;

  const scopeNote = reservedNote(labels, registrable);

  return {
    domain: value,
    registrable,
    labels,
    isReserved: Boolean(scopeNote),
    scopeNote,
  };
}
