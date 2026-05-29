import { describe, expect, it } from "vitest";
import { detectIOC, refangIOC, extractIps } from "@/lib/ioc";

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

describe("detectIOC (IPv6)", () => {
  it.each([
    ["2606:4700:4700::1111"],
    ["fe80::1"],
    ["::1"],
  ])("detects %s as ip", (input) => {
    expect(detectIOC(input)).toBe("ip");
  });
});

describe("extractIps", () => {
  it("splits on whitespace, commas, and semicolons", () => {
    const ips = extractIps("8.8.8.8, 1.1.1.1; 9.9.9.9\n2606:4700:4700::1111");
    expect(ips.map((p) => p.ip)).toEqual([
      "8.8.8.8",
      "1.1.1.1",
      "9.9.9.9",
      "2606:4700:4700::1111",
    ]);
  });

  it("dedupes by canonical form (v4 exact, v6 across spellings)", () => {
    const ips = extractIps(
      "1.1.1.1 1.1.1.1 2606:4700:4700::1111 2606:4700:4700:0:0:0:0:1111",
    );
    expect(ips.map((p) => p.ip)).toEqual(["1.1.1.1", "2606:4700:4700::1111"]);
  });

  it("drops private, reserved, and non-IP tokens", () => {
    const ips = extractIps("10.0.0.1 192.168.1.1 ::1 google.com hello 1.1.1.1");
    expect(ips.map((p) => p.ip)).toEqual(["1.1.1.1"]);
  });

  it("refangs defanged tokens", () => {
    expect(extractIps("8.8.8[.]8 1.1.1.1").map((p) => p.ip)).toEqual([
      "8.8.8.8",
      "1.1.1.1",
    ]);
  });

  it("caps the number of IPs", () => {
    const many = Array.from({ length: 150 }, (_, i) => `1.1.${(i >> 8) & 255}.${i & 255}`).join(" ");
    expect(extractIps(many).length).toBe(100);
  });
});
