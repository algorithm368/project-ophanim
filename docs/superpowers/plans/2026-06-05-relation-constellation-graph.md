# Relationship Constellation Graph (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the current result's relations as an interactive radial constellation graph (click a node to pivot), with a graph/list toggle that keeps the existing list view.

**Architecture:** Pure graph helpers live in `lib/relation-graph.ts` (so vitest, which only includes `lib/**/*.test.ts`, runs them). The React SVG renderer lives in `components/CheckResults/relation-graph.tsx`. Relation label metadata moves to `lib/relations.ts` so the graph and the list share it without an import cycle. `ConnectionsCard` becomes a small container that toggles between the graph and the existing grouped list. `index.tsx` is untouched.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, inline SVG (no new dependency), Tailwind v4, vitest, lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-06-05-relation-constellation-graph-design.md`

**Note on commits:** `main` is the default branch. Do Task 0 first. All commits append the trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- `lib/relations.ts` (modify) — gains exported `RELATION_META`, `RELATION_ORDER`, `DIGEST_RELATIONS` (moved out of `connections.tsx`). Single source of relation labels/order.
- `lib/relation-graph.ts` (create) — pure: `GraphNode`/`GraphEdge`/`GraphModel`/`PositionedNode` types, `buildGraphModel`, `radialLayout`.
- `lib/relation-graph.test.ts` (create) — vitest for the two pure helpers.
- `components/CheckResults/relation-graph.tsx` (create) — `RelationGraph` SVG component + `NeighbourNode`/`FocusNode`.
- `components/CheckResults/connections.tsx` (modify) — import shared metadata; `ConnectionsCard` gains a graph/list toggle; extract the list body into `ConnectionsList`.
- `components/CheckResults/index.tsx` — unchanged.

---

## Task 0: Branch

- [ ] **Step 1: Create a feature branch**

```bash
git checkout -b feat/relation-constellation-graph
```

---

## Task 1: Move relation metadata into `lib/relations.ts`

Pure refactor, no behavior change. Lets the graph and list share labels with no `connections.tsx ↔ relation-graph.tsx` cycle.

**Files:**
- Modify: `lib/relations.ts` (add exports at end)
- Modify: `components/CheckResults/connections.tsx` (delete local defs, import instead)

- [ ] **Step 1: Add the metadata exports to `lib/relations.ts`**

Append to `lib/relations.ts`:

```ts
/** Display label + ordering for each relation kind, shared by the connections
 *  list and the constellation graph. */
export const RELATION_META: Record<string, { label: string }> = {
  contacts: { label: "Contacts (C2 / network)" },
  drops: { label: "Drops" },
  parent: { label: "Parent samples" },
  similar: { label: "Similar samples" },
  distribution: { label: "Distribution hosts" },
  hosted: { label: "Hosted domains" },
  A: { label: "Resolves to (A)" },
  resolved: { label: "Resolves to (passive DNS)" },
  NS: { label: "Nameservers" },
  MX: { label: "Mail (MX)" },
  rDNS: { label: "Reverse DNS" },
  host: { label: "Observed hostnames" },
};

export const RELATION_ORDER = [
  "contacts",
  "drops",
  "parent",
  "similar",
  "distribution",
  "hosted",
  "A",
  "resolved",
  "NS",
  "MX",
  "rDNS",
  "host",
];

/** A file's other digests are shown in the profile card, not as "connections". */
export const DIGEST_RELATIONS = new Set(["MD5", "SHA-1", "SHA-256"]);
```

- [ ] **Step 2: Replace the local defs in `connections.tsx` with an import**

In `components/CheckResults/connections.tsx`, delete the local `RELATION_META`, `RELATION_ORDER`, and `DIGEST_RELATIONS` definitions (currently lines ~22–52) and add to the imports near the top:

```ts
import { relationsFor, RELATION_META, RELATION_ORDER, DIGEST_RELATIONS } from "@/lib/relations";
```

(Replace the existing `import { relationsFor } from "@/lib/relations";` line.)

- [ ] **Step 3: Verify nothing broke**

Run: `npm run lint && npx tsc --noEmit && npm test`
Expected: lint clean, no type errors, all tests pass (same count as before).

- [ ] **Step 4: Commit**

```bash
git add lib/relations.ts components/CheckResults/connections.tsx
git commit -m "refactor: share relation metadata from lib/relations

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `buildGraphModel` (pure, TDD)

