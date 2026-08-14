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
  viewport: { width: 1100, height: 900 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
async function cardShot(path, heading, file, waitText) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 60000 });
  if (waitText) {
    try {
      await page.getByText(waitText, { exact: false }).first().waitFor({ timeout: 45000 });
    } catch {}
  }
  await page.waitForTimeout(1500);
  const card = page.locator("div.mt-5 > *", { hasText: heading }).first();
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: `${OUT}/${file}` });
  console.log("saved", file);
}
await cardShot("/check/google.com", "Registration", "tidy-domain-profile.png", "risk");
await cardShot("/check/8.8.8.8", "Where it's from", "tidy-ip-profile.png", "risk");
await browser.close();
