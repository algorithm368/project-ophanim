# Relationship Detail Document Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the relation constellation graph with a grouped, report-style detail view — each relation kind as a labeled section (label + plain-language description) of rows showing type · full value · Check (pivot) · copy.

**Architecture:** A pure `groupRelations()` helper in `lib/relations.ts` (vitest covers `lib/**/*.test.ts`) shapes `relationsFor()` output into ordered, described groups carrying each item's type. `ConnectionsCard` (`components/CheckResults/connections.tsx`) becomes a thin renderer of those groups via `RelationGroupSection` + `RelationRow`. The graph and its toggle are deleted.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Tailwind v4, vitest, lucide-react icons. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-06-relation-detail-document-design.md`

**Note on branch & commits:** The branch `feat/relation-detail-document` already exists (the spec is committed there). Stay on it — Task 0 just verifies. All commits append the trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- `lib/relations.ts` (modify) — `RELATION_META` entries gain a `description`; add the `RelationGroup` interface + pure `groupRelations()`. `RELATION_ORDER` / `DIGEST_RELATIONS` unchanged.
- `lib/relations.test.ts` (modify) — append a `groupRelations` describe block.
- `components/CheckResults/connections.tsx` (modify) — rewrite `ConnectionsCard` as the detail document (`RelationGroupSection` + `RelationRow`); drop `RelationGraph` / `ViewToggle` / `ConnectionsList` / the toggle.
- `components/CheckResults/relation-graph.tsx` (delete).
- `lib/relation-graph.ts` (delete), `lib/relation-graph.test.ts` (delete).
- `components/CheckResults/index.tsx` — unchanged.

---

## Task 0: Branch

- [ ] **Step 1: Confirm the branch**

```bash
git branch --show-current
```
Expected: `feat/relation-detail-document`. (Already created with the spec commit. If not on it: `git checkout feat/relation-detail-document`.)

---

## Task 1: `RELATION_META` descriptions + `groupRelations` (pure, TDD)

**Files:**
- Modify: `lib/relations.ts`
- Modify: `lib/relations.test.ts` (append)

- [ ] **Step 1: Write the failing test**

In `lib/relations.test.ts`, add `groupRelations` to the `@/lib/relations` import and `RelatedIndicator` to the `@/lib/ti/types` type import so the top of the file reads:

```ts
import { describe, expect, it } from "vitest";
import {
  domainRelations,
  groupRelations,
  hashRelations,
  ipRelations,
  relationsFor,
} from "@/lib/relations";
import type {
  CheckResult,
  DomainCheckResult,
  HashCheckResult,
  RelatedIndicator,
  SourceResult,
} from "@/lib/ti/types";
```

Then append this describe block to the end of the file:

```ts
describe("groupRelations", () => {
  it("excludes a file's other digests (MD5/SHA-1/SHA-256)", () => {
    const related: RelatedIndicator[] = [
      { value: "44d88612fea8a8f36de82e1278abb02f", type: "hash", relation: "MD5" },
      { value: "1.2.3.4", type: "ip", relation: "A" },
    ];
    expect(groupRelations(related).map((g) => g.relation)).toEqual(["A"]);
  });

  it("orders groups by RELATION_ORDER, then unknown relations alphabetically", () => {
    const related: RelatedIndicator[] = [
      { value: "mx.example", type: "domain", relation: "MX" },
      { value: "zeta", type: "domain", relation: "zeta" }, // unknown
      { value: "1.2.3.4", type: "ip", relation: "A" },
      { value: "ns.example", type: "domain", relation: "NS" },
      { value: "alpha", type: "domain", relation: "alpha" }, // unknown
    ];
    expect(groupRelations(related).map((g) => g.relation)).toEqual([
      "A",
      "NS",
      "MX",
      "alpha",
      "zeta",
    ]);
  });

  it("groups items, preserves type, and dedupes duplicate values within a group", () => {
    const related: RelatedIndicator[] = [
      { value: "1.1.1.1", type: "ip", relation: "A" },
      { value: "1.1.1.1", type: "ip", relation: "A" }, // dup value
      { value: "8.8.8.8", type: "ip", relation: "A" },
    ];
    const groups = groupRelations(related);
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toEqual([
      { value: "1.1.1.1", type: "ip" },
      { value: "8.8.8.8", type: "ip" },
    ]);
  });

  it("attaches label and description from RELATION_META", () => {
    const [g] = groupRelations([{ value: "1.2.3.4", type: "ip", relation: "A" }]);
    expect(g.label).toBe("Resolves to (A)");
    expect(g.description).toBe("IP addresses this domain resolves to");
  });

  it("falls back to the raw relation as label for unknown relations", () => {
    const [g] = groupRelations([{ value: "x", type: "domain", relation: "weird" }]);
    expect(g.label).toBe("weird");
    expect(g.description).toBe("");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/relations.test.ts`
