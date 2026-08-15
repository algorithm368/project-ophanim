import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
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
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();

async function pageShot(path, file, waitText) {
  await page.goto(`${BASE}${path}`, {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  if (waitText) {
    try {
      await page.getByText(waitText, { exact: false }).first().waitFor({
        timeout: 45000,
      });
    } catch {
      console.log(`! wait text "${waitText}" not found on ${path}`);
    }
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
  console.log(`saved ${file}`);
}

async function rawShot(path, file) {
  const resp = await ctx.request.get(`${BASE}${path}`);
  writeFileSync(`${OUT}/${file}`, await resp.body());
  console.log(`saved ${file} (${resp.status()})`);
}

await pageShot("/", "home.png");
await rawShot("/opengraph-image", "og-home.png");
await rawShot("/check/8.8.8.8/opengraph-image", "og-check.png");
await pageShot("/check/8.8.8.8", "result-ip.png", "risk");
await pageShot("/check/google.com", "result-domain.png", "risk");

await browser.close();
