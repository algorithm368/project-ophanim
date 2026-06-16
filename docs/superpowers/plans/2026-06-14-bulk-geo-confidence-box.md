# Bulk aggregate geo-confidence box Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a rate-forward aggregate geo-confidence box to the top of the bulk geolocation results, summarizing how confidently the whole batch was located.

**Architecture:** A pure, unit-tested helper (`summarizeBatchConfidence`) buckets each `GeoRow` by its already-computed `resolution.overall.confidence` and returns counts, a confident-rate, and the union of contributing providers. A presentational `BatchConfidence` component renders a headline rate, a four-bucket distribution bar, and a provenance line. `BulkGeoResults` calls the helper and renders the component at the top of the results card. No backend, provider, or scoring changes.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Vitest (pure unit tests, `@/` alias, colocated `*.test.ts`), Tailwind, shadcn primitives.

Spec: `docs/superpowers/specs/2026-06-14-bulk-geo-confidence-box-design.md`

---

## File structure

- `lib/ti/geo/batch-summary.ts` (NEW) — pure aggregation: `BatchConfidence` interface + `summarizeBatchConfidence(rows)`. One responsibility: turn `GeoRow[]` into a batch confidence summary. Depends only on types (`Confidence`) and the `GeoRow` type (type-only import, no runtime cycle).
- `lib/ti/geo/batch-summary.test.ts` (NEW) — colocated unit tests.
- `components/CheckResults/confidence.tsx` (MODIFY) — add the `BatchConfidence` presentational component beside `OverallConfidence`. Reuses the existing `cn` import and confidence palette.
- `components/BulkGeoResults.tsx` (MODIFY) — compute the summary and render the box as the first content element under the card heading.

Reference adapters for style/conventions: existing helpers in `lib/ti/geo/bulk.ts` (pure helpers + colocated tests) and the existing `OverallConfidence`/`ConfidenceChip` components in `components/CheckResults/confidence.tsx`.

---

## Task 1: Pure aggregation helper `summarizeBatchConfidence`

**Files:**
- Create: `lib/ti/geo/batch-summary.ts`
- Test: `lib/ti/geo/batch-summary.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/ti/geo/batch-summary.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { summarizeBatchConfidence } from "@/lib/ti/geo/batch-summary";
import type { GeoRow } from "@/lib/ti/geo";
import type { Confidence, GeoResolution } from "@/lib/ti/types";

/** Build an ok GeoRow whose overall tier is `overall` (null = no overall). */
function okRow(
  ip: string,
  overall: Confidence | null,
  sources: string[] = ["ip-api"],
): GeoRow {
  const resolution: GeoResolution = {
    country: {
      value: "United States",
      confidence: overall ?? "low",
      score: 0.8,
      agreement: 1,
      sources,
    },
    flags: { isHosting: false, isProxy: false, isMobile: false, sources: {} },
    providerCount: sources.length,
    ...(overall ? { overall: { score: 0.8, confidence: overall } } : {}),
  };
  return {
    ip,
    version: 4,
    status: "ok",
    geo: { country: "United States" },
    resolution,
  };
}

function errorRow(ip: string): GeoRow {
  return { ip, version: 4, status: "error", error: "Lookup failed" };
}

describe("summarizeBatchConfidence", () => {
  it("buckets ok rows by resolution.overall.confidence", () => {
    const s = summarizeBatchConfidence([
      okRow("1.1.1.1", "high"),
      okRow("2.2.2.2", "medium"),
      okRow("3.3.3.3", "low"),
    ])!;
    expect(s.counts).toEqual({ high: 1, medium: 1, low: 1, nodata: 0 });
    expect(s.total).toBe(3);
  });

  it("counts error rows and ok-rows-without-overall as no data", () => {
    const s = summarizeBatchConfidence([
      okRow("1.1.1.1", "high"),
      errorRow("2.2.2.2"),
      okRow("3.3.3.3", null),
    ])!;
    expect(s.counts).toEqual({ high: 1, medium: 0, low: 0, nodata: 2 });
  });

  it("computes confidentRate as (high + medium) / total", () => {
    const rows: GeoRow[] = [
      ...Array.from({ length: 9 }, (_, i) => okRow(`10.0.0.${i}`, "high")),
      ...Array.from({ length: 3 }, (_, i) => okRow(`10.0.1.${i}`, "medium")),
      ...Array.from({ length: 2 }, (_, i) => okRow(`10.0.2.${i}`, "low")),
      errorRow("10.0.3.0"),
    ];
    const s = summarizeBatchConfidence(rows)!;
    expect(s.total).toBe(15);
    expect(s.confidentRate).toBeCloseTo(0.8, 5);
  });

  it("yields rate 0 and all-nodata for an all-error batch", () => {
    const s = summarizeBatchConfidence([errorRow("1.1.1.1"), errorRow("2.2.2.2")])!;
    expect(s.confidentRate).toBe(0);
    expect(s.counts.nodata).toBe(s.total);
  });

  it("returns null for fewer than two rows", () => {
    expect(summarizeBatchConfidence([])).toBeNull();
    expect(summarizeBatchConfidence([okRow("1.1.1.1", "high")])).toBeNull();
  });

  it("counts always sum to total", () => {
    const s = summarizeBatchConfidence([
      okRow("1.1.1.1", "high"),
      okRow("2.2.2.2", "medium"),
      errorRow("3.3.3.3"),
    ])!;
    const { high, medium, low, nodata } = s.counts;
    expect(high + medium + low + nodata).toBe(s.total);
  });

  it("returns the sorted distinct union of contributing provider ids", () => {
    const fancy: GeoRow = {
      ip: "9.9.9.9",
      version: 4,
      status: "ok",
      geo: { country: "United States" },
      resolution: {
        country: {
          value: "United States",
          confidence: "high",
          score: 0.9,
          agreement: 1,
          sources: ["ipinfo", "rdap-ip"],
        },
        coordinates: {
          value: { lat: 1, lon: 2 },
          confidence: "medium",
          score: 0.6,
          agreement: 1,
          sources: ["freeipapi"],
        },
        flags: {
          isHosting: true,
          isProxy: false,
          isMobile: false,
          sources: { isHosting: ["ip-api"] },
        },
        providerCount: 4,
        overall: { score: 0.8, confidence: "high" },
      },
    };
    const s = summarizeBatchConfidence([fancy, okRow("8.8.8.8", "high", ["ip-api"])])!;
    expect(s.providers).toEqual(["freeipapi", "ip-api", "ipinfo", "rdap-ip"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/ti/geo/batch-summary.test.ts`
