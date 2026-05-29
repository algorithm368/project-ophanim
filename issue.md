# UI / UX / Accessibility — Issues

Audited 2026-05-29. Scope: the running app reviewed in a browser (Playwright,
bundled Chromium) across the home page (`/`), `/investigate`, and the IP / domain
/ hash result pages (`/check/[ioc]`), in both light and dark themes plus a 390px
mobile viewport. Console was clean (zero errors/warnings) on every page.

What's already strong: streaming per-source progress, a clear 0–100 score with an
inline "why this score" explainer, refang + auto-detection, shareable permalinks,
and a consistent hand-drawn aesthetic that holds up in both themes and on the
malicious ("Danger!") state.

Confidence is noted per item. The previous contents of this file — the
summary-card narrative audit, items #0–#11 — were all resolved (#0–#10 fixed,
#11 won't-fix) and have been cleared. History is in git.

---

## 1. First-load empty state undersells the tool (IP-only) — COPY — ✅ FIXED

**File:** `components/Checker.tsx` (`EmptyState`)

On a cold load the empty state read *"Enter an IPv4 address above and we'll tell
you what kind of address it is…"* even though the input placeholder promises
"IP, domain, or file hash." Cause: `mode` initializes to `"ip"` and only changes
once detection fires on typed input, so the generic case was never shown — the
very first thing a visitor read advertised only IP support.

**Resolved:** `EmptyState` now takes `detected` (the live `detectIOC(query)`)
instead of `mode`. With no type recognized it shows a generic sentence covering
IP, domain, and hash; once detection picks a type the copy specializes to that
lookup. Verified: empty input → generic copy; typing `8.8.8.8` → "Detected an IP
address" + the IP-specific copy. Confidence: **high**.

---

## 2. Live progress stream is invisible to assistive tech — A11Y — ✅ FIXED

**File:** `components/Checker.tsx` (`SearchProgress`)

The streaming source list and percentage are the strongest part of the UX, but a
screen-reader user got nothing: the region had no live semantics, and the
progress bar was a plain `<div>` with width styling — no `role="progressbar"` /
`aria-valuenow`.

**Resolved:**
- The bar is now a `role="progressbar"` with `aria-valuemin={0}` /
  `aria-valuemax={100}` / `aria-valuenow={pct}` and an `aria-valuetext` of
  "N of M sources checked" (omitted while indeterminate, i.e. before the `start`
  event sets the total).
- Added one concise `sr-only` `role="status"` `aria-live="polite"` region that
  announces "N of M sources checked, last in {source}" per settle. The visible
  source grid is deliberately left out of the live region (it updates too often
  to announce in full).

Verified by polling during a live check: `aria-valuenow` climbed
9→27→45→64→82→100, `aria-valuetext` read "N of 11 sources checked", and the
status region announced "N of 11 sources checked, last in {source}".
Confidence: **high**.

---

## 3. Mobile input placeholder is truncated — RESPONSIVE — ✅ FIXED

**File:** `components/Checker.tsx` (input placeholder + className)

At 390px the mono 18px placeholder "Paste an IP, domain, or file hash and we'll
detect it" was clipped to *"…or f"* (and even an iPhone SE at 375px would clip).

**Resolved:** placeholder shortened to "IP, domain, or file hash" (the verb +
"we'll detect it" are already covered by the search icon, the "Got an IOC?"
heading, and the hint line below), and sized `placeholder:text-base
sm:placeholder:text-lg` so it never overflows. Verified with no truncation at
360 / 390 / 414px. Confidence: **high**.

---

## 4. No footer / "about sources" / methodology page — TRUST — 🟠 OPEN

**File:** none exists — `components/Banner.tsx` is header-only; `app/layout.tsx`
renders `<Banner/>` + `children` with no footer.

A public threat-intel tool benefits from a small footer or `/about` page: the
list of TI sources queried (the README documents ~14 — credit them), what the
0–100 score means, a "not abuse/legal advice" disclaimer, and a repo/credit link.
The inline "why this score" copy is good — promote that explanation to a page.

**Suggested fix:** add a lightweight footer in `app/layout.tsx` and/or an
`/about` route. Builds trust and adds crawlable content. Confidence: **medium**.

---

## 5. Investigate graph not verified end-to-end — UNVERIFIED — 🟠 OPEN

