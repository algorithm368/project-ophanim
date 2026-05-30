# CheckResults refactor — design

**Date:** 2026-05-30
**Status:** Approved, ready for implementation planning
**Scope:** Refactor `components/CheckResults.tsx` (2559 lines) for maintainability,
with one mount-time performance fix and one conservative DRY merge. No behavior or
visual change.

## Problem

`components/CheckResults.tsx` is a single 2559-line client component holding ~30
sub-components, ~10 constant tables, and ~12 pure helpers. It is the result view
for all three IOC types (IP / domain / hash). The size makes it hard to navigate
and edit, and large files are harder to reason about reliably.

It is **not** a re-render hotspot. Tracing the data flow in `components/Checker.tsx`:

- During a check, per-source progress streams into a *separate* `SearchProgress`
  component via `progress` state.
- `CheckResults` is gated behind `{!loading && result && …}` (Checker.tsx:613).
  `result` stays `null` until the final NDJSON `done` event, when `setResult()`
  fires once and `setLoading(false)`.
- So `CheckResults` mounts **once** with the complete result. It only renders
  again on refresh/pivot, which restart the whole check anyway.

**Consequence:** broad `React.memo` / `useMemo` would suppress re-render churn that
does not exist here. They are deliberately **out of scope**. The genuine wins are
(1) maintainability via a module split and (2) trimming wasted work on the single
mount.

## Goals

1. Split the one file into a focused module folder, **render-identical and
   behavior-identical**.
2. One targeted DRY merge: unify the three near-duplicate verdict-hero wrappers.
3. One perf fix: stop eagerly serializing collapsed raw-details JSON in `SourceCard`.

## Non-goals

- No `React.memo` / `useMemo` / `useCallback` additions (no re-render churn to fix).
- No merge of the three `*ProfileCard` components — see "DRY decisions" below.
- No bundle-size reduction is promised — see "Bundle size: honest note".
- No styling, copy, layout, or DOM-structure changes.
- No new tests of components (none exist today; verification is build + lint +
  existing unit tests + visual diff).

## External contract (must not break)

`components/Checker.tsx` is the only consumer:

```ts
const loadCheckResults = () => import("./CheckResults");           // line 179
const CheckResults = dynamic(loadCheckResults, { ssr: false });    // line 180
void loadCheckResults();                                            // line 357 (warm)
<CheckResults result={result} onRefresh={refresh} onPivot={pivot} />// line 614
```

The component is a **default export**, dynamically imported with `ssr: false`.
Converting `CheckResults.tsx` → `CheckResults/index.tsx` resolves identically:
`import("./CheckResults")` finds the folder's `index.tsx`, the default export is
unchanged, and the lazy chunk boundary is unchanged. **No edit to `Checker.tsx`.**

Props (unchanged):

```ts
{
  result: CheckResult | DomainCheckResult | HashCheckResult,
  onRefresh: () => void,
  onPivot?: (value: string) => void,
}
```

## Architecture: module split

New folder `components/CheckResults/`. Each file keeps `"use client"`. Grouping is
by *what you edit together*, and follows the import graph confirmed by cross-
reference (below) so there are no cycles.

```
components/CheckResults/
  index.tsx        Default export dispatcher + Results / DomainResults / HashResults
                   layout components. Wraps subtree in PivotContext.Provider.
  primitives.tsx   Shared leaf UI + context: PivotContext, Pivot, PivotList, Field,
                   SectionHeading, ScoreRing, CopyableSummary, useCopied.
  classify.ts      Pure logic (no JSX) + tiny presentational data: scoreBarColor,
                   classifyType, classifyDomain, classifyHash, domainVibe, hashVibe,
                   flagUrl, locationQuip. Stays `.ts`: these return icon component
                   *references* (e.g. `icon: ShieldAlert`), not JSX.
  verdict.tsx      VerdictStyle type, VERDICT_STYLE, VerdictShell, ConsensusBar,
                   and the unified VerdictHero (see DRY decisions).
  profile.tsx      ProfileCard, DomainProfileCard, HashProfileCard, CopyHashButton
                   (used only by HashProfileCard, so it lives here, not in primitives).
  sources.tsx      SLOW_MS, CATEGORY_LABEL, CATEGORY_ORDER, LOOKUP_URL,
                   DOMAIN_LOOKUP_URL, HASH_LOOKUP_URL, sourceLookupUrl, relevanceRank,
                   SourceBreakdown, SourceCard, StatusPill, ScoreChart.
  activity.tsx     SourceHealthNotice, ActivityCard, HistoryCard, trendNote.
  connections.tsx  ConnectionsCard, DistributionUrlsCard, ExposedServicesCard,
                   PORT_SERVICE, shodanHostInfo, RELATION_META, RELATION_ORDER,
                   DIGEST_RELATIONS.
```

