# Geo confidence voting card + bento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the already-computed weighted-vote geo confidence as a monochrome, full-width voting card on the IP check page, showing how each provider voted per field (responsive matrix / ballots).

**Architecture:** A pure transform (`buildVoteTable`) turns `GeoResolution` into a render-ready table; a presentational `VotingCard` renders it (matrix on `sm+`, ballots below). `ProfileCard` drops its old footer/inline-disagreement and renders the card below the map+detail row. Presentation-only: no scoring/reconciliation/source changes.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Tailwind, lucide-react icons, Vitest (unit tests for the pure transform; components verified via `tsc`/lint/build/manual).

Spec: `docs/superpowers/specs/2026-06-14-geo-confidence-voting-design.md`

---

## File structure

- `lib/ti/geo/votes.ts` — **NEW** pure `buildVoteTable(res)` + `providerLabel(id)` + exported types. Imports only `authorityFor` from `weights.ts` (client-safe).
- `lib/ti/geo/votes.test.ts` — **NEW** unit tests for the transform.
- `components/CheckResults/confidence.tsx` — **EDIT** add `ConfidenceDot` + `OverallGauge`; remove `OverallConfidence`; keep `ConfidenceChip`, `Disagreement`, `geoConfidenceReason`.
- `components/CheckResults/voting.tsx` — **NEW** `VotingCard` (gauge header + `Matrix` + `Ballots`).
- `components/CheckResults/profile.tsx` — **EDIT** swap imports; remove two inline `Disagreement` calls and the footer block; render `<VotingCard res={res} />`.

---

## Task 1: Pure vote-table transform

**Files:**
- Create: `lib/ti/geo/votes.ts`
- Test: `lib/ti/geo/votes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/ti/geo/votes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Confidence, GeoResolution, ResolvedField } from "@/lib/ti/types";
import { buildVoteTable, providerLabel } from "@/lib/ti/geo/votes";

const FLAGS: GeoResolution["flags"] = {
  isHosting: false,
  isProxy: false,
  isMobile: false,
  sources: {},
};

function rf<T>(value: T, partial: Partial<ResolvedField<T>> = {}): ResolvedField<T> {
  return {
    value,
    confidence: "high" as Confidence,
    score: 1,
    agreement: 1,
    sources: [],
    ...partial,
  };
}

function res(partial: Partial<GeoResolution>): GeoResolution {
  return { flags: FLAGS, providerCount: 0, ...partial };
}

describe("buildVoteTable", () => {
  it("includes a column only for present fields", () => {
    const table = buildVoteTable(res({ country: rf("United States", { sources: ["ip-api"] }) }));
    expect(table).not.toBeNull();
    expect(table!.fields.map((f) => f.key)).toEqual(["country"]);
  });

  it("classifies win, dissent, and absent cells", () => {
    const table = buildVoteTable(
      res({
        country: rf("United States", {
          sources: ["ip-api", "ipinfo"],
          alternatives: [{ value: "Canada", sources: ["ipwhois"] }],
        }),
        asn: rf("AS15169", { sources: ["ip-api"] }),
      }),
    )!;
    const country = table.fields.find((f) => f.key === "country")!;
    expect(country.cells["ip-api"]).toEqual({ status: "win" });
    expect(country.cells["ipinfo"]).toEqual({ status: "win" });
    expect(country.cells["ipwhois"]).toEqual({ status: "dissent", value: "Canada" });
    const asn = table.fields.find((f) => f.key === "asn")!;
    expect(asn.cells["ipinfo"]).toEqual({ status: "absent" });
    expect(asn.cells["ipwhois"]).toEqual({ status: "absent" });
  });

  it("marks coordinates clustered (win) when not low", () => {
    const table = buildVoteTable(
      res({ coordinates: rf({ lat: 1, lon: 2 }, { confidence: "high", sources: ["ip-api", "ipinfo"] }) }),
    )!;
    const coords = table.fields.find((f) => f.key === "coordinates")!;
    expect(coords.winner).toBe("clustered");
    expect(coords.cells["ip-api"].status).toBe("win");
  });

  it("marks coordinates scattered when low", () => {
    const table = buildVoteTable(
      res({ coordinates: rf({ lat: 1, lon: 2 }, { confidence: "low", sources: ["ip-api", "ipinfo"] }) }),
    )!;
    const coords = table.fields.find((f) => f.key === "coordinates")!;
    expect(coords.winner).toBe("scattered");
    expect(coords.cells["ip-api"].status).toBe("scatter");
    expect(coords.backers).toEqual([]);
  });

  it("flags allocation authority for country (rdap-ip) and asn (ripestat)", () => {
    const table = buildVoteTable(
      res({
        country: rf("United States", { sources: ["ip-api", "rdap-ip"] }),
        asn: rf("AS15169", { sources: ["ripestat", "ip-api"] }),
      }),
    )!;
    const country = table.fields.find((f) => f.key === "country")!;
    expect(country.authorityId).toBe("rdap-ip");
    expect(country.cells["rdap-ip"]).toEqual({ status: "win", authority: true });
    expect(country.cells["ip-api"]).toEqual({ status: "win" });
    const asn = table.fields.find((f) => f.key === "asn")!;
    expect(asn.authorityId).toBe("ripestat");
    expect(asn.cells["ripestat"]).toEqual({ status: "win", authority: true });
  });

  it("has no authority when the authority provider is absent", () => {
    const country = buildVoteTable(res({ country: rf("US", { sources: ["ip-api"] }) }))!.fields[0];
    expect(country.authorityId).toBeUndefined();
    expect(country.cells["ip-api"].authority).toBeUndefined();
  });

  it("orders providers by PROVIDER_ORDER, unknowns last", () => {
    const table = buildVoteTable(
      res({
        country: rf("US", {
          sources: ["reverse-dns", "ip-api"],
          alternatives: [{ value: "CA", sources: ["zzz-unknown"] }],
        }),
      }),
    )!;
    expect(table.providers).toEqual(["ip-api", "reverse-dns", "zzz-unknown"]);
  });

  it("returns null when no located field is present", () => {
    expect(buildVoteTable(res({}))).toBeNull();
  });

  it("provides display labels with id fallback", () => {
    expect(providerLabel("ripestat")).toBe("RIPEstat");
    expect(providerLabel("ip-api")).toBe("ip-api");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/ti/geo/votes.test.ts`