**Files:**
- Create: `lib/relation-graph.ts`
- Test: `lib/relation-graph.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/relation-graph.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildGraphModel } from "./relation-graph";
import type { RelatedIndicator } from "@/lib/ti/types";

const focus = { value: "1.2.3.4", type: "ip" as const };

describe("buildGraphModel", () => {
  it("excludes the focus and dedupes neighbours by lowercased value", () => {
    const related: RelatedIndicator[] = [
      { value: "Evil.com", type: "domain", relation: "rDNS" },
      { value: "evil.com", type: "domain", relation: "host" }, // dup value
      { value: "1.2.3.4", type: "ip", relation: "A" }, // == focus
    ];
    const m = buildGraphModel(focus, related);
    const neighbours = m.nodes.filter((n) => !n.isFocus);
    expect(neighbours).toHaveLength(1);
    expect(neighbours[0].id).toBe("evil.com");
    expect(m.nodes.find((n) => n.isFocus)?.id).toBe("1.2.3.4");
    expect(m.edges).toHaveLength(1);
    expect(m.edges[0]).toMatchObject({ from: "1.2.3.4", to: "evil.com" });
  });

  it("orders neighbours by RELATION_ORDER (A before NS before MX)", () => {
    const related: RelatedIndicator[] = [
      { value: "mx.example", type: "domain", relation: "MX" },
      { value: "5.6.7.8", type: "ip", relation: "A" },
      { value: "ns.example", type: "domain", relation: "NS" },
    ];
    const order = buildGraphModel(focus, related)
      .nodes.filter((n) => !n.isFocus)
      .map((n) => n.relation);
    expect(order).toEqual(["A", "NS", "MX"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/relation-graph.test.ts`
Expected: FAIL — `buildGraphModel` is not exported (module not found).

- [ ] **Step 3: Write the implementation**

Create `lib/relation-graph.ts`:

```ts
import type { IndicatorType, RelatedIndicator } from "@/lib/ti/types";
import { RELATION_ORDER } from "@/lib/relations";

export interface GraphNode {
  id: string; // lowercased value
  value: string;
  type: IndicatorType;
  isFocus: boolean;
  /** Edge label to the focus; undefined for the focus node itself. */
  relation?: string;
}

export interface GraphEdge {
  from: string; // focus id
  to: string; // neighbour id
  relation: string;
}

export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface PositionedNode extends GraphNode {
  x: number;
  y: number;
}

/** Backstop so a pathological fan-out can't explode the SVG; the list view still
 *  shows everything. relationsFor already slices most relation groups. */
const MAX_NEIGHBORS = 48;

/** Star graph: focus at the hub, one deduped neighbour per related value, sorted
 *  by RELATION_ORDER (then value) so same-relation nodes are adjacent. */
export function buildGraphModel(
  focus: { value: string; type: IndicatorType },
  related: RelatedIndicator[],
): GraphModel {
  const focusId = focus.value.toLowerCase();
  const orderIndex = (rel: string) => {
    const i = RELATION_ORDER.indexOf(rel);
    return i === -1 ? RELATION_ORDER.length : i;
  };
  const sorted = [...related].sort(
    (a, b) =>
      orderIndex(a.relation) - orderIndex(b.relation) ||
      a.value.localeCompare(b.value),
  );

  const seen = new Set<string>([focusId]);
  const neighbours: GraphNode[] = [];
  for (const r of sorted) {
    const id = r.value.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    neighbours.push({
      id,
      value: r.value,
      type: r.type,
      isFocus: false,
      relation: r.relation,
    });
    if (neighbours.length >= MAX_NEIGHBORS) break;
  }

  const focusNode: GraphNode = {
    id: focusId,
    value: focus.value,
    type: focus.type,
    isFocus: true,
  };
  const edges: GraphEdge[] = neighbours.map((n) => ({
    from: focusId,
    to: n.id,
    relation: n.relation as string,
  }));
  return { nodes: [focusNode, ...neighbours], edges };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/relation-graph.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/relation-graph.ts lib/relation-graph.test.ts
git commit -m "feat: buildGraphModel for the relation constellation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `radialLayout` (pure, TDD)

**Files:**
- Modify: `lib/relation-graph.ts` (append `radialLayout`)
- Test: `lib/relation-graph.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `lib/relation-graph.test.ts`:

