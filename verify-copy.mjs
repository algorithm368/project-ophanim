import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await ctx.newPage();

await page.goto(`${BASE}/check/8.8.8.8`, {
  waitUntil: "networkidle",
  timeout: 60000,
});

const copyBtn = page.getByRole("button", { name: "Copy summary" });
await copyBtn.first().waitFor({ timeout: 45000 });

console.log("Copy summary buttons:", await copyBtn.count());
console.log(
  "Copy link buttons:",
  await page.getByRole("button", { name: /Copy link/i }).count(),
);

const before = (await copyBtn.first().innerText()).trim();
await copyBtn.first().click();
// Read the visible label right after click (before the 1500ms revert).
await page.waitForTimeout(150);
const after = (await copyBtn.first().innerText()).trim();
const clip = await page.evaluate(() => navigator.clipboard.readText());

console.log("Label before click:", JSON.stringify(before));
console.log("Label after click:", JSON.stringify(after));
console.log("Clipboard length:", clip.length);

await browser.close();
