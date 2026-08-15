import { describe, expect, it } from "vitest";
import { supportsFamily } from "@/lib/ti/check";
import type { TiSource } from "@/lib/ti/types";

/** A source declaring the given families (omit to leave the field unset). */
function fakeSource(id: string, families?: (4 | 6)[]): TiSource {
  return {
    meta: {
      id,
      name: id,
      url: "https://example.test",
      category: "reputation",
      requiresKey: false,
      weight: 1,
      ...(families ? { families } : {}),
    },
    isEnabled: () => true,
    check: async () => ({ status: "ok" as const, score: 0 }),
  };
}

describe("supportsFamily", () => {
  it("treats an unset families field as IPv4 only", () => {
    const source = fakeSource("legacy");
    expect(supportsFamily(source, 4)).toBe(true);
    expect(supportsFamily(source, 6)).toBe(false);
  });

  it("honors an explicit dual-family declaration", () => {
    const source = fakeSource("modern", [4, 6]);
    expect(supportsFamily(source, 4)).toBe(true);
    expect(supportsFamily(source, 6)).toBe(true);
  });

  it("honors a v6-only declaration", () => {
    const source = fakeSource("v6only", [6]);
    expect(supportsFamily(source, 4)).toBe(false);
    expect(supportsFamily(source, 6)).toBe(true);
  });
});