Expected: FAIL — `groupRelations` is not exported (the new cases error; existing cases still pass).

- [ ] **Step 3: Write the implementation**

In `lib/relations.ts`, replace the existing `RELATION_META` declaration:

```ts
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
```

with this `{ label, description }` version:

```ts
/** Display label + plain-language description + ordering for each relation kind,
 *  shared by the connections detail view. */
export const RELATION_META: Record<string, { label: string; description: string }> = {
  contacts: {
    label: "Contacts (C2 / network)",
    description: "C2 / network endpoints this sample contacted",
  },
  drops: { label: "Drops", description: "Files this sample dropped or downloaded" },
  parent: {
    label: "Parent samples",
    description: "Samples that bundle or drop this file",
  },
  similar: {
    label: "Similar samples",
    description: "Files structurally similar to this one",
  },
  distribution: {
    label: "Distribution hosts",
    description: "Hosts that distributed this file",
  },
  hosted: { label: "Hosted domains", description: "Domains hosted on this address" },
  A: {
    label: "Resolves to (A)",
    description: "IP addresses this domain resolves to",
  },
  resolved: {
    label: "Resolves to (passive DNS)",
    description: "IPs seen for this domain in passive DNS",
  },
  NS: {
    label: "Nameservers",
    description: "Authoritative nameservers for this domain",
  },
  MX: { label: "Mail (MX)", description: "Mail exchangers for this domain" },
  rDNS: { label: "Reverse DNS", description: "Reverse-DNS name for this address" },
  host: {
    label: "Observed hostnames",
    description: "Hostnames observed on this address",
  },
};
```

Then append the helper to the end of `lib/relations.ts` (after the `DIGEST_RELATIONS` declaration):

```ts
export interface RelationGroup {
  relation: string;
  label: string;
  description: string;
  items: { value: string; type: IndicatorType }[];
}

/** Shape relations for the connections detail view: drop a file's other digests,
 *  group by relation (preserving each item's type), order by RELATION_ORDER then
 *  unknown relations alphabetically, and attach the shared label/description. */
export function groupRelations(related: RelatedIndicator[]): RelationGroup[] {
  const byRelation = new Map<string, { value: string; type: IndicatorType }[]>();
  for (const r of related) {
    if (DIGEST_RELATIONS.has(r.relation)) continue;
    const items = byRelation.get(r.relation) ?? [];
    if (!items.some((i) => i.value === r.value)) {
      items.push({ value: r.value, type: r.type });
    }
    byRelation.set(r.relation, items);
  }

  const keys = [
    ...RELATION_ORDER.filter((k) => byRelation.has(k)),
    ...[...byRelation.keys()].filter((k) => !RELATION_ORDER.includes(k)).sort(),
  ];

  return keys.map((relation) => {
    const meta = RELATION_META[relation] ?? { label: relation, description: "" };
    return {
      relation,
      label: meta.label,
      description: meta.description,
      items: byRelation.get(relation) ?? [],
    };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/relations.test.ts`
