import { describe, expect, it } from "vitest";
import { sources } from "@/lib/ti/registry";

describe("IP source registry", () => {
  it("has no duplicate source ids", () => {
    const ids = sources.map((s) => s.meta.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("registers the sources that were implemented but left unwired", () => {
    // Both shipped with adapters and tests but no registry entry, so neither
    // ever ran. This guards against that happening again.
    const ids = sources.map((s) => s.meta.id);
    expect(ids).toContain("spamhaus-drop");
    expect(ids).toContain("otx");
  });

  it("declares a family set that always includes IPv4", () => {
    for (const source of sources) {
      expect(source.meta.families ?? [4]).toContain(4);
    }
  });

  it("marks exactly the verified sources as IPv6-capable", () => {
    const v6 = sources
      .filter((s) => (s.meta.families ?? [4]).includes(6))
      .map((s) => s.meta.id)
      .sort();
    expect(v6).toEqual(
      [
        "abuseipdb",
        "freeipapi",
        "ip-api",
        "ipgeolocation",
        "ipinfo",
        "ipwhois",
        "otx",
        "peeringdb",
        "rdap-ip",
        "reverse-dns",
        "ripestat",
        "shodan-internetdb",
        "spamhaus-drop",
      ].sort(),
    );
  });
});
