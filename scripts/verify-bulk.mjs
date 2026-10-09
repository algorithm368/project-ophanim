/**
 * Drive /bulk end to end against a production build and photograph each step.
 *
 *   bun run build
 *   AUTH_TRUST_HOST=true TI_BULK_CONFIRM_AT=0 TI_INTERNAL_SUFFIXES=dc01.fujixerox.net \
 *     bun run start -- -p 3001
 *   node --env-file=.env.local scripts/verify-bulk.mjs <indicator-file>
 *
 * It stops at the confirm bar and presses Skip, so pass 2 never spends metered
 * quota. With TI_BULK_CONFIRM_AT=0 the bar appears for any run that has a
 * queue. Between the bar appearing and Skip it reloads the page, which proves a
 * run resumes from Redis rather than starting over.
 */
import { chromium } from "playwright";
import { encode } from "next-auth/jwt";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.BASE || "http://localhost:3001";
const OUT = process.env.SHOT_DIR || join(tmpdir(), "claude", "bulk");
const FILE = process.argv[2];
if (!FILE) throw new Error("usage: verify-bulk.mjs <indicator-file>");
mkdirSync(OUT, { recursive: true });

const COOKIE_NAME = "authjs.session-token";
const secret = process.env.AUTH_SECRET;
if (!secret) throw new Error("AUTH_SECRET missing; run with --env-file=.env.local");
const token = await encode({
  token: { name: "verify", email: "verify@example.test", sub: "verify" },
  secret,
  salt: COOKIE_NAME,
  maxAge: 60 * 60,
});

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([{ name: COOKIE_NAME, value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("  ! pageerror:", e.message));
page.on("console", (m) => m.type() === "error" && console.log("  ! console:", m.text()));

const shot = async (name) => {
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  console.log(`  saved ${path}`);
};

console.log("── parse preview");
await page.goto(`${BASE}/bulk`, { waitUntil: "networkidle" });
const box = page.getByLabel("Indicators, one per line");
await box.click();
await box.fill(readFileSync(FILE, "utf8"));
const counter = page.getByText(/\d+ indicators, /);
await counter.waitFor();
console.log("  ", await counter.textContent());
await shot("1-preview");

console.log("── pass 1");
const t0 = Date.now();
await page.getByRole("button", { name: "Look up" }).click();
await page.waitForURL(/\/bulk\?run=/, { timeout: 30000 });
const runId = new URL(page.url()).searchParams.get("run");
console.log("   run", runId);
const bar = page.getByRole("status").filter({ hasText: "Enrichment needs" });
await bar.waitFor({ timeout: 600000 });
console.log(`   pass 1 settled in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log("  ", await bar.locator("p").textContent());
await shot("2-confirm");

console.log("── reload resumes");
const before = await fetchRun(runId);
await page.reload({ waitUntil: "networkidle" });
await bar.waitFor({ timeout: 120000 });
const after = await fetchRun(runId);
const redone = after.run.rows.filter((r, i) => r.state !== before.run.rows[i].state).length;
console.log(`   rows whose state changed across the reload: ${redone}`);

console.log("── skip");
await page.getByRole("button", { name: "Skip" }).click();
await bar.waitFor({ state: "detached" });
await shot("3-skipped");

const states = {};
for (const r of after.run.rows) states[r.state] = (states[r.state] ?? 0) + 1;
console.log("   row states", JSON.stringify(states));
for (const want of ["accounts.google.com", "fyaa.mlcrosoft.win", "raw.githubsercontent.com", "xn--y3ctai2b.com"]) {
  const r = after.run.rows.find((x) => x.indicator === want);
  console.log(`   ${want}: ${r ? JSON.stringify({ state: r.state, bucket: r.bucket, verdict: r.verdict, note: r.note, display: r.display }) : "absent"}`);
}
const internal = after.run.rows.filter((r) => r.state === "internal").map((r) => r.indicator);
console.log(`   internal (${internal.length}): ${internal.slice(0, 4).join(", ")}${internal.length > 4 ? ", ..." : ""}`);
console.log(`   internal rows rendered as links: ${await page.locator("a", { hasText: /fujixerox/ }).count()}`);

console.log("── export");
const csv = await (await page.request.get(`${BASE}/api/bulk/${runId}/export?format=csv`)).text();
writeFileSync(join(OUT, "export.csv"), csv);
console.log("   header:", csv.split("\n")[0]);

console.log("── /check/differentia.ru");
await page.goto(`${BASE}/check/differentia.ru`, { waitUntil: "networkidle", timeout: 120000 });
await shot("4-check-differentia");

await browser.close();

async function fetchRun(id) {
  const res = await page.request.get(`${BASE}/api/bulk/${id}`);
  if (!res.ok()) throw new Error(`GET /api/bulk/${id}: ${res.status()}`);
  return res.json();
}
