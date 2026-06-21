# design-sync notes — project-ophanim

Repo-specific gotchas for future syncs. Read this before re-syncing.

## Shape: app repo, not a packaged library
- This is a Next.js 16 app, **no `dist/`, no Storybook, no published package**. The
  converter runs in **synth-entry mode**.
- `node_modules/project-ophanim` does not exist (npm won't self-install), so the
  build's default `PKG_DIR = node_modules/<pkg>` crashes. **Fix:** pass
  `--entry .design-sync/.cache/entry.tsx`; the build walks up from the entry to the
  repo `package.json` and sets PKG_DIR to the repo root.
- `.design-sync/.cache/entry.tsx` re-exports the 4 scoped UI primitives (and their
  compound sub-parts) so `window.Ophanim` carries all 12 exports. It is a
  **generated input under .cache (gitignored) — recreate it on a fresh clone / re-sync.**
- Previews import from the package name: `import { Button } from "project-ophanim"`.
  The story-import shim rewrites that to `window.Ophanim`. (Relative imports like
  `../../components/ui/button` would NOT shim — the filenames are lowercase and don't
  match the PascalCase export names — so they'd bundle a duplicate source copy.)
  The editor shows "Cannot find module 'project-ophanim'" — harmless; esbuild resolves
  it via the shim, no typecheck.

## CSS: Tailwind v4 must be compiled first
- Styling is Tailwind v4 with tokens in `app/globals.css` (`@theme`, `:root`/`.dark`
  oklch vars). **No compiled CSS ships in the repo** — utility classes must be generated.
- Tailwind v4 generates utilities **on-demand** (only classes used in the repo). Since
  claude.ai/design ships only the static CSS closure, a bare compile would leave the
  design agent unable to use tokens the app doesn't already use (e.g. `bg-accent`).
  Fix: compile via `.design-sync/.cache/tw-entry.css`, which imports `app/globals.css`
  and **safelists the full semantic color palette** (`@source inline(...)`).
- Before every build, regenerate (both files are gitignored under `.cache/`):
  `npx -y @tailwindcss/cli@4 -i .design-sync/.cache/tw-entry.css -o .design-sync/.cache/compiled.css`
  `cfg.cssEntry` points at `compiled.css`. **Regenerate on every fresh clone / re-sync**
  (forget it and previews render unstyled). `tw-entry.css` uses paths relative to
  `.cache/`, so it is clone-portable — but it's gitignored, recreate it if missing
  (contents are in this run's history / the heredoc that generated it).
- If you add preview/component classes, recompile so they're included (tw-entry scans
  `app/`, `components/`, `.design-sync/previews/`).

## Fonts: zero-download system stacks (by design)
- `--font-sans`/`--font-mono` are native system stacks; **nothing is meant to ship**.
- `"JetBrains Mono"`, `"Cascadia Code"`, `"SF Mono"` are optional preferred names in the
  mono stack with full system fallbacks → suppressed via `cfg.runtimeFontPrefixes`.
  Do not try to source/ship them.

## Project target
- Synced into the **existing** "Ophanim Design System" project
  (`e6e84545-50a5-4a02-958d-33c88596414c`), which previously held a **hand-built kit**
  (ui_kits/ophanim/*.jsx, preview/*.html, scraps/*.png). The user explicitly chose to
  **overwrite** it. The first upload deleted those old paths.

## Known render warns
- None. Render check is fully clean (4/4).

## Re-sync risks (watch-list)
- `compiled.css` and `entry.tsx` live under gitignored `.cache/` — a re-sync that skips
  regenerating them runs against stale/missing inputs. Always recompile + recreate first.
- `guidelinesGlob: []` deliberately ships no guidelines (repo's only `docs/*.md` is a
  project ROADMAP, not a design guideline). Revisit if real design docs get added.
- If new UI primitives are added under `components/ui/`, add them to both
  `cfg.componentSrcMap` and `.cache/entry.tsx`'s re-export list.
- `--node-modules ./node_modules` (repo root) is where react/@base-ui/cva resolve.
- `DesignSync(finalize_plan)` doubled a relative `localDir` (`ds-bundle/ds-bundle`) —
  pass an **absolute** `localDir` path.
- The project now has a `_ds_sync.json` anchor, so future re-syncs are incremental: the
  driver's diff derives `deletePaths` automatically. The manual delete list used on this
  first overwrite is no longer needed. (The first sync had no anchor, hence the hand-built
  delete list for the old kit.)
