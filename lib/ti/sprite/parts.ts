import { partGrid, partSheet, type Mood, type PartDef } from "./engine";

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
  // round, round and lit, tall bean, content (closed in an arc), wide and level
  calm: partSheet(`
    .##.  .##.  ##  ....  ....
    ####  #-##  ##  .##.  ####
    ####  ####  ##  #..#  ####
    .##.  .##.  ##  ....  ....
  `),
  // Every wary eye is at least two rows deep: one-row lids and squints
  // vanished on the plate, and wary then read as calm.
  // lidded (flat top), brow raised over a small eye, heavy lid, narrowed
  wary: partSheet(`
    ....  ####  ####  ....
    ####  ....  ####  ####
    ####  .##.  .##.  .###
    .##.  .##.  ....  ....
  `),
  // Three wide, not four: on a narrow plate two four-wide slants met in the
  // middle and read as one V, a frown with no eyes in it.
  // slanted (brow falling to the inner corner), slanted slit, glaring and lit, scowl
  hostile: partSheet(`
    #..  ##.  #..  ##.
    ##.  ###  ##.  ###
    ###  .##  #-#  ###
    ...  ...  ###  ...
  `),
};

/** Centred on the midline. `null` is a deliberate "no mouth" variant, which
 *  only a calm face may have: a hostile creature always shows its teeth. */
export const MOUTHS: Record<Mood, (PartDef | null)[]> = {
  // none, smile, small, round
  calm: [
    null,
    ...partSheet(`
      #....#  ......  ..##..
      .####.  .####.  ..##..
    `),
  ],
  // flat, wavering, pulled to one side, pursed
  wary: partSheet(`
    ......  .#..#.  ......  ..##..
    ######  #.##.#  ..####  ......
  `),
  // fangs, clenched teeth, tusks, roar
  hostile: partSheet(`
    ######  ######  .#..#.  .####.
    .#..#.  #.##.#  ######  ##..##
  `),
};

/** Centred on the midline: a brand, a scar, a plate. Mood-independent, since
 *  a mark is who the creature is rather than how it feels, and drawn in the
 *  mid tone so it never competes with the face. `null` is "unmarked". */
export const MARKS: (PartDef | null)[] = [
  null,
  // stud, chevron, cross, diamond, bands, ring
  ...partSheet(`
    ==  =...=  .=.  .=.  ======  .==.
    ==  .=.=.  ===  =.=  ......  =..=
    ..  ..=..  .=.  .=.  ======  =..=
    ..  .....  ...  ...  ......  .==.
  `),
];

/** A single central pupil per mood, for a body whose whole plate is one eye
 *  (the scanner). Drawn as the left half and mirrored at spread 0, so the
 *  pair meets on the midline: round, lidded (the top half only), and a
 *  vertical slit where the two halves meet in one 2px line. */
const [ROUND, LIDDED, SLIT] = partSheet(`
  ##  ##  .#
  ##  ..  .#
`);
export const PUPILS: Record<Mood, PartDef> = { calm: ROUND, wary: LIDDED, hostile: SLIT };

/**
 * Horns over the top corners when the indicator is flagged. Left horn here,
 * mirrored onto the right. Additive and painted outside the body, which is why
 * every body keeps the horn zone (top 4 rows, outer 8 columns each side) clear.
 * A shape difference, so the flagged state survives greyscale and colour
 * blindness rather than leaning on the verdict colour alone.
 *
 * Three rows inside a four-row zone, so the zone's last row is always empty:
 * with the outline ring drawn round both, a horn that came within a cell of
 * the body merged into it and stopped reading as a horn.
 */
export const HORN = partGrid(`
  ##......
  .###....
  ..#####.
`);

export const HORN_ZONE = { rows: 4, cols: 8 } as const;

/** The anonymizer's Fawkes moustache, pinned as its mouth so the mask keeps
 *  its signature while the mood still reads: curled up in a smirk, drooping
 *  flat, and bristling over bared teeth. 10 wide, centred like any mouth. */
const [SMIRK, DROOP, BRISTLE] = partSheet(`
  #........#  ..........  #........#
  #...##...#  ....##....  #...##...#
  .###..###.  .###..###.  .###..###.
  ..........  #........#  ...####...
`);
export const MOUSTACHE: Record<Mood, PartDef> = { calm: SMIRK, wary: DROOP, hostile: BRISTLE };
