import { describe, expect, it } from "vitest";
import {
  BODIES,
  BODY_KEYS,
  HORN_ZONE,
  PARTS,
  SPRITE_SIZE,
  composeGrid,
  hamming,
  isInk,
  paintPart,
  parseGrid,
  partChoice,
  placements,
  seedOf,
  silhouette16,
  spriteLayers,
  toLayers,
  type BodyKey,
  type Layer,
} from "@/lib/ti/sprite";

const FINISHED = BODY_KEYS.filter((k) => !BODIES[k].placeholder);
const SEEDS = Array.from({ length: 500 }, (_, i) => seedOf(`indicator-${i}`));

/** Paint layers back onto a blank grid, so a round trip compares as art. */
function layersToGrid(layers: Layer[]): string[] {
  const rows = Array.from({ length: SPRITE_SIZE }, () => Array.from({ length: SPRITE_SIZE }, () => "."));
  for (const l of layers) for (const r of l.rects) for (let i = 0; i < r.w; i++) rows[r.y][r.x + i] = l.tone;
  return rows.map((r) => r.join(""));
}

describe("parseGrid", () => {
  it("strips indentation and blank framing lines", () => {
    expect(parseGrid(`
      #=
      .-
    `)).toEqual(["#=", ".-"]);
  });

  it("rejects knockouts in a body and anything unknown", () => {
    expect(() => parseGrid("#o")).toThrow();
    expect(() => parseGrid("#X", { part: true })).toThrow();
    expect(parseGrid("#o", { part: true })).toEqual(["#o"]);
  });

  it("rejects ragged rows and wrong sizes", () => {
    expect(() => parseGrid("##\n#")).toThrow(/one width/);
    expect(() => parseGrid("##\n##", { size: 3 })).toThrow(/3x3/);
  });
});