```ts
import { radialLayout } from "./relation-graph";

describe("radialLayout", () => {
  it("centers the focus and rings the neighbours deterministically", () => {
    const related: RelatedIndicator[] = [
      { value: "a.com", type: "domain", relation: "A" },
      { value: "b.com", type: "domain", relation: "A" },
      { value: "c.com", type: "domain", relation: "A" },
    ];
    const model = buildGraphModel(focus, related);
    const size = { width: 480, height: 360 };
    const pos = radialLayout(model, size);

    expect(pos).toHaveLength(4);
    const f = pos.find((p) => p.isFocus)!;
    expect([f.x, f.y]).toEqual([240, 180]);

    const r = 360 * 0.38;
    for (const p of pos.filter((p) => !p.isFocus)) {
      expect(Math.hypot(p.x - 240, p.y - 180)).toBeCloseTo(r, 5);
    }
    // deterministic: identical input -> identical output
    expect(radialLayout(model, size)).toEqual(pos);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/relation-graph.test.ts`
Expected: FAIL — `radialLayout` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `lib/relation-graph.ts`:

```ts
/** Focus at center; neighbours on a ring at a fixed radius, evenly spaced by
 *  index (deterministic — no Math.random). First neighbour sits at the top. */
export function radialLayout(
  model: GraphModel,
  size: { width: number; height: number },
): PositionedNode[] {
  const cx = size.width / 2;
  const cy = size.height / 2;
  const radius = Math.min(size.width, size.height) * 0.38;

  const focus = model.nodes.find((n) => n.isFocus);
  const neighbours = model.nodes.filter((n) => !n.isFocus);
  const out: PositionedNode[] = [];
  if (focus) out.push({ ...focus, x: cx, y: cy });

  const n = Math.max(1, neighbours.length);
  neighbours.forEach((node, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
    out.push({
      ...node,
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  });
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/relation-graph.test.ts`
Expected: PASS (3 tests total).

- [ ] **Step 5: Commit**

```bash
git add lib/relation-graph.ts lib/relation-graph.test.ts
git commit -m "feat: radialLayout for the relation constellation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `RelationGraph` SVG component

No DOM unit test (vitest is node-only here); verified by tsc/lint now and visually in Task 6.

**Files:**
- Create: `components/CheckResults/relation-graph.tsx`

- [ ] **Step 1: Write the component**

Create `components/CheckResults/relation-graph.tsx`:

```tsx
"use client";

import { useContext, useState } from "react";
import { FileDigit, Globe, Link2, Network } from "lucide-react";
import type { IndicatorType, RelatedIndicator, Verdict } from "@/lib/ti/types";
import { RELATION_META } from "@/lib/relations";
import {
  buildGraphModel,
  radialLayout,
  type PositionedNode,
} from "@/lib/relation-graph";
import { cn } from "@/lib/utils";
import { VERDICT_STYLE } from "./verdict";
import { PivotContext } from "./primitives";
import type { IconType } from "./types";

const VIEW = { width: 480, height: 360 };
const FOCUS_R = 26;
const NODE_R = 17;

