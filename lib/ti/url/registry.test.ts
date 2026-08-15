import { describe, expect, it } from "vitest";
import { urlSources } from "@/lib/ti/url/registry";

describe("urlSources", () => {
  it("has unique ids", () => {
    const ids = urlSources.map((s) => s.meta.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not collide with the domain-level source ids it mirrors", () => {
    const ids = urlSources.map((s) => s.meta.id);
    expect(ids).not.toContain("safebrowsing");
    expect(ids).not.toContain("openphish");
  });

  it("keeps the structural check under the floor weight", () => {
    // FLOOR_MIN_WEIGHT is 0.7: only an authoritative listing may pin a verdict
    // alone. A guess about URL shape must stay well below it.
    const heuristics = urlSources.find((s) => s.meta.id === "url-heuristics")!;
    expect(heuristics.meta.weight).toBeLessThan(0.7);
  });

  it("declares keyEnv on every key-gated source", () => {
    for (const source of urlSources) {
      if (source.meta.requiresKey) expect(source.meta.keyEnv).toBeTruthy();
    }
  });

  it("has at least one source that runs without any key", () => {
    const keyless = urlSources.filter((s) => !s.meta.requiresKey);
    expect(keyless.length).toBeGreaterThan(0);
  });
});
