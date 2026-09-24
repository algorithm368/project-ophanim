import { describe, expect, it } from "vitest";
import type { ScanCapability } from "@/lib/ti/url/active/capability";
import type { ScanDetail } from "@/lib/ti/url/active/detail";
import type { MergedIndicator, MergedScan } from "@/lib/ti/url/active/merge";
import { classifyScan, describeScan, fileNameOf } from "@/lib/ti/url/active/scan-class";

const NOW = Date.parse("2026-09-24T12:00:00Z");

/** A page that loaded and said nothing in particular. Every case below starts
 *  from this and adds only what its rung needs, so a test cannot pass because
 *  of a field it did not mean to set. */
function merged(
  detail: Partial<ScanDetail> = {},
  capability: Partial<ScanCapability> = {},
  rest: Partial<MergedIndicator> = {},
): MergedIndicator {
  return {
    targets: ["https://site.test/"],
    engines: ["urlscan"],
    detail: {
      finalUrl: "https://site.test/",
      httpStatus: "200",
      mimeType: "text/html",
      requestCount: 12,
      verdicts: { overall: { malicious: false } },
      absent: [],
      ...detail,
    },
    capability: { passwordField: false, forms: [], downloadLinks: [], ...capability },
    disagreements: [],
    targetDifferences: [],
    separateSites: false,
    incomplete: [],
    perTarget: [],
    ...rest,
  };
}

function reading(target: string, detail: Partial<ScanDetail>): MergedScan {
  return {
    target,
    engines: ["urlscan"],
    detail: { requestCount: 1, verdicts: { overall: { malicious: false } }, absent: [], ...detail },
    capability: { passwordField: false, forms: [], downloadLinks: [] },
    disagreements: [],
    incomplete: [],
  };
}

const OFF_SITE = { action: "https://api.evil.top/p", host: "api.evil.top", crossDomain: true };
const SAME_SITE = { action: "https://site.test/login", host: "site.test", crossDomain: false };

