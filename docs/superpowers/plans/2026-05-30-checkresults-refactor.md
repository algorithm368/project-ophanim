# CheckResults Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 2559-line `components/CheckResults.tsx` into a focused module
folder, unify the three verdict-hero wrappers, and stop eagerly serializing
collapsed raw-details JSON — render- and behavior-identical.

**Architecture:** Convert the single file into `components/CheckResults/` with a
default-export `index.tsx` (preserving `import("./CheckResults")` in `Checker.tsx`)
plus eight focused modules grouped by what-you-edit-together. Modules are built
leaf-first so the project type-checks after every task: each new module is created
while the original file still exists and compiles, then the final task swaps in
`index.tsx` and deletes the original.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript (`isolatedModules`),
eslint (`next/core-web-vitals` + `typescript`, includes `no-unused-vars`), Vitest.

---

## Why "tests" here are build + lint, not new unit tests

This is a pure relocation of a presentational client component. The spec
(`docs/superpowers/specs/2026-05-30-checkresults-refactor-design.md`) established
there are **no** component tests today and we are **not** adding any. The safety
net for a verbatim move is the **TypeScript compiler + eslint**: a wrong import,
missing `export`, or dropped symbol fails `npm run build` (`tsc`) or `npm run lint`
with an exact `file:line`. The final proof of render-parity is a **before/after
visual screenshot diff**. So each module task ends with `npm run build` (and
`npm run lint` once the old file is gone), and the existing `npm test` suite must
stay green throughout.

Because `isolatedModules: true`, every re-exported *type* must use
`export type` / `import type`. Because eslint flags unused vars, each module must
import **exactly** the icons/helpers it uses — the per-module import sets below were
computed from a line-by-line usage map of the original file.

## Source-of-truth line ranges (original `components/CheckResults.tsx`, 2559 lines)

| Symbol | Lines | Destination |
|---|---|---|
| `type IconType` | 75 | types.ts |
| `type Mode` | 77 | types.ts |
| `PivotContext` | 84 | primitives.tsx |
| `Pivot` | 88–103 | primitives.tsx |
| `PivotList` | 106–121 | primitives.tsx |
| `type VerdictStyle` | 123–133 | verdict.tsx |
| `VERDICT_STYLE` | 135–191 | verdict.tsx |
| `scoreBarColor` | 193–198 | classify.ts |
| `SLOW_MS` | 202 | sources.tsx |
| `CATEGORY_LABEL` | 204–210 | sources.tsx |
| `CATEGORY_ORDER` | 212–218 | sources.tsx |
| `LOOKUP_URL` | 221–236 | sources.tsx |
| `DOMAIN_LOOKUP_URL` | 239–247 | sources.tsx |
| `HASH_LOOKUP_URL` | 250–266 | sources.tsx |
| `sourceLookupUrl` | 269–281 | sources.tsx |
| `classifyType` | 284–322 | classify.ts |
| `classifyDomain` | 325–359 | classify.ts |
| `classifyHash` | 362–396 | classify.ts |
| `SourceBreakdown` | 399–448 | sources.tsx |
| `SourceHealthNotice` | 455–474 | activity.tsx |
| `Results` | 476–502 | index.tsx |
| `DomainResults` | 504–529 | index.tsx |
| `HashResults` | 531–557 | index.tsx |
| `ScoreChart` | 559–644 | sources.tsx |
| `relevanceRank` | 646–653 | sources.tsx |
| `ScoreRing` | 655–710 | primitives.tsx |
| `VerdictShell` | 712–847 | verdict.tsx |
| `VerdictHero` | 849–866 | verdict.tsx (unified — Task 4) |
| `DomainVerdictHero` | 868–893 | verdict.tsx (folded into unified) |
| `HashVerdictHero` | 896–918 | verdict.tsx (folded into unified) |
| `ConsensusBar` | 920–999 | verdict.tsx |
| `useCopied` | 1026–1035 | primitives.tsx |
| `CopyableSummary` | 1037–1069 | primitives.tsx |
| `SectionHeading` | 1071–1088 | primitives.tsx |
| `Field` | 1090–1122 | primitives.tsx |
| `flagUrl` | 1129–1132 | classify.ts |
| `locationQuip` | 1135–1142 | classify.ts |
| `ProfileCard` | 1144–1341 | profile.tsx |
| `domainVibe` | 1344–1380 | classify.ts |
| `DomainProfileCard` | 1382–1537 | profile.tsx |
| `CopyHashButton` | 1539–1558 | profile.tsx |
| `hashVibe` | 1560–1594 | classify.ts |
| `HashProfileCard` | 1596–1811 | profile.tsx |
| `RELATION_META` | 1813–1826 | connections.tsx |
| `RELATION_ORDER` | 1827–1840 | connections.tsx |
| `DIGEST_RELATIONS` | 1842 | connections.tsx |
| `ConnectionsCard` | 1844–1895 | connections.tsx |
| `DistributionUrlRow` | 1897–1935 | connections.tsx |
| `DistributionUrlsCard` | 1937–1965 | connections.tsx |
| `ActivityCard` | 1967–2079 | activity.tsx |
| `SourceCard` | 2081–2232 | sources.tsx |
| `StatusPill` | 2234–2293 | sources.tsx |
| `PORT_SERVICE` | 2295–2331 | connections.tsx |
| `type ShodanHostInfo` | 2333–2339 | connections.tsx |
| `shodanHostInfo` | 2341–2358 | connections.tsx |
| `ExposedServicesCard` | 2360–2440 | connections.tsx |
| `trendNote` | 2442–2450 | activity.tsx |
| `HistoryCard` | 2451–2535 | activity.tsx |
| `CheckResults` (default) | 2537–2558 | index.tsx |

