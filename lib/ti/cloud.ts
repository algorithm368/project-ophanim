import { canonicalAsn } from "./geo/geokit";

/** Major cloud/hosting providers keyed by AS number. Extend as needed; this is
 *  a zero-network lookup on the ASN we already resolved via geo. */
const CLOUD_BY_ASN: Record<number, string> = {
  16509: "Amazon Web Services",
  14618: "Amazon Web Services",
  15169: "Google Cloud",
  396982: "Google Cloud",
  8075: "Microsoft Azure",
  13335: "Cloudflare",
  14061: "DigitalOcean",
  31898: "Oracle Cloud",
  63949: "Akamai (Linode)",
  24940: "Hetzner",
  16276: "OVHcloud",
  20473: "Vultr",
  12876: "Scaleway",
  45102: "Alibaba Cloud",
  37963: "Alibaba Cloud",
  54113: "Fastly",
  60781: "Leaseweb",
  51167: "Contabo",
};

/** Substring markers on the ASN org name, for ASNs not in the table above. */
const CLOUD_BY_ORG: [RegExp, string][] = [
  // `aws` needs word boundaries: without them it matches mid-word and labels
  // unrelated networks as Amazon (jAWSon, strAWSon, hAWSley). Every other entry
  // here is a distinctive full word, so only this one is ambiguous.
  [/amazon|\baws\b/i, "Amazon Web Services"],
  [/google/i, "Google Cloud"],
  [/microsoft|azure/i, "Microsoft Azure"],
  [/cloudflare/i, "Cloudflare"],
  [/digitalocean/i, "DigitalOcean"],
  [/oracle/i, "Oracle Cloud"],
  [/hetzner/i, "Hetzner"],
  [/\bovh\b/i, "OVHcloud"],
  [/vultr|choopa/i, "Vultr"],
];

/** Identify the cloud/hosting provider behind an IP from its ASN (preferred) or
 *  ASN org name. Returns undefined when it is not a recognized provider. */
export function cloudProvider(
  asn?: string,
  org?: string,
): { name: string } | undefined {
  if (asn) {
    // geo.asn is frequently the COMBINED "AS15169 GOOGLE" form (ip-api maps its
    // `as` field straight through), so pull just the leading digits rather than
    // `Number()`-parsing the whole string, which yields NaN on that shape.
    const canon = canonicalAsn(asn);
    const n = canon ? Number(canon.slice(2)) : Number.NaN;
    if (Number.isFinite(n) && CLOUD_BY_ASN[n]) {
      return { name: CLOUD_BY_ASN[n] };
    }
  }
  if (org) {
    for (const [re, name] of CLOUD_BY_ORG) {
      if (re.test(org)) return { name };
    }
  }
  return undefined;
}
