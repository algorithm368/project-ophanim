import { describe, it, expect } from "vitest";
import { cloudProvider } from "@/lib/ti/cloud";

describe("cloudProvider", () => {
  it("maps a known cloud ASN (numeric or ASxxxx) to its provider", () => {
    expect(cloudProvider("AS16509")?.name).toBe("Amazon Web Services");
    expect(cloudProvider("13335")?.name).toBe("Cloudflare");
    expect(cloudProvider("AS14061")?.name).toBe("DigitalOcean");
  });

  it("returns undefined for a non-cloud ASN and for missing input", () => {
    expect(cloudProvider("AS49447")).toBeUndefined();
    expect(cloudProvider(undefined)).toBeUndefined();
  });

  it("falls back to an org-name match when the ASN is unknown", () => {
    expect(cloudProvider("AS99999", "AMAZON-02, US")?.name).toBe(
      "Amazon Web Services",
    );
  });

  it("matches the ASN table when geo.asn carries the COMBINED 'AS#### ORG' form", () => {
    // ip-api maps its `as` field straight into geo.asn, so this is the shape
    // the table has to work against in production, not just a bare "AS####".
    expect(cloudProvider("AS15169 GOOGLE")?.name).toBe("Google Cloud");
    expect(
      cloudProvider("AS63949 AKAMAI-LINODE-AP Akamai Connected Cloud")?.name,
    ).toBe("Akamai (Linode)");
    expect(cloudProvider("AS54113 FASTLY")?.name).toBe("Fastly");
  });
});