Expected: FAIL — cannot find module `@/lib/ti/geo/votes` (file not created yet).

- [ ] **Step 3: Write the implementation**

Create `lib/ti/geo/votes.ts`:

```ts
import type { Confidence, GeoResolution, ResolvedField } from "../types";
import { authorityFor, type GeoField } from "./weights";

export type VoteStatus = "win" | "dissent" | "absent" | "scatter";

export interface VoteCell {
  status: VoteStatus;
  /** the differing value to show when status === "dissent" */
  value?: string;
  /** this provider is the allocation authority and it backed the winner */
  authority?: boolean;
}

export interface VoteColumn {
  key: "country" | "city" | "coordinates" | "asn";
  label: string;
  /** RESULT-row display value */
  winner: string;
  confidence: Confidence;
  cells: Record<string, VoteCell>;
  /** ballot view: providers backing the winner */
  backers: string[];
  /** ballot view: dissenting values + who voted for them */
  dissent: { value: string; sources: string[] }[];
  /** provider that is the authority AND backed the winner */
  authorityId?: string;
}

export interface VoteTable {
  /** row order (union of reporting providers across columns) */
  providers: string[];
  fields: VoteColumn[];
}

/** Fixed display order; unknown ids are appended in first-seen order. */
const PROVIDER_ORDER = [
  "ip-api",
  "ipinfo",
  "ipgeolocation",
  "ipwhois",
  "freeipapi",
  "rdap-ip",
  "ripestat",
  "abuseipdb",
  "reverse-dns",
];

const PROVIDER_LABEL: Record<string, string> = {
  ripestat: "RIPEstat",
  abuseipdb: "AbuseIPDB",
  "reverse-dns": "reverse DNS",
};

export function providerLabel(id: string): string {
  return PROVIDER_LABEL[id] ?? id;
}

function geoFieldFor(key: VoteColumn["key"]): GeoField {
  return key === "coordinates" ? "coords" : key;
}

/** Build a column for a reconciled string field (country, city, asn). */
function stringColumn(
  key: "country" | "city" | "asn",
  label: string,
  field: ResolvedField<string> | undefined,
): VoteColumn | null {
  if (!field) return null;
  const authority = authorityFor(geoFieldFor(key));
  const cells: Record<string, VoteCell> = {};
  for (const id of field.sources) {
    cells[id] = authority === id ? { status: "win", authority: true } : { status: "win" };
  }
  for (const alt of field.alternatives ?? []) {
    for (const id of alt.sources) {
      cells[id] = { status: "dissent", value: alt.value };
    }
  }
  const authorityId =
    authority && field.sources.includes(authority) ? authority : undefined;
  return {
    key,
    label,
    winner: field.value,
    confidence: field.confidence,
    cells,
    backers: field.sources,
    dissent: (field.alternatives ?? []).map((a) => ({ value: a.value, sources: a.sources })),
    authorityId,
  };
}

/** Coordinates are cluster-based: reconcile only records per-point dissent when
 *  the cluster is low, so we show clustered/win vs scattered/scatter, never a
 *  fabricated per-provider distance. */
function coordsColumn(field: GeoResolution["coordinates"]): VoteColumn | null {
  if (!field) return null;
  const clustered = field.confidence !== "low";
  const cells: Record<string, VoteCell> = {};
  for (const id of field.sources) {
    cells[id] = { status: clustered ? "win" : "scatter" };
  }
  return {
    key: "coordinates",
    label: "COORDS",
    winner: clustered ? "clustered" : "scattered",
    confidence: field.confidence,
    cells,
    backers: clustered ? field.sources : [],
    dissent: [],
  };
}

export function buildVoteTable(res: GeoResolution): VoteTable | null {
  const columns = [
    stringColumn("country", "COUNTRY", res.country),
    stringColumn("city", "CITY", res.city),
    coordsColumn(res.coordinates),
    stringColumn("asn", "ASN", res.asn),
  ].filter((c): c is VoteColumn => c !== null);

  if (columns.length === 0) return null;

  // Union of reporting providers, ordered by PROVIDER_ORDER (unknowns appended,
  // first-seen order preserved via insertion + stable sort).
  const seen = new Set<string>();
  for (const col of columns) {
    for (const id of Object.keys(col.cells)) seen.add(id);
  }
  const providers = [...seen].sort((a, b) => {
    const ia = PROVIDER_ORDER.indexOf(a);
    const ib = PROVIDER_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  // Backfill absent cells so every column has a cell for every provider row.
  for (const col of columns) {
    for (const id of providers) {
      if (!col.cells[id]) col.cells[id] = { status: "absent" };
    }
  }

  return { providers, fields: columns };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/ti/geo/votes.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Run the full unit suite + lint**

Run: `npm test`
Expected: PASS (existing suite + new file, no network).
Run: `npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/ti/geo/votes.ts lib/ti/geo/votes.test.ts
git commit -m "feat(geo): pure vote-table transform for the confidence card"
```

---

## Task 2: Monochrome confidence primitives

**Files:**
- Modify: `components/CheckResults/confidence.tsx`

No unit test (presentational; repo has no DOM harness). Verified by `tsc` + lint + build + manual.

- [ ] **Step 1: Add the `ScoreRing` import**

In `components/CheckResults/confidence.tsx`, add below the existing imports (after the `import type ...` line):

```ts
import { ScoreRing } from "./primitives";
```

- [ ] **Step 2: Add `ConfidenceDot` and `OverallGauge`; remove `OverallConfidence`**

Delete the entire `OverallConfidence` function (the block starting
`/** Larger chip summarizing overall geolocation confidence. */` through its
closing `}`), and in its place add:

```tsx
/** Monochrome confidence indicator: filled disc (high), half disc (medium),
 *  ring (low). Grayscale only, color stays reserved for the verdict. Always
 *  shown next to the tier word so the level is never ambiguous. */
