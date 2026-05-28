import { chromium } from "playwright";
const OUT = "/tmp/claude/shots";
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
