import { describe, expect, it } from "vitest";
import { sourceWeight } from "./weight";
import type { SourceMeta } from "./types";

const meta = (weight?: number) =>
  ({ id: "s", name: "S", url: "https://s.test", category: "reputation", requiresKey: false, weight }) as SourceMeta;

describe("sourceWeight", () => {
  it("reads the meta's own weight, zero included", () => {
    expect(sourceWeight(meta(0.4))).toBe(0.4);
    expect(sourceWeight(meta(0))).toBe(0);
  });

  it("counts a meta without one, or no meta, at full weight", () => {
    expect(sourceWeight(meta(undefined))).toBe(1);
    expect(sourceWeight(undefined)).toBe(1);
  });
});
