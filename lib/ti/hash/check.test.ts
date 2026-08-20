import { describe, expect, it } from "vitest";
import { supportsAlgorithm } from "@/lib/ti/hash/check";
import { hashSources } from "@/lib/ti/hash/registry";
import type { TiSource } from "@/lib/ti/types";

function source(algorithms?: ("md5" | "sha1" | "sha256")[]): TiSource {
  return {
    meta: {
      id: "s",
      name: "S",
      url: "https://example.test",
      category: "reputation",
      requiresKey: false,
      weight: 1,
      algorithms,
    },
    isEnabled: () => true,
    check: async () => ({ status: "ok" }),
  };
}

describe("supportsAlgorithm", () => {
  it("treats an unset list as all three, so a source cannot lose coverage by omission", () => {
    const any = source();
    expect(supportsAlgorithm(any, "md5")).toBe(true);
    expect(supportsAlgorithm(any, "sha1")).toBe(true);
    expect(supportsAlgorithm(any, "sha256")).toBe(true);
  });

  it("honours a declared list", () => {
    const limited = source(["md5", "sha256"]);
    expect(supportsAlgorithm(limited, "md5")).toBe(true);
    expect(supportsAlgorithm(limited, "sha256")).toBe(true);
    expect(supportsAlgorithm(limited, "sha1")).toBe(false);
  });
});

describe("hash registry algorithm limits", () => {
  const find = (id: string) => hashSources.find((s) => s.meta.id === id)!;

  it("keeps ThreatFox out of a SHA-1 lookup, which its API rejects with a 4xx", () => {
    expect(supportsAlgorithm(find("threatfox"), "sha1")).toBe(false);
    expect(supportsAlgorithm(find("threatfox"), "sha256")).toBe(true);
  });

  it("keeps Team Cymru MHR out of a SHA-256 lookup, which it is not keyed on", () => {
    expect(supportsAlgorithm(find("cymru-mhr"), "sha256")).toBe(false);
    expect(supportsAlgorithm(find("cymru-mhr"), "md5")).toBe(true);
    expect(supportsAlgorithm(find("cymru-mhr"), "sha1")).toBe(true);
  });

  it("leaves every other source answering all three", () => {
    const limited = hashSources.filter((s) => s.meta.algorithms);
    // YARAify also takes SHA3-384, which is not an algorithm this app accepts
    // as an indicator, so its list is the three it shares with us.
    expect(limited.map((s) => s.meta.id).sort()).toEqual([
      "cymru-mhr",
      "threatfox",
      "yaraify",
    ]);
  });
});
