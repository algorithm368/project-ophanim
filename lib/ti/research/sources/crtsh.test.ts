import { afterEach, describe, expect, it, vi } from "vitest";
import { crtshProvider, parseCrtsh } from "./crtsh";
import { getJson } from "../../http";

vi.mock("../../http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../http")>();
  return { ...actual, getJson: vi.fn() };
});


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

describe("parseCrtsh — sparse entries", () => {
  it("tolerates null entries and missing fields", () => {
    expect(parseCrtsh([null, {}], "a.example")).toEqual({
      certs: [
        { issuer: "Unknown CA", commonName: undefined, notBefore: undefined, notAfter: undefined },
        { issuer: "Unknown CA", commonName: undefined, notBefore: undefined, notAfter: undefined },
      ],
      subdomains: [],
    });
  });
});

describe("crtshProvider.check", () => {
  const signal = new AbortController().signal;
  const res = (data: unknown, status = 200) => ({ ok: status < 400, status, data, text: "" });
  afterEach(() => vi.mocked(getJson).mockReset());

  it("needs no key", () => expect(crtshProvider.isEnabled()).toBe(true));

  it("summarizes certs and subdomains", async () => {
    vi.mocked(getJson).mockResolvedValue(
      res([{ name_value: "www.a.example", issuer_name: "CA" }]),
    );
    const f = await crtshProvider.check("a.example", "domain", signal);
    expect(f.summary).toBe("1 certs, 1 subdomain");
    expect(f.link).toBe("https://crt.sh/?q=a.example");
    expect(getJson).toHaveBeenCalledTimes(1);
  });

  it("omits the subdomain count when there are none", async () => {
    vi.mocked(getJson).mockResolvedValue(res([{ name_value: "a.example" }]));
    expect((await crtshProvider.check("a.example", "domain", signal)).summary).toBe("1 certs");
  });

  it("retries a flaky failure once, then reports nothing found", async () => {
    vi.mocked(getJson).mockResolvedValueOnce(res(null, 502)).mockResolvedValueOnce(res(null));
    expect((await crtshProvider.check("a.example", "domain", signal)).status).toBe("empty");
    expect(getJson).toHaveBeenCalledTimes(2);
  });

  it("does not retry a definitive client error", async () => {
    vi.mocked(getJson).mockResolvedValue(res(null, 400));
    expect((await crtshProvider.check("a.example", "domain", signal)).status).toBe("empty");
    expect(getJson).toHaveBeenCalledTimes(1);
  });

  it("maps timeouts and errors", async () => {
    vi.mocked(getJson).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await crtshProvider.check("a.example", "domain", signal)).status).toBe("timeout");
    vi.mocked(getJson).mockRejectedValue(new Error("boom"));
    expect((await crtshProvider.check("a.example", "domain", signal)).error).toBe("boom");
  });
});
