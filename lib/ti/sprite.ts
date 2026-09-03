/**
 * 1-bit sprites, 16x16, stored as ASCII in source.
 *
 * A hex-per-row encoding would be four times smaller and completely
 * unreviewable: a one-character diff in hex is a change nobody can evaluate.
 * ASCII is editable in any editor with no tooling, and `git diff` shows what
 * actually changed about the drawing. The whole set is a couple of kilobytes of
 * text that gzips extremely well.
 *
 * Composition happens here, on the grid, and the conversion to rectangles
 * happens once at the end. Stacking three SVGs instead would render the same
 * picture but make "did the mark stay inside its well" untestable.
 */

export const SPRITE_SIZE = 16;

/** The mark well: rows 8 to 10, columns 5 to 10, inside the hosting body's
 *  chest, 6 wide by 3 tall. */
const MARK_X = 5;
const MARK_Y = 8;

export type BodyKey = "hosting" | "scanner" | "c2" | "anonymizer" | "site" | "file";
export type MarkKey = "aws" | "azure" | "gcp" | "cloudflare";
export type SpriteSpec = { body: BodyKey; mark?: MarkKey; flagged: boolean };
export type Rect = { x: number; y: number; w: number };

export const BODY_KEYS = [
  "hosting",
  "scanner",
  "c2",
  "anonymizer",
  "site",
  "file",
] as const satisfies readonly BodyKey[];

export const MARK_KEYS = [
  "aws",
  "azure",
  "gcp",
  "cloudflare",
] as const satisfies readonly MarkKey[];

/** Turn indented ASCII art into rows, rejecting anything that is not 1-bit. */
export function parseGrid(ascii: string): string[] {
  const rows = ascii
    .split("\n")
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
  for (const row of rows) {
    if (!/^[#.]+$/.test(row)) {
      throw new Error(`sprite rows may contain only # and . characters, got "${row}"`);
    }
  }
  return rows;
}

const BODIES: Record<BodyKey, string[]> = {
  // A rack with two eyes. Rows 8 to 10, columns 5 to 10, are the mark well,
  // filled here with a plain bar. Every provider substitutes that bar.
  hosting: parseGrid(`
    ................
    ...##########...
    ..############..
    ..##........##..
    ..##.##..##.##..
    ..##.##..##.##..
    ..##........##..
    ..############..
    ..##........##..
    ..##.######.##..
    ..##........##..
    ..############..
    ...##########...
    ....##....##....
    ...###....###...
    ................
  `),
  // One eye rather than two, plus an antenna. One eye reads instantly even
  // shrunk, and it happens to mean the right thing: the thing that is watching.
  scanner: parseGrid(`
    ................
    .......##.......
    .......##.......
    ....########....
    ..############..
    .##############.
    .###..####..###.
    .##..######..##.
    .##..######..##.
    .###..####..###.
    .##############.
    ..############..
    ....########....
    ...##......##...
    ..##........##..
    ................
  `),
  // A transmitting mast: a spine through a cross-arm, broadcast waves either
  // side, and a braced lattice splaying out to the feet. No face, because the
  // two aerials of the first draft read as a car's wing mirrors.
  c2: parseGrid(`
    ................
    .......##.......
    ...##########...
    .......##.......
    ..##...##...##..
    .##....##....##.
    .##....##....##.
    ..##...##...##..
    ....########....
    ....##....##....
    ....########....
    ....##....##....
    ...##......##...
    ...##......##...
    ..##........##..
    .###........###.
  `),
  // A hood with nothing under it but eyes.
  anonymizer: parseGrid(`
    ................
    .....######.....
    ....########....
    ...##########...
    ..############..
    ..###......###..
    ..##........##..
    ..##.##..##.##..
    ..##........##..
    ..############..
    ..############..
    .##############.
    .##############.
    .####......####.
    .###........###.
    ................
  `),
  // A window with a title bar, two eyes, and lines of content.
  site: parseGrid(`
    ................
    .##############.
    .##############.
    .#............#.
    .#.##......##.#.
    .#.##......##.#.
    .#............#.
    .#....####....#.
    .#............#.
    .#.##########.#.
    .#............#.
    .#.########...#.
    .#............#.
    .##############.
    ................
    ................
  `),
  // A sheet with a folded corner, two eyes, and lines of content.
  file: parseGrid(`
    ................
    ..#########.....
    ..###########...
    ..##......####..
    ..##........##..
    ..##.##..##.##..
    ..##.##..##.##..
    ..##........##..
    ..##.######.##..
    ..##........##..
    ..##.######.##..
    ..##........##..
    ..##.####...##..
    ..##........##..
    ..############..
    ................
  `),
};

/**
 * 6x3 chest marks. Drawing each provider's real logo does not survive 16x16 at
 * one bit, and would mean reproducing trademarks. One shared body plus a
 * changing mark reads as a family automatically, and a new provider costs six
 * by three pixels rather than a whole character.
 */
export const MARKS: Record<MarkKey, string[]> = {
  aws: parseGrid(`
    ..##..
    .####.
    ##..##
  `),
  azure: parseGrid(`
    ##..##
    .####.
    ..##..
  `),
  gcp: parseGrid(`
    .####.
    ##..##
    .####.
  `),
  cloudflare: parseGrid(`
    ..##..
    .####.
    ######
  `),
};

/**
 * Two horns over the top corners, composited onto whichever base was chosen.
 * Better than a corner warning badge on three counts: it needs no explanation,
 * it is native to the idiom being borrowed, and it produces an evil AWS rather
 * than an AWS with a sticker on it. A `.` here is transparent.
 */
const HORNS = parseGrid(`
  ##...........###
  .##.........##..
`);

/** Overwrite a rectangular region, used for the mark well. */
function paintOpaque(rows: string[][], patch: string[], x0: number, y0: number): void {
  patch.forEach((row, dy) => {
    [...row].forEach((ch, dx) => {
      rows[y0 + dy][x0 + dx] = ch;
    });
  });
}

/** Add pixels only, used for the overlay. */
function paintOver(rows: string[][], patch: string[], x0: number, y0: number): void {
  patch.forEach((row, dy) => {
    [...row].forEach((ch, dx) => {
      if (ch === "#") rows[y0 + dy][x0 + dx] = "#";
    });
  });
}

/** Base body, then the provider mark into its well, then the overlay. */
export function composeGrid(spec: SpriteSpec): string[] {
  const rows = BODIES[spec.body].map((r) => [...r]);
  if (spec.mark && spec.body === "hosting") {
    paintOpaque(rows, MARKS[spec.mark], MARK_X, MARK_Y);
  }
  if (spec.flagged) paintOver(rows, HORNS, 0, 0);
  return rows.map((r) => r.join(""));
}

/** Merge each horizontal run of set pixels into one rectangle. A 16x16 sprite
 *  lands around 30 to 40 of these, which is a small enough SVG to inline. */
export function toRects(grid: string[]): Rect[] {
  const out: Rect[] = [];
  grid.forEach((row, y) => {
    let run = 0;
    [...row].forEach((ch, x) => {
      if (ch === "#") {
        run++;
        return;
      }
      if (run) out.push({ x: x - run, y, w: run });
      run = 0;
    });
    if (run) out.push({ x: row.length - run, y, w: run });
  });
  return out;
}

/** The whole pipeline, which is what the renderer calls. */
export function spriteRects(spec: SpriteSpec): Rect[] {
  return toRects(composeGrid(spec));
}
