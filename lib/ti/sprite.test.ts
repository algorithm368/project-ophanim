import { describe, expect, it } from "vitest";
import {
  BODY_KEYS,
  SPRITE_SIZE,
  composeGrid,
  parseGrid,
  spriteRects,
  toRects,
  type Rect,
} from "@/lib/ti/sprite";

/** Paint rects back onto a blank grid, so a round trip can be compared as art
 *  rather than as coordinates. */
function rectsToGrid(rects: Rect[], size = SPRITE_SIZE): string[] {
  const rows = Array.from({ length: size }, () => Array.from({ length: size }, () => "."));
  for (const r of rects) {
    for (let i = 0; i < r.w; i++) rows[r.y][r.x + i] = "#";
  }
  return rows.map((r) => r.join(""));
}

describe("parseGrid", () => {
  it("strips indentation and blank framing lines", () => {
    const g = parseGrid(`
      ##
      .#
    `);
    expect(g).toEqual(["##", ".#"]);
  });

  it("rejects a row containing anything but # and .", () => {
    expect(() => parseGrid("#X")).toThrow(/only/i);
  });
});

describe("every drawn grid", () => {
  it.each(BODY_KEYS)("%s is 16 by 16", (key) => {
    const g = composeGrid({ body: key, flagged: false });
    expect(g).toHaveLength(SPRITE_SIZE);
    for (const row of g) {
      expect(row).toHaveLength(SPRITE_SIZE);
      expect(row).toMatch(/^[#.]+$/);
    }
  });
});

describe("the horns overlay", () => {
  it.each(BODY_KEYS)("%s leaves the horn zone clear", (key) => {
    const grid = composeGrid({ body: key, flagged: false });
    for (const y of [0, 1]) {
      for (const x of [0, 1, 2, 3, 12, 13, 14, 15]) {
        expect(`${key} r${y}c${x}=${grid[y][x]}`).toBe(`${key} r${y}c${x}=.`);
      }
    }
  });

  it("adds pixels and never removes them", () => {
    const plain = composeGrid({ body: "scanner", flagged: false });
    const horned = composeGrid({ body: "scanner", flagged: true });
    for (let y = 0; y < SPRITE_SIZE; y++) {
      for (let x = 0; x < SPRITE_SIZE; x++) {
        if (plain[y][x] === "#") expect(horned[y][x]).toBe("#");
      }
    }
    expect(horned.join("")).not.toBe(plain.join(""));
  });

  it("only touches the top two rows", () => {
    const plain = composeGrid({ body: "file", flagged: false });
    const horned = composeGrid({ body: "file", flagged: true });
    expect(horned.slice(2)).toEqual(plain.slice(2));
  });
});

describe("toRects", () => {
  it("merges each horizontal run into one rect", () => {
    expect(toRects(["..###.", "######"])).toEqual([
      { x: 2, y: 0, w: 3 },
      { x: 0, y: 1, w: 6 },
    ]);
  });

  it("emits nothing for an empty grid", () => {
    expect(toRects(["....", "...."])).toEqual([]);
  });

  it.each(BODY_KEYS)("round-trips %s to the same drawing", (key) => {
    const grid = composeGrid({ body: key, flagged: true });
    expect(rectsToGrid(toRects(grid))).toEqual(grid);
  });
});

describe("spriteRects", () => {
  it("is the composition and the conversion in one call", () => {
    const spec = { body: "hosting", flagged: true } as const;
    expect(spriteRects(spec)).toEqual(toRects(composeGrid(spec)));
  });
});