Expected: FAIL — cannot resolve `@/lib/ti/geo/batch-summary` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `lib/ti/geo/batch-summary.ts`:

```ts
import type { Confidence } from "../types";
import type { GeoRow } from "../geo";

/** Aggregate confidence across a bulk geolocation batch. */
export interface BatchConfidence {
  /** All rows in the batch (located plus no-data). */
  total: number;
  /** One bucket per row; the four counts sum to `total`. */
  counts: { high: number; medium: number; low: number; nodata: number };
  /** (high + medium) / total, 0..1. "Confidently located" means at least medium. */
  confidentRate: number;
  /** Distinct provider ids that contributed to any resolved field, sorted. */
  providers: string[];
}

/** Union of provider ids backing any resolved field across the batch. */
function collectProviders(rows: GeoRow[]): string[] {
  const ids = new Set<string>();
  for (const { resolution: res } of rows) {
    if (!res) continue;
    const fields = [
      res.country,
      res.region,
      res.city,
      res.asn,
      res.asnOrg,
      res.isp,
      res.coordinates,
    ];
    for (const f of fields) {
      if (f) for (const id of f.sources) ids.add(id);
    }
    for (const list of Object.values(res.flags.sources)) {
      for (const id of list) ids.add(id);
    }
  }
  return [...ids].sort();
}

/**
 * Summarize how confidently a bulk batch was located. Each row is bucketed by
 * its reconciled `resolution.overall.confidence`; error rows (and the rare ok
 * row that produced no `overall`) count as "no data". Returns null for fewer
 * than two rows, so a lone-IPv6 bulk render shows no box.
 */
export function summarizeBatchConfidence(rows: GeoRow[]): BatchConfidence | null {
  const total = rows.length;
  if (total < 2) return null;

  const counts = { high: 0, medium: 0, low: 0, nodata: 0 };
  for (const row of rows) {
    const tier: Confidence | undefined =
      row.status === "ok" ? row.resolution?.overall?.confidence : undefined;
    if (tier === "high") counts.high++;
    else if (tier === "medium") counts.medium++;
    else if (tier === "low") counts.low++;
    else counts.nodata++;
  }

  return {
    total,
    counts,
    confidentRate: (counts.high + counts.medium) / total,
    providers: collectProviders(rows),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/ti/geo/batch-summary.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Run lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/ti/geo/batch-summary.ts lib/ti/geo/batch-summary.test.ts
git commit -m "$(cat <<'EOF'
feat(geo): summarizeBatchConfidence helper for bulk geo

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `BatchConfidence` presentational component

**Files:**
- Modify: `components/CheckResults/confidence.tsx`

This repo unit-tests only `lib/**` (pure, no DOM); presentational components carry no logic and are verified by build/lint plus a dev visual check (per CLAUDE.md). No component test is added.

- [ ] **Step 1: Add the type import**

At the top of `components/CheckResults/confidence.tsx`, the existing import is:

```tsx
import type { Confidence, GeoResolution, ResolvedField } from "@/lib/ti/types";
```

Add this line directly beneath it (alias avoids a name clash with the component below):

```tsx
import type { BatchConfidence as BatchSummary } from "@/lib/ti/geo/batch-summary";
```

- [ ] **Step 2: Append the component**

Add to the end of `components/CheckResults/confidence.tsx`:

```tsx
const BUCKETS: {
  key: keyof BatchSummary["counts"];
  label: string;
  tone: string;
}[] = [
  { key: "high", label: "high", tone: "bg-emerald-600/70" },
  { key: "medium", label: "medium", tone: "bg-amber-600/70" },
  { key: "low", label: "low", tone: "bg-foreground/30" },
  { key: "nodata", label: "no data", tone: "bg-foreground/15" },
];

const PROVIDER_LABEL: Record<string, string> = {
  "ip-api": "ip-api",
  ipinfo: "ipinfo",
  "rdap-ip": "RDAP",
  ripestat: "RIPEstat",
  freeipapi: "freeipapi",
  ipgeolocation: "ipgeolocation",
  ipwhois: "ipwhois",
  abuseipdb: "AbuseIPDB",
  "reverse-dns": "reverse DNS",
};

/** Rate-forward summary of how confidently a bulk batch was located: a headline
 *  rate, a four-bucket distribution bar, and a provenance line. */
