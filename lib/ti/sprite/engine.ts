/**
 * Sprites, 32x32, four tones, stored as ASCII in source.
 *
 * ASCII rather than hex or PNG because a drawing has to survive code review:
 * `git diff` on a grid shows what changed about the picture, and any editor can
 * change it with no tooling. The whole set gzips to almost nothing.
 *
 * A creature is a body (the class, fixed silhouette) plus parts (eyes, mouth,
 * mark) chosen by a seed taken from the indicator. Parts only ever paint over
 * the body's existing ink, so two creatures of one class are siblings: same
 * outline, different face. Composition happens here, on the grid; conversion
 * to rectangles happens once at the end, which keeps "did that part stay inside
 * the body" a testable question.
 */

export const SPRITE_SIZE = 32;

/** Tones are opacity steps of `currentColor`, so the monochrome skin holds and
 *  the verdict colour still owns the hue. */
export const TONES = { "#": 1, "=": 0.55, "-": 0.25 } as const;
export type Tone = keyof typeof TONES;

export const IP_BODY_KEYS = ["hosting", "residential", "mobile", "unknown", "scanner", "c2", "anonymizer", "tor"] as const;
export const DOMAIN_BODY_KEYS = ["site", "landmark", "hatchling", "husk", "courier", "phishing", "spam"] as const;
export const FILE_BODY_KEYS = ["file", "exe", "elf", "apk", "doc", "script", "archive", "malware", "ransomware"] as const;

export type IpBodyKey = (typeof IP_BODY_KEYS)[number];
export type DomainBodyKey = (typeof DOMAIN_BODY_KEYS)[number];
export type FileBodyKey = (typeof FILE_BODY_KEYS)[number];
export type BodyKey = IpBodyKey | DomainBodyKey | FileBodyKey;

export const BODY_KEYS = [...IP_BODY_KEYS, ...DOMAIN_BODY_KEYS, ...FILE_BODY_KEYS] as const;

export type Slot = "eyes" | "mouth" | "mark";

/**
 * How the creature looks out at you, which follows the verdict: calm when
 * clean or unknown, wary when something is off, hostile when it is malicious.
 * See `moodFor`.
 */
export const MOODS = ["calm", "wary", "hostile"] as const;
export type Mood = (typeof MOODS)[number];

export type Verdict = "clean" | "low" | "suspicious" | "malicious" | "unknown";

/** The face follows the verdict. Low and suspicious share "wary": both say
 *  something is off without anyone calling it malicious, which is the one
 *  thing that earns bared teeth. */
export function moodFor(verdict: Verdict): Mood {
  if (verdict === "malicious") return "hostile";
  if (verdict === "low" || verdict === "suspicious") return "wary";
  return "calm";
}

/**
 * Where the parts go. Every body is laid out about a vertical midline at
 * `mid` (default 16, the line between columns 15 and 16).
 *
 * - `eyes.y` is the top row of both eyes; `eyes.spread` is the gap from the
 *   midline to each eye's inner edge, so the pair is mirror symmetric.
 * - `mouth.y` / `mark.y` are the part's top row; it is centred on the midline.
 *
 * Omitting `mouth` or `mark` means the body has no room (or no use) for it.
 */
export type Anchors = {
  mid?: number;
  eyes: { y: number; spread: number };
  mouth?: { y: number };
  mark?: { y: number };
};

export type BodyDef = {
  grid: string[];
  anchors: Anchors;
  /** Slots this body's signature owns, pinned instead of seeded. `null` leaves
   *  the slot empty (a plate with no room for a mark); a per-mood set keeps
   *  the expression while fixing the shape, e.g. the scanner's one pupil. */
  fixed?: Partial<Record<Slot, Record<Mood, PartDef> | null>>;
  /** Still the upscaled stand-in, not finished art. Excluded from the
   *  distinctness test; none may remain when the set ships. */
  placeholder?: true;
};

export type PartDef = { grid: string[] };

export type SpriteSpec = { body: BodyKey; mood: Mood; seed: number };
export type Rect = { x: number; y: number; w: number };
export type Layer = { tone: Tone; opacity: number; rects: Rect[] };