export function ConfidenceDot({ confidence }: { confidence: Confidence }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn(
        "size-2.5 shrink-0",
        confidence === "low" ? "text-muted-foreground" : "text-foreground",
      )}
      aria-hidden
    >
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {confidence === "high" && <circle cx="8" cy="8" r="6" fill="currentColor" />}
      {confidence === "medium" && <path d="M8 2 A6 6 0 0 1 8 14 Z" fill="currentColor" />}
    </svg>
  );
}

/** Compact radial gauge for the overall geo-confidence score (0-1 -> 0-100),
 *  monochrome via the foreground stroke. */
export function OverallGauge({
  overall,
}: {
  overall: { score: number; confidence: Confidence };
}) {
  const pct = Math.round(overall.score * 100);
  return (
    <div className="relative size-12 shrink-0" title={LABEL[overall.confidence]}>
      <ScoreRing value={pct} stroke="stroke-foreground" />
      <span className="absolute inset-0 flex items-center justify-center font-mono text-sm font-semibold tabular-nums text-foreground">
        {pct}
      </span>
    </div>
  );
}
```

(`LABEL` and `cn` already exist in this file; `ConfidenceChip`, `Disagreement`,
and `geoConfidenceReason` are left untouched.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (If `tsc` reports `OverallConfidence` is missing, that is
fixed in Task 4 where `profile.tsx` stops importing it — proceed; the dedicated
check is Task 4 Step 4.)

- [ ] **Step 4: Commit**

```bash
git add components/CheckResults/confidence.tsx
git commit -m "feat(geo): monochrome ConfidenceDot + OverallGauge primitives"
```

---

## Task 3: The voting card

**Files:**
- Create: `components/CheckResults/voting.tsx`

- [ ] **Step 1: Create the component**

Create `components/CheckResults/voting.tsx`:

```tsx
"use client";

