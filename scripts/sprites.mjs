// Contact sheet for the sprite set: each body at 128, 64, 32 and 16 px, then
// four seeded siblings and the wary and hostile faces at 64 px, in both themes. Judge the
// art on this PNG, never on the ASCII: details that look fine in a grid vanish
// at 16 px.
//
// Run with Bun, not node: it imports a TypeScript module directly.
//   bun scripts/sprites.mjs                    # every body
//   SPRITES=site,husk bun scripts/sprites.mjs  # just these
//   SHOT_DIR=/some/dir bun scripts/sprites.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BODIES, BODY_KEYS, SPRITE_SIZE, seedOf, spriteLayers } from "../lib/ti/sprite/index.ts";

const OUT = process.env.SHOT_DIR || join(tmpdir(), "claude", "shots");
mkdirSync(OUT, { recursive: true });

const only = process.env.SPRITES?.split(",").map((s) => s.trim()).filter(Boolean);
const keys = only?.length ? BODY_KEYS.filter((k) => only.includes(k)) : BODY_KEYS;
const SIBLINGS = ["198.51.100.7", "evil.example", "44d88612fea8a8f36de82e1278abb02f", "203.0.113.9"].map(seedOf);

function svg(spec, px) {
  const groups = spriteLayers(spec)
    .map(
      (l) =>
        `<g fill-opacity="${l.opacity}">${l.rects
          .map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="1"/>`)
          .join("")}</g>`,
    )
    .join("");
  return `<svg width="${px}" height="${px}" viewBox="0 0 ${SPRITE_SIZE} ${SPRITE_SIZE}"
     shape-rendering="crispEdges" fill="currentColor">${groups}</svg>`;
}

function cell(body) {
  const base = { body, mood: "calm", seed: SIBLINGS[0] };
  const sizes = [128, 64, 32, 16].map((px) => `<span>${svg(base, px)}</span>`).join("");
  // Three calm siblings, then the first one wary (suspicious) and hostile
  // (malicious, red), which is how the verdict reads on a face.
  const sibs = SIBLINGS.slice(0, 3).map((seed) => `<span>${svg({ ...base, seed }, 64)}</span>`).join("");
  const wary = `<span class="warn">${svg({ ...base, mood: "wary" }, 64)}</span>`;
  const hostile = `<span class="bad">${svg({ ...base, mood: "hostile" }, 64)}</span>`;
  const tag = BODIES[body].placeholder ? " (placeholder)" : "";
  return `<figure><div class="row">${sizes}</div><div class="row">${sibs}${wary}${hostile}</div>
    <figcaption>${body}${tag}</figcaption></figure>`;
}

const html = (theme) => `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin:0; padding:32px; font:12px ui-monospace,monospace;
         background:${theme === "dark" ? "#0a0a0a" : "#ffffff"};
         color:${theme === "dark" ? "#ededed" : "#171717"}; }
  .grid { display:grid; grid-template-columns:repeat(3,1fr); gap:36px 28px; }
  .row { display:flex; align-items:flex-end; gap:14px; margin-bottom:10px; }
  .bad { color:${theme === "dark" ? "#f87171" : "#dc2626"}; }
  .warn { color:${theme === "dark" ? "#fbbf24" : "#d97706"}; }
  figure { margin:0; }
  figcaption { opacity:.6; letter-spacing:.06em; text-transform:uppercase; }
  h1 { font-size:13px; letter-spacing:.14em; text-transform:uppercase; margin:0 0 24px; }
</style></head><body>
  <h1>sprite contact sheet, ${theme}: 128 / 64 / 32 / 16 px, then 3 calm siblings, wary, hostile</h1>
  <div class="grid">${keys.map(cell).join("")}</div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const suffix = only?.length ? `-${only.join("-")}` : "";
for (const theme of ["light", "dark"]) {
  await page.setContent(html(theme), { waitUntil: "load" });
  const file = join(OUT, `sprites${suffix}-${theme}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`saved ${file}`);
}
await browser.close();
