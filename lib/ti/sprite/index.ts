import { DOMAIN_BODIES } from "./bodies/domain";
import { FILE_BODIES } from "./bodies/file";
import { IP_BODIES } from "./bodies/ip";
import {
  SPRITE_SIZE,
  paintPart,
  pick,
  toLayers,
  type BodyDef,
  type BodyKey,
  type Layer,
  type PartDef,
  type Slot,
  type SpriteSpec,
} from "./engine";
import { EYES, HORN, MARKS, MOUTHS } from "./parts";

export * from "./engine";
export { EYES, HORN, HORN_ZONE, MARKS, MOUTHS, PUPILS } from "./parts";

export const BODIES: Record<BodyKey, BodyDef> = { ...IP_BODIES, ...DOMAIN_BODIES, ...FILE_BODIES };

/** The part a slot resolves to for this body, mood and seed: the body's pin
 *  when it has one, otherwise the seed's pick from that mood's set. */
export function partFor(def: BodyDef, spec: Pick<SpriteSpec, "mood" | "seed">, slot: Slot): PartDef | null {
  const pinned = def.fixed?.[slot];
  if (pinned !== undefined) return pinned && pinned[spec.mood];
  const list = { eyes: EYES[spec.mood], mouth: MOUTHS[spec.mood], mark: MARKS }[slot];
  return list[pick(spec.seed, slot, list.length)];
}

type Placement = { part: PartDef; x: number; y: number; mirror: boolean };

/** Every part placement for a spec, in paint order. Exposed so the tests can
 *  check each one stays on the face plate. */
export function placements(spec: SpriteSpec): Placement[] {
  const def = BODIES[spec.body];
  const mid = def.anchors.mid ?? SPRITE_SIZE / 2;
  const out: Placement[] = [];
  const centred = (slot: "mark" | "mouth") => {
    const at = def.anchors[slot];
    const part = partFor(def, spec, slot);
    if (!at || !part) return;
    const w = part.grid[0].length;
    out.push({ part, x: mid - Math.floor(w / 2), y: at.y, mirror: false });
  };
  centred("mark");
  centred("mouth");
  const eye = partFor(def, spec, "eyes");
  if (eye) {
    const w = eye.grid[0].length;
    const { y, spread } = def.anchors.eyes;
    out.push({ part: eye, x: mid - spread - w, y, mirror: false });
    out.push({ part: eye, x: mid + spread, y, mirror: true });
  }
  return out;
}

/** Body, then mark, mouth, eyes, then horns if flagged. */
export function composeGrid(spec: SpriteSpec): string[] {
  const def = BODIES[spec.body];
  const rows = def.grid.map((r) => [...r]);
  for (const p of placements(spec)) paintPart(rows, def.grid, p.part.grid, p.x, p.y, p.mirror);
  if (spec.flagged) {
    // Horns sit outside the body, so they paint unmasked.
    const full = Array.from({ length: SPRITE_SIZE }, () => "#".repeat(SPRITE_SIZE));
    const w = HORN[0].length;
    paintPart(rows, full, HORN, 0, 0);
    paintPart(rows, full, HORN, SPRITE_SIZE - w, 0, true);
  }
  return rows.map((r) => r.join(""));
}

/** The whole pipeline, which is what the renderer calls. */
export function spriteLayers(spec: SpriteSpec): Layer[] {
  return toLayers(composeGrid(spec));
}