export function BatchConfidence({ summary }: { summary: BatchSummary }) {
  const { total, counts, confidentRate, providers } = summary;
  const pct = Math.round(confidentRate * 100);
  const confident = counts.high + counts.medium;
  const names = providers.map((id) => PROVIDER_LABEL[id] ?? id);

  return (
    <div className="space-y-3 rounded-md border border-border bg-background/40 px-4 py-3">
      <div>
        <span className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
          Batch geo confidence
        </span>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums">{pct}%</span>
          <span className="text-sm text-muted-foreground">confidently located</span>
        </div>
        <p className="text-sm text-muted-foreground">
          {confident} of {total} addresses high or medium
        </p>
      </div>

      <ul className="space-y-1">
        {BUCKETS.map((b) => {
          const n = counts[b.key];
          const width = total > 0 ? (n / total) * 100 : 0;
          return (
            <li key={b.key} className="flex items-center gap-2 text-xs">
              <span className="w-16 shrink-0 text-muted-foreground">{b.label}</span>
              <span className="h-2 flex-1 overflow-hidden rounded-sm bg-foreground/5">
                <span
                  className={cn("block h-full rounded-sm", b.tone)}
                  style={{ width: `${width}%` }}
                  aria-hidden
                />
              </span>
              <span className="w-6 shrink-0 text-right font-mono tabular-nums text-muted-foreground">
                {n}
              </span>
            </li>
          );
        })}
      </ul>

      {names.length > 0 && (
        <p className="text-xs text-muted-foreground">
          reconciled across {names.join(", ")}
        </p>
      )}
    </div>
  );
}
```

(`cn` is already imported at the top of this file; no new utility import is needed.)

- [ ] **Step 3: Verify it typechecks and lints**

Run: `npm run lint`
Expected: no errors. (The component is not yet rendered anywhere; that happens in Task 3.)

- [ ] **Step 4: Commit**

```bash
git add components/CheckResults/confidence.tsx
git commit -m "$(cat <<'EOF'
feat(geo): BatchConfidence box component

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Render the box in `BulkGeoResults`

