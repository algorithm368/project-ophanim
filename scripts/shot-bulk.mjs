import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Screenshots of the bulk geolocation readout: the default spread view, the
// same batch measured from an anchor, and a filtered table, in light and dark.
// Runs against `next dev`, where proxy.ts and requireSession wave everything
// through, so no session cookie is needed.
//
//   BASE=http://localhost:3001 node scripts/shot-bulk.mjs
//
// The lookup is real (ip-api, ipinfo, RDAP), so the batch is public resolvers
// and well-known hosts spread across continents.
const OUT = process.env.SHOT_DIR || join(tmpdir(), "claude", "shots");
const BASE = process.env.BASE || "http://localhost:3000";
const IPS = (
  process.env.IPS ||
  "8.8.8.8 1.1.1.1 9.9.9.9 208.67.222.222 77.88.8.8 180.76.76.76 " +
    "91.198.174.192 139.130.4.5 200.160.2.3 202.12.27.33 45.33.32.156 " +
    "185.199.108.153 196.216.2.1 8.8.4.4 2001:4860:4860::8888"
).split(/\s+/);

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

async function run(scheme) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: scheme,
  });
  // defaultTheme is "light", so emulating the scheme is not enough: set the
  // choice next-themes reads before the page boots.
  await ctx.addInitScript((t) => localStorage.setItem("theme", t), scheme);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`! page error: ${e.message}`));
  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 60000 });

  // Type rather than fill: fill before hydration is invisible to React state.
  const box = page.getByLabel("IOC to check");
  await box.click();
  await page.keyboard.type(IPS.join(" "), { delay: 0 });
  await page.getByText(/Detected \d+ IP addresses/).waitFor({ timeout: 15000 });
  await page.keyboard.press("Enter");
  try {
    await page.getByRole("heading", { name: /^Geolocation,/ }).waitFor({ timeout: 45000 });
  } catch (err) {
    await page.screenshot({ path: `${OUT}/bulk-${scheme}-FAILED.png`, fullPage: true });
    console.log(`! no result, page saved as bulk-${scheme}-FAILED.png`);
    throw err;
  }
  await page.waitForTimeout(1200);

  const card = page.locator("[data-slot=card]").filter({ hasText: "Geolocation," });
  await card.screenshot({ path: `${OUT}/bulk-${scheme}-spread.png` });
  console.log(`saved bulk-${scheme}-spread.png`);

  // Anchor from the first row's crosshair.
  await page.getByRole("button", { name: /^Measure distances from / }).first().click();
  await page.waitForTimeout(500);
  await card.screenshot({ path: `${OUT}/bulk-${scheme}-anchor.png` });
  console.log(`saved bulk-${scheme}-anchor.png`);

  // Hover a dot for the tooltip, then filter the table.
  // Clip the viewport rather than shooting the element: an element screenshot
  // scrolls, which slides the dot out from under the cursor and drops the tip.
  const map = page.locator("svg[role=img]").locator("..");
  await map.scrollIntoViewIfNeeded();
  const dots = page.locator("svg g[role=button]");
  await dots.nth(Math.min(3, (await dots.count()) - 1)).hover();
  await page.waitForTimeout(300);
  await page.screenshot({
    path: `${OUT}/bulk-${scheme}-tooltip.png`,
    clip: await map.boundingBox(),
  });
  console.log(`saved bulk-${scheme}-tooltip.png`);

  await page.getByRole("button", { name: /^hosting/i }).click();
  await page.waitForTimeout(300);
  await card.screenshot({ path: `${OUT}/bulk-${scheme}-filtered.png` });
  console.log(`saved bulk-${scheme}-filtered.png`);

  await page.getByRole("tab", { name: /^By country/ }).click();
  await page.waitForTimeout(300);
  await card.screenshot({ path: `${OUT}/bulk-${scheme}-country.png` });
  console.log(`saved bulk-${scheme}-country.png`);
  await ctx.close();
}

await run("light");
if (!process.env.LIGHT_ONLY) await run("dark");
await browser.close();
