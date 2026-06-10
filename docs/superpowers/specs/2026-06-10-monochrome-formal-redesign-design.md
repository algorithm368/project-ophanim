# Monochrome-minimal formal redesign

## Goal

Replace the residual "notebook-sketch / kid web" visual language with a formal,
restrained **monochrome-minimal** look, and improve front-end performance. The
only color in the UI is the threat verdict.

Direction chosen with the user:

- **Look:** monochrome minimal — grayscale UI, color only on the verdict.
- **Scope:** restyle + declutter (no structural rebuild of components).
- **Accent:** verdict colors only; chrome goes neutral.
- **Performance:** single/zero downloaded fonts, defer the OSM map, trim
  animations/deps, server-render cached permalinks.

## Design language (token layer)

**Palette — pure grayscale (chroma 0).** Strip the warm cream tint and the amber
brand accent.

| Token         | Light                 | Dark              |
| ------------- | --------------------- | ----------------- |
| background    | `oklch(0.985 0 0)`    | `oklch(0.17 0 0)` |
| card          | `oklch(1 0 0)`        | `oklch(0.21 0 0)` |
| foreground    | `oklch(0.20 0 0)`     | `oklch(0.96 0 0)` |
| muted-fg      | `oklch(0.44 0 0)`     | `oklch(0.66 0 0)` |
| border        | `oklch(0.90 0 0)`     | `oklch(0.30 0 0)` |
| primary       | near-black            | near-white        |
| ring (focus)  | neutral gray (was amber) | neutral gray   |

Verdict colors (red/orange/amber/emerald) are the ONLY color and stay — on the
verdict hero, consensus bar, source status rails/pills, score bars. The
`destructive` red also stays (it is a verdict-adjacent signal).

**Type — zero downloaded fonts.** Drop both `next/font/google` families (Ubuntu +
JetBrains Mono). Map the existing CSS-vars to system stacks so every current
`font-sans`/`font-heading`/`font-hand`/`font-mono` usage keeps working with no
per-component edits:

- `--font-sans` / `--font-heading` / `--font-hand` → system UI sans stack
- `--font-mono` → native monospace stack (IPs, hashes, scores, timings)

**Shape & elevation — flat report.** Redefine the aliased `sketch-shadow` /
`sketch-shadow-primary` utilities to flat (hairline ring, no drop shadow);
collapse `rounded-2xl/3xl/4xl` usages to `rounded-lg`; convert dashed "notebook"
borders (banner, pivot chips, "why this score" box) to solid hairlines. Redefine
the `highlighter` utility to neutral (or remove its amber).

**Motion — quiet.** Remove `animate-in fade-in slide-in-from-bottom*`, shimmer
pulses, and long eases; drop the `tw-animate-css` import. Keep only functional
bar-fill transitions, shortened.

## Surface-by-surface (restyle + declutter)

- **Banner** (`components/Banner.tsx`): dashed border + gradient → single
  hairline rule; neutral brand mark.
- **Checker** (`components/Checker.tsx`): remove amber `// indicator lookup`
  pen-line eyebrow + `Sparkles`; neutral focus-within; neutral example chips;
  flatten progress/empty/error cards, drop washes and `font-hand` headers.
- **Verdict hero** (`CheckResults/verdict.tsx`): flatten card, remove wash; keep
  verdict word + score ring + consensus bar (verdict color carries the signal).
- **Results stack** (`CheckResults/index.tsx`): tighten spacing (`space-y-6`→
  `-5`), normalize every card to the flat hairline card, route titles through the
  existing uppercase `SectionHeading`.
- **Sources** (`CheckResults/sources.tsx`): keep colored status rails/pills;
  flatten surrounding chrome; convert the dashed + `font-hand` "why this score"
  box to a clean bordered note.
- **Primitives** (`CheckResults/primitives.tsx`): pivot chip dashed → solid
  hairline; `CopyableSummary` `font-hand` button → normal.
- **Location map** (`CheckResults/location-map.tsx`): neutral pin; **defer-mount**
  via `IntersectionObserver` so tiles aren't requested until near the viewport.
- **Pages** (`app/page.tsx`, `app/check/[ioc]/page.tsx`): remove top gradient
  wash.

## Performance plan

1. **Fonts → system stacks** — zero downloads, no font layout shift. Biggest win.
2. **OSM map deferral** — `IntersectionObserver`-gated mount; no external tile
   requests until scrolled near.
3. **Trim animations/deps** — remove `tw-animate-css` + entrance animations.
4. **Cached-permalink SSR** — `/check/[ioc]/page.tsx` already fetches the cached
   result in `generateMetadata`; pass it to `Checker` as `initialResult` so a
   shared link with a cached result paints server HTML instantly. Uncached links
   still stream client-side. (Live streamed results cannot be SSR'd without
   re-architecting — out of scope, documented here intentionally.)

## Implementation strategy

Token-first cascade: edit `app/globals.css` (grayscale tokens, flat utilities,
system fonts) + `app/layout.tsx` (drop web fonts) to shift ~70% of the look in
two files, then surgical passes over components to remove literal tells (dashed
borders, gradients, amber classes, soft radii, entrance animations).

## Verification

- `npm run lint` + `npm test` (logic untouched — must stay green).
- `npm run build` (confirm bundle/font reduction).
- Before/after Playwright screenshots (`scripts/shot.mjs`) on a known-bad IP, a
  domain, and a hash, in both light and dark.
- Do NOT touch the user's `next dev` on :3000 (ngrok); screenshot on a separate
  preview port.

## Out of scope

- Structural rebuild of result components.
- SSR of live (uncached) streamed results.
- Changing TI sources, scoring, or any `lib/ti` logic.
