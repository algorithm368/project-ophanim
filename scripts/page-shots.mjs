import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Shoots each path in light and dark at 1280 px. Used to compare pages
// before and after a change (the /check and /scan boundary check) and to
// look at the homepage. Needs `bun run dev -- -p 3001`, where proxy.ts
// waves every route through, so no session cookie is needed.
const OUT = process.env.OUT || join(tmpdir(), "claude", "page-shots");
const BASE = process.env.BASE || "http://localhost:3001";
const PATHS = (process.env.PATHS || "/").split(",");

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: theme });
  await ctx.addInitScript((t) => localStorage.setItem("theme", t), theme);
  const page = await ctx.newPage();
  for (const path of PATHS) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(1500);
    const slug = path === "/" ? "root" : path.replace(/\W+/g, "_");
    await page.screenshot({ path: join(OUT, `${slug}-${theme}.png`), fullPage: true });
    console.log(`saved ${slug}-${theme}.png`);
  }
  await ctx.close();
}
await browser.close();
