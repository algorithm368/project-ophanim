import { chromium } from "playwright";

// Drives a real Back/Forward walk and asserts the box AND the results panel
// follow the URL. Two indicators with distinctive owners are used so a stale
// results panel (the bug) is detectable: 8.8.8.8 -> Google, 1.1.1.1 -> Cloudflare.
// Assumes the dev server is already running on :3000 (do not start/kill it here).
const BASE = process.env.BASE || "http://localhost:3000";
const A = "8.8.8.8";
const A_OWNER = "Google";
const B = "1.1.1.1";
const B_OWNER = "Cloudflare";

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exitCode = 1;
    throw new Error(msg);
  }
  console.log(`ok: ${msg}`);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const input = () => page.getByLabel("IOC to check");

// The verdict hero (only shown once a lookup completes) has a re-check button.
const resultReady = () =>
  page.getByRole("button", { name: /re-check|fetch fresh/i }).first();

async function runCheck(value) {
  await input().fill(value);
  await page.getByRole("button", { name: "Check" }).click();
  await resultReady().waitFor({ timeout: 60000 });
}

// Poll until the search box holds the expected value (popstate updates state async).
async function waitBox(value) {
  await page.waitForFunction(
    (v) =>
      document.querySelector('input[aria-label="IOC to check"]')?.value === v,
    value,
    { timeout: 10000 },
  );
}

async function waitOwner(owner) {
  await page.getByText(owner, { exact: false }).first().waitFor({ timeout: 15000 });
}

try {
  await page.goto(BASE, { waitUntil: "networkidle" });

  await runCheck(A);
  await page.waitForURL(`**/check/${A}`);
  await waitOwner(A_OWNER);
  await runCheck(B);
  await page.waitForURL(`**/check/${B}`);
  await waitOwner(B_OWNER);

  // Back -> A restores in the URL, the box, AND the results panel (owner = Google).
  await page.goBack();
  await page.waitForURL(`**/check/${A}`);
  await waitBox(A);
  await waitOwner(A_OWNER);
  assert((await input().inputValue()) === A, `box shows ${A} after Back`);
  assert(
    (await page.locator("body").innerText()).includes(A_OWNER),
    `results show ${A}'s owner (${A_OWNER}) after Back, not ${B}'s`,
  );

  // Forward -> B restores (box + results, owner = Cloudflare).
  await page.goForward();
  await page.waitForURL(`**/check/${B}`);
  await waitBox(B);
  await waitOwner(B_OWNER);
  assert((await input().inputValue()) === B, `box shows ${B} after Forward`);
  assert(
    (await page.locator("body").innerText()).includes(B_OWNER),
    `results show ${B}'s owner (${B_OWNER}) after Forward`,
  );

  // Back to A, then Back again -> home, empty box + no results.
  await page.goBack();
  await page.waitForURL(`**/check/${A}`);
  await waitBox(A);
  await page.goBack();
  await page.waitForURL((url) => url.pathname === "/");
  await waitBox("");
  assert((await input().inputValue()) === "", "box cleared at home after Back");

  console.log("\nback/forward walk passed");
} finally {
  await browser.close();
}