**Move verbatim.** Do not edit logic, JSX, class strings, or copy except the two
intentional changes (Task 4 hero unification, Task 10 lazy JSON). Add `export` to a
declaration only when another module imports it; keep purely-internal helpers
unexported (e.g. `relevanceRank`, `DistributionUrlRow`, `trendNote`, `shodanHostInfo`,
`useCopied` stays exported only if used outside — it is internal to primitives, but
`CopyableSummary` consumes it within the same file, so it need not be exported).

## File responsibilities

```
components/CheckResults/
  types.ts         IconType, Mode (shared leaf type aliases; imports only react types)
  classify.ts      scoreBarColor, classifyType/Domain/Hash, flagUrl, locationQuip,
                   domainVibe, hashVibe (pure; returns icon refs, no JSX → stays .ts)
  primitives.tsx   PivotContext, Pivot, PivotList, ScoreRing, useCopied,
                   CopyableSummary, SectionHeading, Field
  verdict.tsx      VerdictStyle, VERDICT_STYLE, VerdictShell, ConsensusBar, VerdictHero
  sources.tsx      SLOW_MS, CATEGORY_LABEL/ORDER, *_LOOKUP_URL, sourceLookupUrl,
                   relevanceRank, SourceBreakdown, ScoreChart, SourceCard, StatusPill
  activity.tsx     SourceHealthNotice, ActivityCard, trendNote, HistoryCard
  connections.tsx  RELATION_META/ORDER, DIGEST_RELATIONS, ConnectionsCard,
                   DistributionUrlRow, DistributionUrlsCard, PORT_SERVICE,
                   ShodanHostInfo, shodanHostInfo, ExposedServicesCard
  profile.tsx      ProfileCard, DomainProfileCard, HashProfileCard, CopyHashButton
  index.tsx        Results, DomainResults, HashResults, CheckResults (default export)
```

Import graph (acyclic, leaf → root): `types`, `classify` are leaves;
`primitives` is a leaf (UI). `verdict` → primitives, classify, types. `sources` →
primitives, classify, types. `activity` → primitives, classify, verdict, types.
`connections` → primitives, types. `profile` → primitives, classify, types.
`index` → all.

---

## Task 1: Scaffold the folder and shared types

**Files:**
- Create: `components/CheckResults/types.ts`

- [ ] **Step 1: Create the shared types module**

```ts
import type { ComponentType } from "react";

export type IconType = ComponentType<{ className?: string }>;

export type Mode = "ip" | "domain" | "hash";
```

- [ ] **Step 2: Verify the project still builds (old file untouched)**