Expected: PASS — all existing cases plus the 5 new `groupRelations` cases.

- [ ] **Step 5: Verify nothing else broke**

Run: `npx tsc --noEmit && npm run lint`
Expected: no type errors (the old `connections.tsx`/`relation-graph.tsx` only read `RELATION_META[...].label`, which still exists), lint clean.

- [ ] **Step 6: Commit**

```bash
git add lib/relations.ts lib/relations.test.ts
git commit -m "feat: groupRelations + relation descriptions for the detail view

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Rewrite `ConnectionsCard` as the detail document; delete the graph

No DOM unit test (vitest is node-only here); verified by tsc/lint now and visually in Task 3.

**Files:**
- Modify: `components/CheckResults/connections.tsx`
- Delete: `components/CheckResults/relation-graph.tsx`, `lib/relation-graph.ts`, `lib/relation-graph.test.ts`

- [ ] **Step 1: Replace the imports at the top of `connections.tsx`**

Replace the current top block (the `"use client";` line through the `./relation-graph` import — i.e. everything above `export function ConnectionsCard`) with:

```tsx
"use client";

import { useContext } from "react";
import {
    Check,
    Copy,
    ExternalLink,
    FileDigit,
    Globe,
    Link2,
    Network,
    Search,
    Server,
} from "lucide-react";
import {
    type CheckResult,
    type DomainCheckResult,
    type HashCheckResult,
    type IndicatorType,
} from "@/lib/ti/types";
import { type ResultLike } from "@/lib/ti/narrative";
import { relationsFor, groupRelations, type RelationGroup } from "@/lib/relations";
import { hostFromUrl } from "@/lib/url";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Pivot, PivotContext, SectionHeading, useCopied } from "./primitives";
import type { IconType } from "./types";

const TYPE_ICON: Record<IndicatorType, IconType> = {
    ip: Network,
    domain: Globe,
    hash: FileDigit,
};
```

(Drops `Share2`/`LayoutList`/`useState`/`Field`/`PivotList`/`RelationGraph`; adds `useContext`, the type icons, `Search`, `IndicatorType`, `groupRelations`/`RelationGroup`, `PivotContext`, `IconType`.)

- [ ] **Step 2: Replace the card body**

Replace the entire `ConnectionsCard` / `ConnectionsList` / `ViewToggle` block (from `export function ConnectionsCard` down to the closing `}` of `ViewToggle`, immediately before `function DistributionUrlRow`) with:

```tsx
export function ConnectionsCard({
    result,
}: {
    result: CheckResult | DomainCheckResult | HashCheckResult;
}) {
    const { related } = relationsFor(result);
    const groups = groupRelations(related);
    if (groups.length === 0) return null;

    return (
        <Card className="sketch-shadow rounded-2xl border border-foreground/12">
            <CardContent className="space-y-5">
                <SectionHeading icon={Link2}>Related indicators</SectionHeading>
                {groups.map((group) => (
                    <RelationGroupSection key={group.relation} group={group} />
                ))}
            </CardContent>
        </Card>
    );
}

function RelationGroupSection({ group }: { group: RelationGroup }) {
    return (
        <div className="space-y-2">
            <div>
                <div className="font-mono text-[12px] font-semibold tracking-wider text-foreground uppercase">
                    {group.label}
                </div>
                {group.description && (
                    <p className="text-xs text-muted-foreground">
                        {group.description}
                    </p>
                )}
            </div>
            <ul className="space-y-1.5">
                {group.items.map((item) => (
                    <RelationRow
                        key={item.value}
                        value={item.value}
                        type={item.type}
                    />
                ))}
            </ul>
        </div>
    );
}