const BODY_CHARS = /^[.#=-]+$/;
const PART_CHARS = /^[.#=o-]+$/;

/** Turn indented ASCII art into rows. `size` checks a full square body. */
export function parseGrid(ascii: string, opts: { part?: boolean; size?: number } = {}): string[] {
  const rows = ascii
    .split("\n")
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
  const allowed = opts.part ? PART_CHARS : BODY_CHARS;
  for (const row of rows) {
    if (!allowed.test(row)) {
      throw new Error(`sprite row has a character outside ${allowed}: "${row}"`);
    }
    if (row.length !== rows[0].length) {
      throw new Error(`sprite rows must be one width, got "${row}"`);
    }
  }
  if (opts.size !== undefined && (rows.length !== opts.size || rows[0]?.length !== opts.size)) {
    throw new Error(`body must be ${opts.size}x${opts.size}, got ${rows[0]?.length}x${rows.length}`);
  }
  return rows;
}

/** A full-size body grid. */
export function bodyGrid(ascii: string): string[] {
  return parseGrid(ascii, { size: SPRITE_SIZE });
}

/** A part grid: any size, may use `o` to knock pixels out. */
export function partGrid(ascii: string): string[] {
  return parseGrid(ascii, { part: true });
}

/**
 * Several parts drawn side by side, one column of cells per part, columns
 * separated by spaces:
 *
 *     .##.  ##
 *     ####  ##
 *
 * Reads as a sheet, so every variant of a slot can be compared at a glance,
 * and saves repeating one wrapper per part. A column shorter than its
 * neighbours is padded with `.` rows below, which paint nothing; trailing
 * all-`.` rows are dropped again so each part keeps its true height.
 */
export function partSheet(ascii: string): PartDef[] {
  const rows = ascii
    .split("\n")
    .map((r) => r.trim())
    .filter((r) => r.length > 0)
    .map((r) => r.split(/\s+/));
  const columns = rows[0]?.length ?? 0;
  for (const row of rows) {
    if (row.length !== columns) {
      throw new Error(`part sheet rows must have ${columns} columns, got "${row.join(" ")}"`);
    }
  }
  return Array.from({ length: columns }, (_, i) => {
    const grid = partGrid(rows.map((r) => r[i]).join("\n"));
    while (grid.length > 1 && /^\.+$/.test(grid.at(-1) ?? "")) grid.pop();
    return { grid };
  });
}

export const isInk = (ch: string | undefined): boolean => ch !== undefined && ch !== ".";

/**
 * Paint a part with its top-left at (x0, y0). Only cells that are already ink
 * in `mask` (the bare body) may change, so a part can never grow the outline.
 * Returns the number of cells it tried to paint outside, which the tests
 * require to be zero and the renderer silently drops.
 */
export function paintPart(
  rows: string[][],
  mask: string[],
  part: string[],
  x0: number,
  y0: number,
  mirror = false,
): number {
  let outside = 0;
  part.forEach((row, dy) => {
    const cells = mirror ? [...row].reverse() : [...row];
    cells.forEach((ch, dx) => {
      if (ch === ".") return;
      const x = x0 + dx;
      const y = y0 + dy;
      if (!isInk(mask[y]?.[x])) {
        outside++;
        return;
      }
      rows[y][x] = ch === "o" ? "." : ch;
    });
  });
  return outside;
}

/** 32-bit FNV-1a, then a murmur finaliser so neighbouring inputs spread across
 *  all the bits the slot picker reads. Pure and stable across deploys. */
export function seedOf(indicator: string): number {
  let h = 0x811c9dc5;
  for (const ch of indicator.trim().toLowerCase()) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Which variant a slot gets. Each slot reads its own byte of the seed, so the
 *  slots vary independently of each other. */
export function pick(seed: number, slot: Slot, count: number): number {
  const shift = { eyes: 0, mouth: 8, mark: 16 }[slot];
  return ((seed >>> shift) & 0xff) % count;
}

/** Merge each horizontal run of one tone into one rectangle, a layer per tone. */
export function toLayers(grid: string[]): Layer[] {
  return (Object.keys(TONES) as Tone[])
    .map((tone) => {
      const rects: Rect[] = [];
      grid.forEach((row, y) => {
        let run = 0;
        [...row, "\0"].forEach((ch, x) => {
          if (ch === tone) {
            run++;
            return;
          }
          if (run) rects.push({ x: x - run, y, w: run });
          run = 0;
        });
      });
      return { tone, opacity: TONES[tone], rects };
    })
    .filter((l) => l.rects.length > 0);
}

/**
 * The one-cell ring around the drawing: every empty cell with ink directly
 * above, below, left or right of it, merged into runs like a tone layer. It
 * may sit one cell outside the grid (x or y of -1 or SPRITE_SIZE), since wide
 * bodies touch the edge, so the renderer pads its view box by one.
 *
 * Holes inside the body get the ring too: a door notch or a gap between
 * scattered fragments is part of the silhouette, and outlining it is what
 * keeps it from reading as a smudge.
 */
export function outlineRects(grid: string[]): Rect[] {
  const ink = (x: number, y: number) => isInk(grid[y]?.[x]);
  const rects: Rect[] = [];
  for (let y = -1; y <= grid.length; y++) {
    let run = 0;
    for (let x = -1; x <= SPRITE_SIZE + 1; x++) {
      const ring =
        x <= SPRITE_SIZE &&
        !ink(x, y) &&
        (ink(x - 1, y) || ink(x + 1, y) || ink(x, y - 1) || ink(x, y + 1));
      if (ring) {
        run++;
        continue;
      }
      if (run) rects.push({ x: x - run, y, w: run });
      run = 0;
    }
  }
  return rects;
}

/** The 2x2 "any ink" reduction: what the silhouette looks like at 16px. */
export function silhouette16(grid: string[]): string[] {
  const out: string[] = [];
  for (let y = 0; y < grid.length; y += 2) {
    let row = "";
    for (let x = 0; x < grid[y].length; x += 2) {
      const any = [grid[y][x], grid[y][x + 1], grid[y + 1]?.[x], grid[y + 1]?.[x + 1]].some(isInk);
      row += any ? "#" : ".";
    }
    out.push(row);
  }
  return out;
}

export function hamming(a: string[], b: string[]): number {
  let d = 0;
  a.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] !== b[y][x]) d++;
  });
  return d;
}
