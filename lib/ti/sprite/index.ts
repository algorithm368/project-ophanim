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
import { HORN, PARTS } from "./parts";

export * from "./engine";
export { EYES, HORN, HORN_ZONE, MARKS, MOUTHS, PARTS } from "./parts";

export const BODIES: Record<BodyKey, BodyDef> = { ...IP_BODIES, ...DOMAIN_BODIES, ...FILE_BODIES };

/** The variant index each slot resolves to for this body and seed. */
export function partChoice(def: BodyDef, seed: number, slot: Slot): number {
  const fixed = def.fixed?.[slot];
  return fixed ?? pick(seed, slot, PARTS[slot].length);
}

/** Every part placement for a spec, in paint order. Exposed so the tests can
 *  check each one stays inside the body. */
export function placements(spec: SpriteSpec): { part: PartDef; x: number; y: number; mirror: boolean }[] {
  const def = BODIES[spec.body];
  const mid = def.anchors.mid ?? SPRITE_SIZE / 2;
  const out: { part: PartDef; x: number; y: number; mirror: boolean }[] = [];
  const centred = (slot: "mark" | "mouth") => {
    const at = def.anchors[slot];
    const part = PARTS[slot][partChoice(def, spec.seed, slot)];
    if (!at || !part) return;
    const w = part.grid[0].length;
    out.push({ part, x: mid - Math.floor(w / 2), y: at.y, mirror: false });
  };
  centred("mark");
  centred("mouth");
  const eye = PARTS.eyes[partChoice(def, spec.seed, "eyes")];
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