const TYPE_ICON: Record<IndicatorType, IconType> = {
  ip: Network,
  domain: Globe,
  hash: FileDigit,
};
const TYPE_CLASS: Record<IndicatorType, string> = {
  ip: "fill-sky-500/15 stroke-sky-500/60 text-sky-600 dark:text-sky-400",
  domain:
    "fill-emerald-500/15 stroke-emerald-500/60 text-emerald-600 dark:text-emerald-400",
  hash: "fill-violet-500/15 stroke-violet-500/60 text-violet-600 dark:text-violet-400",
};

function short(value: string): string {
  return value.length > 22 ? `${value.slice(0, 21)}…` : value;
}

export function RelationGraph({
  focus,
  related,
  verdict,
}: {
  focus: { value: string; type: IndicatorType };
  related: RelatedIndicator[];
  verdict: Verdict;
}) {
  const pivot = useContext(PivotContext);
  const [hover, setHover] = useState<string | null>(null);

  const model = buildGraphModel(focus, related);
  const positioned = radialLayout(model, VIEW);
  const byId = new Map(positioned.map((n) => [n.id, n]));
  const focusNode = byId.get(focus.value.toLowerCase());

  return (
    <svg
      viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
      role="img"
      aria-label={`Relationship graph for ${focus.value}`}
      className="w-full select-none"
    >
      {/* radar grid */}
      <g className="stroke-foreground/[0.08]" fill="none">
        <circle cx={VIEW.width / 2} cy={VIEW.height / 2} r={VIEW.height * 0.19} />
        <circle cx={VIEW.width / 2} cy={VIEW.height / 2} r={VIEW.height * 0.38} />
        <line x1={VIEW.width / 2} y1={0} x2={VIEW.width / 2} y2={VIEW.height} />
        <line x1={0} y1={VIEW.height / 2} x2={VIEW.width} y2={VIEW.height / 2} />
      </g>

      {/* edges */}
      {model.edges.map((e) => {
        const a = byId.get(e.from);
        const b = byId.get(e.to);
        if (!a || !b) return null;
        const active = hover === e.to;
        return (
          <g
            key={e.to}
            className={cn(
              "transition-opacity",
              hover && !active && "opacity-20",
            )}
          >
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              strokeWidth={active ? 2 : 1.25}
              className={active ? "stroke-primary" : "stroke-foreground/25"}
            />
            {(active || model.edges.length <= 6) && (
              <text
                x={(a.x + b.x) / 2}
                y={(a.y + b.y) / 2 - 3}
                textAnchor="middle"
                className="fill-muted-foreground font-mono text-[8px] uppercase tracking-wider"
              >
                {RELATION_META[e.relation]?.label ?? e.relation}
              </text>
            )}
          </g>
        );
      })}

      {/* neighbour nodes */}
      {positioned
        .filter((n) => !n.isFocus)
        .map((n) => (
          <NeighbourNode
            key={n.id}
            node={n}
            dim={hover !== null && hover !== n.id}
            onHover={setHover}
            onPivot={pivot ? () => pivot(n.value) : undefined}
          />
        ))}

      {/* focus node (not interactive) */}
      {focusNode && <FocusNode node={focusNode} verdict={verdict} />}
    </svg>
  );
}

