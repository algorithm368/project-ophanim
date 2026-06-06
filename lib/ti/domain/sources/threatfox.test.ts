import { describe, expect, it } from "vitest";
import { iocHost, threatFoxScore } from "./threatfox";

describe("iocHost", () => {
  it("pins URL IOCs to their hostname", () => {
    expect(iocHost("https://evil.com/a/b", "url")).toBe("evil.com");
  });

  it("normalizes non-URL IOCs (drops path/port, lowercases, strips trailing dot)", () => {
    expect(iocHost("EVIL.com.", "domain")).toBe("evil.com");
    expect(iocHost("evil.com:8080", "ip:port")).toBe("evil.com");
    expect(iocHost("evil.com/path", "domain")).toBe("evil.com");
  });

  it("returns empty string for missing or unparseable input", () => {
    expect(iocHost(undefined, "domain")).toBe("");
    expect(iocHost("not a url", "url")).toBe("");
  });
});

describe("threatFoxScore", () => {
  it("floors any hit at 60 and caps at 100", () => {
    expect(threatFoxScore(0)).toBe(60);
    expect(threatFoxScore(80)).toBe(80);
    expect(threatFoxScore(150)).toBe(100);
  });
});
