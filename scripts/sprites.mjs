// Contact sheet for the 1-bit sprite set: every body, at 16, 32 and 64 px,
// with and without the flagged overlay, in both themes.
//
// Run with Bun, not node: it imports a TypeScript module directly.
//   bun scripts/sprites.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BODY_KEYS, SPRITE_SIZE, spriteRects } from "../lib/ti/sprite.ts";

const OUT = process.env.SHOT_DIR || join(tmpdir(), "claude", "shots");
mkdirSync(OUT, { recursive: true });

const SIZES = [16, 32, 64];

function svg(spec, px) {
  const rects = spriteRects(spec)
    .map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="1"/>`)
    .join("");
  return `<svg width="${px}" height="${px}" viewBox="0 0 ${SPRITE_SIZE} ${SPRITE_SIZE}"
     shape-rendering="crispEdges" fill="currentColor">${rects}</svg>`;
}

function cell(label, spec) {
  const row = SIZES.map((px) => `<span class="s">${svg(spec, px)}</span>`).join("");
  return `<figure><div class="row">${row}</div><figcaption>${label}</figcaption></figure>`;
}

const specs = [];
for (const body of BODY_KEYS) {
  specs.push([body, { body, flagged: false }]);
  specs.push([`${body} + horns`, { body, flagged: true }]);
}

const html = (theme) => `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin:0; padding:32px; font:12px ui-monospace,monospace;
         background:${theme === "dark" ? "#0a0a0a" : "#ffffff"};
         color:${theme === "dark" ? "#ededed" : "#171717"}; }
  .grid { display:grid; grid-template-columns:repeat(4,1fr); gap:28px 20px; }
  .row { display:flex; align-items:flex-end; gap:14px; min-height:68px; }
  figcaption { margin-top:8px; opacity:.6; letter-spacing:.06em; text-transform:uppercase; }
  h1 { font-size:13px; letter-spacing:.14em; text-transform:uppercase; margin:0 0 24px; }
</style></head><body>
  <h1>sprite contact sheet, ${theme}, 16 / 32 / 64 px</h1>
  <div class="grid">${specs.map(([l, s]) => cell(l, s)).join("")}</div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
for (const theme of ["light", "dark"]) {
  await page.setContent(html(theme), { waitUntil: "load" });
  const file = `sprites-${theme}.png`;
  await page.screenshot({ path: join(OUT, file), fullPage: true });
  console.log(`saved ${file}`);
}
await browser.close();
