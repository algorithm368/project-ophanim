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

---

# Threat-intel source live-API test results

Tested 2026-05-30. Scope: the four new key-gated file-hash sources added in the
hash-search enrichment work (Phase 3), exercised against their **live provider
APIs** to reconcile the docs-based response shapes with reality (the plan's
mandatory "verify live" step). Test indicator: WannaCry SHA-256
`ed01ebfbc9eb5bbea545af4d01bf5f1071661840480439c6e5babe8e080e41aa`.

| Source | Verified | Result |
|--------|----------|--------|
| Maltiverse | ✅ end-to-end (public API) | bugs found + fixed |
| Kaspersky OpenTIP | ✅ end-to-end (with key) | field parsing confirmed correct |
| Pulsedive | ✅ key works + shape (direct) | bug found + fixed |
| Hatching Triage | 🟠 blocked | needs a Triage research-account key |

> **Re-tested 2026-05-30 (later):** Kaspersky and Pulsedive keys are now set and
> both sources run. Independently confirmed against EICAR
> (`275a021b…51fd0f`, uncached): Kaspersky → zone `Red`, score 90, real
> detection names, and `FileGeneralInfo` md5/sha1/sha256/type/size all parsed
> correctly. Pulsedive runs (returns "Not indexed" for EICAR — it rarely holds
> file hashes; its response shape was verified directly earlier).

## TI-1. Pulsedive used the wrong endpoint — ✅ FIXED

**File:** `lib/ti/hash/sources/pulsedive.ts`

The adapter read `threats` and `links` off `explore.php`, but that endpoint
returns only summary rows (`iid`, `indicator`, `type`, `risk`, `stamp_*`) — no
`threats`, no `links`. Pulsedive would have contributed a score but **no
categories and no relations**. The detail data lives on `info.php`.

**Resolved (commit `5f34be8`):** switched to a single
`info.php?indicator=<value>&key=<key>` lookup, which returns the full record
(`risk` + `threats[].name`). Dropped the fictional `links`→relations parsing.
`riskToScore` is unchanged and still unit-tested. The response shape was verified
directly against the public API; full end-to-end still needs a working
`PULSEDIVE_API_KEY`.

## TI-2. Maltiverse field shapes were wrong; it also needs no key — ✅ FIXED + VERIFIED

**File:** `lib/ti/hash/sources/maltiverse.ts`

Three issues, all confirmed against the live `/sample` response:
- The `/sample` endpoint is **public** — no key required — yet the adapter was
  key-gated (`requiresKey: true`), so it never ran unless a key was set.
- `contacted_host` is an array of **bare IP/host strings** (e.g.
  `"20.242.39.171"`), not `{hostname, ip_addr}` objects, so the relations loop
  produced nothing.
- Detection labels live in `blacklist[].description`; there is **no `antivirus`
  field**, so `detectionNames`/`categories` were always empty. `download_url`
  does not exist on the record.

**Resolved (commit `5f34be8`):** made it a no-key source (`requiresKey: false`;
an optional key only raises the rate limit), parse detections from
`blacklist[].description` (splitting comma-joined labels into chips), and read
`contacted_host` as strings typed via `detectIOC`. **Verified end-to-end against
the live API:** WannaCry → `malicious`, score 85, real detections
(`ransomware,wcry…`, `WannaCry`, `Generic Malware`), and contacted IPs typed as
`ip` / `contacts`.

## TI-3. Kaspersky OpenTIP — ✅ VERIFIED

**File:** `lib/ti/hash/sources/kaspersky-opentip.ts`

A keyless request returns `401`, so this was initially unverifiable. With a
working `KASPERSKY_OPENTIP_API_KEY` set, a live lookup against EICAR confirmed
the success-response parsing is correct: `Zone: "Red"` → score 90 / malicious,
`DetectionsInfo[].DetectionName` → categories + detectionNames, and
`FileGeneralInfo.{Md5,Sha1,Sha256,Type,Size}` → hashContext (lowercased). No
code change was needed — the docs-based shape matched reality.

## TI-4. Hatching Triage — unverified — 🟠 OPEN

**File:** `lib/ti/hash/sources/triage.ts`

Keyless requests return `401` (`{"error":"UNAUTHORIZED"}`), and Triage's API
requires a **research-account** key, which isn't available — so `TRIAGE_API_KEY`
stays empty and the source remains `skipped`. The two-call search→overview flow
and the `extracted[].config` host parsing therefore remain unverified against a
live response. (The review hardening — IP-vs-domain typing, a non-string guard,
and `host:port` stripping — is already in place from commit `8d4c8a3`.)

## Environment / testing note (cache gotcha)

Early in testing, every new source appeared permanently `skipped` even after
keys were added and the dev server was restarted. The cause was **not** the
keys: the app has `KV_REST_API_URL` configured (the result cache reads the
`KV_REST_API_*` names as well as `UPSTASH_REDIS_REST_*`), so repeated lookups of
the same hash (WannaCry) returned a **cached** result computed during an early
run — back when Maltiverse was still key-gated and the other keys were unset.
`cached: true` on the response is the tell. Querying a **novel/uncached** hash
showed the true state: Maltiverse runs no-key, Kaspersky and Pulsedive run with
their keys, and only Triage stays skipped. When verifying source changes
locally, query a fresh hash (or clear the cache) to avoid stale hits.

## Status