Run: `npm run build`
Expected: PASS (the new file compiles; nothing imports it yet; the original
`components/CheckResults.tsx` is unchanged and still drives the app).

- [ ] **Step 3: Commit**

```bash
git add components/CheckResults/types.ts
git commit -m "refactor(checkresults): add shared types module"
```

---

## Task 2: Extract pure classifiers into `classify.ts`

**Files:**
- Create: `components/CheckResults/classify.ts`
- (Original file stays as-is this task.)

- [ ] **Step 1: Create `classify.ts` with this exact import header, then paste the moved bodies**

Header (icons are the exact set used by the moved functions):

```ts
import {
    Bug,
    FileDigit,
    FileText,
    Globe,
    Network,
    Server,
    ShieldAlert,
    ShieldCheck,
    ShieldQuestion,
    Smartphone,
    Sparkles,
} from "lucide-react";
import type {
    DomainContext,
    GeoContext,
    HashContext,
} from "@/lib/ti/types";
import type { IconType } from "./types";
```

Then copy these bodies **verbatim** from the original and prefix each with
`export`:
- `scoreBarColor` (orig 193–198)
- `classifyType` (orig 284–322)
- `classifyDomain` (orig 325–359)
- `classifyHash` (orig 362–396)
- `flagUrl` (orig 1129–1132)
- `locationQuip` (orig 1135–1142)
- `domainVibe` (orig 1344–1380)
- `hashVibe` (orig 1560–1594)

Each function that declares a return type using the icon alias (e.g.
`classifyType(): { label: string; desc: string; icon: IconType }`) keeps that
annotation; `IconType` now comes from `./types`.

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS. If eslint-in-build or `tsc` reports an unused icon, remove it from
the header; if it reports an undefined name, the body referenced a symbol not yet
moved — recheck against the table.

- [ ] **Step 3: Commit**

```bash
git add components/CheckResults/classify.ts
git commit -m "refactor(checkresults): extract pure classifiers"
```

---

## Task 3: Extract shared primitives into `primitives.tsx`

**Files:**
- Create: `components/CheckResults/primitives.tsx`

- [ ] **Step 1: Create `primitives.tsx` with this header, then paste the moved bodies**

```tsx
"use client";

import {
    createContext,
    useContext,
    useState,
    type ReactNode,
} from "react";
import { Check, Copy, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { IconType } from "./types";
```

Then move **verbatim** and add `export` to each:
- `PivotContext` (orig 84) — **export** (index.tsx provides it; profile/connections consume it)
- `Pivot` (orig 88–103) — export
- `PivotList` (orig 106–121) — export
- `ScoreRing` (orig 655–710) — export
- `useCopied` (orig 1026–1035) — **export** (consumed by `CopyableSummary` here,
  **and** by `CopyHashButton` in profile.tsx + `DistributionUrlRow` in
  connections.tsx — verified, so it must be exported, not internal)
- `CopyableSummary` (orig 1037–1069) — export
- `SectionHeading` (orig 1071–1088) — export
- `Field` (orig 1090–1122) — export

In `SectionHeading` and `Field`, change the `children: React.ReactNode` annotation
to `children: ReactNode` (named import above) so no `React` namespace import is
needed. `SectionHeading`/`Field` keep `icon: IconType` from `./types`.

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/CheckResults/primitives.tsx
git commit -m "refactor(checkresults): extract shared UI primitives"
```

---

## Task 4: Extract verdict UI + unify the three heroes into `verdict.tsx`

**Files:**
- Create: `components/CheckResults/verdict.tsx`

This task performs the spec's one DRY merge: `VerdictHero` / `DomainVerdictHero` /
`HashVerdictHero` (orig 849–918) collapse into a single `VerdictHero` that branches
on the result type.

- [ ] **Step 1: Create `verdict.tsx` with this header**

```tsx
"use client";

