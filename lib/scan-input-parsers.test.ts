import { describe, expect, it, vi } from "vitest";
import { readScanInput } from "@/lib/scan-input";

// readScanInput lets the parsers overrule detection, so a detector and a parser
// that disagree end in a refusal rather than a page with no address behind it.
// The two agree for every input today, so the disagreement is staged here.
vi.mock("@/lib/ioc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ioc")>();
  const staged: Record<string, "ip" | "domain" | "url"> = {
    "not-an-ip": "ip",
    "not a domain": "domain",
    "not a url": "url",
    "nowhere.example": "domain",
  };
  return { ...actual, detectIOC: (v: string) => staged[v] ?? actual.detectIOC(v) };
});

vi.mock("@/lib/ti/url/active/targets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ti/url/active/targets")>();
  return {
    ...actual,
    scanTargetsFor: (indicator: string, kind: Parameters<typeof actual.scanTargetsFor>[1]) =>
      indicator === "nowhere.example" ? [] : actual.scanTargetsFor(indicator, kind),
  };
});

describe("readScanInput when the parsers overrule detection", () => {
  it("refuses an indicator no parser will accept", () => {
    for (const value of ["not-an-ip", "not a domain", "not a url"]) {
      expect(readScanInput(value)).toEqual({
        message: `"${value}" does not parse into an address to visit.`,
      });
    }
  });

  it("refuses an indicator with no address to visit", () => {
    expect(readScanInput("nowhere.example")).toEqual({
      message: '"nowhere.example" does not parse into an address to visit.',
    });
  });
});