Code fixes (Pulsedive endpoint, Maltiverse shapes + no-key) merged to `main`
(`5f34be8`), local/unpushed. `tsc --noEmit` clean, `npm test` → 171 passing,
`npm run lint` clean, `next build` green.

**Verification: 3 of 4 sources confirmed live** — Maltiverse, Kaspersky OpenTIP,
and Pulsedive. Only **Hatching Triage** remains unverified, blocked on a Triage
research-account key.

---

# Hash summary-card narrative — soundness review

Reviewed 2026-05-30. The "summary card" text (the verdict hero's plain-language
paragraph) is produced by `buildHashNarrative` in `lib/ti/narrative.ts`, rendered
via `HashVerdictHero` → `CopyableSummary` in `components/CheckResults.tsx`.
Method: ran `buildHashNarrative` (+ `scoreExplanation`) directly on three real
captured results — EICAR, WannaCry, and a low-scoring hash — plus six synthetic
edge cases (unknown/no-record, clean, malicious-without-metadata, score floored
at 75, unknown-with-metadata). `FLAG_THRESHOLD = 40`.

## What is sound ✅

The logic and honesty hold up — the hard parts are right:
- **Unknown ≠ clean.** An unrated hash reads *"…can't be rated. That isn't the
  same as safe…"*, and an unknown verdict never prints "0/100" (it says "no
  information").
- **Honest denominators.** "N of M TI sources flagged it" counts only scoring
  feeds (weight > 0); context-only and skipped sources are excluded.
- **Accurate score explanation.** `scoreExplanation` correctly names the dominant
  weighted source, its raw score, the blend across N sources, and the 75-floor
  for a definitive malicious listing — matching `aggregateRisk`.
- **Clean branch logic.** malicious-without-metadata omits the file-description
  sentence cleanly; "None of the N TI sources flagged this file" reads correctly;
  unknown-with-metadata correctly says "could not be conclusively rated … not a
  clean result" before describing the file.

## HN-1. "N need an API key" — ✅ FIXED (clause removed)

**File:** `lib/ti/narrative.ts` (`threatSentences`)

Rather than fixing the singular-agreement slip, the "(N need an API key.)" gap
note was **removed from the summary entirely** at the maintainer's request —
`threatSentences` no longer appends any gap parenthetical for any indicator type
(IP / domain / hash). Locked in by a test asserting the clause never appears.

## HN-2. "a {type} of {size} file" — ✅ FIXED

**File:** `lib/ti/narrative.ts:303`

`parts.push(\`a ${type}${size ? \` of ${size}\` : ""} file\`)` produces
non-idiomatic phrasing that worsens with the uncontrolled `fileType` string from
sources. Real output:
- EICAR → *"a Powershell of 68 B file"*
- WannaCry → *"a exe of 3.4 MB file"* (also a wrong article — "a exe" → "an exe")
- Emotet synthetic → *"a PE32 executable (GUI) Intel 80386, for MS Windows of
  3.4 MB file"* (the embedded comma + "of 3.4 MB file" garbles the sentence)

**Resolved:** size is now a trailing parenthetical, the indefinite article keys
off the type's initial sound, and a redundant " file" is dropped when the type
already names the kind. Now: *"an exe file (3.4 MB)"*, *"a Powershell file
(68 B)"*, *"a PDF document (22 KB)"*. Covered by new tests in
`lib/ti/narrative.test.ts`.

## HN-3. "flagged it for {categories}" surfaces non-threat noise — ✅ FIXED

**File:** `lib/ti/narrative.ts:141-148` (categories via `aggregateCategories`)

The "for X, Y, Z" clause takes the top-3 categories by frequency from the
flagging sources, but the source category lists contain junk that then reads as
the *reason* a file is malicious. Real output:
- WannaCry → *"flagged it for WannaCry, **9698f46495ce9401c8bcaf9a2afe1598**,
  calls-wmi"* — a 32-hex **imphash** presented as a threat category.
- EICAR → *"flagged it for **Windows**, **academico**, adware"* — a platform word
  and a noise token shown as "reasons".

Verdict/score are unaffected (categories are display-only), but the sentence
could mislead.

**Resolved:** `threatSentences` now filters categories through
`isMeaningfulCategory`, dropping pure hex tokens (md5/sha1/sha256/imphash length)
and bare platform/arch words before the "for" clause. WannaCry now reads *"flagged
it for WannaCry, calls-wmi, checks-network-adapters"* (imphash gone); EICAR drops
"Windows". Covered by a new test.

## HN-4. "first seen as {name}" overstates ordering — ✅ FIXED

**File:** `lib/ti/narrative.ts:306`

`fileName` is the *best-known / first-non-empty merged* name (per
`HashContext.fileName` — "Best-known file name"), not necessarily the earliest
observed. The card labelled WannaCry *first seen as "important.exe"* and EICAR
*first seen as "eicar.com.txt"*, asserting a temporal order the data doesn't
support (WannaCry alone has ~19 reported names).

**Resolved:** reworded to *seen as "{name}"* (line 306). Covered by a new test.

## Status

**All four addressed** in `lib/ti/narrative.ts` — HN-2/HN-3/HN-4 reworded/filtered,
HN-1 resolved by removing the gap-note clause outright — each locked in by a case
in `lib/ti/narrative.test.ts` (suite 174; `tsc`/lint clean). Changes uncommitted.