Expected ~8 files of ~150–350 lines each.

### Import graph (acyclic — verified by cross-reference)

- `primitives.tsx` — imports only external libs (`lucide-react`, `react`, `@/lib/*`,
  `ui/*`). Imported by nearly everything. **Leaf.**
- `classify.ts` — pure helpers; imports `lucide-react` + `@/lib/ti/types`. **Leaf.**
- `verdict.tsx` — imports `primitives` (ScoreRing, CopyableSummary), `classify`
  (scoreBarColor not needed here; classify* used by the unified hero). Exports
  `VERDICT_STYLE` / `VerdictStyle` consumed downstream.
- `sources.tsx` — imports `primitives` (SectionHeading, Field), `classify`
  (scoreBarColor). Self-contained otherwise.
- `activity.tsx` — imports `primitives`, `verdict` (VERDICT_STYLE for HistoryCard),
  `classify`. One-way dependency on `verdict`; no cycle.
- `connections.tsx` — imports `primitives` (SectionHeading, Pivot, PivotList,
  CopyableSummary).
- `profile.tsx` — imports `primitives`, `classify`.
- `index.tsx` — imports all of the above and assembles the three layout components.

Key shared-symbol facts that drive placement (from cross-reference):

- `SectionHeading` used in 7+ modules → `primitives`.
- `Field` used 24× across profile/activity/connections → `primitives`.
- `Pivot`/`PivotList`/`PivotContext` used in profile, connections, index → `primitives`.
- `CopyableSummary`/`useCopied` used in verdict, profile, connections → `primitives`.
- `VERDICT_STYLE` used in verdict (VerdictShell, ConsensusBar) **and** activity
  (HistoryCard) → lives in `verdict.tsx`, imported one-way by `activity.tsx`.
- `scoreBarColor` used in sources (ScoreChart, SourceCard) → `classify` (pure).
- `CATEGORY_LABEL` used in sources (SourceBreakdown, SourceCard) → `sources.tsx`.

## DRY decisions

**Merge (do):** the three verdict heroes — `VerdictHero` (IP), `DomainVerdictHero`,
`HashVerdictHero` (CheckResults.tsx:849–918). They are thin shells that each
compute a `type`/`categoryLabel`/`narrative` and forward to `VerdictShell`. Replace
with one `VerdictHero({ result, onRefresh })` that branches via the already-imported
`isDomainResult` / `isHashResult` type guards to pick the right `classify*` +
`build*Narrative` + category label, then renders `VerdictShell`. Removes ~50 lines
of near-identical wrappers. `index.tsx` layouts call the single `VerdictHero`.

**Do NOT merge:** the three `*ProfileCard` components (CheckResults.tsx:1144,
1382, 1596). They share surface shape but extract genuinely different data — geo
(ASN/ISP/coords/proxy traits) vs. registration (created/expires/nameservers/MX)
vs. file metadata (size/type/malware family/digests). They already share the real
reusable primitive (`Field`). Collapsing them behind a config object would be a
worse abstraction (a wide union of optional fields + conditionals) than three
honest, readable components. Out of scope.

## Performance fix