import {
    Clock,
    Database,
    RefreshCw,
    Tag,
} from "lucide-react";
import {
    isDomainResult,
    isHashResult,
    type CheckResult,
    type DomainCheckResult,
    type HashCheckResult,
    type Verdict,
} from "@/lib/ti/types";
import {
    buildDomainNarrative,
    buildHashNarrative,
    buildNarrative,
    consensusBuckets,
    type ResultLike,
} from "@/lib/ti/narrative";
import { HASH_ALGO_LABEL } from "@/lib/hash";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { classifyType, classifyDomain, classifyHash } from "./classify";
import { CopyableSummary, ScoreRing } from "./primitives";
import type { IconType } from "./types";
```

- [ ] **Step 2: Move `VerdictStyle`, `VERDICT_STYLE`, `VerdictShell`, `ConsensusBar` verbatim**

- `type VerdictStyle` (orig 123–133) — `export type VerdictStyle`
- `VERDICT_STYLE` (orig 135–191) — `export const VERDICT_STYLE` (activity.tsx imports it)
- `VerdictShell` (orig 712–847) — no export needed (internal); it stays internal to verdict.tsx
- `ConsensusBar` (orig 920–1024) — internal (used only by VerdictShell)

`VerdictShell`'s signature uses `ResultLike` and `IconType` (now imported).
`ConsensusBar` uses `VerdictStyle` + `consensusBuckets` (now imported).

- [ ] **Step 3: Replace the three heroes with one unified `VerdictHero`**

Delete the three separate hero bodies; write this single component (it reproduces
each original branch exactly — compare against orig 849–866, 868–893, 896–918):

```tsx
export function VerdictHero({
    result,
    onRefresh,
}: {
    result: CheckResult | DomainCheckResult | HashCheckResult;
    onRefresh: () => void;
}) {
    if (isHashResult(result)) {
        const ctx = result.context;
        const hasData = result.sources.some(
            (s) => s.status === "ok" && s.score !== undefined,
        );
        const type = classifyHash(ctx, hasData);
        return (
            <VerdictShell
                result={result}
                onRefresh={onRefresh}
                typeLabel={type.label}
                TypeIcon={type.icon}
                categoryLabel={HASH_ALGO_LABEL[result.algorithm]}
                narrative={buildHashNarrative(result).join(" ")}
            />
        );
    }
    if (isDomainResult(result)) {
        const ctx = result.context;
        const resolves =
            (ctx?.resolvedIps?.length ?? 0) > 0 || (ctx?.ipv6?.length ?? 0) > 0;
        const type = classifyDomain(ctx, resolves);
        const categories = ctx?.categories ?? [];
        return (
            <VerdictShell
                result={result}
                onRefresh={onRefresh}
                typeLabel={type.label}
                TypeIcon={type.icon}
                categoryLabel={
                    categories.length
                        ? categories.slice(0, 2).join(" · ")
                        : undefined
                }
                narrative={buildDomainNarrative(result).join(" ")}
            />
        );
    }
    const type = classifyType(result.geo);
    return (
        <VerdictShell
            result={result}
            onRefresh={onRefresh}
            typeLabel={type.label}
            TypeIcon={type.icon}
            narrative={buildNarrative(result).join(" ")}
        />
    );
}
```

Note the branch order: hash and domain are matched by type guard first, with the
plain `CheckResult` (IP) as the fallback `else` — mirroring `Checker.tsx`'s own
`isHashResult ? … : isDomainResult ? … : ip` precedence. `VerdictShell`'s prop
interface (`typeLabel`, `TypeIcon`, `categoryLabel?`, `narrative`) is unchanged.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: PASS. (The original file still defines its own three heroes; both compile
independently — no name collision across modules.)

- [ ] **Step 5: Commit**

```bash
git add components/CheckResults/verdict.tsx
git commit -m "refactor(checkresults): extract verdict UI, unify hero variants"
```

---

## Task 5: Extract source-rating UI into `sources.tsx`

**Files:**
- Create: `components/CheckResults/sources.tsx`

- [ ] **Step 1: Create `sources.tsx` with this header**

```tsx
"use client";

