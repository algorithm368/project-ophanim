# Relationship Constellation Graph (v1, static) — Design Spec

- **Date:** 2026-06-05
- **Status:** Approved design, ready for implementation plan
- **Scope:** v1 only — static constellation from the current result. v2 (expand &
  seek) and v3 (hero gauge / map) are explicitly out of scope (see end).

## Context

The project's vision — and its name, *Ophanim*, the wheels "full of eyes" — is an
**all-seeing eye**: look up one indicator and *see the world around it*. The
relational data already exists. `relationsFor()` (`lib/relations.ts`) returns the
focused indicator plus its typed one-hop edges (rDNS, observed hostnames, A
records, NS, MX, C2 contacts, drops, distribution hosts, parent/similar samples).
Today `ConnectionsCard` (`components/CheckResults/connections.tsx`) renders that as
flat grouped text lists — a graph drawn as text.

v1 turns those relations into an **interactive constellation graph**: the
indicator at the center, related indicators as nodes around it, typed edges, and
click-to-pivot to re-center on a neighbour. It reuses the existing relation data,
the pivot mechanism, and the verdict color system, and adds no dependencies.

## Goals / Non-goals

**Goals**
- Visualize the current result's relations as a radial node–edge graph.
- Hover to highlight a node's connection; click a node to pivot (fresh check).
- Keep the existing grouped list reachable via a graph/list toggle (data, copy,
  and keyboard access must never depend on the visualization).
- Match the tactical/C2 aesthetic; no new npm dependency.

**Non-goals (v1)**
- No fetching a node's own relations (that is v2 "expand & seek").
- No verdict coloring of neighbours (their verdict is unknown until checked).
- No force-directed layout (radial only).
- No changes to `relationsFor`'s data or to the per-source `relations` plumbing.

## Architecture & components

```
lib/relations.ts            + RELATION_META, RELATION_ORDER (moved here from
                              connections.tsx) so the graph and the list share
                              one source of relation labels/order. (avoids a
                              connections.tsx <-> relation-graph.tsx import cycle)

components/CheckResults/
  relation-graph.tsx (new)  Pure helpers + <RelationGraph>:
                              - buildGraphModel(focus, related) -> { nodes, edges }
                              - radialLayout(model, size) -> positioned nodes
                              - RelationGraph: client SVG renderer + hover + pivot
  relation-graph.test.ts (new)  Colocated vitest for the two pure helpers.
  connections.tsx (modify)  ConnectionsCard becomes the "Connections" container:
                              SectionHeading + a graph/list segmented toggle that
                              renders <RelationGraph> or the existing grouped list
                              (list body extracted to an internal ConnectionsList).
  index.tsx (unchanged)     Still renders <ConnectionsCard result={…}/> inside the
                              existing PivotContext.Provider.
```

Each unit has one purpose: `buildGraphModel` shapes data, `radialLayout` places
it, `RelationGraph` draws + handles interaction, `ConnectionsCard` chooses the
view. The pure helpers are testable without the DOM.

## Data model

Input comes from `relationsFor(result)` → `{ value, type, related }` where each
`related` item is `RelatedIndicator` = `{ value, type: "ip"|"domain"|"hash", relation }`.

```ts
type GraphNode = { id: string; value: string; type: IndicatorType; isFocus: boolean };
type GraphEdge = { from: string; to: string; relation: string };
type GraphModel = { nodes: GraphNode[]; edges: GraphEdge[] };
type PositionedNode = GraphNode & { x: number; y: number };
```

`buildGraphModel(focus, related)`:
- `id` = `value.toLowerCase()`. Focus node has `isFocus: true`.
- One edge per related item: `{ from: focusId, to: nodeId, relation }`.
- Dedupe neighbours by `id`; drop any neighbour whose `id === focusId`.
  (`relationsFor` already dedupes and excludes the focus; this is defensive.)
- Order neighbours by `RELATION_ORDER`, then by value, so same-relation nodes are
  adjacent (they cluster in the layout).

## Layout (radial, deterministic)

`radialLayout(model, { width, height })`:
- Focus at center `(width/2, height/2)`.
- N neighbours placed on a single ring; `angle_i = -π/2 + 2π·(i/N)`, radius =
  `min(width, height) * 0.38`. Because neighbours arrive grouped by relation,
  each relation occupies a contiguous arc (visual clustering) without extra math.
- Fully deterministic (index-based; no `Math.random`), so the same result always
  renders the same constellation.
- Safety cap: at most **48** neighbour nodes; extras are omitted from the graph
  and surfaced as a "+N more — see list" hint (the list view shows everything).
  Note `relationsFor` already slices most relation groups (e.g. 6 IPs, 4 NS/MX,
  6 hostnames), so this cap is a backstop, not the normal path.

