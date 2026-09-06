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
 * picture but make "did the flag overlay stay off the body" untestable.
 */

export const SPRITE_SIZE = 16;

export type BodyKey =
  | "hosting"
  | "mobile"
  | "residential"
  | "unknown"
  | "scanner"
  | "c2"
  | "anonymizer"
  | "site"
  | "file";
export type SpriteSpec = { body: BodyKey; flagged: boolean };
export type Rect = { x: number; y: number; w: number };

export const BODY_KEYS = [
  "hosting",
  "mobile",
  "residential",
  "unknown",
  "scanner",
  "c2",
  "anonymizer",
  "site",
  "file",
] as const satisfies readonly BodyKey[];

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
  // A flat-topped guardian. Anonymizer, scanner and c2 all taper from a point,
  // so a flat top is the one silhouette cue that still reads as "a different
  // creature" once the sprite is down to 16px. The eyes sit one pixel in from
  // the frame rather than against it, the same gap anonymizer's eyes leave, so
  // this reads as the same family's "peering out of the dark" rather than a
  // face printed flush on a wall.
  hosting: parseGrid(`
    ....########....
    ....########....
    ...##########...
    ...##########...
    ..############..
    ..############..
    ..##.#....#.##..
    ..##.#....#.##..
    ..##........##..
    ..##........##..
    ..###......###..
    .#####....#####.
    .##############.
    .##############.
    .##############.
    .##############.
  `),
  // Two thin feelers converging to a point above the head, rather than a pair
  // of thick prongs: bug-antenna, not bull-horns. They stay inside columns
  // 4-11 at rows 0-1 so the horn zone the flagged overlay owns stays clear.
  // Tapers to a point at the base rather than flaring, since a mobile address
  // is small and does not sit still the way a rack does.
  mobile: parseGrid(`
    ....#......#....
    .....#....#.....
    ......#..#......
    .......##.......
    ......####......
    .....######.....
    ....########....
    ..############..
    .##############.
    ..##.#....#.##..
    .##..........##.
    .##..........##.
    ..############..
    ...##########...
    ....########....
    .....######.....
  `),
  // A house: a steep straight-sided roof, an overhanging eave (one row wider
  // than the walls it shelters), a window, and a doorway notch cut into the
  // base. The straight walls are the one body in the set that does not taper
  // or flare through its torso, and the door is the only body with a gap cut
  // into its bottom edge rather than a point, a flare, or a flat close.
  residential: parseGrid(`
    .......##.......
    ......####......
    .....######.....
    ....########....
    ...##########...
    .##############.
    ..############..
    ..##.#....#.##..
    ..##.#....#.##..
    ..##........##..
    ..##........##..
    ..##........##..
    ..##........##..
    ..##........##..
    ..#####..#####..
    ..#####..#####..
  `),
  // No eyes, on purpose: every other body stares back, and "unknown" is the
  // one case with nothing to stare with. Fades in from an empty top row and
  // out to an empty bottom row rather than filling the frame edge to edge,
  // and closes on a scalloped three-bump hem instead of a point or a flare,
  // since an ill-defined edge is the whole point of the body.
  unknown: parseGrid(`
    ................
    ......####......
    .....######.....
    ....########....
    ...##########...
    ..############..
    .##############.
    .##..........##.
    .##..........##.
    .##..........##.
    ..############..
    ...##########...
    ....########....
    ....##.##.##....
    ....##.##.##....
    ................
  `),
  // One eye, and only one. The first draft carved two unlit notches either
  // side of a lit centre, so the negative space made two eyes and the sprite
  // read as an insect. The aperture here is a single connected ring around one
  // pupil, which cannot be read as a pair. The antenna stays centred so the
  // horns land either side of it rather than on top of it.
  scanner: parseGrid(`
    ................
    .......##.......
    .......##.......
    ....########....
    ..############..
    .##############.
    .####......####.
    .##...####...##.
    .##...####...##.
    .####......####.
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
  // A peaked hood over a void, with two lit eyes floating in it. The peak is
  // load-bearing: the first draft's dome plus a horizontal face band read as a
  // windscreen, and the whole sprite read as a car.
  anonymizer: parseGrid(`
    ................
    .......##.......
    ......####......
    .....######.....
    .....######.....
    ....###..###....
    ....##....##....
    ...##......##...
    ...##.#..#.##...
    ...##.#..#.##...
    ..##........##..
    ..##........##..
    ..###......###..
    .#####....#####.
    .##############.
    .##############.
  `),
  // A map pin: round head, one big eye, tapering to a single point. Every
  // other body here narrows at the top and flares at the base; this one
  // does the opposite on purpose, since a domain is an address you navigate
  // to rather than a machine that just sits there, and the pin shape is a
  // ready-made symbol for exactly that. The eye is one wide block rather
  // than the two small dots the other faces use, since a lone stare reads
  // as "a place looking back" instead of "a face."
  site: parseGrid(`
    ......####......
    .....######.....
    ....########....
    ...##########...
    ..############..
    .##############.
    .##...####...##.
    .##...####...##.
    .##...####...##.
    .##..........##.
    ..############..
    ...##########...
    ....########....
    .....######.....
    ......####......
    .......##.......
  `),
  // A sheet with a folded corner, two eyes, and lines of content. It sits a
  // row lower than it looks like it should: the top edge at row 1 ran under
  // the horns' inner ends, and moving the whole sheet down was the only fix
  // that left the dog-ear intact. Narrowing row 1 instead chamfers the
  // top-left, and then the sheet reads as cut at both corners.
  file: parseGrid(`
    ................
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
  `),
};

/**
 * Two horns over the top corners, composited onto whichever base was chosen.
 * Better than a corner warning badge on three counts: it needs no explanation,
 * it is native to the idiom being borrowed, and it produces an evil host
 * rather than a host with a sticker on it. A `.` here is transparent.
 */
const HORNS = parseGrid(`
  ##...........###
  .##.........##..
`);

/** Add pixels only, used for the overlay. */
function paintOver(rows: string[][], patch: string[], x0: number, y0: number): void {
  patch.forEach((row, dy) => {
    [...row].forEach((ch, dx) => {
      if (ch === "#") rows[y0 + dy][x0 + dx] = "#";
    });
  });
}

/** Base body, then the overlay. */
export function composeGrid(spec: SpriteSpec): string[] {
  const rows = BODIES[spec.body].map((r) => [...r]);
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
