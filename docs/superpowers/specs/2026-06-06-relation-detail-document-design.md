# Relationship Detail Document — Design Spec

- **Date:** 2026-06-06
- **Status:** Approved design, ready for implementation plan
- **Supersedes:** the constellation graph (`2026-06-05-relation-constellation-graph-design.md`).
  That graph is being removed; this replaces it with a report-style detail view.

## Context

`ConnectionsCard` (`components/CheckResults/connections.tsx`) shows the focused
indicator's one-hop relations (rDNS, observed hostnames, A records, NS, MX, C2
contacts, drops, distribution hosts, parent/similar samples — from
`relationsFor()` in `lib/relations.ts`). It was just reworked into a radial
**constellation graph** with a graph/list toggle. The user does not want a graph;
they want the relations shown as a **document that surfaces detail** for each
related indicator.

This spec replaces the graph (and the toggle) with a single grouped, report-style
detail view. No new dependencies.

## Goals / Non-goals

**Goals**
- Render relations as grouped detail sections: per relation kind, a labeled
  header + a plain-language description + a row per related indicator.
- Each row shows the indicator's **type** (icon), its **full value**, a **Check**
  action (pivot to a fresh check), and a **copy** button.
- Keep one shared source of relation labels/descriptions/order.
- Match the existing tactical/report aesthetic; reuse existing primitives.

**Non-goals**
- No graph, no graph/list toggle.
- No per-neighbour verdict/coloring (a neighbour's verdict is unknown until
  checked — same constraint the graph had; that is future "expand & seek" work).
- No change to `relationsFor`'s data or the per-source `relations` plumbing.

## Data model

Input is unchanged: `relationsFor(result)` → `{ value, type, related }`, each
`related` item is `RelatedIndicator = { value, type: "ip"|"domain"|"hash", relation }`.

A new pure helper shapes it for the view:

```ts
interface RelationGroup {
  relation: string;                 // e.g. "A", "NS", "rDNS"
  label: string;                    // RELATION_META label
  description: string;              // RELATION_META description (plain language)
  items: { value: string; type: IndicatorType }[];
}

function groupRelations(related: RelatedIndicator[]): RelationGroup[];
```

`groupRelations`:
- Drops items whose `relation` is in `DIGEST_RELATIONS` (a file's other digests
  live in the profile card, not here).
- Groups remaining items by `relation`, preserving each item's `type` (the
  current card collapses to `string[]` and loses the type — this keeps it).
- Dedupes by `value` within a group (defensive; `relationsFor` already dedupes
  globally by lowercased value).
- Orders groups by `RELATION_ORDER`, then any unknown relations alphabetically.
- Attaches `label`/`description` from `RELATION_META`; unknown relations fall back
  to `{ label: relation, description: "" }`.
- Returns only non-empty groups.

## Shared metadata (`lib/relations.ts`)

`RELATION_META` gains a `description` per relation:

```ts
export const RELATION_META: Record<string, { label: string; description: string }> = {
  contacts:     { label: "Contacts (C2 / network)", description: "C2 / network endpoints this sample contacted" },
  drops:        { label: "Drops",                   description: "Files this sample dropped or downloaded" },
  parent:       { label: "Parent samples",          description: "Samples that bundle or drop this file" },
  similar:      { label: "Similar samples",          description: "Files structurally similar to this one" },
  distribution: { label: "Distribution hosts",       description: "Hosts that distributed this file" },
  hosted:       { label: "Hosted domains",           description: "Domains hosted on this address" },
  A:            { label: "Resolves to (A)",          description: "IP addresses this domain resolves to" },
  resolved:     { label: "Resolves to (passive DNS)", description: "IPs seen for this domain in passive DNS" },
  NS:           { label: "Nameservers",              description: "Authoritative nameservers for this domain" },
  MX:           { label: "Mail (MX)",                description: "Mail exchangers for this domain" },
  rDNS:         { label: "Reverse DNS",              description: "Reverse-DNS name for this address" },
  host:         { label: "Observed hostnames",        description: "Hostnames observed on this address" },
};
```

`RELATION_ORDER` and `DIGEST_RELATIONS` are unchanged and stay where they are.
`groupRelations` is the only consumer of order/digest filtering, so the card no
longer imports them directly.

