import { describe, expect, it } from "vitest";
import { sourceRowKey, type SourceResult } from "@/lib/ti/types";

const row = (over: Partial<SourceResult> = {}): SourceResult => ({
  status: "ok",
  source: {
    id: "virustotal",
    name: "VirusTotal",
    url: "https://example.com",
    category: "reputation",
    requiresKey: false,
    weight: 1,
  },
  enabled: true,
  durationMs: 10,
  ...over,
});

describe("sourceRowKey", () => {
  it("is the bare source id for a single-layer result", () => {
    expect(sourceRowKey(row())).toBe("virustotal");
  });

  it("qualifies the id by layer when one is set", () => {
    expect(sourceRowKey(row({ layer: "domain" }))).toBe("domain:virustotal");
    expect(sourceRowKey(row({ layer: "ip" }))).toBe("ip:virustotal");
  });

  // #48: this is the whole point — two rows sharing an id must not share a key.
  it("gives two layers of the same id distinct keys", () => {
    const domain = sourceRowKey(row({ layer: "domain" }));
    const ip = sourceRowKey(row({ layer: "ip" }));
    expect(domain).not.toBe(ip);
  });
});
