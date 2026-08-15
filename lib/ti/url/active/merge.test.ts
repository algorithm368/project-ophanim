import { describe, expect, it } from "vitest";
import { mergeScans } from "@/lib/ti/url/active/merge";
import type { ScanCapability } from "@/lib/ti/url/active/capability";
import type { ScanDetail } from "@/lib/ti/url/active/detail";
import type { ActiveScan } from "@/lib/ti/url/active/types";

const detail = (over: Partial<ScanDetail> = {}): ScanDetail => ({
  requestCount: 0,
  verdicts: { overall: { malicious: false } },
  absent: [],
  ...over,
});

const scan = (
  over: Partial<ActiveScan> & Pick<ActiveScan, "engine">,
): ActiveScan => ({
  target: "https://evil.com/a",
  status: "done",
  ...over,
});

describe("mergeScans", () => {
  it("merges data only one engine reported", () => {
    const [merged] = mergeScans([
      scan({ engine: "urlscan", detail: detail({ domainAgeDays: 3 }) }),
      scan({ engine: "cloudflare", detail: detail({ registrar: "Dynadot Inc" }) }),
    ]);
    expect(merged.detail.domainAgeDays).toBe(3);
    expect(merged.detail.registrar).toBe("Dynadot Inc");
    expect(merged.engines).toEqual(["urlscan", "cloudflare"]);
  });

  it("shows agreeing data once and reports no disagreement", () => {
    const [merged] = mergeScans([
      scan({ engine: "urlscan", detail: detail({ httpStatus: "200", ip: "1.2.3.4" }) }),
      scan({
        engine: "cloudflare",
        detail: detail({ httpStatus: "200", ip: "1.2.3.4" }),
      }),
    ]);
    expect(merged.detail.httpStatus).toBe("200");
    expect(merged.disagreements).toEqual([]);
  });

  it("records a disagreement with both values attributed", () => {
    const [merged] = mergeScans([
      scan({ engine: "urlscan", detail: detail({ httpStatus: "200" }) }),
      scan({ engine: "cloudflare", detail: detail({ httpStatus: "403" }) }),
    ]);
    expect(merged.disagreements).toEqual([
      {
        field: "HTTP status",
        values: [
          { engine: "urlscan", value: "200" },
          { engine: "cloudflare", value: "403" },
        ],
        note: "A site answering differently by visitor is what a kit dodging scanners does.",
      },
    ]);
  });

  it("treats a malicious split as a disagreement worth naming", () => {
    const [merged] = mergeScans([
      scan({
        engine: "urlscan",
        detail: detail({ verdicts: { overall: { malicious: true } } }),
      }),
      scan({
        engine: "cloudflare",
        detail: detail({ verdicts: { overall: { malicious: false } } }),
      }),
    ]);
    expect(merged.disagreements.map((d) => d.field)).toContain("Verdict");
  });

  it("keeps a malicious reading from either engine in the merged verdict", () => {
    const [merged] = mergeScans([
      scan({
        engine: "urlscan",
        detail: detail({ verdicts: { overall: { malicious: false } } }),
      }),
      scan({
        engine: "cloudflare",
        detail: detail({ verdicts: { overall: { malicious: true } } }),
      }),
    ]);
    expect(merged.detail.verdicts.overall.malicious).toBe(true);
  });

  it("does not call a value missing from one engine a disagreement", () => {
    // Silence is not a competing claim.
    const [merged] = mergeScans([
      scan({ engine: "urlscan", detail: detail({ httpStatus: "200" }) }),
      scan({ engine: "cloudflare", detail: detail({}) }),
    ]);
    expect(merged.disagreements).toEqual([]);
    expect(merged.detail.httpStatus).toBe("200");
  });

  it("only calls a block absent when every engine left it out", () => {
    const [merged] = mergeScans([
      scan({ engine: "urlscan", detail: detail({ absent: ["cookies", "certificates"] }) }),
      scan({ engine: "cloudflare", detail: detail({ absent: ["cookies"] }) }),
    ]);
    expect(merged.detail.absent).toEqual(["cookies"]);
  });

  it("reports an engine that did not finish rather than dropping it", () => {
    const [merged] = mergeScans([
      scan({ engine: "urlscan", detail: detail({ httpStatus: "200" }) }),
      scan({ engine: "cloudflare", status: "error", error: "Rate limited" }),
    ]);
    expect(merged.engines).toEqual(["urlscan"]);
    expect(merged.incomplete).toEqual([
      { engine: "cloudflare", status: "error", error: "Rate limited" },
    ]);
  });

  it("groups by target, so an IP's two ports stay separate", () => {
    const merged = mergeScans([
      scan({ target: "http://1.2.3.4/", engine: "urlscan", detail: detail() }),
      scan({ target: "https://1.2.3.4/", engine: "urlscan", detail: detail() }),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.map((m) => m.target)).toEqual([
      "http://1.2.3.4/",
      "https://1.2.3.4/",
    ]);
  });
});

describe("mergeScans capability", () => {
  const cap = (over: Partial<ScanCapability> = {}): ScanCapability => ({
    passwordField: false,
    forms: [],
    downloadLinks: [],
    ...over,
  });

  it("says the DOM was not read rather than reporting nothing found", () => {
    // The difference the spec insists on: "form analysis unavailable", never
    // "no password field", when nobody managed to look.
    const [merged] = mergeScans([
      scan({ engine: "urlscan", detail: detail() }),
    ]);
    expect(merged.capability.passwordField).toBe(false);
    expect(merged.capability.error).toBeTruthy();
  });

  it("takes a password field seen by either engine as seen", () => {
    // One engine rendering the form and the other not is exactly what a kit
    // that fingerprints its visitor produces. Presence is the finding.
    const [merged] = mergeScans([
      scan({ engine: "urlscan", detail: detail(), capability: cap({ passwordField: true }) }),
      scan({ engine: "cloudflare", detail: detail(), capability: cap() }),
    ]);
    expect(merged.capability.passwordField).toBe(true);
    expect(merged.capability.error).toBeUndefined();
  });

  it("unions form targets and download links, without duplicates", () => {
    const [merged] = mergeScans([
      scan({
        engine: "urlscan",
        detail: detail(),
        capability: cap({
          forms: [{ action: "https://collect.ru/a", host: "collect.ru", crossDomain: true }],
          downloadLinks: ["https://evil.test/x.exe"],
        }),
      }),
      scan({
        engine: "cloudflare",
        detail: detail(),
        capability: cap({
          forms: [
            { action: "https://collect.ru/a", host: "collect.ru", crossDomain: true },
            { action: "https://evil.test/b", host: "evil.test", crossDomain: true },
          ],
          downloadLinks: ["https://evil.test/x.exe"],
        }),
      }),
    ]);
    expect(merged.capability.forms.map((f) => f.action)).toEqual([
      "https://collect.ru/a",
      "https://evil.test/b",
    ]);
    expect(merged.capability.downloadLinks).toEqual(["https://evil.test/x.exe"]);
  });

  it("drops one engine's DOM error when the other engine read it", () => {
    const [merged] = mergeScans([
      scan({ engine: "urlscan", detail: detail(), capability: cap({ error: "DOM unavailable, HTTP 404" }) }),
      scan({ engine: "cloudflare", detail: detail(), capability: cap({ passwordField: true }) }),
    ]);
    expect(merged.capability.error).toBeUndefined();
    expect(merged.capability.passwordField).toBe(true);
  });

  it("keeps the error when every engine failed to read the DOM", () => {
    const [merged] = mergeScans([
      scan({ engine: "urlscan", detail: detail(), capability: cap({ error: "DOM unavailable, HTTP 404" }) }),
      scan({ engine: "cloudflare", detail: detail(), capability: cap({ error: "DOM fetch timed out" }) }),
    ]);
    expect(merged.capability.error).toBe("DOM unavailable, HTTP 404");
  });
});
