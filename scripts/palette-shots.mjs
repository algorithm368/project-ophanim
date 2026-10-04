import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Dark-palette comparison: shoots one page in dark mode once per candidate
// token set, overriding the `.dark` block in app/globals.css at runtime so no
// source edit is needed to compare. Needs `bun run dev -- -p 3001`.
const OUT = process.env.SHOT_DIR || join(tmpdir(), "claude", "palettes");
const BASE = process.env.BASE || "http://localhost:3001";
const PATHS = (process.env.PATHS || "/check/8.8.8.8").split(",");

const g = (l, c = 0, h = 0) => `oklch(${l} ${c} ${h})`;
function palette({ bg, card, sec, muted, mfg, accent, border, input, fg, c = 0, h = 0 }) {
  const t = (l, k = 1) => g(l, +(c * k).toFixed(4), h);
  return {
    background: t(bg), foreground: t(fg, 0.3), card: t(card), "card-foreground": t(fg, 0.3),
    popover: t(card), "popover-foreground": t(fg, 0.3), primary: t(fg, 0.3), "primary-foreground": t(card),
    secondary: t(sec), "secondary-foreground": t(fg, 0.3), muted: t(muted), "muted-foreground": t(mfg, 0.8),
    accent: t(accent), "accent-foreground": t(fg, 0.3), border: t(border), input: t(input), ring: t(mfg, 0.8),
    sidebar: t(bg + 0.02), "sidebar-border": t(border),
  };
}

const PALETTES = {
  "a-current": null,
  "b-lifted-neutral": palette({ bg: 0.2, card: 0.24, sec: 0.3, muted: 0.29, mfg: 0.77, accent: 0.33, border: 0.37, input: 0.4, fg: 0.97 }),
  "c-slate": palette({ bg: 0.19, card: 0.235, sec: 0.29, muted: 0.28, mfg: 0.76, accent: 0.32, border: 0.36, input: 0.39, fg: 0.96, c: 0.014, h: 255 }),
  "d-deep-contrast": palette({ bg: 0.13, card: 0.185, sec: 0.26, muted: 0.25, mfg: 0.78, accent: 0.29, border: 0.36, input: 0.38, fg: 0.98 }),
  "e-warm-graphite": palette({ bg: 0.2, card: 0.24, sec: 0.3, muted: 0.29, mfg: 0.77, accent: 0.33, border: 0.37, input: 0.4, fg: 0.96, c: 0.008, h: 75 }),
};

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, colorScheme: "dark" });
await ctx.addInitScript(() => localStorage.setItem("theme", "dark"));
const page = await ctx.newPage();

for (const path of PATHS) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 90000 });
  await page.locator('[aria-label="Risk score"]').first().waitFor({ timeout: 60000 }).catch(() => console.log(`! no risk score on ${path}`));
  await page.waitForTimeout(1500);
  const slug = path.replace(/\W+/g, "_");
  for (const [name, vars] of Object.entries(PALETTES)) {
    await page.evaluate((vars) => {
      document.getElementById("pal")?.remove();
      if (!vars) return;
      const s = document.createElement("style");
      s.id = "pal";
      const decls = Object.entries(vars).map(([k, v]) => "--" + k + ":" + v).join(";");
      s.textContent = `html.dark{${decls}}`;
      document.head.append(s);
    }, vars);
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(OUT, `${slug}-${name}.png`) });
    console.log(`saved ${slug}-${name}.png`);
  }
}
await browser.close();
