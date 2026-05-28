import { describe, expect, it } from "vitest";
import { detectIOC, refangIOC } from "@/lib/ioc";

describe("refangIOC", () => {
  it.each([
    ["evil[.]com", "evil.com"],
    ["185.220.101[.]1", "185.220.101.1"],
    ["hxxps://bad[.]site", "https://bad.site"],
    ["hxxp://bad[.]site", "http://bad.site"],
    ["evil dot com", "evil.com"],
    ["mail[at]evil[dot]com", "mail@evil.com"],
    ["evil\\.com", "evil.com"],
    ["google.com", "google.com"],
    ["  1.1.1.1  ", "1.1.1.1"],
  ])("refangs %s -> %s", (input, expected) => {
    expect(refangIOC(input)).toBe(expected);
  });

  it("returns empty input untouched", () => {
    expect(refangIOC("")).toBe("");
  });
});

describe("detectIOC", () => {
  it.each([
    ["8.8.8.8", "ip"],
    ["1.1.1.1", "ip"],
    ["google.com", "domain"],
    ["mail.bbc.co.uk", "domain"],
    ["44d88612fea8a8f36de82e1278abb02f", "hash"],
  ])("detects %s as %s", (input, expected) => {
    expect(detectIOC(input)).toBe(expected);
  });

  it("refangs before detecting", () => {
    expect(detectIOC("evil[.]com")).toBe("domain");
    expect(detectIOC("8.8.8[.]8")).toBe("ip");
  });

  it.each([["" ], ["not an ioc!!"], ["   "]])(
    "returns null for non-IOC %s",
    (input) => {
      expect(detectIOC(input)).toBeNull();
    },
  );
});