import {
    BarChart3,
    CircleX,
    Clock,
    ExternalLink,
    Gauge,
    ShieldAlert,
    ShieldCheck,
    TriangleAlert,
} from "lucide-react";
import {
    type SourceMeta,
    type SourceResult,
} from "@/lib/ti/types";
import {
    formatDate,
    scoreExplanation,
    type ResultLike,
} from "@/lib/ti/narrative";
import { algoFromLength } from "@/lib/hash";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { scoreBarColor } from "./classify";
import { SectionHeading } from "./primitives";
import type { Mode } from "./types";
```

- [ ] **Step 2: Move verbatim (export only what `index.tsx` needs)**

- `SLOW_MS` (orig 202) — internal
- `CATEGORY_LABEL` (orig 204–210) — internal (both consumers, `SourceCard` and
  `SourceBreakdown`, live in this same file — no export needed)
- `CATEGORY_ORDER` (orig 212–218) — internal
- `LOOKUP_URL`, `DOMAIN_LOOKUP_URL`, `HASH_LOOKUP_URL` (orig 221–266) — internal
- `sourceLookupUrl` (orig 269–281) — internal
- `relevanceRank` (orig 646–653) — internal
- `SourceBreakdown` (orig 399–448) — **export** (index.tsx renders it)
- `ScoreChart` (orig 559–644) — **export** (index.tsx renders it)
- `SourceCard` (orig 2081–2232) — internal (used by SourceBreakdown)
- `StatusPill` (orig 2234–2293) — internal (used by SourceCard)

`HASH_LOOKUP_URL` uses `algoFromLength` (imported). `ScoreChart` uses
`scoreExplanation`, `ResultLike`. `SourceCard`/`ScoreChart` use `scoreBarColor`
(from `./classify`), `formatDate`, `CATEGORY_LABEL`, `SLOW_MS`. `SourceBreakdown`
takes `kind: Mode`.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/CheckResults/sources.tsx
git commit -m "refactor(checkresults): extract source-rating UI"
```

---

## Task 6: Extract activity + history into `activity.tsx`

**Files:**
- Create: `components/CheckResults/activity.tsx`

- [ ] **Step 1: Create `activity.tsx` with this header**

```tsx
"use client";

import {
    History,
    ShieldCheck,
    TriangleAlert,
} from "lucide-react";
import type { HistorySnapshot } from "@/lib/ti/types";
import {
    aggregateCategories,
    type ResultLike,
} from "@/lib/ti/narrative";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeading } from "./primitives";
import { VERDICT_STYLE } from "./verdict";
```

- [ ] **Step 2: Move verbatim**

- `SourceHealthNotice` (orig 455–474) — **export**
- `ActivityCard` (orig 1967–2079) — **export**
- `trendNote` (orig 2442–2450) — internal
- `HistoryCard` (orig 2451–2535) — **export**

Verified symbol sets (from a line-by-line scan of each body):
- `SourceHealthNotice` (455–474): `TriangleAlert` only (no `Badge`, no `cn`).
- `ActivityCard` (1967–2079): `aggregateCategories`, `ResultLike`, `SectionHeading`,
  `Card`, `CardContent`, `TriangleAlert`, `ShieldCheck`. It does **not** use
  `ConsensusBar`, `Pivot`, or `Badge` — the header above is therefore complete.
- `HistoryCard` (2451–2535): `VERDICT_STYLE`, `HistorySnapshot`, `trendNote`,
  `ResultLike`, `SectionHeading`, `Card`, `CardContent`, `History`, `cn`.

So the only icons needed are `History`, `ShieldCheck`, `TriangleAlert` — matching
the header. No `Badge` import.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/CheckResults/activity.tsx
git commit -m "refactor(checkresults): extract activity and history cards"
```

---

## Task 7: Extract connections + exposure into `connections.tsx`

**Files:**
- Create: `components/CheckResults/connections.tsx`

- [ ] **Step 1: Create `connections.tsx` with this header**

```tsx
"use client";