function RelationRow({ value, type }: { value: string; type: IndicatorType }) {
    const pivot = useContext(PivotContext);
    const [copied, copy] = useCopied();
    const Icon = TYPE_ICON[type] ?? Link2;
    return (
        <li className="flex items-center gap-2 rounded-md border border-foreground/10 bg-muted/40 p-2 text-xs">
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            <code
                className="min-w-0 flex-1 truncate font-mono text-[12px]"
                title={value}
            >
                {value}
            </code>
            {pivot && (
                <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    aria-label={`Check ${value}`}
                    className="shrink-0 gap-1 font-mono text-[11px] text-muted-foreground hover:text-primary"
                    onClick={() => pivot(value)}
                >
                    <Search className="size-3.5" />
                    check
                </Button>
            )}
            <Button
                type="button"
                variant="ghost"
                size="xs"
                aria-label={`Copy ${value}`}
                className="size-6 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                onClick={() => copy(value)}
            >
                {copied ? (
                    <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                ) : (
                    <Copy className="size-3.5" />
                )}
            </Button>
        </li>
    );
}
```

The rest of the file (`DistributionUrlRow`, `DistributionUrlsCard`, `PORT_SERVICE`, `shodanHostInfo`, `ExposedServicesCard`) is unchanged. Note `Pivot` is still imported because `DistributionUrlRow` uses it.

- [ ] **Step 3: Delete the graph files**

```bash
git rm components/CheckResults/relation-graph.tsx lib/relation-graph.ts lib/relation-graph.test.ts
```

- [ ] **Step 4: Verify compile, lint, tests**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: no type errors, lint clean, all tests pass (the 3 `relation-graph.test.ts` cases are gone; the 5 `groupRelations` cases from Task 1 are present).

- [ ] **Step 5: Commit**

```bash
git add components/CheckResults/connections.tsx
git commit -m "feat: relations as a grouped detail document; remove graph

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

(The `git rm` from Step 3 is already staged, so this commit includes the deletions.)

---

## Task 3: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full static checks**

Run: `npm test && npm run lint && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 2: Visual check via Playwright (dev server already running on :3000)**

Write a throwaway script under `scripts/` (so `node_modules` resolves) using the bundled `chromium` (mirror `scripts/shot.mjs`: `import { chromium } from "playwright"`). Load `http://localhost:3000/check/google.com` (rich A/NS/MX) and `http://localhost:3000/check/1.1.1.1` (rDNS + Shodan hostnames); for each, wait for the verdict headline, then assert/observe:
  - the "Related indicators" card shows grouped sections, each with a label + description and a row per indicator (type icon + value);
  - a row's **check** button pivots (URL changes to `/check/<that value>`, a fresh check runs);
  - a row's **copy** button works (clipboard contains the value);
  - a result with no relations shows no card.
  Screenshot full page for a visual look, then delete the throwaway script.

- [ ] **Step 3: Finish**

```bash
git log --oneline -5
```
Expected: the Task 1–2 commits on top of the spec commit. Screenshots/throwaway script are not committed.

---

## Self-Review (coverage check)

- **Spec → tasks:** `RELATION_META` descriptions + `groupRelations` (T1) · `ConnectionsCard` rewrite into `RelationGroupSection` + `RelationRow` with type icon / full value / Check / copy, graph + files deleted (T2) · unit (`groupRelations`) + static + visual verification (T1/T3). Every spec section maps to a task.
- **Type consistency:** `groupRelations(related) → RelationGroup[]`; `RelationGroup.items` is `{ value, type }[]`; `RelationGroupSection({ group: RelationGroup })`; `RelationRow({ value, type: IndicatorType })`; `TYPE_ICON: Record<IndicatorType, IconType>`. Names match across tasks. `RELATION_META` is `{ label, description }` everywhere.
- **No dead imports after deletes:** only `connections.tsx` imported `RelationGraph` (removed); `relation-graph.tsx` and `relation-graph.test.ts` are the only users of `lib/relation-graph.ts` (all three deleted together).
- **Build stays green between tasks:** T1 only adds an optional `description` field + a new helper, so the still-present graph code (reads `.label`) keeps compiling; T2 swaps the renderer and removes the graph in one commit.
- **No placeholders:** every code step contains complete code; every run step has an exact command + expected result.
