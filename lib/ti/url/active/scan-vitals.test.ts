import { describe, expect, it } from "vitest";
import type { ScanDetail } from "@/lib/ti/url/active/detail";
import type { MergedIndicator } from "@/lib/ti/url/active/merge";
import type { RedFlag } from "@/lib/ti/url/active/red-flags";
import { ageMark } from "@/lib/ti/identity";
import { scanVitals } from "@/lib/ti/url/active/scan-vitals";

const NOW = Date.parse("2026-10-23T12:00:00Z");

function merged(detail: Partial<ScanDetail> = {}): MergedIndicator {
  return {
    targets: ["https://example.test/"],
    engines: ["urlscan"],
    detail: {
      requestCount: 0,
      verdicts: { overall: { malicious: false } },
      absent: [],
      ...detail,
    },
    capability: { passwordField: false, forms: [], downloadLinks: [] },
    disagreements: [],
    targetDifferences: [],
    separateSites: false,
    incomplete: [],
    perTarget: [],
  };
}

const flag = (id: string): RedFlag => ({ id, label: id, section: "x" });

function slot(vitals: ReturnType<typeof scanVitals>, key: string) {
  const v = vitals.find((x) => x.key === key);
  if (!v) throw new Error(`no ${key} slot`);
  return v;
}

describe("scanVitals", () => {
  it("fills the four slots, in order, from a full reading", () => {
    const vitals = scanVitals(
      merged({
        httpStatus: "200",
        mimeType: "text/html",
        server: "cloudflare",
        asn: "AS13335",
        country: "US",
        tlsAgeDays: 19,
        tlsIssuer: "WE1",
        tlsValidDays: 90,
        finalUrl: "https://www.example.test/",
        domainCreated: "2009-04-13T00:00:00Z",
        registrar: "OnlineNIC, Inc.",
      }),
      [],
      NOW,
    );
    expect(vitals.map((v) => v.key)).toEqual(["status", "server", "certificate", "domain"]);
    expect(slot(vitals, "status")).toMatchObject({ value: "200", sub: "text/html" });
    expect(slot(vitals, "server")).toMatchObject({ value: "cloudflare", sub: "AS13335, US" });
    expect(slot(vitals, "certificate")).toMatchObject({
      value: "19 days",
      quiet: { tail: " days" },
      sub: "issued by WE1, valid 90 days",
      flagged: false,
    });
    expect(slot(vitals, "domain")).toMatchObject({
      value: "17 years",
      sub: "registered 2009-04-13, OnlineNIC, Inc.",
      flagged: false,
    });
  });

  it("adds the AS prefix Cloudflare leaves off", () => {
    const vitals = scanVitals(merged({ server: "nginx", asn: "13335" }), [], NOW);
    expect(slot(vitals, "server").sub).toBe("AS13335");
  });

  it("turns the two age slots red when their flags were raised", () => {
    const vitals = scanVitals(
      merged({ tlsAgeDays: 2, domainAgeDays: 3, domain: "new.test" }),
      [flag("new-certificate"), flag("new-domain")],
      NOW,
    );
    expect(slot(vitals, "certificate").flagged).toBe(true);
    expect(slot(vitals, "domain")).toMatchObject({ value: "3 days", flagged: true });
  });

  it("says what is missing rather than closing the slot up", () => {
    const vitals = scanVitals(merged(), [], NOW);
    expect(vitals).toHaveLength(4);
    expect(vitals.every((v) => v.absent)).toBe(true);
    expect(slot(vitals, "status").value).toBe("None");
    expect(slot(vitals, "server")).toMatchObject({ value: "Unnamed", sub: undefined });
    expect(slot(vitals, "certificate")).toMatchObject({ value: "Unknown", sub: "not reported" });
    expect(slot(vitals, "domain")).toMatchObject({ value: "Unknown", sub: "no registration date" });
  });

  it("knows a plain http page has no certificate to date", () => {
    const vitals = scanVitals(merged({ finalUrl: "http://example.test/" }), [], NOW);
    expect(slot(vitals, "certificate")).toMatchObject({ value: "No TLS", absent: true });
  });

  it("has no domain to age on a bare address", () => {
    const vitals = scanVitals(merged({ finalUrl: "http://91.92.242.236/x.exe" }), [], NOW);
    expect(slot(vitals, "domain")).toMatchObject({ value: "None", absent: true });
  });

  it("keeps an unparseable registration date as the engine wrote it", () => {
    const vitals = scanVitals(merged({ domain: "a.test", domainCreated: "soon", domainAgeDays: 400 }), [], NOW);
    expect(slot(vitals, "domain")).toMatchObject({ value: "13 months", sub: "registered soon" });
  });

  it("leaves the certificate's line empty when nothing qualifies it", () => {
    const vitals = scanVitals(merged({ tlsAgeDays: 40 }), [], NOW);
    expect(slot(vitals, "certificate").sub).toBeUndefined();
  });
});

describe("ageMark", () => {
  it("picks the largest unit that is still accurate", () => {
    expect(ageMark(0)).toEqual({ value: "Today" });
    expect(ageMark(1)).toEqual({ value: "1 day", quiet: { tail: " day" } });
    expect(ageMark(59)).toEqual({ value: "59 days", quiet: { tail: " days" } });
    expect(ageMark(60)).toEqual({ value: "2 months", quiet: { tail: " months" } });
    expect(ageMark(729)).toEqual({ value: "24 months", quiet: { tail: " months" } });
    expect(ageMark(730)).toEqual({ value: "2 years", quiet: { tail: " years" } });
  });
});
