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
  // A tall dome rather than a flat-topped block: the taper runs three rows
  // deep before the shoulders flare, so hosting reads as a robed guardian
  // instead of a crate with a face. The eyes are two single-pixel dots
  // floating inside the visor, not notches cut into its border, so they read
  // as "a face behind glass" rather than a grille.
  hosting: parseGrid(`
    .....######.....
    ....########....
    ...##########...
    ...##########...
    ...##########...
    ..###......###..
    ..##........##..
    ..##..#..#..##..
    ..##........##..
    ..##........##..
    ..##........##..
    .####......####.
    .##############.
    .##############.
    .##############.
    ..############..
  `),
  // Bat-like ear flaps rather than thin converging feelers: the first draft's
  // antenna read as a stray hair once the sprite was this small, and a pair of
  // solid ears silhouettes even at 16px. The ears flare wide at row 2, one row
  // later than the antenna they replace, so the horn zone at rows 0-1 stays
  // clear of them. Tapers to a sharper point at the base than any other body,
  // since a mobile address is the least anchored of the set.
  mobile: parseGrid(`
    ....#......#....
    ....##....##....
    ..###.####.###..
    ..############..
    ...##########...
    ..############..
    .##..........##.
    .##..........##.
    .##...#..#...##.
    .##..........##.
    .###........###.
    ..###......###..
    ...##########...
    ....########....
    .....######.....
    ......####......
  `),
  // A house: a steep straight-sided roof, an eave held wide for a full row
  // before the walls begin (rather than stepping straight into them), a
  // window, and a doorway notch cut into the base. The straight walls are the
  // one body in the set that does not taper or flare through its torso, and
  // the door is the only body with a gap cut into its bottom edge rather than
  // a point, a flare, or a flat close.
  residential: parseGrid(`
    .......##.......
    ......####......
    .....######.....
    ....########....
    ...##########...
    ..############..
    .#####....#####.
    ...##......##...
    ..##........##..
    ..##..#..#..##..
    ..##........##..
    ..##........##..
    ..##........##..
    ..##........##..
    ..#####..#####..
    ..#####..#####..
  `),
  // Used to go faceless on purpose, but a blank visor read as "unfinished"
  // more often than "unknown" once it sat next to seven bodies that all
  // stare back. Two dots now, same as the rest, and the ambiguity lives in
  // the scalloped hem instead: a three-bump close rather than a point or a
  // flare, since an ill-defined edge is still the whole point of the body.
  unknown: parseGrid(`
    ......####......
    .....######.....
    ....########....
    ...##########...
    ..############..
    .##############.
    .##..........##.
    .##...#..#...##.
    .##..........##.
    ..############..
    ...##########...
    ...##########...
    ....########....
    ....##.##.##....
    ................
    ................
  `),
  // No antenna stub: the aperture is the whole story here. It nests a lit
  // pupil inside a white ring inside the dark iris, three layers deep, which
  // is the one place in the set that goes that far for a single detail.
  scanner: parseGrid(`
    ................
    .......##.......
    ....########....
    ...##########...
    ..####....####..
    ..##........##..
    ..##..####..##..
    ..##..##.#..##..
    ..##..####..##..
    ..############..
    ...##########...
    .....######.....
    ................
    ................
    ................
    ................
  `),
  // A walker, not a mast: the first draft's transmitting antenna read as
  // furniture once it sat next to eight bodies that all have a face. Ears
  // poke out at row 2, one row later than the antenna they replace, so the
  // horn zone at rows 0-1 stays clear of them. Ears either side of a nested
  // eye, planted on two legs braced wide, so c2 reads as something that came
  // here under its own power rather than hardware bolted to a rack.
  c2: parseGrid(`
    ......####......
    .....######.....
    .##..........##.
    ..############..
    ..##........##..
    .##...####...##.
    .##...##.#...##.
    .##...####...##.
    ..############..
    .....##..##.....
    .....#....#.....
    ....#......#....
    ...##......##...
    ..##........##..
    .##..........##.
    ##............##
  `),
  // A peaked hood over a void, with no eyes: the first draft floated two lit
  // dots in the dark same as every other body, and the void stopped reading
  // as empty. A closed, bracket-shaped mouth low in the hood reads as
  // "nothing to see" without going all the way back to unknown's blank stare.
  anonymizer: parseGrid(`
    .......##.......
    ......####......
    .....######.....
    ....########....
    ....##....##....
    ...##......##...
    ...##......##...
    ..##........##..
    ..##..#..#..##..
    ..##..####..##..
    .###........###.
    .#####....#####.
    .##############.
    .##############.
    ................
    ................
  `),
  // A map pin: round head, tapering to a single point. Every other body here
  // narrows at the top and flares at the base; this one does the opposite on
  // purpose, since a domain is an address you navigate to rather than a
  // machine that just sits there, and the pin shape is a ready-made symbol
  // for exactly that. The eyes are the same two dots the rest of the set
  // uses now, held one row tall so the visor band above them keeps its
  // width, rather than the wide single band this body used to carve out.
  site: parseGrid(`
    ......####......
    .....######.....
    ....########....
    ...##########...
    ..############..
    .##############.
    .##..........##.
    .##...#..#...##.
    .##..........##.
    ..############..
    ...##########...
    ...##########...
    ...##########...
    .....######.....
    ......####......
    .......##.......
  `),
  // A sheet with a folded corner, two eyes, and lines of content. The right
  // eye carries the same dog-ear bite as the sheet's own corner, one pixel
  // deep, so the fold reads as this body's signature rather than a one-off
  // detail of the silhouette.
  file: parseGrid(`
    ................
    ................
    ..#########.....
    ..###########...
    ..##......####..
    ..##........##..
    ..##.##..#..##..
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
