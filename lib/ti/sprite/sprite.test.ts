import { describe, expect, it } from "vitest";
import {
  BODIES,
  BODY_KEYS,
  HORN,
  HORN_ZONE,
  EYES,
  MARKS,
  MOODS,
  MOUTHS,
  SPRITE_SIZE,
  composeGrid,
  hamming,
  isInk,
  paintPart,
  parseGrid,
  partSheet,
  moodFor,
  partFor,
  placements,
  seedOf,
  silhouette16,
  spriteLayers,
  outlineRects,
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

describe("partSheet", () => {
  it("splits a side-by-side sheet into one part per column", () => {
    expect(partSheet(`
      #.  ###
      ##  ...
    `)).toEqual([{ grid: ["#.", "##"] }, { grid: ["###"] }]);
  });

  it("keeps a part's leading blank rows, which place it", () => {
    expect(partSheet(`
      ..
      ##
    `)).toEqual([{ grid: ["..", "##"] }]);
  });

  it("rejects ragged sheets and foreign characters", () => {
    expect(() => partSheet("## ##\n##")).toThrow(/columns/);
    expect(() => partSheet("#X")).toThrow();
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

  it.each(BODY_KEYS)("%s keeps a clear cell between its ink and either horn", (key) => {
    const g = BODIES[key].grid;
    const horn: [number, number][] = [];
    HORN.forEach((row, y) =>
      [...row].forEach((c, x) => {
        if (c === "#") horn.push([x, y], [SPRITE_SIZE - 1 - x, y]);
      }),
    );
    g.forEach((row, y) =>
      [...row].forEach((c, x) => {
        if (!isInk(c)) return;
        for (const [hx, hy] of horn) {
          const near = Math.max(Math.abs(hx - x), Math.abs(hy - y)) < 2;
          expect(near ? `${key} r${y}c${x} touches a horn` : "clear").toBe("clear");
        }
      }),
    );
  });

  it.each(BODY_KEYS)("%s pins a part for every mood, or none", (key) => {
    for (const pinned of Object.values(BODIES[key].fixed ?? {})) {
      if (pinned === null) continue;
      for (const mood of MOODS) expect(pinned[mood]?.grid.length).toBeGreaterThan(0);
    }
  });
});

describe("finished bodies", () => {
  it.each(FINISHED)("%s never has a part paint outside its outline", (key) => {
    const def = BODIES[key];
    for (const seed of SEEDS) {
      for (const p of MOODS.flatMap((mood) => placements({ body: key, flagged: false, mood, seed }))) {
        const scratch = def.grid.map((r) => [...r]);
        expect(paintPart(scratch, def.grid, p.part.grid, p.x, p.y, p.mirror)).toBe(0);
      }
    }
  });

  it.each(FINISHED)("%s produces visibly different siblings", (key) => {
    const interiors = new Set(SEEDS.slice(0, 64).map((seed) => composeGrid({ body: key, flagged: false, mood: "calm", seed }).join("")));
    const free = (["eyes", "mouth", "mark"] as const).filter((s) => BODIES[key].fixed?.[s] === undefined).length;
    expect(interiors.size).toBeGreaterThanOrEqual(free >= 2 ? 16 : 4);
  });

  it.each(FINISHED)("%s keeps its outline whatever the seed", (key) => {
    const bare = BODIES[key].grid.map((r) => [...r].map((c) => (isInk(c) ? "#" : ".")).join(""));
    for (const seed of SEEDS.slice(0, 64)) {
      const g = composeGrid({ body: key, flagged: false, mood: MOODS[seed % 3], seed });
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

  // Round, not chunky: the outline may step at 1px, which is what lets a
  // curve read as a curve at 32, but no edge pixel may hang off the body on a
  // single neighbour. A spur like that is noise at icon size, not shape.
  it.each(FINISHED)("%s has a smooth outline with no stray pixels", (key) => {
    const g = BODIES[key].grid;
    const spurs: string[] = [];
    g.forEach((row, y) => [...row].forEach((c, x) => {
      if (!isInk(c)) return;
      const n = [ink(g, x - 1, y), ink(g, x + 1, y), ink(g, x, y - 1), ink(g, x, y + 1)].filter(Boolean).length;
      if (n < 2) spurs.push(`r${y}c${x}`);
    }));
    expect(spurs).toEqual([]);
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
      for (const p of MOODS.flatMap((mood) => placements({ body: key, flagged: false, mood, seed }))) {
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

  const bare = { grid: [], anchors: { eyes: { y: 0, spread: 0 } } };

  it("spreads neighbouring indicators across every variant of every slot", () => {
    for (const mood of MOODS) {
      const lists = { eyes: EYES[mood], mouth: MOUTHS[mood], mark: MARKS };
      for (const slot of ["eyes", "mouth", "mark"] as const) {
        const seen = new Set(SEEDS.slice(0, 200).map((seed) => partFor(bare, { mood, seed }, slot)));
        expect(seen.size).toBe(lists[slot].length);
      }
    }
  });

  it("pins golden seeds so a reordered part list is caught", () => {
    const s = seedOf("8.8.8.8");
    const index = (mood: (typeof MOODS)[number]) => [
      EYES[mood].indexOf(partFor(bare, { mood, seed: s }, "eyes")!),
      MOUTHS[mood].indexOf(partFor(bare, { mood, seed: s }, "mouth")),
      MARKS.indexOf(partFor(bare, { mood, seed: s }, "mark")),
    ];
    expect(MOODS.map(index)).toMatchSnapshot();
  });
});

describe("the face follows the verdict", () => {
  it("is calm when clean or unknown, wary when off, hostile when malicious", () => {
    expect(moodFor("clean")).toBe("calm");
    expect(moodFor("unknown")).toBe("calm");
    expect(moodFor("low")).toBe("wary");
    expect(moodFor("suspicious")).toBe("wary");
    expect(moodFor("malicious")).toBe("hostile");
  });

  it.each(FINISHED)("%s shows a different face in each mood", (key) => {
    const seed = SEEDS[2];
    const faces = new Set(MOODS.map((mood) => composeGrid({ body: key, flagged: false, mood, seed }).join("")));
    expect(faces.size).toBe(3);
  });

  it("never gives a hostile face a missing mouth", () => {
    expect(MOUTHS.hostile).not.toContain(null);
  });

  it("draws every face part without knocking holes in the plate", () => {
    const parts = [...MOODS.flatMap((m) => [...EYES[m], ...MOUTHS[m]]), ...MARKS];
    for (const p of parts) if (p) expect(p.grid.join("")).not.toContain("o");
  });
});

describe("horns", () => {
  it.each(BODY_KEYS)("%s gains pixels and loses none when flagged", (key: BodyKey) => {
    const seed = SEEDS[0];
    const plain = composeGrid({ body: key, flagged: false, mood: "hostile", seed });
    const horned = composeGrid({ body: key, flagged: true, mood: "hostile", seed });
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
    const spec = { body: key, flagged: true, mood: "wary" as const, seed: SEEDS[1] };
    expect(layersToGrid(spriteLayers(spec))).toEqual(composeGrid(spec));
  });
});

describe("outlineRects", () => {
  it("rings every empty cell that touches ink edge-on, holes included", () => {
    const grid = Array.from({ length: SPRITE_SIZE }, () => ".".repeat(SPRITE_SIZE));
    grid[5] = "....###." + ".".repeat(SPRITE_SIZE - 8);
    grid[6] = "....#.#." + ".".repeat(SPRITE_SIZE - 8);
    grid[7] = "....###." + ".".repeat(SPRITE_SIZE - 8);
    expect(outlineRects(grid)).toEqual([
      { x: 4, y: 4, w: 3 },
      { x: 3, y: 5, w: 1 }, { x: 7, y: 5, w: 1 },
      { x: 3, y: 6, w: 1 }, { x: 5, y: 6, w: 1 }, { x: 7, y: 6, w: 1 },
      { x: 3, y: 7, w: 1 }, { x: 7, y: 7, w: 1 },
      { x: 4, y: 8, w: 3 },
    ]);
  });

  it("steps one cell past the grid where ink touches its edge", () => {
    const grid = Array.from({ length: SPRITE_SIZE }, () => ".".repeat(SPRITE_SIZE));
    grid[0] = "#" + ".".repeat(SPRITE_SIZE - 2) + "#";
    expect(outlineRects(grid)).toEqual([
      { x: 0, y: -1, w: 1 }, { x: SPRITE_SIZE - 1, y: -1, w: 1 },
      { x: -1, y: 0, w: 1 }, { x: 1, y: 0, w: 1 },
      { x: SPRITE_SIZE - 2, y: 0, w: 1 }, { x: SPRITE_SIZE, y: 0, w: 1 },
      { x: 0, y: 1, w: 1 }, { x: SPRITE_SIZE - 1, y: 1, w: 1 },
    ]);
  });

  it.each(BODY_KEYS)("never rings a cell %s inks", (key) => {
    const grid = composeGrid({ body: key, flagged: true, mood: "hostile", seed: SEEDS[2] });
    for (const r of outlineRects(grid))
      for (let i = 0; i < r.w; i++) expect(isInk(grid[r.y]?.[r.x + i])).toBe(false);
  });
});
