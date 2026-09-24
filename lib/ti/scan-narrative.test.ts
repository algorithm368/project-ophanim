import { describe, expect, it } from "vitest";
import { buildScanNarrative } from "./narrative";
import type { ScanCapability } from "./url/active/capability";
import type { ScanDetail } from "./url/active/detail";
import type { MergedScan } from "./url/active/merge";

const detail = (over: Partial<ScanDetail> = {}): ScanDetail => ({
  requestCount: 0,
  verdicts: { overall: { malicious: false } },
  absent: [],
  ...over,
});

const capability = (over: Partial<ScanCapability> = {}): ScanCapability => ({
  passwordField: false,
  forms: [],
  downloadLinks: [],
  ...over,
});

const merged = (over: Partial<MergedScan> = {}): MergedScan => ({
  target: "https://login-ms.xyz/",
  engines: ["urlscan", "cloudflare"],
  detail: detail(),
  capability: capability(),
  disagreements: [],
  incomplete: [],
  ...over,
});

/** Every sentence the builder can emit, in one reading. */
const FULL = merged({
  detail: detail({
    finalUrl: "https://secure-login.ms-verify.top/auth/o365",
    httpStatus: "200",
    title: "Sign in to your account",
    ip: "1.2.3.4",
    server: "nginx",
    domain: "login-ms.xyz",
    domainCreated: "2026-08-15T11:32:58.000Z",
    tlsIssuer: "Let's Encrypt",
    tlsAgeDays: 2,
    tlsValidDays: 89,
    riskCategories: ["Newly Seen Domains", "Security Risks"],
    contentCategories: ["Business & Economy"],
    siblingDomains: ["arwana855silver.com"],
    redirects: [
      {
        from: "https://login-ms.xyz/",
        to: "https://secure-login.ms-verify.top/auth/o365",
        status: 301,
      },
    ],
    verdicts: { overall: { malicious: true, categories: ["phishing"] } },
  }),
  capability: capability({
    passwordField: true,
    forms: [
      { action: "https://collect.ru/gate.php", host: "collect.ru", crossDomain: true },
    ],
    downloadLinks: ["https://cdn.evil.test/invoice.exe"],
  }),
});

describe("buildScanNarrative", () => {
  it("makes no claims at all about an empty reading", () => {
    // The property that matters most: a scan that observed nothing must not
    // produce a paragraph, because every sentence here ends up in a ticket.
    expect(buildScanNarrative(merged({ engines: [] }))).toEqual([]);
  });

  it("says where the URL ends up, and how many hops it took", () => {
    const [first] = buildScanNarrative(FULL);
    expect(first).toContain("redirects once");
    expect(first).toContain("secure-login.ms-verify.top");
  });

  it("does not mention redirection when the URL served itself", () => {
    const text = buildScanNarrative(
      merged({ detail: detail({ finalUrl: "https://login-ms.xyz/", httpStatus: "200" }) }),
    ).join(" ");
    expect(text).not.toMatch(/redirect/i);
  });

  it("reports a password field as belonging to the page that loaded", () => {
    // Never "the site asks for a password": a kit can build the form after a
    // click, and the claim has to survive being argued in a ticket.
    const text = buildScanNarrative(FULL).join(" ");
    expect(text).toMatch(/password field/);
    expect(text).toMatch(/page that loaded/);
  });

  it("names a cross-domain form target as the different domain it is", () => {
    const text = buildScanNarrative(FULL).join(" ");
    expect(text).toContain("collect.ru");
    expect(text).toMatch(/different domain/);
  });

  it("says nothing about forms when the DOM was never read", () => {
    const text = buildScanNarrative(
      merged({
        detail: detail({ httpStatus: "200" }),
        capability: capability({ error: "The page DOM was not read." }),
      }),
    ).join(" ");
    expect(text).not.toMatch(/password/i);
    expect(text).not.toMatch(/form/i);
  });

  it("carries the executable download as a delivery mechanism", () => {
    const text = buildScanNarrative(FULL).join(" ");
    expect(text).toMatch(/invoice\.exe/);
    expect(text).toContain("1 file that executes when opened");
  });

  it("counts several executable links in the plural", () => {
    const text = buildScanNarrative(
      merged({
        detail: detail({ httpStatus: "200" }),
        capability: capability({
          downloadLinks: ["https://a.test/one.exe", "https://a.test/two.msi"],
        }),
      }),
    ).join(" ");
    expect(text).toContain("2 files that execute when opened");
  });

  it("dates the registration exactly when WHOIS gave an instant", () => {
    const text = buildScanNarrative(FULL).join(" ");
    expect(text).toMatch(/registered/);
    expect(text).toMatch(/2026/);
  });

  it("falls back to a rounded age when only the age in days is known", () => {
    const text = buildScanNarrative(
      merged({ detail: detail({ httpStatus: "200", domainAgeDays: 3 }) }),
    ).join(" ");
    expect(text).toMatch(/3 days/);
  });

  it("attributes the verdict to the engine that reached it", () => {
    const text = buildScanNarrative(FULL).join(" ");
    expect(text).toMatch(/urlscan\.io|Cloudflare/);
    expect(text).toMatch(/phishing/);
  });

  it("states a clean reading without letting it read as a clean bill", () => {
    const text = buildScanNarrative(
      merged({ detail: detail({ httpStatus: "200", finalUrl: "https://login-ms.xyz/" }) }),
    ).join(" ");
    expect(text).toMatch(/neither/i);
  });

  it("names only the engines that flagged it when the verdict split", () => {
    const text = buildScanNarrative(
      merged({
        detail: detail({ verdicts: { overall: { malicious: true } } }),
        disagreements: [
          {
            field: "Verdict",
            values: [
              { engine: "urlscan", value: "malicious" },
              { engine: "cloudflare", value: "not malicious" },
            ],
          },
        ],
      }),
    ).join(" ");
    expect(text).toContain("It was flagged by urlscan.io.");
    expect(text).not.toContain("flagged by urlscan.io and Cloudflare");
  });

  it("writes the disagreement out as a sentence", () => {
    const text = buildScanNarrative(
      merged({
        detail: detail({ httpStatus: "200" }),
        disagreements: [
          {
            field: "HTTP status",
            values: [
              { engine: "urlscan", value: "200" },
              { engine: "cloudflare", value: "403" },
            ],
          },
        ],
      }),
    ).join(" ");
    expect(text).toMatch(/disagree/i);
    expect(text).toContain("200");
    expect(text).toContain("403");
    // "hTTP status" is what a naive lowercase-the-first-letter produces.
    expect(text).toContain("disagree on HTTP status");
  });

  it("lowercases an ordinary field label placed mid-sentence", () => {
    const text = buildScanNarrative(
      merged({
        detail: detail({ httpStatus: "200" }),
        disagreements: [
          {
            field: "Serving IP",
            values: [
              { engine: "urlscan", value: "1.1.1.1" },
              { engine: "cloudflare", value: "2.2.2.2" },
            ],
          },
          {
            field: "Page title",
            values: [
              { engine: "urlscan", value: "A" },
              { engine: "cloudflare", value: "B" },
            ],
          },
        ],
      }),
    ).join(" ");
    // Only the first character changes, so an acronym later in the label
    // ("IP") is untouched.
    expect(text).toContain("disagree on serving IP");
    expect(text).toContain("disagree on page title");
  });

  it("says what the site is filed as, before what is wrong with it", () => {
    const sentences = buildScanNarrative(FULL);
    const filed = sentences.findIndex((s) => s.includes("categorizes the site"));
    const risk = sentences.findIndex((s) => s.includes("puts the domain in"));
    expect(sentences[filed]).toContain("Business & Economy");
    expect(filed).toBeLessThan(risk);
  });

  it("names the parent a category was inherited from", () => {
    const text = buildScanNarrative(
      merged({
        detail: detail({
          contentCategories: ["Technology"],
          categoryInheritedFrom: "cloudflare.com",
        }),
      }),
    ).join(" ");
    expect(text).toContain("Technology, inherited from cloudflare.com.");
  });

  it("claims no category for a host that inherited one it never had", () => {
    // The parent name alone is not a categorization of the scanned host.
    const text = buildScanNarrative(
      merged({ detail: detail({ categoryInheritedFrom: "cloudflare.com" }) }),
    ).join(" ");
    expect(text).not.toMatch(/categorizes|cloudflare\.com/);
  });

  it("names an engine that did not finish", () => {
    const text = buildScanNarrative(
      merged({
        engines: ["urlscan"],
        detail: detail({ httpStatus: "200" }),
        incomplete: [{ engine: "cloudflare", status: "error", error: "Rate limited" }],
      }),
    ).join(" ");
    expect(text).toMatch(/Cloudflare/);
  });

  it("reads as prose: every sentence ends in a full stop", () => {
    for (const sentence of buildScanNarrative(FULL)) {
      expect(sentence.trim()).toMatch(/\.$/);
    }
  });
});

