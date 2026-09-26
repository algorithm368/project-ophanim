import { describe, expect, it } from "vitest";
import {
  attribution,
  mergeScans,
  mergeTargets,
} from "@/lib/ti/url/active/merge";
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

  it("keeps the brands, categories and tags an engine named", () => {
    // These were dropped: the seeded `verdicts` object was never replaced by
    // the first-non-empty loop, so a page urlscan called a Microsoft phish
    // merged to "no brand named".
    const [merged] = mergeScans([
      scan({
        engine: "urlscan",
        detail: detail({
          verdicts: {
            overall: { malicious: true, score: 100, brands: ["Microsoft"], categories: ["phishing"] },
            engines: { malicious: true, enginesTotal: 3, maliciousTotal: 1 },
          },
        }),
      }),
      scan({
        engine: "cloudflare",
        detail: detail({
          verdicts: { overall: { malicious: false, categories: ["phishing", "newly seen"] } },
        }),
      }),
    ]);
    const overall = merged.detail.verdicts.overall;
    expect(overall.malicious).toBe(true);
    expect(overall.score).toBe(100);
    expect(overall.brands).toEqual(["Microsoft"]);
    expect(overall.categories).toEqual(["phishing", "newly seen"]);
    expect(merged.detail.verdicts.engines?.enginesTotal).toBe(3);
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

describe("attribution", () => {
  it("names only the engines that reported the field", () => {
    const scans = [
      scan({ engine: "urlscan", detail: detail({ httpStatus: "200" }) }),
      scan({ engine: "cloudflare", detail: detail({ registrar: "Dynadot Inc" }) }),
    ];
    expect(attribution(scans, "httpStatus")).toEqual(["urlscan"]);
    expect(attribution(scans, "registrar")).toEqual(["cloudflare"]);
    expect(attribution(scans, "title")).toEqual([]);
  });

  it("treats an empty string or empty list as not reported", () => {
    const scans = [
      scan({ engine: "urlscan", detail: detail({ tlsIssuer: "", riskCategories: [] }) }),
    ];
    expect(attribution(scans, "tlsIssuer")).toEqual([]);
    expect(attribution(scans, "riskCategories")).toEqual([]);
  });

  it("ignores an engine that did not finish", () => {
    const scans = [
      scan({ engine: "urlscan", status: "running" }),
      scan({ engine: "cloudflare", detail: detail({ httpStatus: "403" }) }),
    ];
    expect(attribution(scans, "httpStatus")).toEqual(["cloudflare"]);
  });
});

const cap = (over: Partial<ScanCapability> = {}): ScanCapability => ({
  passwordField: false,
  forms: [],
  downloadLinks: [],
  ...over,
});

describe("mergeScans capability", () => {

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

describe("mergedDetail request count", () => {
  // The merged reading seeded `requestCount: 0` alongside the other required
  // fields, and a seeded zero can never be replaced: `isEmptyValue(0)` is
  // false, so the first-non-empty guard read the slot as already filled and
  // discarded every engine's real count. Nothing rendered it, so the zero was
  // invisible until the network section started showing it.
  it("keeps the count an engine reported", () => {
    const [merged] = mergeScans([
      scan({ engine: "urlscan", detail: detail({ requestCount: 41 }) }),
    ]);
    expect(merged.detail.requestCount).toBe(41);
  });

  it("falls back to zero when no engine reported one", () => {
    const [merged] = mergeScans([
      scan({ engine: "urlscan", detail: detail({ requestCount: 0 }) }),
    ]);
    expect(merged.detail.requestCount).toBe(0);
  });
});

describe("mergeTargets", () => {
  const httpScan = (over: Partial<ActiveScan> = {}) =>
    scan({ engine: "urlscan", target: "http://8.8.8.8/", ...over });
  const httpsScan = (over: Partial<ActiveScan> = {}) =>
    scan({ engine: "urlscan", target: "https://8.8.8.8/", ...over });

  it("names every scanned URL", () => {
    const merged = mergeTargets([
      httpScan({ detail: detail() }),
      httpsScan({ detail: detail() }),
    ]);
    expect(merged.targets).toEqual(["http://8.8.8.8/", "https://8.8.8.8/"]);
  });

  it("folds fields only one URL reported", () => {
    const merged = mergeTargets([
      httpScan({ detail: detail({ server: "nginx" }) }),
      httpsScan({ detail: detail({ tlsIssuer: "WR2" }) }),
    ]);
    expect(merged.detail.server).toBe("nginx");
    expect(merged.detail.tlsIssuer).toBe("WR2");
  });

  it("reports a field the two URLs answered differently on", () => {
    const merged = mergeTargets([
      httpScan({ detail: detail({ ip: "8.8.8.8" }) }),
      httpsScan({ detail: detail({ ip: "8.8.4.4" }) }),
    ]);
    expect(merged.targetDifferences).toEqual([
      {
        field: "Serving IP",
        values: [
          { target: "http://8.8.8.8/", value: "8.8.8.8" },
          { target: "https://8.8.8.8/", value: "8.8.4.4" },
        ],
      },
    ]);
  });

  // The case the screenshot showed: both ports land on the same host, one just
  // takes an extra hop getting there.
  it("reports a differing hop count", () => {
    const merged = mergeTargets([
      httpScan({
        detail: detail({
          redirects: [
            { from: "a", to: "b" },
            { from: "b", to: "c" },
          ],
        }),
      }),
      httpsScan({ detail: detail({ redirects: [{ from: "a", to: "c" }] }) }),
    ]);
    expect(
      merged.targetDifferences.find((d) => d.field === "Redirect hops")?.values,
    ).toEqual([
      { target: "http://8.8.8.8/", value: "2" },
      { target: "https://8.8.8.8/", value: "1" },
    ]);
  });

  it("says nothing differs when both URLs answered the same", () => {
    const same = detail({ finalUrl: "https://dns.google/", title: "DNS" });
    const merged = mergeTargets([
      httpScan({ detail: same }),
      httpsScan({ detail: same }),
    ]);
    expect(merged.targetDifferences).toEqual([]);
    expect(merged.separateSites).toBe(false);
  });

  // An extra hop to the same destination is one site answering on two ports,
  // which is the ordinary case and must not carry a warning.
  it("does not call an extra hop to the same page separate sites", () => {
    const merged = mergeTargets([
      httpScan({
        detail: detail({
          finalUrl: "https://dns.google/",
          title: "DNS",
          redirects: [
            { from: "a", to: "b" },
            { from: "b", to: "c" },
          ],
        }),
      }),
      httpsScan({
        detail: detail({ finalUrl: "https://dns.google/", title: "DNS" }),
      }),
    ]);
    expect(merged.separateSites).toBe(false);
  });

  it("calls two different destinations separate sites", () => {
    const merged = mergeTargets([
      httpScan({ detail: detail({ finalUrl: "http://8.8.8.8/setup" }) }),
      httpsScan({ detail: detail({ finalUrl: "https://dns.google/" }) }),
    ]);
    expect(merged.separateSites).toBe(true);
  });

  it("calls two different titles on one host separate sites", () => {
    const merged = mergeTargets([
      httpScan({
        detail: detail({ finalUrl: "https://x.test/", title: "Router login" }),
      }),
      httpsScan({
        detail: detail({ finalUrl: "https://x.test/", title: "Welcome" }),
      }),
    ]);
    expect(merged.separateSites).toBe(true);
  });

  // A reading with neither host nor title cannot answer the question, and
  // counting it as a match would suppress a warning on the pair that can.
  it("ignores a URL that reported neither destination nor title", () => {
    const merged = mergeTargets([
      httpScan({ detail: detail() }),
      httpsScan({ detail: detail({ finalUrl: "https://dns.google/" }) }),
    ]);
    expect(merged.separateSites).toBe(false);
  });

  it("keeps engine conflicts attached to the URL they were about", () => {
    const merged = mergeTargets([
      httpScan({ engine: "urlscan", detail: detail({ ip: "1.1.1.1" }) }),
      httpScan({ engine: "cloudflare", detail: detail({ ip: "2.2.2.2" }) }),
      httpsScan({ engine: "urlscan", detail: detail({ ip: "1.1.1.1" }) }),
    ]);
    expect(merged.disagreements).toHaveLength(1);
    expect(merged.disagreements[0].field).toBe("Serving IP");
  });

  it("sees a password field either URL rendered", () => {
    const merged = mergeTargets([
      httpScan({ detail: detail(), capability: cap({}) }),
      httpsScan({ detail: detail(), capability: cap({ passwordField: true }) }),
    ]);
    expect(merged.capability.passwordField).toBe(true);
  });

  it("names an engine that never finished", () => {
    const merged = mergeTargets([
      httpScan({ detail: detail() }),
      httpsScan({ engine: "cloudflare", status: "running" }),
    ]);
    expect(merged.incomplete).toEqual([
      { engine: "cloudflare", status: "running" },
    ]);
  });

  it("holds no targets when nothing was scanned", () => {
    const merged = mergeTargets([]);
    expect(merged.targets).toEqual([]);
    expect(merged.engines).toEqual([]);
    expect(merged.separateSites).toBe(false);
  });
});