describe("classifyScan, the UAT cases", () => {
  it("UAT-01: a password field posting off-site on a young name imitating a brand is a harvest", () => {
    const c = classifyScan(
      merged(
        { domainAgeDays: 3, verdicts: { overall: { malicious: true, brands: ["Microsoft"] } } },
        { passwordField: true, forms: [OFF_SITE] },
      ),
      NOW,
    );
    expect(c.kind).toBe("harvest");
    expect(c.label).toBe("Credential harvest");
    expect(c.caption).toBe(
      "imitates Microsoft, form posts to api.evil.top, domain registered 3 days ago",
    );
  });

  it("UAT-01: any one of the three signals is enough", () => {
    for (const extra of [
      [{ verdicts: { overall: { malicious: false, brands: ["PayPal"] } } }, {}],
      [{}, { forms: [OFF_SITE] }],
      [{ domainAgeDays: 0 }, {}],
    ] as [Partial<ScanDetail>, Partial<ScanCapability>][]) {
      const c = classifyScan(merged(extra[0], { passwordField: true, ...extra[1] }), NOW);
      expect(c.kind).toBe("harvest");
    }
  });

  it("UAT-02: a real login page is a login page, not a harvest", () => {
    const c = classifyScan(
      merged({ domainAgeDays: 9000 }, { passwordField: true, forms: [SAME_SITE] }),
      NOW,
    );
    expect(c.kind).toBe("login");
    expect(c.label).toBe("Login page");
    expect(c.caption).toBe("form posts to the same site, domain registered 24 years ago");
  });

  it("UAT-02: a password field built by script, with no form, still reads as a login page", () => {
    const c = classifyScan(merged({}, { passwordField: true }), NOW);
    expect(c.kind).toBe("login");
    expect(c.caption).toBe("password field with no form around it");
  });

  it("UAT-03: a URL that is an ELF binary is an executable file, described by its bytes", () => {
    const url = "http://203.0.113.7/bins/x86";
    const c = classifyScan(
      merged(
        {
          finalUrl: url,
          mimeType: "application/octet-stream",
          title: undefined,
          requestCount: 1,
          downloads: [
            {
              url,
              filename: "x86",
              size: 61_440,
              description: "ELF 32-bit LSB executable, Intel 80386",
              sha256: "a".repeat(64),
              state: "completed",
            },
          ],
        },
        {},
        { targets: [url] },
      ),
      NOW,
    );
    expect(c.kind).toBe("file");
    expect(c.label).toBe("Executable file");
    expect(c.caption).toBe("ELF 32-bit LSB executable, Intel 80386, 60 KB");
  });

  it("UAT-03: the real sample, a Windows PE served as octet-stream", () => {
    const url = "http://91.92.242.236/files-129312398/files/file_370ffa2745f69715.exe";
    const c = classifyScan(
      merged(
        {
          finalUrl: url,
          mimeType: "application/octet-stream",
          downloads: [
            {
              url,
              filename: "file_370ffa2745f69715.exe",
              size: 14_456_176,
              mimeType: "application/x-dosexec",
              description: "PE32+ executable (GUI) x86-64, for MS Windows",
              sha256: "f85033ce218d3018439a69ce98108a8d30043f57101d5a50f683e7636150ea1a",
              state: "completed",
            },
          ],
        },
        {},
        { targets: [url] },
      ),
      NOW,
    );
    expect(c.label).toBe("Executable file");
    expect(c.caption).toBe("PE32+ executable (GUI) x86-64, for MS Windows, 14 MB");
  });

  it("UAT-03: a file with no download record is still a file, classed by its type and name", () => {
    const c = classifyScan(
      merged({ finalUrl: "https://files.test/pack.zip", mimeType: "application/zip" }),
      NOW,
    );
    expect(c.kind).toBe("file");
    expect(c.label).toBe("Archive");
    expect(c.caption).toBe("served as application/zip");
  });

  it("UAT-04: a page offering an archive is a download lure, named by the file", () => {
    const c = classifyScan(
      merged({}, { downloadLinks: ["https://cdn.test/docs/Invoice_2026.zip"] }),
      NOW,
    );
    expect(c.kind).toBe("lure");
    expect(c.label).toBe("Download lure");
    expect(c.caption).toBe("offers Invoice_2026.zip");
  });

  it("UAT-04: a page that starts a download by itself says so", () => {
    const c = classifyScan(
      merged({ downloads: [{ url: "https://cdn.test/setup.exe", filename: "setup.exe" }] }),
      NOW,
    );
    expect(c.kind).toBe("lure");
    expect(c.caption).toBe("downloads setup.exe");
  });

  it("UAT-04: a harvest outranks a lure when a page is both", () => {
    const c = classifyScan(
      merged(
        {},
        { passwordField: true, forms: [OFF_SITE], downloadLinks: ["https://cdn.test/a.zip"] },
      ),
      NOW,
    );
    expect(c.kind).toBe("harvest");
  });

  it("UAT-05: an address serving an nginx welcome on :80 and a 404 on :443 is a default page", () => {
    const c = classifyScan(
      merged({ title: "Welcome to nginx!" }, {}, {
        targets: ["http://203.0.113.50/", "https://203.0.113.50/"],
        perTarget: [
          reading("http://203.0.113.50/", { title: "Welcome to nginx!", httpStatus: "200" }),
          reading("https://203.0.113.50/", { httpStatus: "404" }),
        ],
      }),
      NOW,
    );
    expect(c.kind).toBe("default");
    expect(c.label).toBe("Default page");
    expect(c.caption).toBe(
      "nginx welcome page on :80, HTTP 404 on :443, nothing deployed at /",
    );
  });

  it("UAT-05: an nginx welcome in front of a real application on the other port is not a default page", () => {
    const c = classifyScan(
      merged({ title: "Welcome to nginx!" }, {}, {
        targets: ["http://203.0.113.50/", "https://203.0.113.50/"],
        perTarget: [
          reading("http://203.0.113.50/", { title: "Welcome to nginx!", httpStatus: "200" }),
          reading("https://203.0.113.50/", { title: "Portal", httpStatus: "200" }),
        ],
      }),
      NOW,
    );
    expect(c.kind).not.toBe("default");
  });

  it("UAT-05: errors with no default page are an error page, and a 403 claims nothing about deployment", () => {
    const c = classifyScan(merged({ httpStatus: "403" }), NOW);
    expect(c.label).toBe("Error page");
    expect(c.caption).toBe("HTTP 403");
  });

  it("UAT-06: the class describes where the trip ended, and the caption says how it got there", () => {
    const c = classifyScan(
      merged(
        {
          finalUrl: "https://shop-deal.xyz/",
          title: "Deals",
          redirects: [
            { from: "https://bit.ly/xyz", to: "https://t.test/1" },
            { from: "https://t.test/1", to: "https://t.test/2" },
            { from: "https://t.test/2", to: "https://shop-deal.xyz/" },
          ],
        },
        {},
        { targets: ["https://bit.ly/xyz"] },
      ),
      NOW,
    );
    expect(c.kind).toBe("page");
    expect(c.caption).toBe(
      "no password field and no file offered in the page that loaded, reached in 3 hops from bit.ly",
    );
  });

  it("UAT-06: a redirect that stays on one host adds nothing", () => {
    const c = classifyScan(
      merged({
        title: "Home",
        redirects: [{ from: "https://site.test/", to: "https://site.test/home" }],
        finalUrl: "https://site.test/home",
      }),
      NOW,
    );
    expect(c.caption).toBe("no password field and no file offered in the page that loaded");
  });

  it("UAT-07: a for-sale page held at a parking service is parked", () => {
    const c = classifyScan(
      merged({ title: "This domain is for sale", nameservers: ["ns1.sedoparking.com"] }),
      NOW,
    );
    expect(c.kind).toBe("parked");
    expect(c.caption).toBe("for sale page, held at ns1.sedoparking.com");
  });

  it("UAT-07: a used-car lot is not parked", () => {
    const c = classifyScan(merged({ title: "Used cars for sale" }), NOW);
    expect(c.kind).toBe("page");
  });

  it("UAT-08: nothing finished is no answer, and never reads as clean", () => {
    const c = classifyScan(merged({}, {}, { engines: [] }), NOW);
    expect(c.kind).toBe("no-answer");
    expect(c.caption).toBe("nothing loaded, which is not the same as clean");
  });

  it("UAT-08: the scanner's own reason is carried into the caption", () => {
    const c = classifyScan(
      merged({}, {}, {
        engines: [],
        incomplete: [{ engine: "urlscan", status: "error", error: "Could not resolve domain" }],
      }),
      NOW,
    );
    expect(c.caption).toBe("nothing loaded (Could not resolve domain), which is not the same as clean");
  });

  it("UAT-08: an engine that finished having loaded nothing is also no answer", () => {
    const c = classifyScan(
      merged({ finalUrl: undefined, httpStatus: undefined, mimeType: undefined, requestCount: 0 }),
      NOW,
    );
    expect(c.kind).toBe("no-answer");
  });

  it("UAT-10: silence after a flagged scan reads as a takedown", () => {
    const c = classifyScan(merged({}, {}, { engines: [] }), NOW, [
      { at: "2026-09-21T09:00:00Z", malicious: true, engines: ["urlscan"], reports: [] },
    ]);
    expect(c.kind).toBe("no-answer");
    expect(c.caption).toMatch(/^nothing loaded now, it was flagged on .+, so it has likely been taken down$/);
  });
});