import { Check, Star } from "lucide-react";
import type { GeoResolution } from "@/lib/ti/types";
import {
  buildVoteTable,
  providerLabel,
  type VoteCell,
  type VoteColumn,
} from "@/lib/ti/geo/votes";
import { ConfidenceDot, OverallGauge, geoConfidenceReason } from "./confidence";

/** One matrix cell, rendered by status. Agreement recedes (a light check),
 *  disagreement reads as the differing value, all in grayscale. */
function Cell({ cell }: { cell: VoteCell }) {
  switch (cell.status) {
    case "win":
      return (
        <span className="inline-flex items-center justify-center gap-0.5">
          <Check className="size-3.5 text-foreground/75" aria-label="agrees" />
          {cell.authority && (
            <Star className="size-3 text-foreground/55" aria-label="allocation authority" />
          )}
        </span>
      );
    case "dissent":
      return <span className="text-[12px] text-muted-foreground">{cell.value}</span>;
    case "scatter":
      return (
        <span className="text-foreground/40" aria-label="scattered point">
          ·
        </span>
      );
    case "absent":
    default:
      return (
        <span className="text-foreground/25" aria-label="not reported">
          –
        </span>
      );
  }
}

/** Wide layout: provider x field tally sheet. */
function Matrix({ providers, fields }: { providers: string[]; fields: VoteColumn[] }) {
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="border-b border-foreground/10">
          <th className="py-1.5 pr-3 text-left font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Provider
          </th>
          {fields.map((f) => (
            <th
              key={f.key}
              className="px-3 py-1.5 text-center font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
            >
              {f.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-foreground/[0.06]">
        {providers.map((id) => (
          <tr key={id} className="transition-colors hover:bg-foreground/[0.03]">
            <td className="py-1.5 pr-3 font-mono text-[12px] text-foreground/65">
              {providerLabel(id)}
            </td>
            {fields.map((f) => (
              <td key={f.key} className="px-3 py-1.5 text-center">
                <Cell cell={f.cells[id]} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t border-foreground/15 bg-muted/40">
          <td className="py-2 pr-3 font-mono text-[11px] font-semibold uppercase tracking-wider text-foreground">
            Result
          </td>
          {fields.map((f) => (
            <td key={f.key} className="px-3 py-2 text-center align-top">
              <div className="truncate text-[13px] font-medium text-foreground">{f.winner}</div>
              <div className="mt-1 flex items-center justify-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <ConfidenceDot confidence={f.confidence} />
                {f.confidence}
              </div>
            </td>
          ))}
        </tr>
      </tfoot>
    </table>
  );
}

/** Narrow layout: one ballot per field. */
function Ballots({ fields }: { fields: VoteColumn[] }) {
  return (
    <div className="space-y-3">
      {fields.map((f) => (
        <div
          key={f.key}
          className="border-t border-foreground/[0.06] pt-3 first:border-t-0 first:pt-0"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {f.label}
            </span>
            <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <ConfidenceDot confidence={f.confidence} />
              {f.confidence}
            </span>
          </div>
          <div className="mt-0.5 text-sm font-medium text-foreground">{f.winner}</div>
          {f.backers.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px]">
              <span className="text-foreground/45">backed</span>
              {f.backers.map((id) => (
                <span key={id} className="inline-flex items-center gap-0.5 text-foreground/75">
                  {providerLabel(id)}
                  {id === f.authorityId && (
                    <Star className="size-3 text-foreground/55" aria-label="allocation authority" />
                  )}
                </span>
              ))}
            </div>
          )}
          {f.dissent.map((d, i) => (
            <div
              key={i}
              className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-foreground/75"
            >
              <span className="text-foreground/45">differs</span>
              <span>{d.value}</span>
              <span className="text-foreground/45">,</span>
              {d.sources.map((s) => (
                <span key={s}>{providerLabel(s)}</span>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Full-width geo-confidence card: overall gauge + per-provider voting,
 *  responsive matrix (sm+) / ballots (below sm). No-op when nothing resolved. */
export function VotingCard({ res }: { res: GeoResolution }) {
  const table = buildVoteTable(res);
  if (!table) return null;
  return (
    <div className="rounded-xl border border-foreground/10 bg-muted/30 p-4">
      {res.overall && (
        <div className="flex items-center gap-3 pb-3">
          <OverallGauge overall={res.overall} />
          <div className="min-w-0">
            <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-foreground">
              Geo confidence, {res.overall.confidence}
            </div>
            <div className="mt-0.5 text-[13px] text-muted-foreground">
              {geoConfidenceReason(res)}
            </div>
          </div>
        </div>
      )}
      <div className="hidden sm:block">
        <Matrix providers={table.providers} fields={table.fields} />
      </div>
      <div className="sm:hidden">
        <Ballots fields={table.fields} />
      </div>
      {table.fields.some((f) => f.authorityId) && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          <Star className="mr-1 inline size-3 align-[-1px] text-foreground/55" />
          allocation authority, RDAP country, RIPEstat ASN
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (As in Task 2, an `OverallConfidence` import error from
`profile.tsx` is expected until Task 4; ignore until Task 4 Step 4.)

- [ ] **Step 3: Commit**

```bash
git add components/CheckResults/voting.tsx
git commit -m "feat(geo): monochrome voting card (matrix + ballots)"
```

---

## Task 4: Wire the card into the IP profile

**Files:**
- Modify: `components/CheckResults/profile.tsx`

- [ ] **Step 1: Swap the imports**

Replace the line:

```ts
import { Disagreement, OverallConfidence, geoConfidenceReason } from "./confidence";
```

with:

```ts
import { VotingCard } from "./voting";
```

(The `LocationMap` import on the next line stays.)

- [ ] **Step 2: Remove the two inline `Disagreement` calls**

Delete this line (in the country identity strip):

```tsx
                            {res?.country && <Disagreement field={res.country} />}
```

Delete this line (in the ASN field):

```tsx
                                                {res?.asn && <Disagreement field={res.asn} />}
```

- [ ] **Step 3: Replace the footer block with the voting card**

Replace this block:

```tsx
                {res?.overall && (
                    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <OverallConfidence confidence={res.overall.confidence} />
                        <span>{geoConfidenceReason(res)}</span>
                    </div>
                )}
```

with:

```tsx
                {res && <VotingCard res={res} />}
```

- [ ] **Step 4: Typecheck + lint + build**

Run: `npx tsc --noEmit`
Expected: no errors (the `OverallConfidence` reference is now gone).
Run: `npm run lint`
Expected: no errors.
Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add components/CheckResults/profile.tsx
git commit -m "feat(geo): render voting card below the geo bento row"
```

---

## Task 5: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Unit suite + lint + build**

Run: `npm test` — Expected: PASS.
Run: `npm run lint` — Expected: clean.
Run: `npm run build` — Expected: success.

- [ ] **Step 2: Manual, known-good IP (multi-voter)**

Start `npm run dev` (or use the user's running server). Open
`http://localhost:3000/check/8.8.8.8`. Confirm:
- the geo section shows the map + detail row, then a full-width card below it;
- the card header shows the gauge (a number) + "Geo confidence, high" + reason;
- the matrix lists each provider with checks; `rdap-ip` country cell carries the
  authority star; the `RESULT` row is anchored at the bottom with dot + tier;
- no hue is used anywhere in the card (grayscale only).

- [ ] **Step 3: Manual, low-corroboration IP**

Check an IP that resolves through few providers (e.g. a single-voter case).
Confirm the card still renders: few rows, a `low`/`medium` tier, no crash, and
columns drop for any absent field.

- [ ] **Step 4: Responsive swap**

Narrow the viewport below the `sm` breakpoint (~640px). Confirm the matrix is
replaced by stacked ballots (field label + tier, winner value, `backed` line,
`differs` line) and reads cleanly; widen again to confirm the matrix returns.

- [ ] **Step 5: No regressions in the flat view**

Confirm the OG image route and history still render (they read the flat
`overlayResolution` view, which is untouched). Spot-check
`http://localhost:3000/check/8.8.8.8` OG by viewing
`/check/8.8.8.8/opengraph-image` loads without error.

---

## Notes for the implementer

- **House style:** user-facing copy uses commas, never dashes or " - " separators
  (the card's "differs Palo Alto, ipgeolocation" and the authority footnote
  already follow this). Keep it that way.
- **Monochrome is a hard constraint:** color in this card is a bug. The only
  approved hues in the app belong to the risk verdict. If you reach for emerald /
  amber / red, stop.
- **Do not touch** `components/BulkGeoResults.tsx` or `ConfidenceChip` — the bulk
  geo tool stays tonal and is out of scope.
