import { describe, expect, it } from "vitest";
import { parseCrtsh } from "./crtsh";

describe("parseCrtsh", () => {
  const payload = [
    {
      issuer_name: "C=US, O=Let's Encrypt, CN=R3",
      common_name: "evil.com",
      name_value: "evil.com\nwww.evil.com\n*.evil.com",
      not_before: "2021-06-01T00:00:00",
      not_after: "2021-09-01T00:00:00",
    },
    {
      issuer_name: "C=US, O=DigiCert",
      common_name: "mail.evil.com",
      name_value: "mail.evil.com\nWWW.EVIL.COM",
      not_before: "2022-01-01T00:00:00",
      not_after: "2022-04-01T00:00:00",
    },
  ];

  it("maps certificate records", () => {
    const { certs } = parseCrtsh(payload, "evil.com");
    expect(certs[0]).toEqual({
      issuer: "C=US, O=Let's Encrypt, CN=R3",
      commonName: "evil.com",
      notBefore: "2021-06-01T00:00:00",
      notAfter: "2021-09-01T00:00:00",
    });
    expect(certs).toHaveLength(2);
  });

  it("collects unique subdomains, lowercased and sorted, excluding apex and wildcards", () => {
    const { subdomains } = parseCrtsh(payload, "evil.com");
    expect(subdomains).toEqual(["mail.evil.com", "www.evil.com"]);
  });

  it("caps the number of certs returned", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      issuer_name: "CA",
      name_value: `h${i}.evil.com`,
    }));
    expect(parseCrtsh(many, "evil.com", 10).certs).toHaveLength(10);
  });

  it("returns empties for a malformed payload", () => {
    expect(parseCrtsh(null, "evil.com")).toEqual({ certs: [], subdomains: [] });
    expect(parseCrtsh({}, "evil.com")).toEqual({ certs: [], subdomains: [] });
  });
});