describe("classifyScan, the rungs past the UAT", () => {
  it("a server listing its own files is an open directory", () => {
    const c = classifyScan(merged({ title: "Index of /bins/" }), NOW);
    expect(c.kind).toBe("open-directory");
    expect(c.caption).toBe("lists the files in /bins/");
  });

  it("a page Cloudflare has filed takes the filing as its class", () => {
    const c = classifyScan(merged({ title: "Daily", contentCategories: ["News & Media"] }), NOW);
    expect(c.label).toBe("News & Media");
    expect(c.caption).toBe("filed by Cloudflare");
  });

  it("anything else is a web page, captioned by what it did not do", () => {
    const c = classifyScan(merged({ title: "Hello", server: "nginx" }), NOW);
    expect(c).toEqual({
      kind: "page",
      label: "Web page",
      caption: "no password field and no file offered in the page that loaded",
    });
  });

  it("claims nothing about a page whose markup was never read", () => {
    const c = classifyScan(merged({ title: "Hello" }, { error: "The page DOM was not read." }), NOW);
    expect(c.caption).toBe("its markup was not read");
  });
});

describe("describeScan", () => {
  const describe_ = (m: MergedIndicator) => describeScan(m, classifyScan(m, NOW));

  it("says what a served file is and who serves it, from the real .exe scan", () => {
    const url = "http://91.92.242.236/files-129312398/files/file_370ffa2745f69715.exe";
    const m = merged(
      {
        finalUrl: url,
        mimeType: "application/octet-stream",
        domain: "91.92.242.236",
        server: "nginx/1.24.0 (Ubuntu)",
        asnName: "OMEGATECH-AS Omegatech LTD, SC",
        country: "NL",
        downloads: [
          {
            url,
            filename: "file_370ffa2745f69715.exe",
            size: 14_456_176,
            description: "PE32+ executable (GUI) x86-64, for MS Windows",
          },
        ],
      },
      {},
      { targets: [url] },
    );
    expect(describe_(m)).toBe(
      "A Windows program, file_370ffa2745f69715.exe, delivered straight from 91.92.242.236. It is served by nginx/1.24.0 (Ubuntu) from Omegatech LTD in the Netherlands.",
    );
  });

  it("names the page by its own title, from the real redirect scan", () => {
    const m = merged(
      {
        finalUrl: "https://www.wikipedia.org/",
        title: "Wikipedia",
        server: "ATS/9.2.15",
        asnName: "WIKIMEDIA - Wikimedia Foundation Inc., US",
        country: "US",
      },
      {},
      { targets: ["http://roundtripfunding.sbs/"] },
    );
    expect(describe_(m)).toBe(
      'A web page titled "Wikipedia" on www.wikipedia.org. It is served by ATS/9.2.15 from Wikimedia Foundation Inc. in the United States.',
    );
  });

  it("leaves out the hosting sentence when nothing about the host was reported", () => {
    const m = merged(
      { title: "Sign in", mimeType: "text/html", verdicts: { overall: { malicious: true, brands: ["Microsoft"] } } },
      { passwordField: true },
    );
    expect(describe_(m)).toBe('A credential harvest page titled "Sign in" on site.test.');
  });

  it("uses the category as the kind of site", () => {
    const m = merged({ title: "Daily", contentCategories: ["News & Media"] });
    expect(describe_(m)).toBe('A news & media site titled "Daily" on site.test.');
  });

  it("calls a default page a bare server", () => {
    const m = merged({ finalUrl: "http://203.0.113.50/", title: "Welcome to nginx!" }, {}, {
      targets: ["http://203.0.113.50/"],
    });
    expect(describe_(m)).toBe("A bare web server at 203.0.113.50, with no site deployed on it.");
  });

  it("says nothing when nothing answered, since the caption already does", () => {
    expect(describe_(merged({}, {}, { engines: [] }))).toBeUndefined();
  });
});

describe("fileNameOf", () => {
  it("decodes the last path segment and gives nothing for a bare host", () => {
    expect(fileNameOf("https://x.test/a/My%20File.zip")).toBe("My File.zip");
    expect(fileNameOf("https://x.test/")).toBeUndefined();
    expect(fileNameOf("not a url")).toBeUndefined();
  });
});