import {
    Check,
    Copy,
    ExternalLink,
    FileDigit,
    Fingerprint,
    Globe,
    Link2,
    Mail,
    Network,
    Server,
    SignalHigh,
} from "lucide-react";
import {
    type CheckResult,
    type HashCheckResult,
    type ResultLike,
} from "@/lib/ti/types";
import { relationsFor } from "@/lib/relations";
import { hostFromUrl } from "@/lib/url";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Pivot, PivotList, SectionHeading, useCopied } from "./primitives";
import type { IconType } from "./types";
```

- [ ] **Step 2: Move verbatim**

- `RELATION_META` (orig 1813–1826) — internal
- `RELATION_ORDER` (orig 1827–1840) — internal
- `DIGEST_RELATIONS` (orig 1842) — internal
- `ConnectionsCard` (orig 1844–1895) — **export**
- `DistributionUrlRow` (orig 1897–1935) — internal
- `DistributionUrlsCard` (orig 1937–1965) — **export**
- `PORT_SERVICE` (orig 2295–2331) — internal
- `type ShodanHostInfo` (orig 2333–2339) — internal
- `shodanHostInfo` (orig 2341–2358) — internal
- `ExposedServicesCard` (orig 2360–2440) — **export**

Verified symbol sets:
- `ConnectionsCard` (1844–1895): `relationsFor`, `RELATION_META/ORDER`,
  `DIGEST_RELATIONS`, `PivotList`, `SectionHeading`, `Link2`, `ResultLike`.
- `DistributionUrlRow` (1897–1935): `useCopied` (from `./primitives`),
  `hostFromUrl`, `Pivot`, `Button`, `ExternalLink`, `Check`, `Copy`. **This is why
  `useCopied` is exported from primitives (Task 3).** It does **not** use
  `CopyableSummary` — it builds its own inline copy button.
- `DistributionUrlsCard` (1937–1965): `HashCheckResult`, `SectionHeading`, `Link2`,
  renders `DistributionUrlRow`.
- `ExposedServicesCard` (2360–2440): `shodanHostInfo`, `PORT_SERVICE`,
  `CheckResult`, `SectionHeading`, `Server`, icons for ports/CVEs.

Add `useCopied` to the `./primitives` import in this module's header:
`import { Pivot, PivotList, SectionHeading, useCopied } from "./primitives";`

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: PASS. Resolve any unused-import / missing-import error exactly as
reported by `tsc`/eslint.

- [ ] **Step 4: Commit**

```bash
git add components/CheckResults/connections.tsx
git commit -m "refactor(checkresults): extract connections and exposure cards"
```

---

## Task 8: Extract profile cards into `profile.tsx`

**Files:**
- Create: `components/CheckResults/profile.tsx`

- [ ] **Step 1: Create `profile.tsx` with this header**

```tsx
"use client";

import {
    Binary,
    Building2,
    CalendarClock,
    Check,
    Copy,
    FileDigit,
    FileText,
    Fingerprint,
    Globe,
    HardDrive,
    History,
    Link2,
    Mail,
    MapPin,
    Navigation,
    Network,
    Server,
    ShieldAlert,
    ShieldCheck,
    ShieldQuestion,
    SignalHigh,
    Smartphone,
    Tag,
    Wifi,
} from "lucide-react";
import {
    type CheckResult,
    type DomainCheckResult,
    type HashCheckResult,
} from "@/lib/ti/types";
import {
    formatBytes,
    formatDate,
    joinPlace,
} from "@/lib/ti/narrative";
import { HASH_ALGO_LABEL } from "@/lib/hash";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    classifyType,
    classifyDomain,
    classifyHash,
    domainVibe,
    flagUrl,
    hashVibe,
    locationQuip,
} from "./classify";
import { Field, Pivot, PivotList, SectionHeading } from "./primitives";
import type { IconType } from "./types";
```

- [ ] **Step 2: Move verbatim**

- `ProfileCard` (orig 1144–1341) — **export**
- `DomainProfileCard` (orig 1382–1537) — **export**
- `CopyHashButton` (orig 1539–1558) — internal (used only by HashProfileCard)
- `HashProfileCard` (orig 1596–1811) — **export**

`ProfileCard` uses `classifyType`, `flagUrl`, `joinPlace`, `locationQuip`, `Field`,
`Pivot`, `SectionHeading`, and geo icons **including `ShieldAlert`** (hard-
referenced in the `traits` array at orig line 1167 — that's why `ShieldAlert` is in
the header). `DomainProfileCard` uses `classifyDomain`, `domainVibe`, `formatDate`,
`PivotList`. `HashProfileCard` uses `classifyHash`, `hashVibe`, `formatBytes`,
`formatDate`, `HASH_ALGO_LABEL`, `CopyHashButton`. The header is the superset across
all three cards; trim any icon `tsc`/eslint flags as genuinely unused.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/CheckResults/profile.tsx
git commit -m "refactor(checkresults): extract profile cards"
```

