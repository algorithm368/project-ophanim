import { describe, expect, it } from "vitest";
import { distillCloudflareResult } from "@/lib/ti/url/active/cloudflare-detail";

/** Shaped after a real Cloudflare result, inventoried 2026-08-15. */
const CF = {
  page: {
    url: "https://arwana855jp.com/",
    title: "403 Forbidden",
    status: "403",
    server: "cloudflare",
    ip: "104.21.17.202",
    asn: "13335",
    asnname: "CLOUDFLARENET",
    country: "United States",
    domain: "arwana855jp.com",
    apexDomain: "arwana855jp.com",
    tlsIssuer: "",
    tlsAgeDays: 1,
    tlsValidDays: 365,
    domStructHash: "ebc3889a75f4",
    history: [
      { url: "https://arwana855jp.com/", statusCode: 301 },
      { url: "https://arwana855jp.com/blocked", statusCode: 403 },
    ],
  },
  verdicts: { overall: { malicious: false, categories: [], tags: [] } },
  lists: {
    domains: ["arwana855jp.com"],
    ips: ["104.21.17.202"],
    certificates: [],
  },
  data: { requests: [{}, {}], cookies: [], console: [], links: [] },
  stats: { securePercentage: 100, malicious: 0 },
  task: { uuid: "cf-1", status: "finished" },
  meta: {
    processors: {
      whois: {
        data: {
          registrar: "Dynadot Inc",
          created_date: "2026-08-15T11:32:58.000Z",
          expiration_date: "2027-08-15T11:32:58.000Z",
          nameservers: ["ALEC.NS.CLOUDFLARE.COM"],
        },
      },
      domainCategories: {
        data: [
          {
            name: "arwana855jp.com",
            isPrimary: true,
            risks: [{ name: "Newly Seen Domains" }, { name: "Security Risks" }],
            // The feed emits the super category alongside each child, so
            // "Gambling" arrives twice for a two-category site.
            content: [
              { id: 99, super_category_id: 12, name: "Gambling" },
              { id: 12, name: "Gambling" },
              { id: 155, super_category_id: 26, name: "Technology" },
            ],
            inherited: {},
          },
          { name: "static.cloudflareinsights.com", isPrimary: false },
        ],
      },
      radarRank: {
        data: [{ hostname: "arwana855jp.com", rank: null, bucket: ">200000" }],
      },
      dns: { data: [{ name: "arwana855jp.com", type: "A", dnssec_valid: false }] },
      robotsTxt: {
        data: [{ sitemaps: ["https://arwana855silver.com/sitemap.xml"] }],
      },
    },
  },
};

describe("distillCloudflareResult", () => {
  it("derives the redirect chain from page.history, which has no data.redirects", () => {
    const d = distillCloudflareResult(CF);
    expect(d.redirects).toEqual([
      {
        from: "https://arwana855jp.com/",
        to: "https://arwana855jp.com/blocked",
        status: 301,
      },
    ]);
  });

  it("reports no redirect when history holds a single entry", () => {
    const d = distillCloudflareResult({
      ...CF,
      page: { ...CF.page, history: [{ url: "https://x.test/", statusCode: 200 }] },
    });
    expect(d.redirects).toEqual([]);
  });

  it("carries WHOIS, which urlscan has no equivalent for", () => {
    const d = distillCloudflareResult(CF);
    expect(d.registrar).toBe("Dynadot Inc");
    expect(d.domainCreated).toBe("2026-08-15T11:32:58.000Z");
    expect(d.nameservers).toContain("ALEC.NS.CLOUDFLARE.COM");
  });

  it("takes risk categories from the primary domain only", () => {
    // A third-party asset's categories say nothing about the page under test.
    const d = distillCloudflareResult(CF);
    expect(d.riskCategories).toEqual(["Newly Seen Domains", "Security Risks"]);
  });

  it("takes the site's content categories, without repeating a super category", () => {
    const d = distillCloudflareResult(CF);
    expect(d.contentCategories).toEqual(["Gambling", "Technology"]);
    expect(d.categoryInheritedFrom).toBeUndefined();
  });

  it("falls back to the parent's categories, naming the parent", () => {
    // Verified live: blog.cloudflare.com carries none of its own and inherits
    // "Technology" from cloudflare.com.
    const d = distillCloudflareResult({
      ...CF,
      meta: {
        processors: {
          domainCategories: {
            data: [
              {
                name: "blog.cloudflare.com",
                isPrimary: true,
                inherited: {
                  from: "cloudflare.com",
                  content: [
                    { id: 155, super_category_id: 26, name: "Technology" },
                    { id: 26, name: "Technology" },
                  ],
                },
              },
            ],
          },
        },
      },
    });
    expect(d.contentCategories).toEqual(["Technology"]);
    expect(d.categoryInheritedFrom).toBe("cloudflare.com");
  });

  it("leaves an uncategorized domain unset rather than categorized as nothing", () => {
    const d = distillCloudflareResult({
      ...CF,
      meta: {
        processors: {
          domainCategories: {
            data: [{ name: "x.test", isPrimary: true, content: [], inherited: {} }],
          },
        },
      },
    });
    expect(d.contentCategories).toBeUndefined();
    expect(d.riskCategories).toBeUndefined();
  });

  it("keeps the radar rank bucket and the DOM structure hash", () => {
    const d = distillCloudflareResult(CF);
    expect(d.radarRankBucket).toBe(">200000");
    expect(d.domStructHash).toBe("ebc3889a75f4");
  });

  it("reads sibling domains out of the robots.txt sitemaps", () => {
    const d = distillCloudflareResult(CF);
    expect(d.siblingDomains).toEqual(["arwana855silver.com"]);
  });

  it("omits a sitemap host that is just the scanned domain again", () => {
    const d = distillCloudflareResult({
      ...CF,
      meta: {
        processors: {
          ...CF.meta.processors,
          robotsTxt: {
            data: [{ sitemaps: ["https://arwana855jp.com/sitemap.xml"] }],
          },
        },
      },
    });
    expect(d.siblingDomains).toEqual([]);
  });

  it("records DNSSEC validity", () => {
    expect(distillCloudflareResult(CF).dnssecValid).toBe(false);
  });

  it("leaves the urlscan-only verdict lanes unset rather than faking them", () => {
    const d = distillCloudflareResult(CF);
    expect(d.verdicts.engines).toBeUndefined();
    expect(d.verdicts.community).toBeUndefined();
  });

  it("names what Cloudflare did not report", () => {
    const d = distillCloudflareResult(CF);
    expect(d.absent).toContain("cookies");
    expect(d.absent).toContain("certificates");
  });

  it("survives a result with nothing but a page block", () => {
    const d = distillCloudflareResult({ page: { url: "https://x.test/" } });
    expect(d.finalUrl).toBe("https://x.test/");
    expect(d.requestCount).toBe(0);
    expect(d.registrar).toBeUndefined();
    expect(d.redirects).toEqual([]);
  });
});