describe("every body", () => {
  it.each(BODY_KEYS)("%s is a 32 by 32 body", (key) => {
    const g = BODIES[key].grid;
    expect(g).toHaveLength(SPRITE_SIZE);
    for (const row of g) expect(row).toMatch(/^[.#=-]{32}$/);
  });

  it.each(BODY_KEYS)("%s leaves the horn zone clear", (key) => {
    const g = BODIES[key].grid;
    for (let y = 0; y < HORN_ZONE.rows; y++) {
      for (let x = 0; x < HORN_ZONE.cols; x++) {
        expect(`${key} r${y}c${x}=${g[y][x]}`).toBe(`${key} r${y}c${x}=.`);
        const xr = SPRITE_SIZE - 1 - x;
        expect(`${key} r${y}c${xr}=${g[y][xr]}`).toBe(`${key} r${y}c${xr}=.`);
      }
    }
  });

  it.each(BODY_KEYS)("%s pins only parts that exist", (key) => {
    for (const [slot, i] of Object.entries(BODIES[key].fixed ?? {})) {
      expect(PARTS[slot as keyof typeof PARTS][i]).toBeDefined();
    }
  });
});

describe("finished bodies", () => {
  it.each(FINISHED)("%s never has a part paint outside its outline", (key) => {
    const def = BODIES[key];
    for (const seed of SEEDS) {
      for (const p of placements({ body: key, flagged: false, seed })) {
        const scratch = def.grid.map((r) => [...r]);
        expect(paintPart(scratch, def.grid, p.part.grid, p.x, p.y, p.mirror)).toBe(0);
      }
    }
  });

  it.each(FINISHED)("%s produces visibly different siblings", (key) => {
    const interiors = new Set(SEEDS.slice(0, 64).map((seed) => composeGrid({ body: key, flagged: false, seed }).join("")));
    const free = (["eyes", "mouth", "mark"] as const).filter((s) => BODIES[key].fixed?.[s] === undefined).length;
    expect(interiors.size).toBeGreaterThanOrEqual(free >= 2 ? 16 : 4);
  });

  it.each(FINISHED)("%s keeps its outline whatever the seed", (key) => {
    const bare = BODIES[key].grid.map((r) => [...r].map((c) => (isInk(c) ? "#" : ".")).join(""));
    for (const seed of SEEDS.slice(0, 64)) {
      const g = composeGrid({ body: key, flagged: false, seed });
      // Knockouts may open holes inside, but nothing may appear outside.
      g.forEach((row, y) => [...row].forEach((c, x) => {
        if (isInk(c)) expect(bare[y][x]).toBe("#");
      }));
    }
  });

  it("no two classes collapse together at 16px", () => {
    const pairs: string[] = [];
    for (let i = 0; i < FINISHED.length; i++) {
      for (let j = i + 1; j < FINISHED.length; j++) {
        const a = FINISHED[i];
        const b = FINISHED[j];
        const d = hamming(silhouette16(BODIES[a].grid), silhouette16(BODIES[b].grid));
        if (d < 12) pairs.push(`${a}~${b}=${d}`);
      }
    }
    expect(pairs).toEqual([]);
  });
});

/**
 * The house style, taken from the anonymizer (see the spec's "House style").
 * These are what make 23 bodies drawn at different times read as one family.
 */
describe("house style", () => {
  const ink = (g: string[], x: number, y: number) => isInk(g[y]?.[x]);

  it.each(FINISHED)("%s steps its outline in 2x2 blocks", (key) => {
    const g = BODIES[key].grid;
    const ragged: string[] = [];
    for (let y = 0; y < SPRITE_SIZE; y += 2) {
      for (let x = 0; x < SPRITE_SIZE; x += 2) {
        const n = [ink(g, x, y), ink(g, x + 1, y), ink(g, x, y + 1), ink(g, x + 1, y + 1)].filter(Boolean).length;
        if (n !== 0 && n !== 4) ragged.push(`r${y}c${x}`);
      }
    }
    expect(ragged).toEqual([]);
  });

  it.each(FINISHED)("%s has a dark body with a solid edge", (key) => {
    const g = BODIES[key].grid;
    let total = 0;
    let dark = 0;
    const softEdge: string[] = [];
    g.forEach((row, y) => [...row].forEach((c, x) => {
      if (!isInk(c)) return;
      total++;
      if (c === "#") dark++;
      const edge = !ink(g, x - 1, y) || !ink(g, x + 1, y) || !ink(g, x, y - 1) || !ink(g, x, y + 1);
      if (edge && c !== "#") softEdge.push(`r${y}c${x}`);
    }));
    expect(softEdge).toEqual([]);
    expect(dark / total).toBeGreaterThanOrEqual(0.55);
  });

  it.each(FINISHED)("%s has a face plate that every face part lands on", (key) => {
    const def = BODIES[key];
    const plate = def.grid.join("").split("").filter((c) => c === "-").length;
    expect(plate).toBeGreaterThanOrEqual(60);
    const offPlate = new Set<string>();
    for (const seed of SEEDS.slice(0, 200)) {
      for (const p of placements({ body: key, flagged: false, seed })) {
        p.part.grid.forEach((row, dy) => {
          const cells = p.mirror ? [...row].reverse() : [...row];
          cells.forEach((c, dx) => {
            if (c === ".") return;
            const under = def.grid[p.y + dy]?.[p.x + dx];
            if (under !== "-" && under !== "=") offPlate.add(`r${p.y + dy}c${p.x + dx}`);
          });
        });
      }
    }
    expect([...offPlate]).toEqual([]);
  });

  it.each(FINISHED)("%s stands on the shared floor and eye line", (key) => {
    const def = BODIES[key];
    const rows = def.grid.map((r) => [...r].some(isInk));
    expect(rows.lastIndexOf(true)).toBe(29);
    expect(rows.indexOf(true)).toBeLessThanOrEqual(6);
    expect(def.anchors.eyes.y).toBeGreaterThanOrEqual(11);
    expect(def.anchors.eyes.y).toBeLessThanOrEqual(15);
  });
});

describe("the seed", () => {
  it("is stable, case-insensitive and trims", () => {
    expect(seedOf("Evil.COM ")).toBe(seedOf("evil.com"));
    expect(seedOf("evil.com")).not.toBe(seedOf("evil.net"));
  });

  it("spreads neighbouring indicators across every slot", () => {
    for (const slot of ["eyes", "mouth", "mark"] as const) {
      const seen = new Set(SEEDS.slice(0, 200).map((s) => partChoice({ grid: [], anchors: { eyes: { y: 0, spread: 0 } } }, s, slot)));
      expect(seen.size).toBe(PARTS[slot].length);
    }
  });

  it("pins golden seeds so a reordered part list is caught", () => {
    const def = { grid: [], anchors: { eyes: { y: 0, spread: 0 } } };
    const s = seedOf("8.8.8.8");
    expect(s).toBe(seedOf("8.8.8.8"));
    expect([partChoice(def, s, "eyes"), partChoice(def, s, "mouth"), partChoice(def, s, "mark")]).toMatchSnapshot();
  });
});

describe("horns", () => {
  it.each(BODY_KEYS)("%s gains pixels and loses none when flagged", (key: BodyKey) => {
    const seed = SEEDS[0];
    const plain = composeGrid({ body: key, flagged: false, seed });
    const horned = composeGrid({ body: key, flagged: true, seed });
    expect(horned.slice(HORN_ZONE.rows)).toEqual(plain.slice(HORN_ZONE.rows));
    expect(horned.join("")).not.toBe(plain.join(""));
    plain.forEach((row, y) => [...row].forEach((c, x) => {
      if (isInk(c)) expect(horned[y][x]).toBe(c);
    }));
  });
});

describe("toLayers", () => {
  it("merges each run of one tone into one rect, a layer per tone", () => {
    expect(toLayers(["##==", "-#.#"])).toEqual([
      { tone: "#", opacity: 1, rects: [{ x: 0, y: 0, w: 2 }, { x: 1, y: 1, w: 1 }, { x: 3, y: 1, w: 1 }] },
      { tone: "=", opacity: 0.55, rects: [{ x: 2, y: 0, w: 2 }] },
      { tone: "-", opacity: 0.25, rects: [{ x: 0, y: 1, w: 1 }] },
    ]);
  });

  it("emits nothing for an empty grid", () => {
    expect(toLayers(["....", "...."])).toEqual([]);
  });

  it.each(BODY_KEYS)("round-trips %s to the same drawing", (key) => {
    const spec = { body: key, flagged: true, seed: SEEDS[1] };
    expect(layersToGrid(spriteLayers(spec))).toEqual(composeGrid(spec));
  });
});