---

## Task 9: Wire `index.tsx` and delete the original file

**Files:**
- Create: `components/CheckResults/index.tsx`
- Delete: `components/CheckResults.tsx`

- [ ] **Step 1: Create `index.tsx` with this header + the three layouts + dispatcher**

```tsx
"use client";

import {
    isDomainResult,
    isHashResult,
    type CheckResult,
    type DomainCheckResult,
    type HashCheckResult,
} from "@/lib/ti/types";
import { PivotContext } from "./primitives";
import { VerdictHero } from "./verdict";
import { SourceBreakdown, ScoreChart } from "./sources";
import { SourceHealthNotice, ActivityCard, HistoryCard } from "./activity";
import {
    ConnectionsCard,
    DistributionUrlsCard,
    ExposedServicesCard,
} from "./connections";
import {
    ProfileCard,
    DomainProfileCard,
    HashProfileCard,
} from "./profile";
```

- [ ] **Step 2: Move `Results`, `DomainResults`, `HashResults` verbatim (orig 476–557)**

These already call `VerdictHero` (the IP one). After the Task 4 unification there
is a single `VerdictHero`, so `DomainResults` and `HashResults` must call
`VerdictHero` too (not `DomainVerdictHero` / `HashVerdictHero`, which no longer
exist). Update those two JSX call sites:
- In `DomainResults` (orig line 514) `<DomainVerdictHero … />` → `<VerdictHero … />`
- In `HashResults` (orig line 541) `<HashVerdictHero … />` → `<VerdictHero … />`

All other lines in the three layouts are unchanged. They remain **non-exported**
(internal to index.tsx).

- [ ] **Step 3: Move the default `CheckResults` dispatcher verbatim (orig 2537–2558)**

It uses `isHashResult` / `isDomainResult` to pick the layout and wraps the subtree
in `PivotContext.Provider`. Keep `export default function CheckResults(...)`
unchanged.

- [ ] **Step 4: Delete the original monolith**

```bash
git rm components/CheckResults.tsx
```

- [ ] **Step 5: Verify build + lint (now the new folder is the live component)**

Run: `npm run build`
Expected: PASS — `Checker.tsx`'s `import("./CheckResults")` now resolves to
`components/CheckResults/index.tsx`; the default export is unchanged.

Run: `npm run lint`
Expected: PASS — no unused imports/vars in any module. Fix any flagged import by
removing it (unused) or adding it (missing) per the exact eslint message.

Run: `npm test`
Expected: PASS — existing `lib/**` unit tests unaffected.

- [ ] **Step 6: Commit**

```bash
git add components/CheckResults/index.tsx
git commit -m "refactor(checkresults): wire index dispatcher, remove monolith"
```

---

## Task 10: Lazy-serialize collapsed raw-details JSON in `SourceCard`

**Files:**
- Modify: `components/CheckResults/sources.tsx` (`SourceCard`, the raw-details
  `<details>` block — original lines 2215–2228)

The original eagerly computes `JSON.stringify(result.details, null, 2)` on mount
even though the `<details>` starts collapsed. Defer it to first expand.

- [ ] **Step 1: Add open-state to `SourceCard`**

Add the `useState` import to `sources.tsx`'s react import (currently sources.tsx
imports no react hooks — add one):

```tsx
import { useState } from "react";
```

At the top of the `SourceCard` function body (alongside the existing `const`
destructuring), add:

```tsx
    const [detailsOpen, setDetailsOpen] = useState(false);
```

- [ ] **Step 2: Gate the `<details>` body on open-state**

Replace the existing raw-details block (original 2215–2228):

```tsx
                {result.details && Object.keys(result.details).length > 0 && (
                    <details
                        className="text-xs"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <summary className="flex cursor-pointer items-center gap-1 text-muted-foreground select-none hover:text-foreground">
                            <ExternalLink className="size-3" />
                            View raw details
                        </summary>
                        <pre className="mt-2 overflow-x-auto rounded-lg bg-muted/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
                            {JSON.stringify(result.details, null, 2)}
                        </pre>
                    </details>
                )}
```

