/**
 * Photograph the active scan page for one indicator.
 *
 * Runs against a production build on :3001, never the user's own :3000. See
 * scripts/verify-loading.mjs for why AUTH_TRUST_HOST and --env-file are needed:
 *
 *   bun run build
 *   AUTH_TRUST_HOST=true bun run start -- -p 3001
 *   node --env-file=.env.local scripts/shot-scan.mjs [indicator]
 *
 * Pass SCAN=1 to press Engage when the indicator has never been scanned. That
 * spends the urlscan.io and Cloudflare quota, so it is opt-in: without it the
 * script photographs whatever is already cached and says so.
 */
import { chromium } from "playwright";
import { encode } from "next-auth/jwt";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = "http://localhost:3001";
const OUT = process.env.SHOT_DIR || join(tmpdir(), "claude", "scan");
const INDICATOR = process.argv[2] ?? "8.8.8.8";
mkdirSync(OUT, { recursive: true });

const COOKIE_NAME = "authjs.session-token";
const secret = process.env.AUTH_SECRET;
if (!secret) throw new Error("AUTH_SECRET missing; run with --env-file=.env.local");

const token = await encode({
  token: { name: "shot", email: "shot@example.test", sub: "shot" },
  secret,
  salt: COOKIE_NAME,
  maxAge: 60 * 30,
});

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 1,
});
await ctx.addCookies([
  { name: COOKIE_NAME, value: token, domain: "localhost", path: "/" },
]);
const page = await ctx.newPage();
page.on("console", (m) => {
  if (m.type() === "error") console.log("  ! console:", m.text());
});
page.on("pageerror", (e) => console.log("  ! pageerror:", e.message));

const slug = INDICATOR.replace(/[^a-z0-9.]+/gi, "-");
console.log(`\n── /scan/${INDICATOR} ──`);
await page.goto(`${BASE}/scan/${encodeURIComponent(INDICATOR)}`, {
  waitUntil: "networkidle",
  timeout: 120000,
});

const engage = page.getByRole("button", { name: /engage|scan now|arm/i }).first();
if (await engage.isVisible().catch(() => false)) {
  if (process.env.SCAN === "1") {
    console.log("  not scanned yet, engaging (this spends quota)");
    await engage.click();
    const confirm = page.getByRole("button", { name: /engage|confirm|send/i }).last();
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    // The batch takes roughly thirty seconds on the provider; the page polls.
    await page
      .locator("#capture")
      .waitFor({ timeout: 180000 })
      .catch(() => console.log("  ! no capture section after waiting"));
    await page.waitForTimeout(5000);
  } else {
    console.log("  not scanned yet. Re-run with SCAN=1 to spend the quota.");
  }
}

// The nav rail only exists once a scan has landed, so it doubles as the
// "is there a teardown here" check.
const sections = await page.$$eval("main section[id]", (els) =>
  els.map((el) => el.id),
);
console.log("  sections:", sections.length ? sections.join(", ") : "(none)");

const flags = await page.$$eval("main a[href^='#']", (els) =>
  els.filter((el) => el.closest("li")).map((el) => el.textContent?.trim()),
);
console.log("  red flags:", flags.length ? flags : "(none)");

const rows = await page.$$eval("main table tr", (els) => els.length);
console.log("  ledger rows:", rows);

const shot = join(OUT, `${slug}.png`);
await page.screenshot({ path: shot, fullPage: true });
console.log(`  saved ${shot}`);

await browser.close();
