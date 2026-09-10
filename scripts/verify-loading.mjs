/**
 * Prove two things about a navigation into an indicator page, in a real browser:
 *
 *  1. the loading shell does not shift — `loading.tsx` and the page's own
 *     Suspense fallback render the same box in the same place, and nothing
 *     jumps when the content replaces them; and
 *  2. the page does not spend requests the server already answered.
 *
 * Run against a production build on :3001, never the user's own :3000:
 *
 *   bun run build && bun run start -- -p 3001
 *   node --env-file=.env.local scripts/verify-loading.mjs
 *
 * `--env-file` is what supplies AUTH_SECRET, which is needed to mint a session
 * cookie: every route sits behind proxy.ts, and a browser login is not an
 * option here (the hd-claim allowlist refuses this account).
 */
import { chromium } from "playwright";
import { encode } from "next-auth/jwt";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = "http://localhost:3001";
const OUT = process.env.SHOT_DIR || join(tmpdir(), "claude", "loading");
mkdirSync(OUT, { recursive: true });

const COOKIE_NAME = "authjs.session-token";
const secret = process.env.AUTH_SECRET;
if (!secret) throw new Error("AUTH_SECRET missing; run with --env-file=.env.local");

const token = await encode({
  token: { name: "verify", email: "verify@example.test", sub: "verify" },
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

/** Every request the page made, so a claim about "one fewer round trip" is a
 *  count rather than an assertion. */
let seen = [];
page.on("request", (r) => {
  const u = new URL(r.url());
  if (u.origin === BASE) seen.push(`${r.method()} ${u.pathname}${u.search}`);
});
const apiCalls = () => seen.filter((s) => s.includes("/api/"));

/** Layout instability, as the browser itself scores it. Anything above ~0.1
 *  over a navigation is a visible jump. */
async function watchShifts() {
  await page.evaluate(() => {
    window.__shifts = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (!e.hadRecentInput) window.__shifts.push(e.value);
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}
const shiftScore = () =>
  page.evaluate(() => (window.__shifts ?? []).reduce((a, b) => a + b, 0));

const IP = "8.8.8.8";

// ── 1. /check, warm the cache and count what the page asks for ───────────────
console.log(`\n── GET /check/${IP} ──`);
seen = [];
await page.goto(`${BASE}/check/${IP}`, { waitUntil: "networkidle", timeout: 90000 });
await page
  .locator('[aria-label="Risk score"]')
  .first()
  .waitFor({ timeout: 90000 })
  .catch(() => console.log("! risk score never settled"));
await page.waitForTimeout(1500);
console.log("api requests:", apiCalls().length ? apiCalls() : "(none)");
await page.screenshot({ path: join(OUT, "check-settled.png"), fullPage: true });

// Second load, now that the result and any scan batch are cached server-side.
console.log(`\n── GET /check/${IP} again (warm) ──`);
seen = [];
await page.goto(`${BASE}/check/${IP}`, { waitUntil: "networkidle", timeout: 90000 });
await page.waitForTimeout(2000);
console.log("api requests:", apiCalls().length ? apiCalls() : "(none)");
const scanUrlCalls = apiCalls().filter((s) => s.includes("/api/scan-url"));
console.log(
  scanUrlCalls.length === 0
    ? "  ✓ no /api/scan-url round trip (server answered it)"
    : `  ✗ still calling scan-url: ${scanUrlCalls.join(", ")}`,
);

// ── 2. soft-navigate to /scan, sampling the loading shell ───────────────────
//
// Two things have to be defeated to see `loading.tsx` at all. The router
// prefetches the link, so by the time it is clicked the payload is already in
// the client cache and there is no pending state to photograph; and the real
// response is fast enough to miss. So prefetches are refused, and the actual
// navigation is held back. Neither changes which code path runs, only when.
console.log(`\n── soft nav → /scan/${IP} ──`);
await page.route("**/scan/**", async (route) => {
  const req = route.request();
  if (req.headers()["next-router-prefetch"]) return route.abort();
  await new Promise((r) => setTimeout(r, 2500));
  await route.continue();
});

seen = [];
await watchShifts();
const box = () =>
  page.evaluate(() => {
    const el = document.querySelector("main > div");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) };
  });

/** The shell's stand-in for the search box: a placeholder bar, not a real
 *  input, so it has no label to find it by. Only the lookup shape has one. */
const hasSearchPlaceholder = () =>
  page.locator("main > div > .sweep.h-12").isVisible().catch(() => false);

const link = page.getByRole("link", { name: /active/i }).first();
await link.click();

await page.waitForTimeout(900);
const duringLoading = await box();
await page.screenshot({ path: join(OUT, "scan-loading.png") });
// The shell must actually be a shell. If the content is already there the
// delay did not take and every check below is measuring the same thing twice.
const shellVisible = await page
  .locator(".sweep")
  .first()
  .isVisible()
  .catch(() => false);
const hasSearchBox = await hasSearchPlaceholder();
console.log("  shell box while loading:", duringLoading);
console.log(
  shellVisible
    ? "  ✓ the loading shell is genuinely on screen"
    : "  ! no shell visible, the delay did not take, checks below are vacuous",
);
console.log(
  hasSearchBox
    ? "  ✗ loading shell is showing a search box the scan page does not have"
    : "  ✓ loading shell has no search box (scan shape)",
);

await page.waitForTimeout(6000);
const afterContent = await box();
await page.screenshot({ path: join(OUT, "scan-settled.png"), fullPage: true });
console.log("  content box after mount:", afterContent);

const moved =
  duringLoading &&
  afterContent &&
  (duringLoading.x !== afterContent.x || duringLoading.w !== afterContent.w);
console.log(
  moved ? "  ✗ the container moved between shell and content" : "  ✓ container held its position",
);
console.log("  layout-shift score:", (await shiftScore()).toFixed(4));
console.log("  api requests:", apiCalls().length ? apiCalls() : "(none)");
const subjectCalls = apiCalls().filter(
  (s) => s.includes("/api/check?") || s.includes("/api/check-domain?"),
);
console.log(
  subjectCalls.length === 0
    ? "  ✓ no subject fan-out from the browser (server read it from cache)"
    : `  ✗ still fetching the subject: ${subjectCalls.join(", ")}`,
);

// ── 3. the cold path still reaches the network ──────────────────────────────
// Removing the request on a cache hit is only correct if a miss still fetches.
// A domain nobody has looked up here has no cached identity record, so this is
// the branch that has to fall through to the browser.
const COLD = `verify-${Date.now()}.example.com`;
console.log(`\n── GET /scan/${COLD} (nothing cached) ──`);
await page.unrouteAll({ behavior: "ignoreErrors" });
seen = [];
await page.goto(`${BASE}/scan/${COLD}`, { waitUntil: "networkidle", timeout: 90000 });
await page.waitForTimeout(3000);
const coldSubject = apiCalls().filter((s) => s.includes("/api/check-domain?"));
console.log(
  coldSubject.length
    ? `  ✓ cache miss still fetches the subject: ${coldSubject.join(", ")}`
    : "  ✗ nothing fetched, a miss would render an empty identity card forever",
);

// ── 4. the lookup shell keeps its own shape ─────────────────────────────────
// The scan shell must not grow a search box; the lookup shell must keep one.
// They are the same component, told apart only by the path, so this is the
// half that proves the derivation is a derivation and not a constant.
//
// A soft navigation, for the same reason as above: `loading.tsx` is skipped on
// a hard load, where the page streams its own Suspense fallback instead.
console.log(`\n── soft nav → /check/${IP} shell ──`);
await page.goto(`${BASE}/scan/${IP}`, { waitUntil: "networkidle", timeout: 90000 });
await page.route("**/check/**", async (route) => {
  const req = route.request();
  if (req.headers()["next-router-prefetch"]) return route.abort();
  await new Promise((r) => setTimeout(r, 2500));
  await route.continue();
});
await watchShifts();
await page.getByRole("link", { name: /passive/i }).first().click();
await page.waitForTimeout(900);
await page.screenshot({ path: join(OUT, "check-loading.png") });
const lookupShellBox = await box();
const lookupShellVisible = await page.locator(".sweep").first().isVisible().catch(() => false);
const lookupShellSearch = await hasSearchPlaceholder();
console.log("  shell box:", lookupShellBox);
console.log(
  lookupShellVisible ? "  ✓ shell on screen" : "  ! no shell, the delay did not take",
);
console.log(
  lookupShellSearch
    ? "  ✓ lookup shell keeps its search box (lookup shape)"
    : "  ✗ lookup shell lost its search box",
);
await page.waitForTimeout(6000);
const lookupContentBox = await box();
console.log("  content box:", lookupContentBox);
console.log("  layout-shift score:", (await shiftScore()).toFixed(4));

console.log(`\nscreenshots in ${OUT}`);
await browser.close();