with this version (adds `onToggle`; renders `<pre>` only when open):

```tsx
                {result.details && Object.keys(result.details).length > 0 && (
                    <details
                        className="text-xs"
                        onClick={(e) => e.stopPropagation()}
                        onToggle={(e) =>
                            setDetailsOpen(e.currentTarget.open)
                        }
                    >
                        <summary className="flex cursor-pointer items-center gap-1 text-muted-foreground select-none hover:text-foreground">
                            <ExternalLink className="size-3" />
                            View raw details
                        </summary>
                        {detailsOpen && (
                            <pre className="mt-2 overflow-x-auto rounded-lg bg-muted/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
                                {JSON.stringify(result.details, null, 2)}
                            </pre>
                        )}
                    </details>
                )}
```

Behavior is identical to the user: the summary always shows; on expand, `onToggle`
flips `detailsOpen`, the `<pre>` mounts with the same serialized text. The
`JSON.stringify` now runs only when (and if) a card is expanded, not for every
source on the initial mount.

- [ ] **Step 3: Verify build + lint + test**

Run: `npm run build && npm run lint && npm test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add components/CheckResults/sources.tsx
git commit -m "perf(checkresults): serialize source raw-details only when expanded"
```

---

## Task 11: Visual parity verification (before/after)

**Files:**
- Uses: `scripts/shot.mjs` (existing Playwright helper)

This proves render-identical output across all three IOC layouts. Requires the dev
server and a browser. **If the environment cannot run the dev server or Playwright,
state that explicitly and skip — do not claim visual parity you did not observe.**

- [ ] **Step 1: Capture BEFORE screenshots from the pre-refactor commit**

```bash
git stash --include-untracked 2>/dev/null || true
git worktree add /tmp/cr-before main
( cd /tmp/cr-before && npm install && npm run dev & )
# wait for http://localhost:3000 to answer, then:
SHOT_DIR=/tmp/cr-shots/before node scripts/shot.mjs
# stop that dev server
```

(If a worktree is impractical, instead capture BEFORE by checking out the parent of
this branch into a second checkout. The goal is screenshots of the unmodified
component.)

- [ ] **Step 2: Capture AFTER screenshots from this branch**

Add a hash case to cover the third layout. Temporarily append to `scripts/shot.mjs`
(or run an inline variant) so it also shoots:

```js
await pageShot(
  "/check/44d88612fea8a8f36de82e1278abb02f",
  "result-hash.png",
  "risk",
);
```

Then:

```bash
npm run dev &
# wait for the server, then:
SHOT_DIR=/tmp/cr-shots/after node scripts/shot.mjs
```

Capture `result-ip.png` (8.8.8.8), `result-domain.png` (google.com), and
`result-hash.png` (EICAR MD5).

- [ ] **Step 3: Compare**

Diff `before/` vs `after/` for `result-ip.png` and `result-domain.png` (the hash
case has no "before" unless added there too; eyeball it against the live
pre-refactor app or accept it as a smoke check that the hash layout renders).
Expected: pixel-identical IP and domain results; hash result renders correctly with
verdict, profile, activity, connections, distribution URLs, score chart, and source
breakdown.

- [ ] **Step 4: Clean up and report**

```bash
git worktree remove /tmp/cr-before 2>/dev/null || true
```

Revert any temporary edit to `scripts/shot.mjs` (or keep the added hash case as a
small, intentional improvement and commit it separately). Report the comparison
result honestly: identical / differences found / could-not-verify-in-environment.

---

## Final verification checklist

- [ ] `npm run build` passes
- [ ] `npm run lint` passes (no unused/missing imports in any module)
- [ ] `npm test` passes (existing `lib/**` suites green)
- [ ] `components/CheckResults.tsx` is gone; `components/CheckResults/` has 9 files
- [ ] `components/Checker.tsx` is **unchanged** (no consumer edits were needed)
- [ ] Only two behavioral edits exist beyond relocation: unified `VerdictHero`
      (Task 4) and lazy raw-details JSON (Task 10)
- [ ] Visual diff confirms IP + domain parity and a correct hash layout (or an
      explicit could-not-verify note)
```
