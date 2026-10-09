import { describe, expect, it } from "vitest";
import { mapLimit } from "./limit";

describe("mapLimit", () => {
  it("keeps order, never exceeds the limit, and reports each result", async () => {
    let active = 0;
    let peak = 0;
    const seen: number[] = [];
    const out = await mapLimit([5, 1, 3, 2], 2, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, n));
      active--;
      return n * 10;
    }, (r) => seen.push(r));
    expect(out).toEqual([50, 10, 30, 20]);
    expect(peak).toBe(2);
    expect(seen.sort()).toEqual([10, 20, 30, 50]);
  });
  it("handles an empty list", async () => {
    expect(await mapLimit([], 3, async (x) => x)).toEqual([]);
  });
});