`SourceCard` (CheckResults.tsx:2215–2227) renders the raw-details `<details>` with:

```tsx
<pre>{JSON.stringify(result.details, null, 2)}</pre>
```

This serializes `result.details` **eagerly on mount**, even though the `<details>`
starts collapsed and most users never expand it. On the one mount that matters,
that is ~15–50 stringify calls (one per source with details) for invisible content.

**Fix:** compute the JSON only when the `<details>` is open. Add local
`const [open, setOpen] = useState(false)` to `SourceCard`, set it from the
`<details onToggle={(e) => setOpen(e.currentTarget.open)}>`, and render the `<pre>`
body only when `open`. The summary still renders so the disclosure looks identical;
the serialized text appears on expand exactly as before. (`<details>` already
exists in the DOM, so `onToggle` fires on user expand.)

This is the single perf change. It is mount-time work reduction, not re-render
work, consistent with the one-mount data flow.

## Bundle size: honest note

Bundle reduction was raised as a goal; the honest assessment is **≈ neutral**:

- Splitting one file into eight compiles to the **same async chunk** — module
  boundaries inside a bundle do not change shipped bytes.
- The component is *already* a lazy `dynamic(..., { ssr: false })` import, so it is
  already code-split out of the initial load.
- `lucide-react` icons are already tree-shaken (named imports); there is no heavy
  chart library (the history chart is hand-rolled SVG).
- Everything renders on the single result view, so there is no large rarely-shown
  subtree worth deferring behind a further `dynamic()`.

If aggressive bundle reduction is later desired, that is a **different, larger
scope** (e.g. measuring the chunk, auditing `lucide-react` import cost, possibly
lazy-loading `ExposedServicesCard`/`HistoryCard` subtrees) — explicitly not part of
this refactor.

## Error handling

No change. The components' existing fallbacks (`SourceHealthNotice` for total
outage, per-source error/timeout/skipped rendering, `?? ` defaults) are relocated
verbatim. The split introduces no new failure modes; a missing import would fail at
type-check time (caught by `npm run build`).

## Testing & verification

No component tests exist (only `lib/relations.test.ts`, `lib/ti/narrative.test.ts`,
and other `lib/**/*.test.ts`). Verification is therefore:

1. **`npm run build`** — type-checks the whole graph; catches any broken import,
   missing export, or type drift from the split/merge. Must pass.
2. **`npm run lint`** — eslint clean. Must pass.
3. **`npm test`** — existing unit tests still green (they exercise the `lib/ti`
   helpers this component consumes; unchanged).
4. **Visual diff** — `node scripts/shot.mjs` captures `/check/8.8.8.8` (IP) and
   `/check/google.com` (domain) before and after; add a hash case
   (`/check/44d88612fea8a8f36de82e1278abb02f`, the EICAR MD5) to cover the third
   layout. Compare screenshots to confirm render-identical output. If the dev
   server / browser cannot be run in the environment, say so explicitly rather
   than claiming visual parity.

## Risks & mitigations

- **Import cycle introduced by split** → mitigated by the verified acyclic graph
  above; `npm run build` would fail loudly on a cycle-induced type error.
- **Default-export resolution change** → mitigated: folder `index.tsx` preserves
  `import("./CheckResults")` default-export semantics; verified Checker.tsx is the
  sole consumer.
- **Accidental behavior drift during relocation** → mitigated by moving code
  verbatim (no logic edits except the two intentional changes), plus the visual
  diff gate.
- **`onToggle` perf-fix changing UX** → mitigated: summary still renders; only the
  hidden `<pre>` body is deferred; expand shows identical content.

## Implementation order (for the plan)

1. Create `components/CheckResults/` and move code into the eight modules verbatim,
   wiring imports/exports; delete the old single file. Build + lint green.
2. Unify the three verdict heroes into one `VerdictHero`. Build + lint green.
3. Apply the `SourceCard` `onToggle` lazy-JSON fix. Build + lint + test green.
4. Visual diff (before/after IP, domain, hash). Confirm parity.