## Components (`components/CheckResults/connections.tsx`)

- **`ConnectionsCard`** — calls `groupRelations(relationsFor(result).related)`;
  returns `null` when empty (unchanged behavior). Renders `SectionHeading` +
  a stack of `RelationGroup` sections. No `useState`, no toggle.
- **`RelationGroup({ group })`** — the section: label (mono, uppercase) + the
  plain-language `description` (muted), then a `<ul>` of rows.
- **`RelationRow({ value, type })`** — one bordered row reusing the existing
  `DistributionUrlRow` styling: a `type` icon (`Network`/`Globe`/`FileDigit`,
  `Link2` fallback), the value (`<code>`, mono, `truncate` + `title` for long
  values), a **Check** button (`Search` icon + "check", calls
  `useContext(PivotContext)` → `pivot(value)`; rendered only when a pivot handler
  exists, like `Pivot`), and a **copy** button (`useCopied`, Copy/Check flip).

### Removed

- Delete `components/CheckResults/relation-graph.tsx`.
- Delete `lib/relation-graph.ts` and `lib/relation-graph.test.ts`.
- Remove from `connections.tsx`: `RelationGraph`, `ViewToggle`, `ConnectionsList`,
  the `view` `useState`, and the `Share2`/`LayoutList` imports. Remove now-unused
  `Field`/`PivotList` imports (the deleted list body was their only user here).

`DistributionUrlsCard` and `ExposedServicesCard` in the same file are untouched.

## Edge cases, accessibility, performance

- **No relations:** render nothing (unchanged).
- **Long values:** truncate with a `title` tooltip; the copy button preserves the
  full value, so nothing is lost.
- **Accessibility:** Check and copy are real `<button>`s with `aria-label`s; the
  value is selectable text. No SVG-interaction concerns (the graph is gone).
- **Performance:** plain DOM, no animation library. `relationsFor` already slices
  most relation groups (6 IPs, 4 NS/MX, 6 hostnames), so row counts stay small.

## Reused code (no change unless noted)

- `relationsFor` — `lib/relations.ts` (data).
- `RELATION_META` (gains `description`), `RELATION_ORDER`, `DIGEST_RELATIONS` —
  `lib/relations.ts`.
- `PivotContext` — `components/CheckResults/primitives.tsx` (Check → pivot).
- `SectionHeading`, `useCopied`, `Pivot` — `components/CheckResults/primitives.tsx`.
- `Card`/`CardContent`, `Button` — `components/ui/*`.
- Type icons from `lucide-react` (`Network`, `Globe`, `FileDigit`, `Search`).

## Files

- **Modify:** `lib/relations.ts` (descriptions + `groupRelations`),
  `components/CheckResults/connections.tsx` (rewrite the card).
- **Create:** `lib/relations.test.ts` (unit tests for `groupRelations`).
- **Delete:** `components/CheckResults/relation-graph.tsx`,
  `lib/relation-graph.ts`, `lib/relation-graph.test.ts`.
- **Unchanged:** `components/CheckResults/index.tsx` (still renders
  `<ConnectionsCard result={…}/>` inside `PivotContext.Provider`).

## Testing & verification

- **Unit (colocated vitest), `lib/relations.test.ts` — `groupRelations`:**
  - excludes digest relations (MD5 / SHA-1 / SHA-256);
  - orders groups by `RELATION_ORDER` (e.g. A before NS before MX), unknown
    relations last and alphabetical;
  - preserves each item's `type`; dedupes duplicate values within a group;
  - attaches `label` + `description` from `RELATION_META`.
  (These replace the 3 deleted `relation-graph.test.ts` cases.)
- **Static:** `npm test`, `npm run lint`, `npx tsc --noEmit` all clean.
- **Visual (Playwright, bundled chromium, dev server on :3000):** `google.com`
  (A/NS/MX) and `1.1.1.1` (rDNS + Shodan hostnames) — confirm grouped sections
  with descriptions and rows; Check pivots (URL changes); copy works; a
  no-relations result shows no card.

## Out of scope / future

- **Expand & seek:** fetch a related indicator's own result and merge — unchanged
  from the prior spec; still future work.
