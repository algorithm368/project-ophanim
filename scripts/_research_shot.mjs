import { chromium } from "playwright";

const OUT = process.env.SHOT_DIR || "/tmp/claude/shots";
const BASE = "http://localhost:3000";

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 1400 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

async function shotResearch(path, file) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 60000 });
  try {
    await page.getByText("Research", { exact: false }).first().waitFor({ timeout: 45000 });
  } catch {
    console.log(`! "Research" not found on ${path}`);
  }
  await page.waitForTimeout(1200);
  // Screenshot the Research card specifically, scrolled into view.
  const heading = page.getByText("Research", { exact: true }).first();
  await heading.scrollIntoViewIfNeeded();
  const card = heading.locator("xpath=ancestor::*[contains(@class,'rounded-lg')][1]");
  try {
    await card.screenshot({ path: `${OUT}/${file}` });
  } catch {
    await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
  }
  console.log(`saved ${file}`);
}

await shotResearch("/check/8.8.8.8", "research-ip.png");
await shotResearch("/check/google.com", "research-domain.png");

await browser.close();
