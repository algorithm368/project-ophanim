import { partGrid, type PartDef, type Slot } from "./engine";

/**
 * The sibling slots. A body's silhouette is its class; these are what make one
 * creature of that class different from the next.
 *
 * APPEND ONLY. The seed picks a variant by index, so inserting or reordering an
 * entry re-rolls every creature already drawn. The golden-seed test in
 * sprite.test.ts exists to catch exactly that.
 *
 * Parts paint only over the body's own ink. `#` is full ink, `=` and `-` the
 * two lighter tones, `o` knocks a pixel out to the background (a hole), and
 * `.` leaves the body alone. Bodies are filled with a lighter tone so that both
 * a dark `#` feature and a knocked-out `o` feature read against them.
 */

/** One eye, drawn on the left and mirrored to the right. */
export const EYES: PartDef[] = [
  // 0 dot
  {
    grid: partGrid(`
      ##
      ##
    `),
  },
  // 1 tall
  {
    grid: partGrid(`
      ##
      ##
      ##
    `),
  },
  // 2 round, lit
  {
    grid: partGrid(`
      .#.
      #o#
      .#.
    `),
  },
  // 3 slit
  {
    grid: partGrid(`
      ####
    `),
  },
  // 4 slanted, angled in toward the midline
  {
    grid: partGrid(`
      #..
      ##.
      ###
    `),
  },
  // 5 heavy-lidded
  {
    grid: partGrid(`
      ####
      .##.
    `),
  },
  // 6 large, ringed, pupil off-centre
  {
    grid: partGrid(`
      .##.
      #oo#
      #o##
      .##.
    `),
  },
  // 7 hollow
  {
    grid: partGrid(`
      ooo
      o#o
      ooo
    `),
  },
];

/** Centred on the midline. `null` is a deliberate "no mouth" variant. */
export const MOUTHS: (PartDef | null)[] = [
  null,
  // 1 flat
  {
    grid: partGrid(`
      ######
    `),
  },
  // 2 smile
  {
    grid: partGrid(`
      #....#
      .####.
    `),
  },
  // 3 fangs
  {
    grid: partGrid(`
      ######
      .#..#.
    `),
  },
  // 4 open
  {
    grid: partGrid(`
      oo
      oo
    `),
  },
  // 5 zigzag
  {
    grid: partGrid(`
      #.#.#.
      .#.#.#
    `),
  },
];

/** Centred on the midline: a brand, a scar, a plate. `null` is "unmarked". */
export const MARKS: (PartDef | null)[] = [
  null,
  // 1 stud
  {
    grid: partGrid(`
      oo
      oo
    `),
  },
  // 2 chevron
  {
    grid: partGrid(`
      #...#
      .#.#.
      ..#..
    `),
  },
  // 3 cross
  {
    grid: partGrid(`
      .#.
      ###
      .#.
    `),
  },
  // 4 diamond
  {
    grid: partGrid(`
      .o.
      ooo
      .o.
    `),
  },
  // 5 bands
  {
    grid: partGrid(`
      ######
      ......
      ######
    `),
  },
  // 6 ring
  {
    grid: partGrid(`
      .##.
      #..#
      #..#
      .##.
    `),
  },
];

export const PARTS: Record<Slot, readonly (PartDef | null)[]> = {
  eyes: EYES,
  mouth: MOUTHS,
  mark: MARKS,
};

/**
 * Horns over the top corners when the indicator is flagged. Left horn here,
 * mirrored onto the right. Additive and painted outside the body, which is why
 * every body keeps the horn zone (top 4 rows, outer 8 columns each side) clear.
 * A shape difference, so the flagged state survives greyscale and colour
 * blindness rather than leaning on the verdict colour alone.
 */
export const HORN = partGrid(`
  ##......
  ###.....
  .####...
  ..#####.
`);

export const HORN_ZONE = { rows: 4, cols: 8 } as const;
