import { describe, expect, it } from "vitest";
import type { ScanCapability } from "@/lib/ti/url/active/capability";
import type { ScanDetail } from "@/lib/ti/url/active/detail";
import type { MergedIndicator } from "@/lib/ti/url/active/merge";
import {
  NEW_CERTIFICATE_DAYS,
  NEW_DOMAIN_DAYS,
  redFlagsFor,
} from "@/lib/ti/url/active/red-flags";

const NOW = Date.parse("2026-09-10T12:00:00Z");
const DAY = 86_400_000;

function merged(
  detail: Partial<ScanDetail> = {},
  capability: Partial<ScanCapability> = {},
): MergedIndicator {
  return {
    targets: ["https://evil.test/"],
    engines: ["urlscan"],
    detail: {
      requestCount: 0,
      verdicts: { overall: { malicious: false } },
      absent: [],
      ...detail,
    },
    capability: {
      passwordField: false,
      forms: [],
      downloadLinks: [],
      ...capability,
    },
    disagreements: [],
    targetDifferences: [],
    separateSites: false,
    incomplete: [],
    perTarget: [],
  };
}

const ids = (m: MergedIndicator) => redFlagsFor(m, NOW).map((f) => f.id);

describe("redFlagsFor", () => {
  it("raises nothing for a scan that found nothing", () => {
    expect(redFlagsFor(merged(), NOW)).toEqual([]);
  });

  describe("credential exfiltration", () => {
    it("flags a password field whose form posts off-site", () => {
      const flags = redFlagsFor(
        merged(
          {},
          {
            passwordField: true,
            forms: [
              { action: "https://evil-cdn.top/x", host: "evil-cdn.top", crossDomain: true },
            ],
          },
        ),
        NOW,
      );
      expect(flags[0].id).toBe("credential-exfil");
      expect(flags[0].label).toContain("evil-cdn.top");
      expect(flags[0].section).toBe("dom");
    });

    // A login form posting to its own site is every login form there is.
    it("does not flag a password field posting to its own site", () => {
      expect(
        ids(
          merged(
            {},
            {
              passwordField: true,
              forms: [
                { action: "https://evil.test/login", host: "evil.test", crossDomain: false },
              ],
            },
          ),
        ),
      ).toEqual([]);
    });

    // A cross-domain form with nothing to type a password into is a search box
    // pointed at a provider, a newsletter signup, an analytics beacon.
    it("does not flag a cross-domain form with no password field", () => {
      expect(
        ids(
          merged(
            {},
            {
              forms: [
                { action: "https://cdn.test/x", host: "cdn.test", crossDomain: true },
              ],
            },
          ),
        ),
      ).toEqual([]);
    });
  });

  describe("executable downloads", () => {
    it("flags links to files that run", () => {
      const flags = redFlagsFor(
        merged({}, { downloadLinks: ["https://x.test/a.exe", "https://x.test/b.msi"] }),
        NOW,
      );
      expect(flags[0].id).toBe("executable-download");
      expect(flags[0].label).toContain("2 links");
      // The files are listed in the payload tile, not in the DOM rows.
      expect(flags[0].section).toBe("payload");
    });
  });

  describe("a new domain", () => {
    it("never flags a bare address, even from a batch cached with urlscan's 0", () => {
      expect(ids(merged({ domain: "91.92.242.236", domainAgeDays: 0 }))).not.toContain("new-domain");
      expect(
        ids(merged({ finalUrl: "http://203.0.113.9/login", domainAgeDays: 0 })),
      ).not.toContain("new-domain");
    });

    it("flags a rounded age under the threshold", () => {
      expect(ids(merged({ domainAgeDays: NEW_DOMAIN_DAYS - 1 }))).toContain(
        "new-domain",
      );
    });

    it("does not flag the threshold itself", () => {
      expect(ids(merged({ domainAgeDays: NEW_DOMAIN_DAYS }))).toEqual([]);
    });

    // Cloudflare's WHOIS instant is sharper than urlscan's day count, so it
    // wins when both are present.
    it("prefers the WHOIS instant over the rounded age", () => {
      const flags = redFlagsFor(
        merged({
          domainAgeDays: 900,
          domainCreated: new Date(NOW - 4 * DAY).toISOString(),
        }),
        NOW,
      );
      expect(flags.map((f) => f.id)).toContain("new-domain");
      expect(flags[0].label).toContain("4 days ago");
    });

    it('says "today" rather than "0 days ago"', () => {
      const flags = redFlagsFor(
        merged({ domainCreated: new Date(NOW - 3600_000).toISOString() }),
        NOW,
      );
      expect(flags[0].label).toBe("The domain was registered today");
    });

    // A skewed clock must not produce "registered -2 days ago".
    it("reads a future registration date as today", () => {
      const flags = redFlagsFor(
        merged({ domainCreated: new Date(NOW + 2 * DAY).toISOString() }),
        NOW,
      );
      expect(flags[0].label).toBe("The domain was registered today");
    });

    it("ignores an unparseable creation date and falls back to the age", () => {
      expect(ids(merged({ domainCreated: "not a date", domainAgeDays: 5 }))).toContain(
        "new-domain",
      );
    });

    it("says nothing when neither age is known", () => {
      expect(ids(merged())).toEqual([]);
    });
  });

  describe("a new certificate", () => {
    it("flags a certificate under the threshold", () => {
      expect(ids(merged({ tlsAgeDays: NEW_CERTIFICATE_DAYS - 1 }))).toContain(
        "new-certificate",
      );
    });

    it("does not flag the threshold itself", () => {
      expect(ids(merged({ tlsAgeDays: NEW_CERTIFICATE_DAYS }))).toEqual([]);
    });
  });

  describe("requests to flagged hosts", () => {
    it("flags any request that went to one", () => {
      const flags = redFlagsFor(merged({ maliciousRequestCount: 3 }), NOW);
      expect(flags[0].id).toBe("malicious-requests");
      expect(flags[0].section).toBe("network");
    });

    // Zero is a real observation, and it is the good one.
    it("does not flag a reported zero", () => {
      expect(ids(merged({ maliciousRequestCount: 0 }))).toEqual([]);
    });
  });

  // The order decides what an analyst reads first when several fire at once.
  it("puts the credential form ahead of everything else", () => {
    expect(
      ids(
        merged(
          {
            domainAgeDays: 1,
            tlsAgeDays: 1,
            maliciousRequestCount: 2,
          },
          {
            passwordField: true,
            downloadLinks: ["https://x.test/a.exe"],
            forms: [
              { action: "https://out.test/", host: "out.test", crossDomain: true },
            ],
          },
        ),
      ),
    ).toEqual([
      "credential-exfil",
      "executable-download",
      "new-domain",
      "new-certificate",
      "malicious-requests",
    ]);
  });
});