**File:** `components/graph/InvestigationGraph.tsx`, `app/investigate/page.tsx`

This audit only reached the empty state ("No nodes yet"). The graph that builds
once an IOC is added was not exercised.

**Suggested fix:** verify the graph builds, is responsive on mobile, and offers
keyboard / screen-reader access — SVG/canvas graphs are frequently mouse-only.
Confidence: **n/a (needs verification)**.

---

## 6. Default button hover is anchor-gated — POLISH — 🟡 OPEN

**File:** `components/ui/button.tsx` — `default` variant
`"bg-primary text-primary-foreground [a]:hover:bg-primary/80"`

The hover background is gated on `[a]:` (anchors), so real `<button>` elements get
no variant-level hover feedback. The home CTA overrides it with
`hover:bg-primary/90` (`Checker.tsx:539`), but other default-variant buttons
(refresh, pivot chips, etc.) may have no hover affordance.

**Suggested fix:** drop the `[a]:` gate or add a button-applicable hover so all
default buttons respond. Audit secondary actions for visible hover/focus states.
Confidence: **medium**.

---

## 7. Per-result share metadata is minimal — SEO — 🟡 OPEN

**File:** `app/check/[ioc]/page.tsx:44-47` (`generateMetadata`)

`generateMetadata` sets `title` (verdict included — nice) + `description`, and
`app/check/[ioc]/opengraph-image.tsx` auto-wires the card image. But there's no
explicit `openGraph` / `twitter` object, nor `robots` / `alternates.canonical`,
so Slack/Twitter unfurls rely on defaults.

**Suggested fix:** add an `openGraph` (+ `twitter.card`) object echoing the
verdict title/description, plus canonical/robots, on both the result page and
`app/layout.tsx`. Confidence: **low** (OG image already auto-wires).

---

## 8. Long result page on mobile — UX — 🟡 OPEN

**File:** `components/CheckResults.tsx`

The full 14-source breakdown makes the result page very tall on mobile (the
full-page IP shot is ~3–4 screens).

**Suggested fix:** collapse the full source breakdown behind a "Show all sources"
toggle, or add a sticky in-page nav (Verdict · Geo · What it does · Sources).
Confidence: **low**.

---

## 9. Missing `theme-color` / `color-scheme` — POLISH — 🟡 OPEN

**File:** `app/layout.tsx`

No `<meta name="theme-color">` (or `metadata.themeColor` / viewport export) and no
`color-scheme`, so mobile browser chrome and native form controls don't match the
active theme.

**Suggested fix:** export `themeColor` per scheme and set `color-scheme` so native
UI matches. Confidence: **low**.

---

## 10. No one-click permalink copy — UX — 🟡 OPEN

**File:** `components/CheckResults.tsx` (has "Copy summary")

The URL syncs to `/check/<ioc>` on every lookup, but there's no "Copy link"
button near the verdict; only "Copy summary" exists. A permalink copy fits the
ticket/analyst workflow the URL-syncing already supports.

**Suggested fix:** add a "Copy link" action beside "Copy summary".
Confidence: **low**.

---

## Summary

| # | Area | Type | Confidence | Status |
|---|------|------|-----------|--------|
| 1 | First-load empty state is IP-only | Copy | High | ✅ Fixed |
| 2 | Progress stream invisible to AT; bar lacks ARIA | A11y | High | ✅ Fixed |
| 3 | Mobile placeholder truncated | Responsive | High | ✅ Fixed |
| 4 | No footer / about / methodology page | Trust | Medium | 🟠 Open |
| 5 | Investigate graph not verified | Unverified | n/a | 🟠 Open |
| 6 | Default button hover anchor-gated | Polish | Medium | 🟡 Open |
| 7 | Per-result share metadata minimal | SEO | Low | 🟡 Open |
| 8 | Long result page on mobile | UX | Low | 🟡 Open |
| 9 | Missing theme-color / color-scheme | Polish | Low | 🟡 Open |
| 10 | No one-click permalink copy | UX | Low | 🟡 Open |

All items are presentation / accessibility / trust improvements — no functional
defects or console errors were found. **#1–#3 are now fixed** (verified in the
browser; `npm run lint` clean, `npm test` → 165 passing). #4–#10 remain open.
