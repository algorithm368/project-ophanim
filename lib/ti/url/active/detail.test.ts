import { describe, expect, it } from "vitest";
import { distillResult, MAX_LISTED } from "@/lib/ti/url/active/detail";

/** Shaped after a real urlscan result, inventoried 2026-08-15. */
const RESULT = {
  page: {
    url: "https://www.wikipedia.org/",
    title: "Wikipedia",
    status: "200",
    mimeType: "text/html",
    server: "ATS/9.2.13",
    ip: "2a02:ec80:300:ed1a::1",
    asn: "AS14907",
    asnname: "WIKIMEDIA - Wikimedia Foundation Inc., US",
    country: "US",
    city: "",
    domain: "www.wikipedia.org",
    apexDomain: "wikipedia.org",
    apexDomainAgeDays: 4889,
    domainAgeDays: 3546,
    tlsIssuer: "YE2",
    tlsValidFrom: "2026-08-05T19:15:41.000Z",
    tlsValidDays: 89,
    tlsAgeDays: 9,
    umbrellaRank: 6101,
  },
  verdicts: {
    overall: { score: 0, malicious: false, categories: [], brands: [], tags: [] },
    engines: { malicious: false, enginesTotal: 3, maliciousTotal: 0 },
    community: { malicious: false, votesTotal: 0 },
  },
  lists: {
    domains: ["www.wikipedia.org", "wikipedia.org"],
    ips: ["2a02:ec80:300:ed1a::1"],
    asns: ["AS14907"],
    countries: ["US"],
    servers: ["ATS/9.2.13"],
    linkDomains: Array.from({ length: 120 }, (_, i) => `link${i}.test`),
    certificates: [
      {
        subjectName: "*.wikipedia.org",
        issuer: "YE2",
        validFrom: 1754421341,
        validTo: 1762197341,
      },
    ],
  },
  data: {
    requests: Array.from({ length: 7 }, (_, i) => ({
      request: { request: { url: `https://cdn.test/${i}.js` } },
      response: { response: { status: 200 }, type: "script", size: 1024 },
    })),
    cookies: [
      { name: "session", domain: ".wikipedia.org", secure: true, httpOnly: true },
    ],
    console: [],
    links: [{ href: "https://en.wikipedia.org/", text: "English" }],
    redirects: [
      { from: "https://wikipedia.org/", to: "https://www.wikipedia.org/", status: 301 },
    ],
  },
  stats: { securePercentage: 100, malicious: 0, totalLinks: 120 },
  task: { time: "2026-08-15T10:44:00.000Z" },
};

describe("distillResult", () => {
  it("carries the identity of the page that answered", () => {
    const d = distillResult(RESULT);
    expect(d.title).toBe("Wikipedia");
    expect(d.httpStatus).toBe("200");
    expect(d.server).toBe("ATS/9.2.13");
    expect(d.asnName).toContain("Wikimedia");
    expect(d.country).toBe("US");
  });

  it("reads the redirect chain in the shape the provider really sends", () => {
    // Verified against a live payload: hops are {from, to, status}, not {url}.
    // The first fixture guessed {url}, which made this parse to nothing while
    // the unit test still passed.
    const d = distillResult(RESULT);
    expect(d.redirects).toEqual([
      {
        from: "https://wikipedia.org/",
        to: "https://www.wikipedia.org/",
        status: 301,
      },
    ]);
  });

  it("keeps the age fields, which are the cheap phishing signal", () => {
    const d = distillResult(RESULT);
    expect(d.domainAgeDays).toBe(3546);
    expect(d.apexDomainAgeDays).toBe(4889);
    expect(d.tlsAgeDays).toBe(9);
    expect(d.tlsIssuer).toBe("YE2");
  });

  it("counts what loaded rather than storing every request", () => {
    const d = distillResult(RESULT);
    expect(d.requestCount).toBe(7);
    expect(d.securePercentage).toBe(100);
    // The raw request array is never carried through.
    expect((d as unknown as Record<string, unknown>).requests).toBeUndefined();
  });

  it("caps long lists and reports the true total", () => {
    const d = distillResult(RESULT);
    expect(d.linkDomains?.length).toBe(MAX_LISTED);
    expect(d.linkDomainCount).toBe(120);
  });

  it("keeps cookie flags, since a missing Secure flag is the finding", () => {
    const d = distillResult(RESULT);
    expect(d.cookies?.[0]).toEqual({
      name: "session",
      domain: ".wikipedia.org",
      secure: true,
      httpOnly: true,
    });
  });

  it("reads the three verdict lanes separately", () => {
    const d = distillResult(RESULT);
    expect(d.verdicts.overall.malicious).toBe(false);
    expect(d.verdicts.engines?.enginesTotal).toBe(3);
    expect(d.verdicts.community?.votesTotal).toBe(0);
  });

  it("survives a result with nothing but a page block", () => {
    const d = distillResult({ page: { url: "https://x.test/" } });
    expect(d.finalUrl).toBe("https://x.test/");
    expect(d.requestCount).toBe(0);
    expect(d.verdicts.overall.malicious).toBe(false);
  });

  it("names what the scan did not report, rather than showing an empty box", () => {
    const d = distillResult({ page: { url: "https://x.test/" } });
    expect(d.absent).toContain("certificates");
    expect(d.absent).toContain("cookies");
  });

  it("keeps the file the browser received, hash and all", () => {
    // Shaped after a real scan of a bare .exe URL, 2026-09-24.
    const url = "http://91.92.242.236/files-129312398/files/file_370ffa2745f69715.exe";
    const d = distillResult({
      page: { url, mimeType: "application/octet-stream" },
      meta: {
        processors: {
          download: {
            data: [
              {
                filename: "file_370ffa2745f69715.exe",
                filesize: 14456176,
                receivedBytes: 14456176,
                url,
                state: "completed",
                mimeType: "application/x-dosexec",
                mimeDescription: "PE32+ executable (GUI) x86-64, for MS Windows",
                sha256: "f85033ce218d3018439a69ce98108a8d30043f57101d5a50f683e7636150ea1a",
              },
            ],
          },
        },
      },
    });
    expect(d.downloads).toEqual([
      {
        filename: "file_370ffa2745f69715.exe",
        url,
        size: 14456176,
        mimeType: "application/x-dosexec",
        description: "PE32+ executable (GUI) x86-64, for MS Windows",
        sha256: "f85033ce218d3018439a69ce98108a8d30043f57101d5a50f683e7636150ea1a",
        state: "completed",
      },
    ]);
  });

  it("drops the age urlscan reports for a bare address, which has no registration", () => {
    const d = distillResult({
      page: { url: "http://91.92.242.236/x.exe", domain: "91.92.242.236", domainAgeDays: 0, apexDomainAgeDays: 0 },
    });
    expect(d.domainAgeDays).toBeUndefined();
    expect(d.apexDomainAgeDays).toBeUndefined();
  });

  it("reads a page scan, which has no download processor, as no downloads", () => {
    expect(distillResult(RESULT).downloads).toEqual([]);
  });
});