**Files:**
- Modify: `components/BulkGeoResults.tsx`

- [ ] **Step 1: Add imports**

The file currently imports the chip:

```tsx
import { ConfidenceChip } from "@/components/CheckResults/confidence";
```

Change it to also pull in the box, and add the helper import beneath the existing `flagUrl` import:

```tsx
import { BatchConfidence, ConfidenceChip } from "@/components/CheckResults/confidence";
import { summarizeBatchConfidence } from "@/lib/ti/geo/batch-summary";
```

- [ ] **Step 2: Compute the summary and render it under the heading**

The current component opening is:

```tsx
export default function BulkGeoResults({ rows }: { rows: GeoRow[] }) {
  if (!rows.length) return null;
  return (
    <Card className="sketch-shadow mt-8 overflow-hidden rounded-lg border border-border bg-card">
      <CardContent className="space-y-4">
        <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Globe className="size-5 text-muted-foreground" />
          Geolocation, {rows.length} {rows.length === 1 ? "address" : "addresses"}
        </h2>

        <CopyableList rows={rows} />
```

Replace that span (from the function signature through the line before `<CopyableList rows={rows} />`) with:

```tsx
export default function BulkGeoResults({ rows }: { rows: GeoRow[] }) {
  if (!rows.length) return null;
  const summary = summarizeBatchConfidence(rows);
  return (
    <Card className="sketch-shadow mt-8 overflow-hidden rounded-lg border border-border bg-card">
      <CardContent className="space-y-4">
        <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Globe className="size-5 text-muted-foreground" />
          Geolocation, {rows.length} {rows.length === 1 ? "address" : "addresses"}
        </h2>

        {summary && <BatchConfidence summary={summary} />}

        <CopyableList rows={rows} />
```

(The rest of the component — `SameCountryCallout`, the table — is unchanged.)

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/BulkGeoResults.tsx
git commit -m "$(cat <<'EOF'
feat(geo): render batch confidence box in bulk results

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the new `batch-summary.test.ts`.

- [ ] **Step 2: Run lint and production build (typecheck)**

Run: `npm run lint && npm run build`
Expected: lint clean; build succeeds (TypeScript compiles, no type errors).

- [ ] **Step 3: Visual check in the browser**

Run `npm run dev` (note: the user runs their own dev server on :3000 behind ngrok, so do NOT broadly kill node/next; if a server is already up, use it). Paste a mixed batch into the search box, e.g.:

```
8.8.8.8, 1.1.1.1, 9.9.9.9, 208.67.222.222, 192.0.2.1, 203.0.113.7, 198.51.100.4
```

Confirm:
- The "Batch geo confidence" box renders at the top of the results card, under the "Geolocation, N addresses" heading and above the copy-friendly summary.
- The headline percentage equals `(high + medium) / total` rounded, and matches the bucket counts shown in the bar.
- The bar segment widths look proportional to their counts; the counts on the right sum to the total.
- The "reconciled across ..." line lists the providers that actually fired (ip-api always; ipinfo only with a token; RDAP/freeipapi only when uncertain IPs triggered the fan-out).
- A single-IPv6 bulk render (paste one IPv6 only, e.g. `2606:4700:4700::1111`) shows NO box (its per-row chip suffices).
- The copy summary, same-country callout, and table below are unchanged.

If the UI cannot be verified in this environment, say so explicitly rather than claiming it works.

- [ ] **Step 4: Mark the plan complete**

No commit needed (verification only). All four tasks done.

---

## Self-review notes

- **Spec coverage:** rate-forward layout (Task 2/3), pure tested helper returning `{ total, counts, confidentRate, providers }` with `< 2` gating (Task 1), `overall`-based bucketing with error/no-overall → no data (Task 1), provider-id union (Task 1), monochrome box reusing the palette (Task 2), rendered as first content element under the heading (Task 3), no backend/provider/scoring changes (none touched). Verification mirrors the spec's verification section (Task 4).
- **Placeholder scan:** none — every code and command step is concrete.
- **Type consistency:** `BatchConfidence` interface fields (`total`, `counts.{high,medium,low,nodata}`, `confidentRate`, `providers`) are used identically in the helper, tests, and component; the component aliases the imported type as `BatchSummary` to avoid clashing with the component's own name; `summarizeBatchConfidence` signature matches every call site.
