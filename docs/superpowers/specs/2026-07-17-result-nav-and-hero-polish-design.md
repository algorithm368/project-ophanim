# Result page navigation and verdict hero polish

**Date:** 2026-07-17
**Status:** Design approved, pending spec review

## Problem

A UX/UI audit of the live app surfaced three issues on the result page, all on
the presentation layer (no scoring, source, or data-model changes):

1. **No orientation on a very long page.** A populated IP result is roughly
   5,000px tall: eight stacked cards of equal visual weight. Once the analyst
   scrolls past the verdict there is no way to jump between sections (Origin,
   Exposed, DNS, Related, Research, Sources) and no persistent sense of place.
2. **The lookup card stays fully expanded on result pages.** The heading
   "Check an IP, domain, or file hash", the detection hint, and the TRY chips
   occupy ~150px above the verdict on every result view, delaying the one thing
   the analyst came for.
3. **The verdict score reads weakly.** The score ("75 / 100") sits small in the
   top-right of the hero while a paragraph of prose dominates. The score is the
   single most important takeaway and should be the visual focal point.

## Scope

In: issues 1, 2, 3. Out: mobile table treatment and research-skeleton polish
(deferred). No changes to `lib/`, scoring, sources, or the data model.

## Design decisions (confirmed with user)

- **Sticky bar carries the section nav only.** The verdict and score do *not*
  follow the analyst down the page; the compact search is not sticky. The only
  pinned element is the jump nav.
- **The verdict hero score meter is monochrome.** The verdict word remains the
  single element that carries color, consistent with the existing
  monochrome-formal design language (`VERDICT_STYLE`, `app/globals.css`).

## Design

### Issue 2 — collapse the lookup on result pages

`components/Checker.tsx` renders one lookup card regardless of state. When a
`result` is present (not loading, not bulk), render a **compact search bar**
instead of the full hero card:

```
🔍 45.83.193.150                                    [Check]  ✕
```

- One row, ~48px: search icon, the current indicator in `font-mono`, a Check
  submit, and a clear affordance. Editable — typing a new IOC and submitting
  runs a fresh check, exactly as today.
- No heading, no detection-hint line, no TRY chips (those belong to the
  landing/empty state).
- Not sticky; it scrolls away normally. The full lookup hero stays on the
  landing / empty / error states unchanged.
- Detection feedback (the "Detected an IP address" line) collapses into inline
  placeholder/aria text so the compact bar stays one row.

### Issue 1 — sticky section jump nav

A new `SectionNav` renders directly under the compact search on result pages and
uses `position: sticky; top: 0` so it pins to the top of the viewport on scroll.

```
Origin · Exposed · DNS · Related · Research · Sources
────────────────────────────────────────────────────  (hairline, backdrop blur)
```

- **Content is nav only** (per decision). Each item is an anchor that
  smooth-scrolls to its section. The active section is highlighted (foreground
  text + underline) via a scroll-spy hook.
- **Dynamic per result type.** Not every type has every section (domain has
  Certificates, hash has Distribution URLs, only IP has Exposed Services). The
  nav is built from the sections actually rendered, in document order.
- **Mobile:** the strip scrolls horizontally (`overflow-x-auto`, no wrap),
  never pushing the body into horizontal scroll.
- Styling reuses existing tokens: mono uppercase labels like the section
  headers, hairline border, `--elev-shadow`, backdrop blur over `--background`.

#### Section registration

`components/CheckResults/index.tsx` wraps each result card in a
`<section id="..." data-nav-label="...">`. A single source-of-truth array per
result type lists `{ id, label }` in render order; `index.tsx` maps it to both
the wrapped sections and the `SectionNav` items, so the two never drift.

Anchor ids and labels:

| id         | label    | IP | domain | hash | card                       |
|------------|----------|----|--------|------|----------------------------|
| `origin`   | Origin   | ✓  | ✓      | ✓    | Profile / DomainProfile / HashProfile |
| `exposed`  | Exposed  | ✓  |        |      | ExposedServicesCard        |
| `certs`    | Certs    |    | ✓      |      | CertificatesCard           |
| `dns`      | DNS      | ✓  | ✓      |      | PassiveDnsCard             |
| `related`  | Related  | ✓  | ✓      | ✓    | ConnectionsCard            |
| `dist`     | Dist     |    |        | ✓    | DistributionUrlsCard       |
| `research` | Research | ✓  | ✓      | ✓    | ResearchCard               |
| `sources`  | Sources  | ✓  | ✓      | ✓    | SourceBreakdown            |

The verdict hero and `SourceHealthNotice` are not nav targets (the analyst lands
on the verdict; the nav is for what lies below it). Scroll-to accounts for the
sticky nav height via `scroll-margin-top` on each section.

#### `useScrollSpy(ids)` hook

`components/CheckResults/use-scroll-spy.ts`: an `IntersectionObserver` over the
section elements returns the id of the section currently nearest the top. This
is the one piece of testable logic (given a set of intersection ratios / a
top-most visible element, pick the active id) and gets a small unit test that
does not need a DOM — the selection function is pure and separated from the
observer wiring.

### Issue 3 — verdict hero score as focal point

Rework the top of `VerdictShell` in `components/CheckResults/verdict.tsx`:

```
┌──────────────────────────────────────────────┐
│ MALICIOUS                            75  /100 │   verdict word = only color;
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░                   │   big mono score; monochrome meter
│                                               │
│ This address is almost certainly malicious…   │   narrative, muted, secondary
│ 11/12 detectors · 6 flagged · 1 rate limited  │
│ › why this score          checked … [re-check]│
└──────────────────────────────────────────────┘
```

- The score number grows to a large `font-mono` display (~`text-5xl`), staying
  `text-foreground` (monochrome).
- A new horizontal **score meter** (0–100) sits under the verdict/score row,
  filled to `riskScore`. The fill is monochrome (`bg-foreground`), the track is
  `bg-muted`. No verdict tint on the bar.
- The verdict word keeps `VERDICT_STYLE[...].text` — the only color on the card.
- The narrative prose, consensus line, "why this score", and meta row keep their
  current content and order but now read as clearly secondary to the score.

## Files

- `components/Checker.tsx` — branch to a compact search bar when `result` is
  present; extract the compact bar as a local component.
- `components/CheckResults/verdict.tsx` — rework `VerdictShell` header + add the
  monochrome score meter.
- `components/CheckResults/index.tsx` — wrap cards in `<section>` anchors from a
  per-type config; render `SectionNav`.
- `components/CheckResults/section-nav.tsx` — new sticky nav component.
- `components/CheckResults/use-scroll-spy.ts` — new hook + pure active-id
  selector.
- `components/CheckResults/use-scroll-spy.test.ts` — unit test for the selector.

No new dependencies; shadcn primitives and existing CSS tokens only.

## Verification

There is no network in this change, so unit tests cover only the scroll-spy
selector. Everything else is visual:

1. `bun run test` and `bun run lint` pass.
2. `bun run dev` + the Playwright screenshot helper, before/after, across:
   desktop and mobile widths; a malicious IP, a clean IP, a domain; light and
   dark themes. Confirm: compact search on result pages, verdict/score reads at
   a glance, sticky nav pins and scroll-spy tracks, no horizontal body scroll on
   mobile.

## Non-goals

- Mobile table reflow (SOURCE VOTES / Origin) — deferred.
- Research/URLScan skeleton polish — deferred.
- Any change to which sections exist or their order (that is
  `2026-06-22-result-page-presentation-design.md`); this spec only adds
  navigation and hero emphasis on top of that IA.