## Visual design (tactical / C2)

- Inline `<svg>` with a responsive `viewBox`, square-ish container with a sensible
  min-height; faint radar-style background grid (concentric ring + crosshair) at
  low opacity.
- **Focus node:** larger circle (~r26) with the type icon; ring stroked with the
  result's verdict color via `VERDICT_STYLE[result.verdict].ring`
  (`components/CheckResults/verdict.tsx`); label = focus value (truncated, mono).
- **Neighbour nodes:** smaller (~r18) with the type icon; colored **by type** (a
  small `type → tailwind class` map, drawn from the existing palette — foreground/
  muted/primary tones, not new colors). Label = value, truncated.
- **Edges:** thin `stroke-foreground/20` lines from focus to each neighbour; the
  relation label (mono, tiny) sits near the midpoint, shown on hover (or always
  when there are few nodes).
- **Type icons:** `Network` (ip), `Globe` (domain), `FileDigit` (hash), `Link2`
  (url) — the icons already used elsewhere (Checker `MODE_META`, connections).
- **Legend:** small key mapping node icon → type, in a corner.

## Interaction

- **Hover** a neighbour → emphasize its edge (`stroke-primary`), slightly scale the
  node, dim the others (reduced opacity); tooltip shows `value` + relation label.
- **Click** a neighbour → `useContext(PivotContext)`'s `pivot(value)` (re-centers
  by running a fresh check — already wired through `Checker.pivot`). Focus node is
  not interactive (it's the current subject).
- **Graph/list toggle:** a segmented control in the card header (`SectionHeading`
  `action` slot). Default to **graph** when `related.length >= 3`, else **list**
  (a 1–2 node graph isn't worth drawing). Choice is component-local state.
- **List view** = the current grouped-relation rendering, extracted from today's
  `ConnectionsCard` into an internal `ConnectionsList` and reused unchanged.

## Edge cases, accessibility, performance

- **No relations:** render nothing (same as `ConnectionsCard` today).
- **Accessibility:** each neighbour node is a real focusable control (SVG `<g>`
  with `role="button"`, `tabIndex={0}`, `aria-label="Check <value> (<relation>)"`,
  Enter/Space → pivot). The list view is the fully accessible, copyable equivalent.
- **Responsive:** SVG scales to its container; on very small screens default to the
  list view.
- **Performance / SSR:** pure SVG, no animation library (hover uses CSS
  transitions). `CheckResults` is already loaded via `dynamic(..., { ssr: false })`,
  so the client-only graph is fine. Node cap (48) bounds DOM size.

## Reused code (no change unless noted)

- `relationsFor` — `lib/relations.ts` (graph data; this file also gains the moved
  `RELATION_META`/`RELATION_ORDER`).
- `PivotContext` — `components/CheckResults/primitives.tsx` (click → pivot).
- `VERDICT_STYLE` — `components/CheckResults/verdict.tsx` (focus ring color).
- `SectionHeading`, `useCopied` — `components/CheckResults/primitives.tsx`.
- Type icons from `lucide-react` (`Network`, `Globe`, `FileDigit`, `Link2`).

## Files

- **Create:** `components/CheckResults/relation-graph.tsx`,
  `components/CheckResults/relation-graph.test.ts`.
- **Modify:** `lib/relations.ts` (export `RELATION_META`, `RELATION_ORDER`),
  `components/CheckResults/connections.tsx` (toggle + extract `ConnectionsList`,
  import shared relation meta + `RelationGraph`).
- **Unchanged:** `components/CheckResults/index.tsx`.

## Testing & verification

- **Unit (colocated vitest):** `relation-graph.test.ts`
  - `buildGraphModel`: excludes the focus, dedupes neighbours by lowercased value,
    emits one edge per neighbour, orders by `RELATION_ORDER`.
  - `radialLayout`: focus at center, N neighbours produce N positioned nodes inside
    the bounds, deterministic for identical input.
- **Full suite + static checks:** `npm test`, `npm run lint`, `npx tsc --noEmit`.
- **Visual (Playwright, existing `scripts/shot.mjs` pattern):** check `google.com`
  (rich A/NS/MX web) and an IP with rDNS + Shodan hostnames; confirm the
  constellation renders, hover highlights one edge, clicking a node re-centers, and
  the graph/list toggle shows the same data both ways. Confirm the card is absent
  when there are no relations.

## Out of scope / future

- **v2 — expand & seek:** click a node to GET its result, run `relationsFor` on it,
  merge new neighbours, switch to a force-directed layout, color nodes by verdict,
  cache fetched results. Separate spec.
- **v3 — supporting:** surface the unused `ScoreRing` as a gauge in `VerdictHero`;
  plot related IPs on the existing `LocationMap`.