describe("buildScanNarrative, as a property", () => {
  /** Every field the builder reads, each with a value and a "missing". */
  const FIELDS: [keyof ScanDetail, unknown][] = [
    ["finalUrl", "https://elsewhere.test/x"],
    ["httpStatus", "403"],
    ["title", "403 Forbidden"],
    ["server", "cloudflare"],
    ["ip", "1.2.3.4"],
    ["domain", "login-ms.xyz"],
    ["domainCreated", "2026-08-15T11:32:58.000Z"],
    ["domainAgeDays", 3],
    ["tlsIssuer", "Let's Encrypt"],
    ["tlsAgeDays", 2],
    ["tlsValidDays", 89],
    ["riskCategories", ["Security Risks"]],
    ["contentCategories", ["News & Media"]],
    ["categoryInheritedFrom", "bbc.com"],
    ["siblingDomains", ["other.test"]],
    ["redirects", [{ from: "https://login-ms.xyz/", to: "https://elsewhere.test/x", status: 301 }]],
  ];

  /** Words that betray a template slot filled with nothing. */
  const LEAKS = /\bundefined\b|\bnull\b|\bNaN\b|\[object|\bunknown\b/i;

  it("never leaks a placeholder, for any subset of the data", () => {
    // Sampling the subset space is more than enough to hit every combination of
    // present and absent fields the builder branches on.
    for (let mask = 0; mask < 1 << FIELDS.length; mask += 37) {
      const over: Record<string, unknown> = {};
      FIELDS.forEach(([key, value], i) => {
        if (mask & (1 << i)) over[key] = value;
      });
      const sentences = buildScanNarrative(
        merged({ detail: detail(over as Partial<ScanDetail>) }),
      );
      for (const sentence of sentences) {
        expect(sentence).not.toMatch(LEAKS);
        expect(sentence).not.toMatch(/\s,|\s\.|,\./);
      }
    }
  });

  it("makes no claim that outlives its input", () => {
    // With nothing observed, no sentence may appear. With one field observed,
    // the paragraph may only talk about that field.
    expect(buildScanNarrative(merged({ engines: [] }))).toEqual([]);
    const onlyStatus = buildScanNarrative(
      merged({ detail: detail({ httpStatus: "403" }) }),
    ).join(" ");
    expect(onlyStatus).not.toMatch(/certificate|registered|password|redirect/i);
  });
});
