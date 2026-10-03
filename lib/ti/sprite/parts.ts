import { partGrid, type Mood, type PartDef } from "./engine";

/**
 * The sibling slots. A body's silhouette is its class; the face is its mood
 * and its individuality.
 *
 * Eyes and mouths come in one set per mood, and the mood follows the verdict
 * (see `moodFor`), so a creature's expression is a second, colour-free reading
 * of the verdict alongside the horns: calm when clean, wary when something is
 * off, hostile when it is malicious. The seed then picks within that mood's
 * set, which is what makes two clean hosts look like siblings rather than
 * twins.
 *
 * APPEND ONLY within each list. The seed picks a variant by index, so inserting
 * or reordering an entry re-rolls every creature already drawn. The
 * golden-seed test in sprite.test.ts exists to catch exactly that.
 *
 * Every part is drawn for the house style: dark `#` features on the light face
 * plate, `-` to leave a lit highlight inside a feature, and no knockouts (a
 * hole through the plate shows the page behind it, which reads as damage, not
 * as a face). Eyes fit a 4x4 box, mouths 6x2, marks 6x4, which every body's
 * plate is tested to hold.
 */

/** One eye, drawn on the left of the midline and mirrored to the right. Its
 *  rightmost column is the inner corner, so a hostile eye's brow descends
 *  toward it. */
export const EYES: Record<Mood, PartDef[]> = {
  calm: [
    // round
    {
      grid: partGrid(`
        .##.
        ####
        ####
        .##.
      `),
    },
    // round, lit
    {
      grid: partGrid(`
        .##.
        #-##
        ####
        .##.
      `),
    },
    // tall bean
    {
      grid: partGrid(`
        ##
        ##
        ##
        ##
      `),
    },
    // content, closed in an arc
    {
      grid: partGrid(`
        ....
        .##.
        #..#
        ....
      `),
    },
    // wide and level
    {
      grid: partGrid(`
        ....
        ####
        ####
        ....
      `),
    },
  ],
  wary: [
    // narrowed
    {
      grid: partGrid(`
        ....
        ####
        .##.
        ....
      `),
    },
    // brow raised over a small eye
    {
      grid: partGrid(`
        ####
        ....
        .##.
        .##.
      `),
    },
    // heavy lid
    {
      grid: partGrid(`
        ####
        ####
        .##.
        ....
      `),
    },
    // squint
    {
      grid: partGrid(`
        ....
        ....
        ####
        ....
      `),
    },
  ],
  hostile: [
    // Three wide, not four: on a narrow plate two four-wide slants met in the
    // middle and read as one V, a frown with no eyes in it.
    // slanted, brow falling to the inner corner
    {
      grid: partGrid(`
        #..
        ##.
        ###
      `),
    },
    // slanted slit
    {
      grid: partGrid(`
        ##.
        ###
        .##
      `),
    },
    // glaring, lit
    {
      grid: partGrid(`
        #..
        ##.
        #-#
        ###
      `),
    },
    // scowl
    {
      grid: partGrid(`
        ##.
        ###
        ###
      `),
    },
  ],
};

/** Centred on the midline. `null` is a deliberate "no mouth" variant, which
 *  only a calm face may have: a hostile creature always shows its teeth. */
export const MOUTHS: Record<Mood, (PartDef | null)[]> = {
  calm: [
    null,
    // smile
    {
      grid: partGrid(`
        #....#
        .####.
      `),
    },
    // small
    {
      grid: partGrid(`
        ......
        .####.
      `),
    },
    // round
    {
      grid: partGrid(`
        ..##..
        ..##..
      `),
    },
  ],
  wary: [
    // flat
    {
      grid: partGrid(`
        ......
        ######
      `),
    },
    // wavering
    {
      grid: partGrid(`
        .#..#.
        #.##.#
      `),
    },
    // pulled to one side
    {
      grid: partGrid(`
        ......
        ..####
      `),
    },
    // pursed
    {
      grid: partGrid(`
        ..##..
        ......
      `),
    },
  ],
  hostile: [
    // fangs
    {
      grid: partGrid(`
        ######
        .#..#.
      `),
    },
    // clenched teeth
    {
      grid: partGrid(`
        ######
        #.##.#
      `),
    },
    // tusks
    {
      grid: partGrid(`
        .#..#.
        ######
      `),
    },
    // roar
    {
      grid: partGrid(`
        .####.
        ##..##
      `),
    },
  ],
};

/** Centred on the midline: a brand, a scar, a plate. Mood-independent, since
 *  a mark is who the creature is rather than how it feels, and drawn in the
 *  mid tone so it never competes with the face. `null` is "unmarked". */
export const MARKS: (PartDef | null)[] = [
  null,
  // stud
  {
    grid: partGrid(`
      ==
      ==
    `),
  },
  // chevron
  {
    grid: partGrid(`
      =...=
      .=.=.
      ..=..
    `),
  },
  // cross
  {
    grid: partGrid(`
      .=.
      ===
      .=.
    `),
  },
  // diamond
  {
    grid: partGrid(`
      .=.
      =.=
      .=.
    `),
  },
  // bands
  {
    grid: partGrid(`
      ======
      ......
      ======
    `),
  },
  // ring
  {
    grid: partGrid(`
      .==.
      =..=
      =..=
      .==.
    `),
  },
];

/** A single central pupil per mood, for a body whose whole plate is one eye
 *  (the scanner). Drawn as the left half and mirrored at spread 0, so the
 *  pair meets on the midline. */
export const PUPILS: Record<Mood, PartDef> = {
  // round
  calm: {
    grid: partGrid(`
      ##
      ##
    `),
  },
  // lidded: the top half only
  wary: {
    grid: partGrid(`
      ##
      ..
    `),
  },
  // a vertical slit, the two halves meeting in one 2px line
  hostile: {
    grid: partGrid(`
      .#
      .#
    `),
  },
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
