/**
 * Photographs the vitals strip on finished /check pages, one per indicator.
 *
 * Writes two shots per indicator and theme: the strip alone, and the top of
 * the page with the strip in place, so a change to the strip is judged both up
 * close and against the tiles around it. Runs against a production build,
 * which is the only place the proxy really gates, so it mints its own session:
 *
 *   bun run build
 *   AUTH_TRUST_HOST=true bun run start -- -p 3001
 *   node --env-file=.env.local scripts/shot-vitals.mjs
 *
 * IOCS is a comma list (default: one IP, one domain, one hash). THEMES picks
 * light, dark or both. EXTRA_CSS is injected before the shot, to try a tweak
 * without rebuilding, and TAG suffixes the file names so the two sit side by
 * side.
 */
import { chromium } from "playwright";
import { encode } from "next-auth/jwt";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.BASE || "http://localhost:3001";
const OUT = process.env.OUT || join(tmpdir(), "claude", "vitals-shots");
const IOCS = (process.env.IOCS || "80.183.142.206,github.com,84c82835a5d21bbcf75a61706d8ab549").split(",");
const THEMES = (process.env.THEMES || "dark,light").split(",");
// Optional CSS injected after load, to compare a tweak without a rebuild.
const EXTRA_CSS = process.env.EXTRA_CSS;
const TAG = process.env.TAG ? `-${process.env.TAG}` : "";

const COOKIE_NAME = "authjs.session-token";
const secret = process.env.AUTH_SECRET;
if (!secret) throw new Error("AUTH_SECRET missing; run with --env-file=.env.local");
const token = await encode({
  token: { name: "shot", email: "shot@example.test", sub: "shot" },
  secret,
  salt: COOKIE_NAME,
  maxAge: 60 * 30,
});

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
for (const theme of THEMES) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: theme });
  await ctx.addCookies([{ name: COOKIE_NAME, value: token, domain: "localhost", path: "/" }]);
  await ctx.addInitScript((t) => localStorage.setItem("theme", t), theme);
  const page = await ctx.newPage();
  for (const ioc of IOCS) {
    await page.goto(`${BASE}/check/${encodeURIComponent(ioc)}`, { waitUntil: "domcontentloaded" });
    // The strip is the grid whose cells are size containers, which nothing
    // else on the page is. It only renders once the result is in, so it
    // doubles as the done signal.
    const strip = page.locator("div.grid:has(> div.\\@container)").first();
    try {
      await strip.waitFor({ timeout: 120_000 });
    } catch (err) {
      await page.screenshot({ path: join(OUT, "timeout.png") });
      throw err;
    }
    if (EXTRA_CSS) await page.addStyleTag({ content: EXTRA_CSS });
    await page.evaluate(() => document.fonts.ready);
    await strip.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    const slug = ioc.replace(/\W+/g, "_").slice(0, 24);
    await strip.screenshot({ path: join(OUT, `${slug}-${theme}${TAG}-strip.png`) });
    const box = await strip.boundingBox();
    await page.screenshot({
      path: join(OUT, `${slug}-${theme}${TAG}-page.png`),
      fullPage: true,
      clip: { x: 0, y: 0, width: 1280, height: Math.ceil((box?.y ?? 0) + (box?.height ?? 0) + 40) },
    });
    console.log(`saved ${slug}-${theme}`);
  }
  await ctx.close();
}
await browser.close();
console.log(OUT);