function NeighbourNode({
  node,
  dim,
  onHover,
  onPivot,
}: {
  node: PositionedNode;
  dim: boolean;
  onHover: (id: string | null) => void;
  onPivot?: () => void;
}) {
  const Icon = TYPE_ICON[node.type] ?? Link2;
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`Check ${node.value}${node.relation ? ` (${node.relation})` : ""}`}
      className={cn(
        "cursor-pointer outline-none transition-opacity",
        dim && "opacity-30",
      )}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(node.id)}
      onBlur={() => onHover(null)}
      onClick={onPivot}
      onKeyDown={(e) => {
        if (onPivot && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onPivot();
        }
      }}
    >
      <circle
        cx={node.x}
        cy={node.y}
        r={NODE_R}
        strokeWidth={1.5}
        className={TYPE_CLASS[node.type] ?? "fill-muted stroke-foreground/40"}
      />
      <Icon
        x={node.x - 7}
        y={node.y - 7}
        width={14}
        height={14}
        className={TYPE_CLASS[node.type]}
      />
      <text
        x={node.x}
        y={node.y + NODE_R + 11}
        textAnchor="middle"
        className="fill-foreground/80 font-mono text-[9px]"
      >
        {short(node.value)}
      </text>
    </g>
  );
}

function FocusNode({
  node,
  verdict,
}: {
  node: PositionedNode;
  verdict: Verdict;
}) {
  const Icon = TYPE_ICON[node.type] ?? Link2;
  const style = VERDICT_STYLE[verdict];
  return (
    <g>
      <circle
        cx={node.x}
        cy={node.y}
        r={FOCUS_R}
        strokeWidth={3}
        className={cn("fill-background", style.ring)}
      />
      <Icon
        x={node.x - 10}
        y={node.y - 10}
        width={20}
        height={20}
        className={style.text}
      />
      <text
        x={node.x}
        y={node.y + FOCUS_R + 12}
        textAnchor="middle"
        className={cn("font-mono text-[10px] font-semibold", style.text)}
      >
        {short(node.value)}
      </text>
    </g>
  );
}
```

- [ ] **Step 2: Verify it compiles and lints**

Run: `npx tsc --noEmit && npx eslint components/CheckResults/relation-graph.tsx`
Expected: no type errors, lint clean.

- [ ] **Step 3: Commit**

```bash
git add components/CheckResults/relation-graph.tsx
git commit -m "feat: RelationGraph SVG constellation renderer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Graph/list toggle in `ConnectionsCard`

**Files:**
- Modify: `components/CheckResults/connections.tsx`

- [ ] **Step 1: Update imports**

In `components/CheckResults/connections.tsx`, ensure these are imported (add `useState`, the toggle icons, and `RelationGraph`):

```ts
import { useState } from "react";
import { Check, Copy, ExternalLink, LayoutList, Link2, Server, Share2 } from "lucide-react";
import { RelationGraph } from "./relation-graph";
```

(Keep the existing `relationsFor`/metadata import from Task 1 and the other existing imports.)

- [ ] **Step 2: Replace the `ConnectionsCard` body**

Replace the entire current `ConnectionsCard` function with:

```tsx
export function ConnectionsCard({
  result,
}: {
  result: CheckResult | DomainCheckResult | HashCheckResult;
}) {
  const { value, type, related } = relationsFor(result);
  // A file's other digests live in the profile card, not here.
  const filtered = related.filter((r) => !DIGEST_RELATIONS.has(r.relation));

  const groups = new Map<string, string[]>();
  for (const r of filtered) {
    const list = groups.get(r.relation) ?? [];
    list.push(r.value);
    groups.set(r.relation, list);
  }
  const keys = [
    ...RELATION_ORDER.filter((k) => groups.has(k)),
    ...[...groups.keys()].filter((k) => !RELATION_ORDER.includes(k)).sort(),
  ];

  // Graph default once there are enough nodes to be worth drawing.
  const [view, setView] = useState<"graph" | "list">(
    filtered.length >= 3 ? "graph" : "list",
  );

  if (groups.size === 0) return null;

  return (
    <Card className="sketch-shadow rounded-2xl border border-foreground/12">
      <CardContent className="space-y-4">
        <SectionHeading
          icon={Link2}
          action={<ViewToggle view={view} onChange={setView} />}
        >
          Related indicators
        </SectionHeading>
        {view === "graph" ? (
          <RelationGraph
            focus={{ value, type }}
            related={filtered}
            verdict={result.verdict}
          />
        ) : (
          <ConnectionsList groups={groups} keys={keys} />
        )}
      </CardContent>
    </Card>
  );
}

function ConnectionsList({
  groups,
  keys,
}: {
  groups: Map<string, string[]>;
  keys: string[];
}) {
  return (
    <dl className="divide-y divide-foreground/[0.06] [&>:first-child]:pt-0 [&>:last-child]:pb-0">
      {keys.map((key) => {
        const meta = RELATION_META[key] ?? { label: key };
        return (
          <Field key={key} label={meta.label} wrap>
            <PivotList values={groups.get(key) ?? []} max={6} />
          </Field>
        );
      })}
    </dl>
  );
}

function ViewToggle({
  view,
  onChange,
}: {
  view: "graph" | "list";
  onChange: (v: "graph" | "list") => void;
}) {
  const base =
    "flex size-7 items-center justify-center rounded-md border transition-colors";
  return (
    <div className="flex items-center gap-1" role="group" aria-label="View">
      <button
        type="button"
        aria-pressed={view === "graph"}
        aria-label="Graph view"
        onClick={() => onChange("graph")}
        className={
          view === "graph"
            ? `${base} border-primary/50 bg-primary/10 text-primary`
            : `${base} border-foreground/15 text-muted-foreground hover:text-foreground`
        }
      >
        <Share2 className="size-3.5" />
      </button>
      <button
        type="button"
        aria-pressed={view === "list"}
        aria-label="List view"
        onClick={() => onChange("list")}
        className={
          view === "list"
            ? `${base} border-primary/50 bg-primary/10 text-primary`
            : `${base} border-foreground/15 text-muted-foreground hover:text-foreground`
        }
      >
        <LayoutList className="size-3.5" />
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Verify compile, lint, tests**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: no type errors, lint clean, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add components/CheckResults/connections.tsx
git commit -m "feat: graph/list toggle in the connections card

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full static checks**

Run: `npm test && npm run lint && npx tsc --noEmit`
Expected: all pass (4 new tests in `lib/relation-graph.test.ts`).

- [ ] **Step 2: Visual check via Playwright (dev server already running on :3000)**

Write a throwaway script in `scripts/` (so `node_modules` resolves) that loads a rich case, e.g. `http://localhost:3000/check/google.com` (many A/NS/MX), waits for the verdict, screenshots full page; then repeat for an IP with rDNS + Shodan hostnames (e.g. `1.1.1.1`). Confirm:
  - the "Related indicators" card shows the constellation by default (≥3 relations);
  - hovering a node highlights its edge and dims the rest;
  - clicking a node re-centers (URL changes to `/check/<that value>`, a fresh check runs);
  - the graph/list toggle switches to the same data as a grouped list;
  - a result with no relations shows no card.
Delete the throwaway script afterward.

- [ ] **Step 3: Commit any screenshots/notes are NOT committed; finish**

```bash
git log --oneline -7
```
Expected: the Task 0–5 commits in order.

---

## Self-Review (coverage check)

- **Spec → tasks:** metadata move (T1) · `buildGraphModel` (T2) · `radialLayout` (T3) · SVG renderer with radial layout, type icons + verdict-ring focus, hover-highlight, click-pivot, a11y buttons (T4) · graph/list toggle + reused list + card-hides-when-empty (T5) · unit + visual verification (T6). All spec sections map to a task.
- **Spec refinement noted:** pure helpers live in `lib/relation-graph.ts` (not the component file) because vitest only includes `lib/**/*.test.ts`; node types are `ip|domain|hash` (+ `Link2` fallback) since `IndicatorType` has no `url`.
- **Type consistency:** `buildGraphModel` → `GraphModel`; `radialLayout(model, size)` → `PositionedNode[]`; `RelationGraph` consumes both and `RELATION_META`/`VERDICT_STYLE`/`PivotContext`. Names match across tasks.
- **No placeholders:** every code step contains complete code; every run step has an exact command + expected result.
