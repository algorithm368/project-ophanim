import { chromium } from "playwright";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Screenshots land in the OS temp dir rather than a hardcoded "/tmp". On Linux
// these resolve to the same place, but "/tmp" is world-writable and spelling it
// out is what javascript:S5443 flags: another user on the same host can
// pre-create or symlink a predictable path underneath it. os.tmpdir() also
// makes the script work on Windows, where /tmp does not exist. Override with
// SHOT_DIR to write somewhere you control.
const OUT = process.env.SHOT_DIR || join(tmpdir(), "claude", "shots");
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
