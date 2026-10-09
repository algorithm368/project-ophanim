# Bulk Lookup Implementation Plan

> **For agentic workers:** this plan is executed through **Orca orchestration**,
> not ad hoc subagents. The coordinator loads the Orca `orchestration` skill
> (`orca skills get orchestration`), creates one Run, creates one Orca task per
> Task below with the `--deps` from *Orca task graph*, and dispatches each
> ready task to a supervised worker (`orca orchestration worker-start --agent
> claude`, or `--agent codex` when the coordinator's context or usage is nearly
> full). Each worker gets the task text plus *Global Constraints*, follows TDD
> (superpowers:test-driven-development), and reports `worker_done` with the
> commit SHA. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paste up to 1,000 IPs and domains, or give the CLI a file of any
size (the reference file has 423k IPs), and get one row per indicator. Each row
is scored the same way `/check` scores it, says how deep it was checked, and
spends metered free-tier quota only where it can change the answer.

**Architecture:** A pure engine in `lib/ti/bulk/` does the work: parse, pass 0
(local feeds, large runs only), pass 1 (unmetered profile), buckets A/B/C/D,
and pass 2 (metered sources in B, C, A order, under a per-key Redis quota
ledger). API keys resolve per lane (`check`, `bulk`, `scan`) through
`lib/ti/keys.ts`. Two thin runners drive the engine: browser-paced routes under
`/api/bulk`, backed by a Redis run record, and `scripts/bulk.ts`, backed by a
run directory on disk.

**Tech Stack:** Next.js 16 App Router route handlers (nodejs runtime), React 19,
TypeScript, `@upstash/redis`, Vitest, Bun, Node `node:async_hooks`,
`node:crypto`, `node:url`, `node:fs`.

**Spec:** `docs/superpowers/specs/2026-10-07-bulk-lookup-design.md` (revision
2). Read it before any task. It explains *why* every rule below exists, and
lists the real-input cases the tests must cover.

## Global Constraints

- Indicator kinds: `ip` and `domain` only. Hash, URL and CIDR inputs are reported as invalid with a reason, never dropped silently.
- Metered source ids: `virustotal`, `abuseipdb`, `greynoise`, `otx`, `safebrowsing`.
- Metered key envs: `VIRUSTOTAL_API_KEY`, `ABUSEIPDB_API_KEY`, `GREYNOISE_API_KEY`, `OTX_API_KEY`, `GOOGLE_SAFE_BROWSING_API_KEY`.
- Vouching source ids: `scanner-id`, `tranco`, `abuseipdb`, `greynoise`.
- Pass 0 source ids: `feodo`, `et-open`, `ipsum`, `spamhaus-drop`. A strong hit is `ok` with `malicious: true` or `score >= 30`.
- Lanes: `check` (the default when none is set), `bulk`, `scan`. A key resolves as `<KEY_ENV>_<LANE>`, then `<KEY_ENV>`.
- Quota pools are per key: `<keyEnv>:<sha256(key) first 8 hex>`. Defaults: VT 500/day and 4/min, AbuseIPDB 1000, GreyNoise 50, OTX 5000, Safe Browsing 10000. Override with `TI_QUOTA_<KEYENV>_DAILY`.
- Bulk share: 1.0 on its own key, `TI_BULK_SHARE` (default 0.6, clamped to (0, 1]) on a shared key. **Never borrow the shared key when a bulk key is spent.**
- Confirmation threshold: `TI_BULK_CONFIRM_AT`, default 50 metered calls.
- Web cap 1,000 rows. Above 1,000 is the CLI with pass 0. Web pass 1 chunk 25, pass 2 chunk 4. CLI `--concurrency` default 5.
- Internal names: `TI_INTERNAL_SUFFIXES` (comma list), single-label names, and the TLDs `internal`, `corp`, `lan`, `intranet`, `home.arpa`. Applies to bulk only.
- Redis keys: `ti:quota:v1:<pool>:{day|bulk|exhausted}:<YYYY-MM-DD>` (48h), `ti:quota:v1:<pool>:min:<epochMinute>` (120s), `ti:bulk:v1:run:<id>` (7d), `ti:bulk:v1:row:<kind>:<indicator>`.
- Freshness: `suspicious`/`malicious` stale after 24h, others after 7d. Partial or unfinished bulk rows are kept 24h.
- Bulk **never writes** the shared `/check` result cache. It only reads it.
- CLI run directory: `~/.ophanim/bulk/<runId>/` unless `--out-dir`. It is never inside the repo.
- Every NDJSON event carries `v: 1`. All `/api/bulk` routes check the session. Runs are visible only to their owner.
- Never log or store an API key. Only its fingerprint.
- Tests are colocated `lib/**/*.test.ts`, no network, and keep `lib/` at 100% lines and branches (`bun run coverage`, then `node scripts/coverage-gaps.mjs <path>`).
- Lint is strict: `sonarjs/cognitive-complexity` 15 and `no-nested-ternary` are errors.
- User-facing copy uses commas, never em/en dashes or ` - ` separators.
- Use `bun run test`, never `bun test`.
- UI: monochrome, colour only on verdict, system fonts, desktop width 1280+.

---

## File map

| File | Responsibility |
|---|---|
| `lib/ti/keys.ts` | Lanes, `apiKey`, `hasOwnKey`, `keyFingerprint` |
| `lib/ti/bulk/types.ts` | Bulk types, `depthOf` |
| `lib/ti/bulk/profile.ts` | Pass 0, 1 and 2 source sets and order |
| `lib/ti/bulk/classify.ts` | Results to bucket A/B/C/D |
| `lib/ti/bulk/quota.ts` | Per-key quota ledger |
| `lib/ti/bulk/internal.ts` | `isInternalName` |
| `lib/ti/bulk/parse.ts` | Text to items, with every real-input case |
| `lib/ti/bulk/pass0.ts` | Local-feed screening for large runs |
| `lib/ti/bulk/row-cache.ts` | Freshness, shared-cache read, bulk row cache |
| `lib/ti/bulk/engine.ts` | `runPass1`, `runPass2`, queue, estimate |
| `lib/ti/bulk/run-store.ts` | Web run record (summaries), ownership |
| `lib/ti/bulk/export.ts` | CSV/JSON of rows and invalid input |
| `lib/ti/bulk/run-dir.ts` | CLI run directory: state, rows.jsonl, outputs |
| `lib/ti/bulk/limit.ts` | `mapLimit` concurrency helper |
| `lib/ti/bulk/api.ts` | Route helpers, `BulkEvent` |
| `lib/ti/domain/tranco-list.ts` | Daily top-1,000 Tranco list, parent lookup, shared-hosting rule |
| 6 adapters, `lib/ti/check.ts`, `lib/ti/domain/check.ts`, `lib/ti/hash/check.ts`, `lib/require-session.ts`, `lib/route-mode.ts`, `.env.example` | Modified |
| `app/api/bulk/**` | Five routes |
| `scripts/bulk.ts` | CLI |
| `app/bulk/page.tsx`, `components/Bulk/*`, `app/page.tsx` | The page |

## Orca task graph

```
T1 types+profile ─┬─ T2 classify ───────────────────────────┐
                  ├─ T6 parse (needs T6a internal, same task)│
                  ├─ T7 pass0 ──────────────────────────────┤
                  └─ T8 row cache ──────────────────────────┤
T3 keys+adapters ─┬─ T4 quota ─┬─ T5 /check spend hook     │
                  └─ T16 Tranco local list ───────────────────┤
                               └────────────────────────────┴─ T9 engine ─┬─ T10 run store+export ─ T12 routes ─ T14 UI ─┐
                                                              T11 run-dir+limit ─────────────── T13 CLI ────────────────┴─ T15 verify
```

`--deps`: T2, T6, T7 and T8 on T1. T4 on T1 and T3. T5 on T4. T16 (Tranco,
written last below but scheduled early) on T3. T9 on T2, T4, T7, T8 and T16. T10 on T6 and T9. T11 on T9 and T10. T12 on T10. T13 on T6, T7, T9 and
T11. T14 on T12. T15 on T13 and T14. T1 and T3 have no deps and start
together.

```bash
git switch main && git pull && git switch -c feat/bulk-lookup
orca orchestration run-create --objective "Bulk IOC lookup per docs/superpowers/plans/2026-10-07-bulk-lookup.md" --json
orca orchestration task-create --task-title "T1 bulk types and source profile" \
  --spec "Implement Task 1 of docs/superpowers/plans/2026-10-07-bulk-lookup.md. Read the spec and Global Constraints first." --json
orca orchestration task-create --task-title "T2 bucket classifier" --deps '["<T1>"]' \
  --spec "Implement Task 2 of docs/superpowers/plans/2026-10-07-bulk-lookup.md." --json
# ...T3..T15 likewise
orca orchestration worker-start --agent claude   # one per ready task
```

Parallel tasks touch disjoint files. Workers `git pull --rebase` before each
commit on `feat/bulk-lookup`.

---

### Task 1: Bulk types and source profile

**Files:**
- Create: `lib/ti/bulk/types.ts`, `lib/ti/bulk/profile.ts`
- Test: `lib/ti/bulk/profile.test.ts`, `lib/ti/bulk/types.test.ts`

**Interfaces:**
- Consumes: `sources`, `domainSources`, `sourceWeight` (`lib/ti/weight.ts`), `parseIP` (`lib/ip.ts`).
- Produces: `BulkKind`, `Bucket`, `RowState`, `Depth`, `METERED_IDS`, `MeteredId`, `METERED_KEY_ENVS`, `MeteredKeyEnv`, `BulkRow`, `RowSummary`, `InvalidInput`, `BulkRun`, `depthOf(row)`; `VOUCHING_IDS`, `PASS0_IDS`, `isMetered`, `registryFor`, `inBulkProfile`, `familyOf(kind, indicator)`, `pass1Sources(kind, family?)`, `pass0Sources(family)`, `pass2Ids(kind, bucket)`, `sourceById(kind, id)`.

- [ ] **Step 1: Write `lib/ti/bulk/types.ts`**

```ts
import type { SourceResult, Verdict } from "../types";

export type BulkKind = "ip" | "domain";

/** A: hard-listed, B: suspicious or mixed, C: quiet, D: vouched. See the spec. */
export type Bucket = "A" | "B" | "C" | "D";

/**
 * `pending` not started. `pass1` waiting for pass 2. `full` finished.
 * `partial` a wanted metered source could not run. `cached` a fresh /check
 * result. `internal` never sent out. `feed-only` pass 0 was the last step.
 */
export type RowState = "pending" | "pass1" | "full" | "partial" | "cached" | "internal" | "feed-only";

/** How far a row was checked. A row is never quieter than its evidence. */
export type Depth = "none" | "feed" | "free" | "full";

export const METERED_IDS = ["virustotal", "abuseipdb", "greynoise", "otx", "safebrowsing"] as const;
export type MeteredId = (typeof METERED_IDS)[number];

export const METERED_KEY_ENVS = [
  "VIRUSTOTAL_API_KEY",
  "ABUSEIPDB_API_KEY",
  "GREYNOISE_API_KEY",
  "OTX_API_KEY",
  "GOOGLE_SAFE_BROWSING_API_KEY",
] as const;
export type MeteredKeyEnv = (typeof METERED_KEY_ENVS)[number];

export interface BulkRow {
  id: number;
  indicator: string;
  /** The Unicode form, when the indicator was converted to punycode. */
  display?: string;
  kind: BulkKind;
  state: RowState;
  bucket?: Bucket;
  riskScore?: number;
  verdict?: Verdict;
  /** Every result so far, with `raw` already dropped. */
  results: SourceResult[];
  /** Metered sources still to ask. */
  pending: MeteredId[];
  /** Metered sources that were wanted but could not run. */
  missing: MeteredId[];
  /** Pass 0 feeds that listed this IP. */
  listedBy?: string[];
  /** Why the row is the way it is, in user-facing copy. */
  note?: string;
  checkedAt?: string;
}

/** What a run record keeps per row: everything but the results. */
export type RowSummary = Omit<BulkRow, "results">;

export interface InvalidInput {
  input: string;
  reason: string;
}

export interface BulkRun {
  v: 1;
  id: string;
  owner: string;
  createdAt: string;
  rows: RowSummary[];
  invalid: InvalidInput[];
  duplicates: number;
  confirmed?: boolean;
}

export function depthOf(row: RowSummary): Depth {
  if (row.state === "internal" || row.state === "pending") return "none";
  if (row.state === "feed-only") return "feed";
  if (row.state === "cached") return "full";
  if (row.state === "full" && row.bucket !== "D") return "full";
  return "free";
}
```

- [ ] **Step 2: Write the failing tests**

`lib/ti/bulk/types.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { depthOf, type RowSummary } from "./types";

const row = (over: Partial<RowSummary>): RowSummary => ({
  id: 0, indicator: "x", kind: "ip", state: "pending", pending: [], missing: [], ...over,
});

describe("depthOf", () => {
  it.each([
    [row({ state: "internal" }), "none"],
    [row({ state: "pending" }), "none"],
    [row({ state: "feed-only" }), "feed"],
    [row({ state: "cached" }), "full"],
    [row({ state: "full", bucket: "B" }), "full"],
    [row({ state: "full", bucket: "D" }), "free"],
    [row({ state: "partial", bucket: "C" }), "free"],
    [row({ state: "pass1", bucket: "C" }), "free"],
  ])("%o is %s", (r, depth) => expect(depthOf(r)).toBe(depth));
});
```

`lib/ti/bulk/profile.test.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  VOUCHING_IDS, familyOf, inBulkProfile, isMetered, pass0Sources,
  pass1Sources, pass2Ids, registryFor, sourceById,
} from "./profile";
import { METERED_IDS } from "./types";
import { sourceWeight } from "../weight";

/** Source ids whose adapter can set `allowlisted`, read from the source text so
 *  a new vouching adapter cannot slip past VOUCHING_IDS unnoticed. */
function vouchingIdsOnDisk(): Set<string> {
  const found = new Set<string>();
  for (const dir of ["lib/ti/sources", "lib/ti/domain/sources"]) {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
      const text = readFileSync(join(dir, file), "utf8");
      const id = /id:\s*"([^"]+)"/.exec(text)?.[1];
      if (id && /allowlisted\s*[:=]/.test(text)) found.add(id);
    }
  }
  return found;
}

describe("bulk source profile", () => {
  it("knows every vouching adapter", () => {
    for (const id of vouchingIdsOnDisk()) expect(VOUCHING_IDS.has(id)).toBe(true);
  });

  it("excludes only weight-0 sources that never vouch", () => {
    for (const kind of ["ip", "domain"] as const) {
      for (const s of registryFor(kind)) {
        if (inBulkProfile(s)) continue;
        expect(sourceWeight(s.meta)).toBe(0);
        expect(VOUCHING_IDS.has(s.meta.id)).toBe(false);
      }
    }
  });

  it("keeps metered sources out of pass 1 and drops the context fan-out", () => {
    const ids = pass1Sources("ip").map((s) => s.meta.id);
    expect(ids.some(isMetered)).toBe(false);
    expect(ids).not.toContain("ip-api");
    expect(ids).not.toContain("reverse-ip");
    expect(ids).toEqual(expect.arrayContaining(["scanner-id", "feodo"]));
    expect(pass1Sources("domain").map((s) => s.meta.id)).toContain("tranco");
  });

  it("filters IP sources by family", () => {
    const v6 = pass1Sources("ip", 6).map((s) => s.meta.id);
    expect(v6).not.toContain("ipsum");
    expect(v6).toContain("spamhaus-drop");
  });

  it("builds pass 0 from the four feeds, by family", () => {
    expect(pass0Sources(4).map((s) => s.meta.id).sort()).toEqual(["et-open", "feodo", "ipsum", "spamhaus-drop"]);
    expect(pass0Sources(6).map((s) => s.meta.id)).toEqual(["spamhaus-drop"]);
  });

  it("reads the family of an indicator", () => {
    expect(familyOf("ip", "2001:db8::1")).toBe(6);
    expect(familyOf("ip", "1.2.3.4")).toBe(4);
    expect(familyOf("domain", "a.com")).toBe(4);
  });

  it("orders pass 2 by bucket", () => {
    expect(pass2Ids("ip", "C")).toEqual(["abuseipdb", "greynoise", "otx", "virustotal"]);
    expect(pass2Ids("ip", "B")).toEqual(["virustotal", "abuseipdb", "greynoise", "otx"]);
    expect(pass2Ids("ip", "A")).toEqual(pass2Ids("ip", "B"));
    expect(pass2Ids("domain", "C")).toEqual(["safebrowsing", "virustotal"]);
    expect(pass2Ids("ip", "D")).toEqual([]);
  });

  it("only names metered ids that exist in the registry", () => {
    for (const kind of ["ip", "domain"] as const) {
      for (const bucket of ["A", "B", "C"] as const) {
        for (const id of pass2Ids(kind, bucket)) {
          expect(METERED_IDS).toContain(id);
          expect(sourceById(kind, id)?.meta.keyEnv).toBeTruthy();
        }
      }
    }
    expect(sourceById("ip", "nope")).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run to see them fail**

Run: `bun run test lib/ti/bulk/profile.test.ts lib/ti/bulk/types.test.ts`
Expected: FAIL, `Cannot find module './profile'`.

- [ ] **Step 4: Implement `lib/ti/bulk/profile.ts`**

```ts
import type { TiSource } from "../types";
import { sources } from "../registry";
import { domainSources } from "../domain/registry";
import { sourceWeight } from "../weight";
import { parseIP } from "@/lib/ip";
import { METERED_IDS, type Bucket, type BulkKind, type MeteredId } from "./types";

/** Sources that can set `allowlisted`. They feed computeFloor's vouch count
 *  even at weight 0, so dropping one would change a score. */
export const VOUCHING_IDS: ReadonlySet<string> = new Set(["scanner-id", "tranco", "abuseipdb", "greynoise"]);

/** Whole-feed downloads that answer per IP from memory: free at any scale. */
export const PASS0_IDS: ReadonlySet<string> = new Set(["feodo", "et-open", "ipsum", "spamhaus-drop"]);

const METERED: ReadonlySet<string> = new Set(METERED_IDS);

export function isMetered(id: string): id is MeteredId {
  return METERED.has(id);
}

export function registryFor(kind: BulkKind): TiSource[] {
  return kind === "ip" ? sources : domainSources;
}

/** A source is left out of bulk only when it cannot move aggregateRisk. */
export function inBulkProfile(source: TiSource): boolean {
  return sourceWeight(source.meta) > 0 || VOUCHING_IDS.has(source.meta.id);
}

export function familyOf(kind: BulkKind, indicator: string): 4 | 6 {
  return kind === "ip" ? (parseIP(indicator)?.version ?? 4) : 4;
}

// Same rule as checkIp's supportsFamily: unset means IPv4 only. Restated here
// rather than imported from ../check, which imports the quota ledger.
const supports = (s: TiSource, family: 4 | 6) => (s.meta.families ?? [4]).includes(family);

export function pass1Sources(kind: BulkKind, family: 4 | 6 = 4): TiSource[] {
  return registryFor(kind).filter(
    (s) => inBulkProfile(s) && !isMetered(s.meta.id) && (kind === "domain" || supports(s, family)),
  );
}

export function pass0Sources(family: 4 | 6): TiSource[] {
  return sources.filter((s) => PASS0_IDS.has(s.meta.id) && supports(s, family));
}

const IP_CONFIRM: MeteredId[] = ["virustotal", "abuseipdb", "greynoise", "otx"];
// A quiet IP's blind spot is fresh brute force and scanning, which AbuseIPDB
// and GreyNoise see first. VirusTotal's 500/day is kept for the mixed rows.
const IP_QUIET: MeteredId[] = ["abuseipdb", "greynoise", "otx", "virustotal"];
const DOMAIN_ORDER: MeteredId[] = ["safebrowsing", "virustotal"];

const ORDER: Record<BulkKind, Record<Bucket, MeteredId[]>> = {
  ip: { A: IP_CONFIRM, B: IP_CONFIRM, C: IP_QUIET, D: [] },
  domain: { A: DOMAIN_ORDER, B: DOMAIN_ORDER, C: DOMAIN_ORDER, D: [] },
};

export function pass2Ids(kind: BulkKind, bucket: Bucket): MeteredId[] {
  return [...ORDER[kind][bucket]];
}

export function sourceById(kind: BulkKind, id: string): TiSource | undefined {
  return registryFor(kind).find((s) => s.meta.id === id);
}
```

- [ ] **Step 5: Run the tests**

Run: `bun run test lib/ti/bulk/profile.test.ts lib/ti/bulk/types.test.ts`
Expected: PASS. If "filters IP sources by family" fails because a feed's
`families` differs from what is assumed here, read its `meta.families` and fix
the expectation, not the adapter.

- [ ] **Step 6: Commit**

```bash
git add lib/ti/bulk/types.ts lib/ti/bulk/types.test.ts lib/ti/bulk/profile.ts lib/ti/bulk/profile.test.ts
git commit -m "feat(bulk): types, depth, and the pass 0/1/2 source profiles"
```

---

### Task 2: Bucket classifier and the accuracy invariant

**Files:**
- Create: `lib/ti/bulk/classify.ts`
- Test: `lib/ti/bulk/classify.test.ts`, `lib/ti/bulk/invariant.test.ts`

**Interfaces:**
- Consumes: `aggregateRisk`, Task 1 `inBulkProfile`, `registryFor`, `Bucket`.
- Produces: `classify(results: SourceResult[]): { bucket: Bucket; riskScore: number; verdict: Verdict; vouchedBy?: string }`.

- [ ] **Step 1: Write the failing tests**

`lib/ti/bulk/classify.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { SourceMeta, SourceResult } from "../types";
import { classify } from "./classify";

function meta(id: string, weight: number): SourceMeta {
  return { id, name: id, url: "", category: "blocklist", requiresKey: false, weight };
}
function ok(id: string, weight: number, extra: Partial<SourceResult> = {}): SourceResult {
  return { source: meta(id, weight), enabled: true, durationMs: 1, status: "ok", ...extra };
}

describe("classify", () => {
  it("puts a hard listing in A", () => {
    const r = classify([ok("feodo", 1, { score: 100, malicious: true }), ok("dnsbl", 0.5, { score: 0 })]);
    expect(r.bucket).toBe("A");
    expect(r.riskScore).toBeGreaterThanOrEqual(75);
  });
  it("puts a single soft hit in B", () => {
    expect(classify([ok("dnsbl", 0.5, { score: 60 }), ok("ipsum", 0.7, { score: 0 })]).bucket).toBe("B");
  });
  it("puts a quiet row in C", () => {
    expect(classify([ok("dnsbl", 0.5, { score: 0 }), ok("ipsum", 0.7, { score: 0 })])).toMatchObject({ bucket: "C", verdict: "clean" });
  });
  it("puts a row nobody could score in C", () => {
    expect(classify([]).bucket).toBe("C");
  });
  it("puts a vouched quiet row in D and names the voucher", () => {
    expect(classify([ok("tranco", 0, { allowlisted: true }), ok("dnsbl", 0.5, { score: 0 })])).toMatchObject({ bucket: "D", vouchedBy: "tranco" });
  });
  it("does not let a vouch hide a malicious listing", () => {
    expect(classify([ok("tranco", 0, { allowlisted: true }), ok("openphish", 0.9, { score: 90, malicious: true })]).bucket).not.toBe("D");
  });
  it("ignores a vouch from a source that did not answer ok", () => {
    expect(classify([{ ...ok("tranco", 0, { allowlisted: true }), status: "error" }]).bucket).toBe("C");
  });
  it("buckets a Tranco parent vouch as D, without touching the score", () => {
    const pv = ok("tranco", 0, { details: { parentVouch: { parent: "google.com", rank: 1 } } });
    const r = classify([pv, ok("dnsbl", 0.5, { score: 0 })]);
    expect(r).toMatchObject({ bucket: "D", vouchedBy: "tranco, via google.com" });
    expect(r.riskScore).toBe(classify([ok("dnsbl", 0.5, { score: 0 })]).riskScore);
  });
  it("does not let a parent vouch hide a listing", () => {
    const pv = ok("tranco", 0, { details: { parentVouch: { parent: "b.com", rank: 9 } } });
    expect(classify([pv, ok("openphish", 0.9, { score: 90, malicious: true })]).bucket).not.toBe("D");
  });
  it("ignores malformed parent details", () => {
    expect(classify([ok("tranco", 0, { details: { parentVouch: { parent: 7 } } })]).bucket).toBe("C");
  });
});
```

`lib/ti/bulk/invariant.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { aggregateRisk } from "../aggregate";
import type { SourceResult } from "../types";
import { sourceWeight } from "../weight";
import { inBulkProfile, registryFor } from "./profile";

type Shape = "listed" | "mixed" | "quiet" | "vouched";

/** One plausible answer per registry source. Context sources get a score too,
 *  to prove their weight of 0 keeps them out of the sum. */
function fixture(kind: "ip" | "domain", shape: Shape): SourceResult[] {
  return registryFor(kind).map((s, i) => {
    const weighted = sourceWeight(s.meta) > 0;
    const base: SourceResult = { source: s.meta, enabled: true, durationMs: 1, status: "ok", score: weighted ? 0 : 50 };
    if (shape === "listed" && ["feodo", "openphish"].includes(s.meta.id)) return { ...base, score: 100, malicious: true };
    if (shape === "mixed" && weighted && i % 3 === 0) return { ...base, score: 55 };
    if (shape === "vouched" && ["tranco", "scanner-id"].includes(s.meta.id)) return { ...base, allowlisted: true };
    return base;
  });
}

describe("bulk scores match /check", () => {
  for (const kind of ["ip", "domain"] as const) {
    for (const shape of ["listed", "mixed", "quiet", "vouched"] as const) {
      it(`${kind}, ${shape}`, () => {
        const full = fixture(kind, shape);
        const ids = new Set(registryFor(kind).filter(inBulkProfile).map((s) => s.meta.id));
        expect(aggregateRisk(full.filter((r) => ids.has(r.source.id)))).toEqual(aggregateRisk(full));
      });
    }
  }
});
```

- [ ] **Step 2: Run to see them fail**

Run: `bun run test lib/ti/bulk/classify.test.ts lib/ti/bulk/invariant.test.ts`
Expected: classify FAIL with a missing module. The invariant may already pass, because it only uses Task 1.

- [ ] **Step 3: Implement `lib/ti/bulk/classify.ts`**

```ts
import { aggregateRisk } from "../aggregate";
import type { SourceResult, Verdict } from "../types";
import type { Bucket } from "./types";

export interface Classified {
  bucket: Bucket;
  riskScore: number;
  verdict: Verdict;
  vouchedBy?: string;
}

const isOk = (r: SourceResult) => r.status === "ok";

/** Tranco's bulk-lane parent match (Task 16). It is bucketing only: it is not
 *  `allowlisted`, so it never reaches aggregateRisk's floor gate. */
function parentOf(r: SourceResult): string | undefined {
  const pv = r.details?.parentVouch as { parent?: unknown } | undefined;
  return typeof pv?.parent === "string" ? pv.parent : undefined;
}

function voucherOf(results: SourceResult[]): string | undefined {
  for (const r of results) {
    if (!isOk(r)) continue;
    if (r.allowlisted === true) return r.source.id;
    const parent = parentOf(r);
    if (parent) return `${r.source.id}, via ${parent}`;
  }
  return undefined;
}

/** Order matters: a floor beats a vouch, and a vouch only counts with no
 *  malicious listing. */
export function classify(results: SourceResult[]): Classified {
  const { riskScore, verdict, breakdown } = aggregateRisk(results);
  const base = { riskScore, verdict };
  if (breakdown.floorApplied) return { ...base, bucket: "A" };

  const listed = results.some((r) => isOk(r) && r.malicious === true);
  const vouchedBy = voucherOf(results);
  if (vouchedBy && !listed) return { ...base, bucket: "D", vouchedBy };

  const quiet = verdict === "clean" || verdict === "unknown";
  const settled = !breakdown.borderline && !breakdown.uncorroborated;
  return { ...base, bucket: quiet && settled ? "C" : "B" };
}
```

- [ ] **Step 4: Run both**

Run: `bun run test lib/ti/bulk/classify.test.ts lib/ti/bulk/invariant.test.ts`
Expected: PASS. If the invariant fails, `aggregateRisk` reads something from a weight-0 source other than `allowlisted`. **Stop and report it to the coordinator**, because the spec's exclusion rule would be wrong.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/bulk/classify.ts lib/ti/bulk/classify.test.ts lib/ti/bulk/invariant.test.ts
git commit -m "feat(bulk): bucket classifier and score invariant against /check"
```

---

### Task 3: API keys per lane

**Files:**
- Create: `lib/ti/keys.ts`
- Test: `lib/ti/keys.test.ts`
- Modify: `lib/ti/sources/virustotal.ts:70-72`, `lib/ti/sources/abuseipdb.ts:141-143`, `lib/ti/sources/greynoise.ts:96-98`, `lib/ti/sources/otx.ts:57-59`, `lib/ti/domain/sources/virustotal.ts:281-283`, `lib/ti/domain/sources/safebrowsing.ts:42,101`
- Modify: `.env.example`

**Interfaces:**
- Produces: `type Lane = "check" | "bulk" | "scan"`, `withLane<T>(lane, fn: () => Promise<T>): Promise<T>`, `currentLane(): Lane`, `apiKey(keyEnv: string | undefined, lane?: Lane): string | undefined`, `hasOwnKey(keyEnv: string, lane: Lane): boolean`, `keyFingerprint(key: string): string`.

- [ ] **Step 1: Write the failing tests**

```ts
import { afterEach, describe, expect, it } from "vitest";
import { apiKey, currentLane, hasOwnKey, keyFingerprint, withLane } from "./keys";

afterEach(() => {
  delete process.env.TEST_KEY;
  delete process.env.TEST_KEY_BULK;
});

describe("lanes and keys", () => {
  it("defaults to the check lane", () => {
    expect(currentLane()).toBe("check");
  });

  it("prefers the lane's own key, then the shared one", async () => {
    process.env.TEST_KEY = "shared";
    expect(apiKey("TEST_KEY")).toBe("shared");
    await withLane("bulk", async () => {
      expect(currentLane()).toBe("bulk");
      expect(apiKey("TEST_KEY")).toBe("shared");
      process.env.TEST_KEY_BULK = " own ";
      expect(apiKey("TEST_KEY")).toBe("own");
      expect(hasOwnKey("TEST_KEY", "bulk")).toBe(true);
    });
    expect(apiKey("TEST_KEY")).toBe("shared");
    expect(hasOwnKey("TEST_KEY", "check")).toBe(false);
  });

  it("treats blanks and a missing env name as unset", () => {
    process.env.TEST_KEY = "  ";
    expect(apiKey("TEST_KEY")).toBeUndefined();
    expect(apiKey(undefined)).toBeUndefined();
  });

  it("fingerprints without revealing the key", () => {
    expect(keyFingerprint("abc")).toBe("ba7816bf");
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `bun run test lib/ti/keys.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement `lib/ti/keys.ts`**

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

/**
 * Which part of the app is asking. Each lane can carry its own API key
 * (`<KEY_ENV>_<LANE>`), so bulk lookups can spend a separate free-tier quota
 * from /check's. With no lane set, the lane is `check`, so the single-lookup
 * path needs no change.
 */
export type Lane = "check" | "bulk" | "scan";

const store = new AsyncLocalStorage<Lane>();

export function withLane<T>(lane: Lane, fn: () => Promise<T>): Promise<T> {
  return store.run(lane, fn);
}

export function currentLane(): Lane {
  return store.getStore() ?? "check";
}

const read = (name: string) => process.env[name]?.trim() || undefined;

export function hasOwnKey(keyEnv: string, lane: Lane): boolean {
  return Boolean(read(`${keyEnv}_${lane.toUpperCase()}`));
}

export function apiKey(keyEnv: string | undefined, lane: Lane = currentLane()): string | undefined {
  if (!keyEnv) return undefined;
  return read(`${keyEnv}_${lane.toUpperCase()}`) ?? read(keyEnv);
}

/** Enough to tell keys apart in Redis, never enough to use one. */
export function keyFingerprint(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}
```

- [ ] **Step 4: Migrate the six adapters**

In each file, import `apiKey` and replace both reads. For example, `lib/ti/sources/virustotal.ts`:

```ts
import { apiKey } from "../keys";
// ...
  isEnabled: () => Boolean(apiKey("VIRUSTOTAL_API_KEY")),
  async check(ip, signal) {
    const key = apiKey("VIRUSTOTAL_API_KEY");
```

Do the same with `ABUSEIPDB_API_KEY` (`sources/abuseipdb.ts`), `GREYNOISE_API_KEY` (`sources/greynoise.ts`), `OTX_API_KEY` (`sources/otx.ts`), `VIRUSTOTAL_API_KEY` (`domain/sources/virustotal.ts`, import from `"../../keys"`), and `GOOGLE_SAFE_BROWSING_API_KEY` (`domain/sources/safebrowsing.ts`, both line 42 and line 101). Leave every other adapter alone.

Add to each of those six adapters' existing test file one case proving the lane is honoured. For `lib/ti/sources/virustotal.test.ts` (mirror the file's existing fetch mock):

```ts
it("uses the bulk key inside the bulk lane", async () => {
  process.env.VIRUSTOTAL_API_KEY = "shared";
  process.env.VIRUSTOTAL_API_KEY_BULK = "own";
  await withLane("bulk", () => virusTotalSource.check("1.2.3.4", AbortSignal.timeout(1000)));
  expect(fetchMock.mock.calls[0][1].headers["x-apikey"]).toBe("own");
  delete process.env.VIRUSTOTAL_API_KEY_BULK;
});
```

Adjust the header name and mock variable to whatever each test file already uses.

- [ ] **Step 5: `.env.example`**

Under each of the five metered keys, add an empty line for its bulk key, with this comment once above the first:

```
# Optional second key for bulk lookups only (lib/ti/keys.ts). With it, bulk
# spends its own free-tier quota and never touches /check's. Check the
# provider's terms before creating a second account.
VIRUSTOTAL_API_KEY_BULK=
```

…and the same pattern for `ABUSEIPDB_API_KEY_BULK`, `OTX_API_KEY_BULK`, `GREYNOISE_API_KEY_BULK` and `GOOGLE_SAFE_BROWSING_API_KEY_BULK`.

- [ ] **Step 6: Run everything**

Run: `bun run test lib/ti && bun run typecheck`
Expected: PASS. The `check` lane resolves to the same key as before, so no existing test should change.

- [ ] **Step 7: Commit**

```bash
git add lib/ti/keys.ts lib/ti/keys.test.ts lib/ti/sources/{virustotal,abuseipdb,greynoise,otx}.ts lib/ti/sources/{virustotal,abuseipdb,greynoise,otx}.test.ts lib/ti/domain/sources/{virustotal,safebrowsing}.ts lib/ti/domain/sources/{virustotal,safebrowsing}.test.ts .env.example
git commit -m "feat(keys): per-lane API keys, bulk can use its own quota"
```

---

### Task 4: Per-key quota ledger

**Files:**
- Create: `lib/ti/bulk/quota.ts`
- Test: `lib/ti/bulk/quota.test.ts`

**Interfaces:**
- Consumes: `getRedis` (`lib/ti/cache.ts`), Task 3 `apiKey`, `hasOwnKey`, `keyFingerprint`, Task 1 `METERED_KEY_ENVS`, `MeteredKeyEnv`.
- Produces:
  - `type Reservation = "ok" | "minute" | "spent" | "nokey" | "unavailable"`
  - `reserveBulk(keyEnv: MeteredKeyEnv, now?: Date): Promise<Reservation>`
  - `recordSpend(results: SourceResult[], now?: Date): Promise<void>`
  - `markExhausted(keyEnv: MeteredKeyEnv, lane: Lane, now?: Date): Promise<void>`
  - `isQuotaHit(r: SourceResult): boolean`, `isMeteredKeyEnv(x): x is MeteredKeyEnv`
  - `remaining(now?: Date): Promise<QuotaRemaining[] | null>`, with `interface QuotaRemaining { keyEnv: MeteredKeyEnv; own: boolean; daily: number; used: number; bulkLeft: number; exhausted: boolean }` (key envs with no key at all are omitted)
  - `limitFor(keyEnv)`, `bulkShare()`, `utcDay(now)`, `msToNextMinute(now)`

- [ ] **Step 1: Write the failing tests**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceMeta, SourceResult } from "../types";
import { keyFingerprint } from "../keys";

const store = new Map<string, number | string>();
const fake = {
  incrby: vi.fn(async (k: string, n: number) => {
    const v = Number(store.get(k) ?? 0) + n;
    store.set(k, v);
    return v;
  }),
  decrby: vi.fn(async (k: string, n: number) => {
    const v = Number(store.get(k) ?? 0) - n;
    store.set(k, v);
    return v;
  }),
  expire: vi.fn(async () => 1),
  get: vi.fn(async (k: string) => store.get(k) ?? null),
  set: vi.fn(async (k: string, v: string) => {
    store.set(k, v);
    return "OK";
  }),
  mget: vi.fn(async (...keys: string[]) => keys.map((k) => store.get(k) ?? null)),
};
let redis: typeof fake | null = fake;
vi.mock("../cache", () => ({ getRedis: () => redis }));

const q = await import("./quota");
const NOW = new Date("2026-10-07T10:00:30Z");
const D = "2026-10-07";
const VT = `ti:quota:v1:VIRUSTOTAL_API_KEY:${keyFingerprint("vt-shared")}`;
const VT_OWN = `ti:quota:v1:VIRUSTOTAL_API_KEY:${keyFingerprint("vt-own")}`;
const ABUSE = `ti:quota:v1:ABUSEIPDB_API_KEY:${keyFingerprint("ab")}`;

function result(id: string, keyEnv: string | undefined, extra: Partial<SourceResult> = {}): SourceResult {
  const meta: SourceMeta = { id, name: id, url: "", category: "reputation", requiresKey: Boolean(keyEnv), weight: 1, keyEnv };
  return { source: meta, enabled: true, durationMs: 1, status: "ok", ...extra };
}

beforeEach(() => {
  store.clear();
  redis = fake;
  vi.clearAllMocks();
  process.env.VIRUSTOTAL_API_KEY = "vt-shared";
  process.env.ABUSEIPDB_API_KEY = "ab";
});
afterEach(() => {
  for (const k of ["VIRUSTOTAL_API_KEY", "VIRUSTOTAL_API_KEY_BULK", "ABUSEIPDB_API_KEY", "TI_BULK_SHARE", "TI_QUOTA_VIRUSTOTAL_API_KEY_DAILY"]) delete process.env[k];
});

describe("limits", () => {
  it("reads env overrides and clamps the share", () => {
    process.env.TI_QUOTA_VIRUSTOTAL_API_KEY_DAILY = "20";
    expect(q.limitFor("VIRUSTOTAL_API_KEY")).toEqual({ daily: 20, perMinute: 4 });
    process.env.TI_BULK_SHARE = "7";
    expect(q.bulkShare()).toBe(1);
    process.env.TI_BULK_SHARE = "nonsense";
    expect(q.bulkShare()).toBe(0.6);
  });
  it("formats the UTC day and the next-minute wait", () => {
    expect(q.utcDay(NOW)).toBe(D);
    expect(q.msToNextMinute(NOW)).toBe(30_000);
  });
});

describe("reserveBulk", () => {
  it("reserves inside the shared key's bulk share", async () => {
    expect(await q.reserveBulk("ABUSEIPDB_API_KEY", NOW)).toBe("ok");
    expect(store.get(`${ABUSE}:day:${D}`)).toBe(1);
    expect(store.get(`${ABUSE}:bulk:${D}`)).toBe(1);
  });

  it("stops at 60% of a shared key and rolls back", async () => {
    store.set(`${VT}:bulk:${D}`, 300);
    expect(await q.reserveBulk("VIRUSTOTAL_API_KEY", NOW)).toBe("spent");
    expect(store.get(`${VT}:bulk:${D}`)).toBe(300);
  });

  it("gives an own bulk key the whole day, in its own pool", async () => {
    process.env.VIRUSTOTAL_API_KEY_BULK = "vt-own";
    store.set(`${VT_OWN}:bulk:${D}`, 300);
    store.set(`${VT_OWN}:day:${D}`, 300);
    expect(await q.reserveBulk("VIRUSTOTAL_API_KEY", NOW)).toBe("ok");
    expect(store.has(`${VT}:day:${D}`)).toBe(false);
  });

  it("never borrows the shared key when the own key is spent", async () => {
    process.env.VIRUSTOTAL_API_KEY_BULK = "vt-own";
    store.set(`${VT_OWN}:day:${D}`, 500);
    expect(await q.reserveBulk("VIRUSTOTAL_API_KEY", NOW)).toBe("spent");
    expect(store.has(`${VT}:day:${D}`)).toBe(false);
  });

  it("stops when /check has used the shared day", async () => {
    store.set(`${ABUSE}:day:${D}`, 1000);
    expect(await q.reserveBulk("ABUSEIPDB_API_KEY", NOW)).toBe("spent");
  });

  it("asks the caller to wait at the VirusTotal minute cap", async () => {
    const minuteKey = `${VT}:min:${Math.floor(NOW.getTime() / 60_000)}`;
    store.set(minuteKey, 4);
    expect(await q.reserveBulk("VIRUSTOTAL_API_KEY", NOW)).toBe("minute");
    expect(store.get(minuteKey)).toBe(4);
  });

  it("refuses an exhausted pool", async () => {
    await q.markExhausted("ABUSEIPDB_API_KEY", "bulk", NOW);
    expect(await q.reserveBulk("ABUSEIPDB_API_KEY", NOW)).toBe("spent");
  });

  it("reports nokey, and unavailable without Redis or when it throws", async () => {
    expect(await q.reserveBulk("OTX_API_KEY", NOW)).toBe("nokey");
    redis = null;
    expect(await q.reserveBulk("ABUSEIPDB_API_KEY", NOW)).toBe("unavailable");
    redis = fake;
    fake.get.mockRejectedValueOnce(new Error("down"));
    expect(await q.reserveBulk("ABUSEIPDB_API_KEY", NOW)).toBe("unavailable");
  });
});

describe("isQuotaHit", () => {
  it("matches rate_limited and 429-shaped errors only", () => {
    expect(q.isQuotaHit(result("virustotal", "VIRUSTOTAL_API_KEY", { status: "rate_limited" }))).toBe(true);
    expect(q.isQuotaHit(result("virustotal", "VIRUSTOTAL_API_KEY", { status: "error", error: "HTTP 429" }))).toBe(true);
    expect(q.isQuotaHit(result("abuseipdb", "ABUSEIPDB_API_KEY", { status: "error", error: "Daily rate limit exceeded" }))).toBe(true);
    expect(q.isQuotaHit(result("abuseipdb", "ABUSEIPDB_API_KEY", { status: "error", error: "HTTP 500" }))).toBe(false);
    expect(q.isQuotaHit(result("abuseipdb", "ABUSEIPDB_API_KEY"))).toBe(false);
  });
});

describe("recordSpend (check lane)", () => {
  it("counts metered calls by key, including a hash VirusTotal source, and marks hits", async () => {
    await q.recordSpend(
      [
        result("virustotal", "VIRUSTOTAL_API_KEY"),
        result("virustotal-sandbox", "VIRUSTOTAL_API_KEY"),
        result("abuseipdb", "ABUSEIPDB_API_KEY", { status: "rate_limited" }),
        result("greynoise", "GREYNOISE_API_KEY", { status: "skipped" }),
        result("feodo", undefined),
      ],
      NOW,
    );
    expect(store.get(`${VT}:day:${D}`)).toBe(2);
    expect(store.get(`${ABUSE}:exhausted:${D}`)).toBe("1");
    expect([...store.keys()].some((k) => k.includes("GREYNOISE"))).toBe(false);
  });

  it("skips a metered source with no key, is a no-op without Redis, and swallows errors", async () => {
    await q.recordSpend([result("otx", "OTX_API_KEY")], NOW);
    expect(store.size).toBe(0);
    redis = null;
    await expect(q.recordSpend([result("virustotal", "VIRUSTOTAL_API_KEY")], NOW)).resolves.toBeUndefined();
    redis = fake;
    fake.incrby.mockRejectedValueOnce(new Error("down"));
    await expect(q.recordSpend([result("virustotal", "VIRUSTOTAL_API_KEY")], NOW)).resolves.toBeUndefined();
  });
});

describe("remaining", () => {
  it("reports each configured pool and what bulk may still spend", async () => {
    store.set(`${VT}:day:${D}`, 100);
    store.set(`${VT}:bulk:${D}`, 40);
    const rows = await q.remaining(NOW);
    expect(rows?.find((r) => r.keyEnv === "VIRUSTOTAL_API_KEY")).toEqual({ keyEnv: "VIRUSTOTAL_API_KEY", own: false, daily: 500, used: 100, bulkLeft: 260, exhausted: false });
    expect(rows?.some((r) => r.keyEnv === "OTX_API_KEY")).toBe(false);
  });

  it("reports an own key at full share, and null without Redis", async () => {
    process.env.VIRUSTOTAL_API_KEY_BULK = "vt-own";
    expect((await q.remaining(NOW))?.find((r) => r.keyEnv === "VIRUSTOTAL_API_KEY")).toMatchObject({ own: true, bulkLeft: 500 });
    redis = null;
    expect(await q.remaining(NOW)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `bun run test lib/ti/bulk/quota.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement `lib/ti/bulk/quota.ts`**

```ts
import { getRedis } from "../cache";
import { apiKey, currentLane, hasOwnKey, keyFingerprint, type Lane } from "../keys";
import type { SourceResult } from "../types";
import { METERED_KEY_ENVS, type MeteredKeyEnv } from "./types";

export interface QuotaLimit {
  daily: number;
  perMinute?: number;
}

const DEFAULT_LIMITS: Record<MeteredKeyEnv, QuotaLimit> = {
  VIRUSTOTAL_API_KEY: { daily: 500, perMinute: 4 },
  ABUSEIPDB_API_KEY: { daily: 1000 },
  GREYNOISE_API_KEY: { daily: 50 },
  OTX_API_KEY: { daily: 5000 },
  GOOGLE_SAFE_BROWSING_API_KEY: { daily: 10000 },
};

const DEFAULT_SHARE = 0.6;
const DAY_TTL = 48 * 60 * 60;
const MINUTE_TTL = 120;

const METERED: ReadonlySet<string> = new Set(METERED_KEY_ENVS);
export function isMeteredKeyEnv(x: string | undefined): x is MeteredKeyEnv {
  return x !== undefined && METERED.has(x);
}

export function limitFor(keyEnv: MeteredKeyEnv): QuotaLimit {
  const raw = Number(process.env[`TI_QUOTA_${keyEnv}_DAILY`]);
  const base = DEFAULT_LIMITS[keyEnv];
  return Number.isFinite(raw) && raw > 0 ? { ...base, daily: Math.floor(raw) } : base;
}

export function bulkShare(): number {
  const raw = Number(process.env.TI_BULK_SHARE);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_SHARE;
  return Math.min(raw, 1);
}

export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function msToNextMinute(now: Date = new Date()): number {
  return 60_000 - (now.getTime() % 60_000);
}

/** One pool per key: the same VirusTotal key serves VT ip, domain, hash and
 *  sandbox, and a bulk-only key is a separate account with its own quota. */
function poolOf(keyEnv: MeteredKeyEnv, lane: Lane): string | null {
  const key = apiKey(keyEnv, lane);
  return key ? `ti:quota:v1:${keyEnv}:${keyFingerprint(key)}` : null;
}

const dayKey = (pool: string, day: string) => `${pool}:day:${day}`;
const bulkKey = (pool: string, day: string) => `${pool}:bulk:${day}`;
const exhaustedKey = (pool: string, day: string) => `${pool}:exhausted:${day}`;
const minuteKey = (pool: string, now: Date) => `${pool}:min:${Math.floor(now.getTime() / 60_000)}`;

const QUOTA_TEXT = /\b429\b|quota|rate.?limit|limit exceeded/i;

/** Only GreyNoise maps 429 to `rate_limited` today, so the message match
 *  catches the others. */
export function isQuotaHit(r: SourceResult): boolean {
  if (r.status === "rate_limited") return true;
  return r.status === "error" && QUOTA_TEXT.test(r.error ?? "");
}

function allowance(keyEnv: MeteredKeyEnv): number {
  const { daily } = limitFor(keyEnv);
  return hasOwnKey(keyEnv, "bulk") ? daily : Math.floor(daily * bulkShare());
}

export type Reservation = "ok" | "minute" | "spent" | "nokey" | "unavailable";

/** Take one call of bulk's allowance on this key. Never borrows another pool. */
export async function reserveBulk(keyEnv: MeteredKeyEnv, now: Date = new Date()): Promise<Reservation> {
  const pool = poolOf(keyEnv, "bulk");
  if (!pool) return "nokey";
  const redis = getRedis();
  if (!redis) return "unavailable";
  const day = utcDay(now);
  const limit = limitFor(keyEnv);
  try {
    if (await redis.get(exhaustedKey(pool, day))) return "spent";
    const keys = [dayKey(pool, day), bulkKey(pool, day)];
    if (limit.perMinute) keys.push(minuteKey(pool, now));
    const [used, bulkUsed, minuteUsed] = await Promise.all(keys.map((k) => redis.incrby(k, 1)));
    await Promise.all(keys.map((k, i) => redis.expire(k, i === 2 ? MINUTE_TTL : DAY_TTL)));
    const overDay = used > limit.daily || bulkUsed > allowance(keyEnv);
    const overMinute = limit.perMinute !== undefined && minuteUsed > limit.perMinute;
    if (!overDay && !overMinute) return "ok";
    await Promise.all(keys.map((k) => redis.decrby(k, 1)));
    return overDay ? "spent" : "minute";
  } catch (err) {
    console.error("[bulk] quota reserve failed:", err);
    return "unavailable";
  }
}

export async function markExhausted(keyEnv: MeteredKeyEnv, lane: Lane, now: Date = new Date()): Promise<void> {
  const pool = poolOf(keyEnv, lane);
  const redis = getRedis();
  if (!pool || !redis) return;
  try {
    await redis.set(exhaustedKey(pool, utcDay(now)), "1", { ex: DAY_TTL });
  } catch (err) {
    console.error("[bulk] quota mark failed:", err);
  }
}

/** /check's side of the ledger: count what its fan-out spent. Never gates. */
export async function recordSpend(results: SourceResult[], now: Date = new Date()): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const lane = currentLane();
  const day = utcDay(now);
  try {
    for (const r of results) {
      const keyEnv = r.source.keyEnv;
      if (!isMeteredKeyEnv(keyEnv) || r.status === "skipped") continue;
      const pool = poolOf(keyEnv, lane);
      if (!pool) continue;
      await redis.incrby(dayKey(pool, day), 1);
      await redis.expire(dayKey(pool, day), DAY_TTL);
      if (limitFor(keyEnv).perMinute) {
        await redis.incrby(minuteKey(pool, now), 1);
        await redis.expire(minuteKey(pool, now), MINUTE_TTL);
      }
      if (isQuotaHit(r)) await markExhausted(keyEnv, lane, now);
    }
  } catch (err) {
    console.error("[bulk] quota record failed:", err);
  }
}

export interface QuotaRemaining {
  keyEnv: MeteredKeyEnv;
  /** True when bulk has its own key for this source. */
  own: boolean;
  daily: number;
  used: number;
  bulkLeft: number;
  exhausted: boolean;
}

export async function remaining(now: Date = new Date()): Promise<QuotaRemaining[] | null> {
  const redis = getRedis();
  if (!redis) return null;
  const day = utcDay(now);
  const pools = METERED_KEY_ENVS.flatMap((keyEnv) => {
    const pool = poolOf(keyEnv, "bulk");
    return pool ? [{ keyEnv, pool }] : [];
  });
  if (pools.length === 0) return [];
  const values = await redis.mget<(string | number | null)[]>(
    ...pools.flatMap(({ pool }) => [dayKey(pool, day), bulkKey(pool, day), exhaustedKey(pool, day)]),
  );
  return pools.map(({ keyEnv }, i) => {
    const { daily } = limitFor(keyEnv);
    const used = Number(values[i * 3] ?? 0);
    const bulkUsed = Number(values[i * 3 + 1] ?? 0);
    const bulkLeft = Math.max(0, Math.min(allowance(keyEnv) - bulkUsed, daily - used));
    return { keyEnv, own: hasOwnKey(keyEnv, "bulk"), daily, used, bulkLeft, exhausted: Boolean(values[i * 3 + 2]) };
  });
}
```

- [ ] **Step 4: Run tests and coverage**

Run: `bun run test lib/ti/bulk/quota.test.ts && bun run coverage && node scripts/coverage-gaps.mjs lib/ti/bulk/quota.ts`
Expected: PASS, no gaps. The `pools.length === 0` branch needs one more case: unset both keys, then expect `[]`.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/bulk/quota.ts lib/ti/bulk/quota.test.ts
git commit -m "feat(bulk): per-key quota ledger shared with /check"
```

---

### Task 5: Record /check's metered spend (IP, domain and hash)

**Files:**
- Modify: `lib/ti/check.ts`, `lib/ti/domain/check.ts`, `lib/ti/hash/check.ts`
- Test: add one case to each of `lib/ti/check.test.ts`, `lib/ti/domain/check.test.ts` and `lib/ti/hash/check.test.ts` (create the file if absent, mirroring `lib/ti/check.test.ts`'s mocking)

**Interfaces:**
- Consumes: Task 4 `recordSpend`.

- [ ] **Step 1: Write the failing tests** (one per file, shown for IP)

```ts
import * as quota from "@/lib/ti/bulk/quota";

it("reports metered spend to the quota ledger", async () => {
  const spy = vi.spyOn(quota, "recordSpend").mockResolvedValue();
  const result = await checkIp("8.8.8.8");
  expect(spy).toHaveBeenCalledWith(result.sources);
});
```

For hash, assert `toHaveBeenCalledWith(expect.arrayContaining([]))` was called once, since the hash result post-processes its sources.

- [ ] **Step 2: Run to see them fail**

Run: `bun run test lib/ti/check.test.ts lib/ti/domain lib/ti/hash/check.test.ts`
Expected: FAIL, spy not called.

- [ ] **Step 3: Implement** after each `runAll` (inside `withRequestMemo`'s result, before assembling):

```ts
import { recordSpend } from "./bulk/quota"; // "../bulk/quota" in domain/ and hash/
// ...
  // Bulk lookup budgets each metered key against what /check already spent
  // today. Fire and forget: the ledger must never slow or fail a lookup.
  void recordSpend(results);
```

Use the array that is passed to the assembler (in `checkIp`, the registry-ordered array).

- [ ] **Step 4: Run tests**

Run: `bun run test lib/ti`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/check.ts lib/ti/domain/check.ts lib/ti/hash/check.ts lib/ti/check.test.ts lib/ti/domain/check.test.ts lib/ti/hash/check.test.ts
git commit -m "feat(bulk): /check reports metered spend to the quota ledger"
```

---

### Task 6: Internal names and input parsing

**Files:**
- Create: `lib/ti/bulk/internal.ts`, `lib/ti/bulk/parse.ts`
- Test: `lib/ti/bulk/internal.test.ts`, `lib/ti/bulk/parse.test.ts`

**Interfaces:**
- Consumes: `refangIOC`, `detectIOC`, `parseIP`, `parseDomain`, `domainToASCII` (`node:url`), Task 1 types.
- Produces: `isInternalName(domain: string): boolean`; `WEB_CAP = 1000`; `interface BulkItem { indicator: string; kind: BulkKind; display?: string; note?: string; internal?: boolean }`; `interface ParsedBulk { items: BulkItem[]; invalid: InvalidInput[]; duplicates: number }`; `parseBulkInput(text: string): ParsedBulk`; `invalidSummary(invalid: InvalidInput[]): Record<string, number>`.

- [ ] **Step 1: Write the failing tests**

`lib/ti/bulk/internal.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { isInternalName } from "./internal";

afterEach(() => delete process.env.TI_INTERNAL_SUFFIXES);

describe("isInternalName", () => {
  it("matches a configured suffix on a label boundary, any case", () => {
    process.env.TI_INTERNAL_SUFFIXES = " dc01.fujixerox.net , corp.example.co.th";
    expect(isInternalName("sgpaphq-addc04.dc01.fujixerox.net")).toBe(true);
    expect(isInternalName("DC01.FUJIXEROX.NET")).toBe(true);
    expect(isInternalName("fujixerox.net")).toBe(false);
    expect(isInternalName("evildc01.fujixerox.net")).toBe(false);
  });
  it("treats single labels and internal-use TLDs as internal", () => {
    expect(isInternalName("fileserver01")).toBe(true);
    expect(isInternalName("nas.lan")).toBe(true);
    expect(isInternalName("printer.home.arpa")).toBe(true);
    expect(isInternalName("evil.com")).toBe(false);
  });
});
```

`lib/ti/bulk/parse.test.ts`. Every case comes from the real files (spec, *What the real input looks like*):

```ts
import { afterEach, describe, expect, it } from "vitest";
import { invalidSummary, parseBulkInput } from "./parse";

afterEach(() => delete process.env.TI_INTERNAL_SUFFIXES);

describe("parseBulkInput", () => {
  it("handles CRLF, trailing spaces, separators and refang", () => {
    const r = parseBulkInput("1.1.1.1 \r\nevil[.]com, 8.8.8.8;\r\n");
    expect(r.items.map((i) => i.indicator)).toEqual(["1.1.1.1", "evil.com", "8.8.8.8"]);
  });

  it("collapses case variants", () => {
    const r = parseBulkInput("Gvaq70s7he.ru \ngvaq70s7he.ru");
    expect(r.items).toEqual([{ indicator: "gvaq70s7he.ru", kind: "domain" }]);
    expect(r.duplicates).toBe(1);
  });

  it("converts a Thai IDN to punycode, keeps the display form, and dedupes it", () => {
    const r = parseBulkInput("หีหอม.com\nxn--y3ctai2b.com");
    expect(r.items).toEqual([{ indicator: "xn--y3ctai2b.com", kind: "domain", display: "หีหอม.com" }]);
    expect(r.duplicates).toBe(1);
  });

  it("reads leading zeros as decimal, with a note", () => {
    expect(parseBulkInput("15.03.05.16").items).toEqual([
      { indicator: "15.3.5.16", kind: "ip", note: "Read as 15.3.5.16, written with leading zeros" },
    ]);
  });

  it("marks internal names, configured and single-label", () => {
    process.env.TI_INTERNAL_SUFFIXES = "dc01.fujixerox.net";
    const r = parseBulkInput("SGPAPHQ-ADDC04.dc01.fujixerox.net fileserver01");
    expect(r.items).toEqual([
      { indicator: "sgpaphq-addc04.dc01.fujixerox.net", kind: "domain", internal: true },
      { indicator: "fileserver01", kind: "domain", internal: true },
    ]);
  });

  it("refuses CIDR, hashes, URLs, non-routable IPs, special-use names and junk, with reasons", () => {
    const r = parseBulkInput("216.126.237.0/24 d41d8cd98f00b204e9800998ecf8427e hxxps://bad.example.org/x 10.0.0.1 foo.test ???");
    expect(r.items).toEqual([]);
    expect(r.invalid.map((i) => i.reason)).toEqual([
      "CIDR range, not expanded",
      "Not supported in bulk, hash",
      "Not supported in bulk, url",
      expect.stringMatching(/^Non-routable address, /),
      expect.stringMatching(/^Special-use domain, /),
      "Not an IP or domain",
    ]);
  });

  it("keeps IPv6 and returns nothing for blank input", () => {
    expect(parseBulkInput("2001:4860:4860::8888").items[0]).toMatchObject({ kind: "ip" });
    expect(parseBulkInput("  \r\n ")).toEqual({ items: [], invalid: [], duplicates: 0 });
  });
});

describe("invalidSummary", () => {
  it("groups by the reason's head", () => {
    expect(
      invalidSummary([
        { input: "a", reason: "Non-routable address, private" },
        { input: "b", reason: "Non-routable address, loopback" },
        { input: "c", reason: "CIDR range, not expanded" },
      ]),
    ).toEqual({ "Non-routable address": 2, "CIDR range": 1 });
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `bun run test lib/ti/bulk/internal.test.ts lib/ti/bulk/parse.test.ts`
Expected: FAIL, modules missing.

- [ ] **Step 3: Implement `lib/ti/bulk/internal.ts`**

```ts
const INTERNAL_TLDS = ["internal", "corp", "lan", "intranet", "home.arpa"];

function configured(): string[] {
  return (process.env.TI_INTERNAL_SUFFIXES ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase().replace(/^\./, ""))
    .filter(Boolean);
}

const under = (name: string, suffix: string) => name === suffix || name.endsWith(`.${suffix}`);

/** A name that belongs to the analyst's own network. Bulk never sends one out:
 *  an AD hostname handed to VirusTotal is a leak of internal infrastructure. */
export function isInternalName(domain: string): boolean {
  const name = domain.toLowerCase();
  if (!name.includes(".")) return true;
  return [...configured(), ...INTERNAL_TLDS].some((suffix) => under(name, suffix));
}
```

- [ ] **Step 4: Implement `lib/ti/bulk/parse.ts`**

```ts
import { domainToASCII } from "node:url";
import { detectIOC, refangIOC } from "@/lib/ioc";
import { parseIP } from "@/lib/ip";
import { parseDomain } from "@/lib/domain";
import { isInternalName } from "./internal";
import type { BulkKind, InvalidInput } from "./types";

export const WEB_CAP = 1000;

export interface BulkItem {
  indicator: string;
  kind: BulkKind;
  display?: string;
  note?: string;
  internal?: boolean;
}

export interface ParsedBulk {
  items: BulkItem[];
  invalid: InvalidInput[];
  duplicates: number;
}

type Checked = { item: BulkItem } | { reason: string };

const CIDR = /^[0-9a-f:.]+\/\d{1,3}$/i;
const SINGLE_LABEL = /^[a-z][a-z0-9-]*$/i;
const LEADING_ZERO = /(^|\.)0\d/;

function toAscii(value: string): string {
  return /[^\x00-\x7f]/.test(value) ? domainToASCII(value.toLowerCase()) : value;
}

function checkIp(value: string): Checked {
  const ip = parseIP(value);
  if (!ip || ip.isPrivate || ip.isReserved) return { reason: `Non-routable address, ${ip?.scopeNote ?? "reserved"}` };
  const item: BulkItem = { indicator: ip.ip, kind: "ip" };
  if (LEADING_ZERO.test(value)) item.note = `Read as ${ip.ip}, written with leading zeros`;
  return { item };
}

function checkDomain(value: string, original: string): Checked {
  const d = parseDomain(value);
  if (!d || d.isReserved) return { reason: `Special-use domain, ${d?.scopeNote ?? "reserved"}` };
  const item: BulkItem = { indicator: d.domain, kind: "domain" };
  if (original !== value) item.display = original;
  if (isInternalName(d.domain)) item.internal = true;
  return { item };
}

function check(token: string): Checked {
  const refanged = refangIOC(token);
  if (CIDR.test(refanged)) return { reason: "CIDR range, not expanded" };
  const value = toAscii(refanged);
  const kind = value ? detectIOC(value) : null;
  if (kind === "hash" || kind === "url") return { reason: `Not supported in bulk, ${kind}` };
  if (kind === "ip") return checkIp(value);
  if (kind === "domain") return checkDomain(value, refanged);
  if (SINGLE_LABEL.test(value)) return { item: { indicator: value.toLowerCase(), kind: "domain", internal: true } };
  return { reason: "Not an IP or domain" };
}

export function parseBulkInput(text: string): ParsedBulk {
  const out: ParsedBulk = { items: [], invalid: [], duplicates: 0 };
  const seen = new Set<string>();
  for (const token of text.split(/[\s,;]+/).filter(Boolean)) {
    const checked = check(token);
    if ("reason" in checked) {
      out.invalid.push({ input: token, reason: checked.reason });
      continue;
    }
    const key = `${checked.item.kind}:${checked.item.indicator.toLowerCase()}`;
    if (seen.has(key)) {
      out.duplicates++;
      continue;
    }
    seen.add(key);
    out.items.push(checked.item);
  }
  return out;
}

export function invalidSummary(invalid: InvalidInput[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { reason } of invalid) {
    const head = reason.split(",")[0];
    out[head] = (out[head] ?? 0) + 1;
  }
  return out;
}
```

- [ ] **Step 5: Run the tests**

Run: `bun run test lib/ti/bulk/internal.test.ts lib/ti/bulk/parse.test.ts`
Expected: PASS. If `parseDomain("xn--y3ctai2b.com").domain` or the leading-zero canonical form differs from what is expected here, check it against `lib/domain.test.ts` and `lib/ip.test.ts` and fix the expectation. The 2026-10-07 probe gave `15.3.5.16` and `xn--y3ctai2b.com`.

- [ ] **Step 6: Commit**

```bash
git add lib/ti/bulk/internal.ts lib/ti/bulk/internal.test.ts lib/ti/bulk/parse.ts lib/ti/bulk/parse.test.ts
git commit -m "feat(bulk): parse real-world input, internal names never leave"
```

---

### Task 7: Pass 0, local-feed screening

**Files:**
- Create: `lib/ti/bulk/pass0.ts`
- Test: `lib/ti/bulk/pass0.test.ts`

**Interfaces:**
- Consumes: `runAll`, `aggregateRisk`, Task 1 `pass0Sources`, `familyOf`, `BulkRow`.
- Produces: `STRONG_SCORE = 30`; `interface Pass0Summary { riskScore: number; verdict: Verdict; listedBy: string[]; strong: boolean }`; `summarizePass0(results): Pass0Summary`; `runPass0(ip: string): Promise<Pass0Summary>`; `settlePass0(row: BulkRow, s: Pass0Summary, includeWeak: boolean): BulkRow | null` (a finished `feed-only` row, or null to escalate).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi } from "vitest";
import type { SourceMeta, SourceResult } from "../types";

const runAll = vi.fn();
vi.mock("../orchestrate", () => ({ runAll: (...a: unknown[]) => runAll(...a) }));
const p = await import("./pass0");

function res(id: string, weight: number, extra: Partial<SourceResult> = {}): SourceResult {
  const meta: SourceMeta = { id, name: id, url: "", category: "blocklist", requiresKey: false, weight };
  return { source: meta, enabled: true, durationMs: 1, status: "ok", score: 0, ...extra };
}
const row = { id: 7, indicator: "1.2.3.4", kind: "ip" as const, state: "pending" as const, results: [], pending: [], missing: [] };

describe("pass 0", () => {
  it("calls a malicious listing or ipsum level 3 strong", () => {
    expect(p.summarizePass0([res("feodo", 1, { score: 100, malicious: true })])).toMatchObject({ strong: true, listedBy: ["feodo"] });
    expect(p.summarizePass0([res("ipsum", 0.7, { score: 30 })]).strong).toBe(true);
  });

  it("calls ipsum level 1 or 2 weak, and nothing none", () => {
    expect(p.summarizePass0([res("ipsum", 0.7, { score: 20 })])).toMatchObject({ strong: false, listedBy: ["ipsum"] });
    expect(p.summarizePass0([res("ipsum", 0.7), { ...res("feodo", 1), status: "error" }])).toMatchObject({ strong: false, listedBy: [] });
  });

  it("runs only the pass 0 feeds for the IP's family", async () => {
    runAll.mockResolvedValue([]);
    await p.runPass0("2001:4860:4860::8888");
    expect(runAll.mock.calls[0][0].map((s: { meta: SourceMeta }) => s.meta.id)).toEqual(["spamhaus-drop"]);
  });

  it("settles rows that do not escalate", () => {
    const none = { riskScore: 0, verdict: "clean" as const, listedBy: [], strong: false };
    const weak = { riskScore: 14, verdict: "clean" as const, listedBy: ["ipsum"], strong: false };
    const strong = { riskScore: 75, verdict: "malicious" as const, listedBy: ["spamhaus-drop"], strong: true };
    expect(p.settlePass0(row, none, false)).toMatchObject({ id: 7, state: "feed-only", note: "Not in feeds, unchecked", verdict: undefined });
    expect(p.settlePass0(row, weak, false)).toMatchObject({ state: "feed-only", note: "Weak listing (ipsum), unchecked", listedBy: ["ipsum"] });
    expect(p.settlePass0(row, weak, true)).toBeNull();
    expect(p.settlePass0(row, strong, false)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `bun run test lib/ti/bulk/pass0.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement `lib/ti/bulk/pass0.ts`**

```ts
import { aggregateRisk } from "../aggregate";
import { runAll } from "../orchestrate";
import type { SourceResult, Verdict } from "../types";
import { familyOf, pass0Sources } from "./profile";
import type { BulkRow } from "./types";

/** ipsum scores 10 per list, so 30 is "on three or more blocklists". */
export const STRONG_SCORE = 30;

export interface Pass0Summary {
  riskScore: number;
  verdict: Verdict;
  listedBy: string[];
  strong: boolean;
}

const listed = (r: SourceResult) => r.status === "ok" && (r.malicious === true || (r.score ?? 0) > 0);
const strongHit = (r: SourceResult) => r.status === "ok" && (r.malicious === true || (r.score ?? 0) >= STRONG_SCORE);

/** Compact on purpose: a 419k-IP run keeps one of these per IP, not the results. */
export function summarizePass0(results: SourceResult[]): Pass0Summary {
  const { riskScore, verdict } = aggregateRisk(results);
  return {
    riskScore,
    verdict,
    listedBy: results.filter(listed).map((r) => r.source.id),
    strong: results.some(strongHit),
  };
}

/** The feed loaders cache at module level, so after the first IP every call
 *  is an in-memory lookup. */
export async function runPass0(ip: string): Promise<Pass0Summary> {
  return summarizePass0(await runAll(pass0Sources(familyOf("ip", ip)), ip));
}

/** Large runs stop here unless the hit is strong (or weak, with --include-weak).
 *  A row that stops gets no verdict: being absent from four feeds is not clean. */
export function settlePass0(row: BulkRow, s: Pass0Summary, includeWeak: boolean): BulkRow | null {
  const weak = s.listedBy.length > 0;
  if (s.strong || (weak && includeWeak)) return null;
  return {
    ...row,
    state: "feed-only",
    listedBy: s.listedBy,
    note: weak ? `Weak listing (${s.listedBy.join(", ")}), unchecked` : "Not in feeds, unchecked",
    checkedAt: new Date().toISOString(),
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `bun run test lib/ti/bulk/pass0.test.ts`
Expected: PASS.

- [ ] **Step 5: Measure on the real file (no commit of data)**

```bash
cat > /tmp/claude-1000/pass0-probe.ts <<'EOF'
import { readFileSync } from "node:fs";
import { parseBulkInput } from "@/lib/ti/bulk/parse";
import { runPass0 } from "@/lib/ti/bulk/pass0";
const items = parseBulkInput(readFileSync(process.argv[2], "utf8")).items.filter((i) => i.kind === "ip");
const t = Date.now();
let strong = 0, weak = 0;
for (let i = 0; i < items.length; i += 2000) {
  const out = await Promise.all(items.slice(i, i + 2000).map((it) => runPass0(it.indicator)));
  for (const s of out) s.strong ? strong++ : s.listedBy.length && weak++;
}
console.log({ ips: items.length, strong, weak, seconds: (Date.now() - t) / 1000 });
EOF
cp /tmp/claude-1000/pass0-probe.ts ./.pass0-probe.ts && bun ./.pass0-probe.ts /home/siriwat-dev-debian/.claude/uploads/9e7ae34d-339c-4cc6-9adc-60eab9bf2ffc/e330a2cf-IPSVI.txt; rm -f ./.pass0-probe.ts
```

Expected: about 423k IPs, strong close to 11,444, and runtime in seconds to a few minutes. Report the numbers to the coordinator. If runtime is over 10 minutes, profile `matchDrop` (linear over about 1,661 blocks) and report before optimising.

- [ ] **Step 6: Commit**

```bash
git add lib/ti/bulk/pass0.ts lib/ti/bulk/pass0.test.ts
git commit -m "feat(bulk): pass 0 screens large runs against local feeds"
```

---

### Task 8: Freshness rule and row cache

**Files:**
- Create: `lib/ti/bulk/row-cache.ts`
- Test: `lib/ti/bulk/row-cache.test.ts`

**Interfaces:**
- Consumes: `getRedis`, `getCachedResultFor` (`lib/ti/cache.ts`), Task 1 types.
- Produces: `isFresh(verdict, checkedAt, now?)`, `readSharedFull(kind, indicator, now?)` returning `{ results, riskScore, verdict, checkedAt } | null`, `readBulkRow(kind, indicator, now?)` (fresh only), `readBulkRowAny(kind, indicator)` (any age, for resuming a run), `writeBulkRow(row: BulkRow)`.

- [ ] **Step 1: Write the failing tests**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BulkRow } from "./types";

const kv = new Map<string, unknown>();
const fake = {
  get: vi.fn(async (k: string) => kv.get(k) ?? null),
  set: vi.fn(async (k: string, v: unknown, _o: { ex: number }) => {
    kv.set(k, v);
    return "OK";
  }),
};
let redis: typeof fake | null = fake;
const shared = vi.fn();
vi.mock("../cache", () => ({ getRedis: () => redis, getCachedResultFor: (...a: unknown[]) => shared(...a) }));

const rc = await import("./row-cache");
const NOW = new Date("2026-10-07T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const row = (over: Partial<BulkRow>): BulkRow => ({ id: 0, indicator: "1.2.3.4", kind: "ip", state: "full", results: [], pending: [], missing: [], ...over });

beforeEach(() => {
  kv.clear();
  redis = fake;
  shared.mockReset();
  fake.set.mockClear();
});

describe("isFresh", () => {
  it("gives bad verdicts 24h and the rest 7 days", () => {
    expect(rc.isFresh("malicious", hoursAgo(23), NOW)).toBe(true);
    expect(rc.isFresh("suspicious", hoursAgo(25), NOW)).toBe(false);
    expect(rc.isFresh("clean", hoursAgo(24 * 6), NOW)).toBe(true);
    expect(rc.isFresh("low", hoursAgo(24 * 8), NOW)).toBe(false);
  });
});

describe("readSharedFull", () => {
  it("returns a fresh /check result and drops a stale one or a miss", async () => {
    shared.mockResolvedValueOnce({ sources: [], riskScore: 80, verdict: "malicious", checkedAt: hoursAgo(2) });
    expect(await rc.readSharedFull("ip", "1.2.3.4", NOW)).toMatchObject({ riskScore: 80 });
    shared.mockResolvedValueOnce({ sources: [], riskScore: 80, verdict: "malicious", checkedAt: hoursAgo(30) });
    expect(await rc.readSharedFull("ip", "1.2.3.4", NOW)).toBeNull();
    shared.mockResolvedValueOnce(null);
    expect(await rc.readSharedFull("domain", "x.com", NOW)).toBeNull();
  });
});

describe("bulk row cache", () => {
  it("keeps unfinished rows 24h, clean full rows 7 days, bad rows 24h", async () => {
    await rc.writeBulkRow(row({ state: "partial", verdict: "clean" }));
    await rc.writeBulkRow(row({ state: "pass1", verdict: "clean" }));
    await rc.writeBulkRow(row({ state: "full", verdict: "clean" }));
    await rc.writeBulkRow(row({ state: "full", verdict: "malicious" }));
    expect(fake.set.mock.calls.map((c) => c[2].ex)).toEqual([86_400, 86_400, 604_800, 86_400]);
  });

  it("reads back fresh rows only, and any row for resuming", async () => {
    await rc.writeBulkRow(row({ verdict: "clean", checkedAt: hoursAgo(1) }));
    expect(await rc.readBulkRow("ip", "1.2.3.4", NOW)).toMatchObject({ verdict: "clean" });
    kv.set("ti:bulk:v1:row:ip:1.2.3.4", row({ verdict: "malicious", checkedAt: hoursAgo(30) }));
    expect(await rc.readBulkRow("ip", "1.2.3.4", NOW)).toBeNull();
    expect(await rc.readBulkRowAny("ip", "1.2.3.4")).toMatchObject({ verdict: "malicious" });
    kv.set("ti:bulk:v1:row:ip:1.2.3.4", row({}));
    expect(await rc.readBulkRow("ip", "1.2.3.4", NOW)).toBeNull();
  });

  it("degrades without Redis and on Redis errors", async () => {
    redis = null;
    await expect(rc.writeBulkRow(row({}))).resolves.toBeUndefined();
    expect(await rc.readBulkRow("ip", "1.2.3.4", NOW)).toBeNull();
    expect(await rc.readBulkRowAny("ip", "1.2.3.4")).toBeNull();
    redis = fake;
    fake.get.mockRejectedValueOnce(new Error("down"));
    expect(await rc.readBulkRowAny("ip", "1.2.3.4")).toBeNull();
    fake.set.mockRejectedValueOnce(new Error("down"));
    await expect(rc.writeBulkRow(row({ verdict: "clean" }))).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `bun run test lib/ti/bulk/row-cache.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement `lib/ti/bulk/row-cache.ts`**

```ts
import { getCachedResultFor, getRedis } from "../cache";
import type { SourceResult, Verdict } from "../types";
import type { BulkKind, BulkRow } from "./types";

const DAY = 24 * 60 * 60;
const WEEK = 7 * DAY;
const ROW_PREFIX = "ti:bulk:v1:row:";

const isBad = (v: Verdict) => v === "suspicious" || v === "malicious";

/** A listing can expire within a day, so a bad verdict is re-asked sooner. */
export function isFresh(verdict: Verdict, checkedAt: string, now: Date = new Date()): boolean {
  const ageSeconds = (now.getTime() - Date.parse(checkedAt)) / 1000;
  return ageSeconds <= (isBad(verdict) ? DAY : WEEK);
}

export interface SharedHit {
  results: SourceResult[];
  riskScore: number;
  verdict: Verdict;
  checkedAt: string;
}

/** A /check result ran the whole registry, so a fresh one finishes a row free. */
export async function readSharedFull(kind: BulkKind, indicator: string, now: Date = new Date()): Promise<SharedHit | null> {
  const hit = await getCachedResultFor(kind, indicator);
  if (!hit || !isFresh(hit.verdict, hit.checkedAt, now)) return null;
  return { results: hit.sources, riskScore: hit.riskScore, verdict: hit.verdict, checkedAt: hit.checkedAt };
}

const rowKey = (kind: BulkKind, indicator: string) => `${ROW_PREFIX}${kind}:${indicator}`;

export async function readBulkRowAny(kind: BulkKind, indicator: string): Promise<BulkRow | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    return (await redis.get<BulkRow>(rowKey(kind, indicator))) ?? null;
  } catch (err) {
    console.error("[bulk] row cache read failed:", err);
    return null;
  }
}

export async function readBulkRow(kind: BulkKind, indicator: string, now: Date = new Date()): Promise<BulkRow | null> {
  const row = await readBulkRowAny(kind, indicator);
  if (!row?.verdict || !row.checkedAt) return null;
  return isFresh(row.verdict, row.checkedAt, now) ? row : null;
}

function rowTtl(row: BulkRow): number {
  if (row.state !== "full") return DAY;
  return row.verdict && isBad(row.verdict) ? DAY : WEEK;
}

/** Bulk's own cache. It never writes /check's keys: a bulk row lacks the
 *  context sources that /check renders. */
export async function writeBulkRow(row: BulkRow): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(rowKey(row.kind, row.indicator), row, { ex: rowTtl(row) });
  } catch (err) {
    console.error("[bulk] row cache write failed:", err);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `bun run test lib/ti/bulk/row-cache.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/bulk/row-cache.ts lib/ti/bulk/row-cache.test.ts
git commit -m "feat(bulk): freshness rule and bulk-only row cache"
```

---

### Task 9: Engine (pass 1, queue, estimate, pass 2)

**Files:**
- Create: `lib/ti/bulk/engine.ts`
- Test: `lib/ti/bulk/engine.test.ts`

**Interfaces:**
- Consumes: `runAll`, `runSource`, Task 1 profile, Task 2 `classify`, Task 3 `hasOwnKey`, Task 4 `reserveBulk`, `markExhausted`, `isQuotaHit`, `msToNextMinute`, `isMeteredKeyEnv`, Task 6 `BulkItem`, Task 8 caches.
- Produces: `newRow(id, item: BulkItem): BulkRow` (internal items come back as state `internal`); `runPass1(row, now?)`; `escalationQueue(rows: RowSummary[]): RowSummary[]`; `estimate(rows: RowSummary[]): Partial<Record<MeteredId, number>>`; `estimateTotal(e)`; `runPass2(row: BulkRow, now?): Promise<{ row: BulkRow; waitMs?: number }>`.

Callers run pass 1 and pass 2 inside `withLane("bulk", ...)`. Pass 1 chunks run inside one `withRequestMemo`.

- [ ] **Step 1: Write the failing tests**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceMeta, SourceResult } from "../types";
import type { BulkRow, RowSummary } from "./types";

const runAll = vi.fn();
const runSource = vi.fn();
vi.mock("../orchestrate", () => ({ runAll: (...a: unknown[]) => runAll(...a), runSource: (...a: unknown[]) => runSource(...a) }));
const reserveBulk = vi.fn();
const markExhausted = vi.fn();
vi.mock("./quota", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./quota")>()),
  reserveBulk: (...a: unknown[]) => reserveBulk(...a),
  markExhausted: (...a: unknown[]) => markExhausted(...a),
}));
const readSharedFull = vi.fn();
const readBulkRow = vi.fn();
const writeBulkRow = vi.fn();
vi.mock("./row-cache", () => ({
  readSharedFull: (...a: unknown[]) => readSharedFull(...a),
  readBulkRow: (...a: unknown[]) => readBulkRow(...a),
  writeBulkRow: (...a: unknown[]) => writeBulkRow(...a),
}));

const e = await import("./engine");
const NOW = new Date("2026-10-07T10:00:30Z");

function res(id: string, weight: number, extra: Partial<SourceResult> = {}): SourceResult {
  const meta: SourceMeta = { id, name: id, url: "", category: "blocklist", requiresKey: false, weight };
  return { source: meta, enabled: true, durationMs: 1, status: "ok", ...extra };
}

beforeEach(() => {
  vi.clearAllMocks();
  readSharedFull.mockResolvedValue(null);
  readBulkRow.mockResolvedValue(null);
  delete process.env.VIRUSTOTAL_API_KEY_BULK;
});

describe("newRow", () => {
  it("starts internal items finished, never to be looked up", () => {
    expect(e.newRow(1, { indicator: "fs01", kind: "domain", internal: true })).toMatchObject({ state: "internal", note: "Internal name, not sent to any source" });
    expect(e.newRow(2, { indicator: "a.com", kind: "domain", display: "á.com", note: "n" })).toMatchObject({ state: "pending", display: "á.com", note: "n" });
  });
});

describe("runPass1", () => {
  it("never looks up an internal row", async () => {
    const row = e.newRow(0, { indicator: "fs01", kind: "domain", internal: true });
    expect(await e.runPass1(row, NOW)).toBe(row);
    expect(readSharedFull).not.toHaveBeenCalled();
    expect(runAll).not.toHaveBeenCalled();
  });

  it("finishes from a fresh /check result without running anything", async () => {
    readSharedFull.mockResolvedValue({ results: [res("feodo", 1, { score: 100, malicious: true })], riskScore: 90, verdict: "malicious", checkedAt: NOW.toISOString() });
    const row = await e.runPass1(e.newRow(0, { indicator: "1.2.3.4", kind: "ip" }), NOW);
    expect(row).toMatchObject({ state: "cached", verdict: "malicious", pending: [] });
    expect(runAll).not.toHaveBeenCalled();
  });

  it("reuses a cached bulk row under the new id, keeping the parse note", async () => {
    readBulkRow.mockResolvedValue({ ...e.newRow(9, { indicator: "1.2.3.4", kind: "ip" }), state: "full", verdict: "clean" });
    const row = await e.runPass1(e.newRow(3, { indicator: "1.2.3.4", kind: "ip", note: "Read as" }), NOW);
    expect(row).toMatchObject({ id: 3, state: "full", note: "Read as" });
  });

  it("queues a quiet IP for the quiet-order metered sources", async () => {
    runAll.mockResolvedValue([res("dnsbl", 0.5, { score: 0 })]);
    const row = await e.runPass1(e.newRow(0, { indicator: "1.2.3.4", kind: "ip" }), NOW);
    expect(row).toMatchObject({ state: "pass1", bucket: "C", pending: ["abuseipdb", "greynoise", "otx", "virustotal"] });
    expect(writeBulkRow).toHaveBeenCalledWith(row);
  });

  it("asks only family-capable sources for an IPv6", async () => {
    runAll.mockResolvedValue([]);
    await e.runPass1(e.newRow(0, { indicator: "2001:4860:4860::8888", kind: "ip" }), NOW);
    expect(runAll.mock.calls[0][0].map((s: { meta: SourceMeta }) => s.meta.id)).not.toContain("ipsum");
  });

  it("finishes a vouched domain at pass 1 with a note", async () => {
    runAll.mockResolvedValue([res("tranco", 0, { allowlisted: true })]);
    const row = await e.runPass1(e.newRow(0, { indicator: "google.com", kind: "domain" }), NOW);
    expect(row).toMatchObject({ state: "full", bucket: "D", pending: [], note: "Not escalated, vouched by tranco" });
  });
});

describe("escalationQueue and estimate", () => {
  const mk = (id: number, bucket: "A" | "B" | "C", kind: "ip" | "domain" = "ip"): RowSummary => ({
    id, indicator: `x${id}`, kind, state: "pass1", bucket, missing: [],
    pending: kind === "ip" ? ["virustotal", "abuseipdb"] : ["safebrowsing", "virustotal"],
  });

  it("orders B, then C, then A, stable by id, and skips finished rows", () => {
    const rows = [mk(0, "A"), mk(1, "C"), mk(2, "B"), mk(3, "C"), { ...mk(4, "B"), state: "full" as const }];
    expect(e.escalationQueue(rows).map((r) => r.id)).toEqual([2, 1, 3, 0]);
  });

  it("counts pending calls per source", () => {
    const est = e.estimate([mk(0, "B"), mk(1, "C", "domain")]);
    expect(est).toEqual({ virustotal: 2, abuseipdb: 1, safebrowsing: 1 });
    expect(e.estimateTotal(est)).toBe(4);
  });
});

describe("runPass2", () => {
  const start = (): BulkRow => ({
    ...e.newRow(0, { indicator: "1.2.3.4", kind: "ip" }),
    state: "pass1", bucket: "C", results: [res("dnsbl", 0.5, { score: 0 })], pending: ["abuseipdb", "virustotal"],
  });
  const echo = async (s: { meta: SourceMeta }) => res(s.meta.id, 1, { score: 0 });

  it("runs every pending source, by key env, and ends full", async () => {
    reserveBulk.mockResolvedValue("ok");
    runSource.mockImplementation(echo);
    const { row, waitMs } = await e.runPass2(start(), NOW);
    expect(reserveBulk.mock.calls.map((c) => c[0])).toEqual(["ABUSEIPDB_API_KEY", "VIRUSTOTAL_API_KEY"]);
    expect(waitMs).toBeUndefined();
    expect(row).toMatchObject({ state: "full", pending: [], missing: [] });
  });

  it("pauses at the minute cap, saving progress to the row cache", async () => {
    reserveBulk.mockResolvedValueOnce("ok").mockResolvedValueOnce("minute");
    runSource.mockImplementation(echo);
    const { row, waitMs } = await e.runPass2(start(), NOW);
    expect(waitMs).toBe(30_000);
    expect(row).toMatchObject({ state: "pass1", pending: ["virustotal"] });
    expect(writeBulkRow).toHaveBeenCalledWith(row);
  });

  it("names why each wanted source is missing", async () => {
    reserveBulk.mockResolvedValueOnce("spent").mockResolvedValueOnce("unavailable");
    const { row } = await e.runPass2(start(), NOW);
    expect(row).toMatchObject({ state: "partial", missing: ["abuseipdb", "virustotal"] });
    expect(row.results.slice(-2).map((r) => r.summary)).toEqual(["Bulk quota reached", "No quota ledger, Redis not configured"]);
  });

  it("says when it is the bulk key that is spent, and when there is no key", async () => {
    process.env.VIRUSTOTAL_API_KEY_BULK = "own";
    reserveBulk.mockResolvedValueOnce("nokey").mockResolvedValueOnce("spent");
    const { row } = await e.runPass2(start(), NOW);
    expect(row.results.slice(-2).map((r) => r.summary)).toEqual(["No API key", "Bulk key quota reached"]);
  });

  it("marks a provider quota hit exhausted in the bulk lane, and missing", async () => {
    reserveBulk.mockResolvedValue("ok");
    runSource.mockResolvedValueOnce(res("abuseipdb", 1, { status: "error", error: "HTTP 429" })).mockResolvedValueOnce(res("virustotal", 1, { score: 0 }));
    const { row } = await e.runPass2(start(), NOW);
    expect(markExhausted).toHaveBeenCalledWith("ABUSEIPDB_API_KEY", "bulk", NOW);
    expect(row).toMatchObject({ state: "partial", missing: ["abuseipdb"] });
  });

  it("re-scores on the merged results", async () => {
    reserveBulk.mockResolvedValue("ok");
    runSource.mockImplementation(async (s: { meta: SourceMeta }) => res(s.meta.id, 1, { score: 100, malicious: true }));
    expect((await e.runPass2(start(), NOW)).row.verdict).toBe("malicious");
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `bun run test lib/ti/bulk/engine.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement `lib/ti/bulk/engine.ts`**

```ts
import { hasOwnKey } from "../keys";
import { runAll, runSource } from "../orchestrate";
import type { SourceResult } from "../types";
import { classify } from "./classify";
import type { BulkItem } from "./parse";
import { familyOf, pass1Sources, pass2Ids, sourceById } from "./profile";
import { isMeteredKeyEnv, isQuotaHit, markExhausted, msToNextMinute, reserveBulk, type Reservation } from "./quota";
import { readBulkRow, readSharedFull, writeBulkRow } from "./row-cache";
import type { Bucket, BulkRow, MeteredId, MeteredKeyEnv, RowSummary } from "./types";

export function newRow(id: number, item: BulkItem): BulkRow {
  const { internal, ...rest } = item;
  const row: BulkRow = { id, ...rest, state: "pending", results: [], pending: [], missing: [] };
  return internal ? { ...row, state: "internal", note: "Internal name, not sent to any source" } : row;
}

/** Pass 1, cheapest first: /check's cache, bulk's cache, then the unmetered
 *  profile. Callers wrap a chunk in one withRequestMemo and withLane("bulk"). */
export async function runPass1(row: BulkRow, now: Date = new Date()): Promise<BulkRow> {
  if (row.state === "internal") return row;
  const shared = await readSharedFull(row.kind, row.indicator, now);
  if (shared) {
    const { bucket } = classify(shared.results);
    return { ...row, ...shared, bucket, state: "cached", pending: [], missing: [] };
  }
  const cached = await readBulkRow(row.kind, row.indicator, now);
  if (cached) return { ...cached, id: row.id, note: row.note ?? cached.note };

  const results = await runAll(pass1Sources(row.kind, familyOf(row.kind, row.indicator)), row.indicator);
  const c = classify(results);
  const pending = pass2Ids(row.kind, c.bucket);
  const next: BulkRow = {
    ...row,
    results,
    bucket: c.bucket,
    riskScore: c.riskScore,
    verdict: c.verdict,
    pending,
    missing: [],
    state: pending.length === 0 ? "full" : "pass1",
    note: c.vouchedBy ? `Not escalated, vouched by ${c.vouchedBy}` : row.note,
    checkedAt: now.toISOString(),
  };
  await writeBulkRow(next);
  return next;
}

const BUCKET_RANK: Record<Bucket, number> = { B: 0, C: 1, A: 2, D: 3 };

export function escalationQueue<T extends RowSummary>(rows: T[]): T[] {
  return rows
    .filter((r) => r.state === "pass1" && r.pending.length > 0)
    .sort((a, b) => BUCKET_RANK[a.bucket ?? "D"] - BUCKET_RANK[b.bucket ?? "D"] || a.id - b.id);
}

export function estimate(rows: RowSummary[]): Partial<Record<MeteredId, number>> {
  const out: Partial<Record<MeteredId, number>> = {};
  for (const row of escalationQueue(rows)) {
    for (const id of row.pending) out[id] = (out[id] ?? 0) + 1;
  }
  return out;
}

export function estimateTotal(e: Partial<Record<MeteredId, number>>): number {
  return Object.values(e).reduce((sum, n) => sum + (n ?? 0), 0);
}

function reasonFor(reservation: Exclude<Reservation, "ok" | "minute">, keyEnv: MeteredKeyEnv): string {
  if (reservation === "nokey") return "No API key";
  if (reservation === "unavailable") return "No quota ledger, Redis not configured";
  return hasOwnKey(keyEnv, "bulk") ? "Bulk key quota reached" : "Bulk quota reached";
}

function skipped(row: BulkRow, id: MeteredId, summary: string): SourceResult {
  const meta = sourceById(row.kind, id)?.meta ?? { id, name: id, url: "", category: "reputation" as const, requiresKey: true, weight: 0 };
  return { source: meta, enabled: true, status: "skipped", summary, durationMs: 0 };
}

/** Ask one metered source. Null means: wait for the next minute. */
async function askOne(row: BulkRow, id: MeteredId, now: Date): Promise<{ result: SourceResult; missed: boolean } | null> {
  const source = sourceById(row.kind, id);
  const keyEnv = source?.meta.keyEnv;
  if (!source || !isMeteredKeyEnv(keyEnv)) return { result: skipped(row, id, "No API key"), missed: true };
  const reservation = await reserveBulk(keyEnv, now);
  if (reservation === "minute") return null;
  if (reservation !== "ok") return { result: skipped(row, id, reasonFor(reservation, keyEnv)), missed: true };
  const result = await runSource(source, row.indicator);
  const hit = isQuotaHit(result);
  if (hit) await markExhausted(keyEnv, "bulk", now);
  return { result, missed: hit };
}

/** Pass 2 for one row, resumable: progress is in `pending` and written to the
 *  row cache at every stop, so the next call carries on where this one ended. */
export async function runPass2(row: BulkRow, now: Date = new Date()): Promise<{ row: BulkRow; waitMs?: number }> {
  const next: BulkRow = { ...row, results: [...row.results], pending: [...row.pending], missing: [...row.missing] };
  while (next.pending.length > 0) {
    const asked = await askOne(next, next.pending[0], now);
    if (!asked) {
      await writeBulkRow(next);
      return { row: next, waitMs: msToNextMinute(now) };
    }
    const id = next.pending.shift() as MeteredId;
    next.results.push(asked.result);
    if (asked.missed) next.missing.push(id);
  }
  const c = classify(next.results);
  const done: BulkRow = {
    ...next,
    riskScore: c.riskScore,
    verdict: c.verdict,
    state: next.missing.length > 0 ? "partial" : "full",
    checkedAt: now.toISOString(),
  };
  await writeBulkRow(done);
  return { row: done };
}
```

The bucket is **not** recomputed after pass 2. It records why the row was escalated.

- [ ] **Step 4: Run tests and lint**

Run: `bun run test lib/ti/bulk && bun run lint`
Expected: PASS, no complexity errors.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/bulk/engine.ts lib/ti/bulk/engine.test.ts
git commit -m "feat(bulk): engine with tiered escalation and resumable pass 2"
```

---

### Task 10: Web run store, export, session owner

**Files:**
- Create: `lib/ti/bulk/run-store.ts`, `lib/ti/bulk/export.ts`
- Modify: `lib/require-session.ts`
- Test: `lib/ti/bulk/run-store.test.ts`, `lib/ti/bulk/export.test.ts`, `lib/require-session.test.ts` (add cases)

**Interfaces:**
- Consumes: `getRedis`, Task 9 `newRow`, Task 6 `ParsedBulk`, Task 8 `readBulkRowAny`, Task 1 `depthOf`.
- Produces: `summarize(row: BulkRow): RowSummary`; `createRun(owner, parsed, id?, now?): { run: BulkRun; rows: BulkRow[] }`; `saveRun(run)`; `loadRun(id, owner)`; `mergeRows(run, rows: BulkRow[])`; `hydrate(summary: RowSummary): Promise<BulkRow>`; `toCsv(rows: RowSummary[])`; `toJson(rows: RowSummary[])`; `invalidCsv(invalid)`; `requireSessionUser(): Promise<{ email: string } | Response>`.

- [ ] **Step 1: Write the failing tests**

`lib/ti/bulk/run-store.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const kv = new Map<string, unknown>();
const fake = {
  get: vi.fn(async (k: string) => kv.get(k) ?? null),
  set: vi.fn(async (k: string, v: unknown) => {
    kv.set(k, v);
    return "OK";
  }),
};
let redis: typeof fake | null = fake;
vi.mock("../cache", () => ({ getRedis: () => redis }));
const readBulkRowAny = vi.fn();
// engine.ts (imported via newRow) also reads from row-cache, so the mock
// names every export even though only readBulkRowAny is exercised here.
vi.mock("./row-cache", () => ({
  readBulkRowAny: (...a: unknown[]) => readBulkRowAny(...a),
  readBulkRow: vi.fn(),
  readSharedFull: vi.fn(),
  writeBulkRow: vi.fn(),
}));
const s = await import("./run-store");

const parsed = {
  items: [{ indicator: "1.1.1.1", kind: "ip" as const }, { indicator: "fs01", kind: "domain" as const, internal: true }],
  invalid: [],
  duplicates: 1,
};

beforeEach(() => {
  kv.clear();
  redis = fake;
  readBulkRowAny.mockReset();
});

describe("run store", () => {
  it("creates numbered rows and keeps only summaries in the record", () => {
    const { run, rows } = s.createRun("me@x.com", parsed, "r1", new Date("2026-10-07T00:00:00Z"));
    expect(run).toMatchObject({ v: 1, id: "r1", owner: "me@x.com", duplicates: 1 });
    expect(run.rows.map((r) => [r.id, r.state])).toEqual([[0, "pending"], [1, "internal"]]);
    expect("results" in run.rows[0]).toBe(false);
    expect(rows[0].results).toEqual([]);
  });

  it("generates an id when none is given", () => {
    expect(s.createRun("me@x.com", parsed).run.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("saves and loads for the owner only", async () => {
    const { run } = s.createRun("me@x.com", parsed, "r1");
    expect(await s.saveRun(run)).toBe(true);
    expect(await s.loadRun("r1", "me@x.com")).toEqual(run);
    expect(await s.loadRun("r1", "other@x.com")).toBeNull();
    expect(await s.loadRun("nope", "me@x.com")).toBeNull();
  });

  it("merges rows by id as summaries", () => {
    const { run, rows } = s.createRun("me@x.com", parsed, "r1");
    const merged = s.mergeRows(run, [{ ...rows[0], state: "full", results: [{} as never] }]);
    expect(merged.rows.map((r) => r.state)).toEqual(["full", "internal"]);
    expect("results" in merged.rows[0]).toBe(false);
  });

  it("hydrates a summary from the row cache, or starts it over", async () => {
    const { run } = s.createRun("me@x.com", parsed, "r1");
    readBulkRowAny.mockResolvedValueOnce({ ...run.rows[0], id: 99, state: "pass1", results: ["x"] });
    expect(await s.hydrate({ ...run.rows[0], state: "pass1" })).toMatchObject({ id: 0, state: "pass1", results: ["x"] });
    readBulkRowAny.mockResolvedValueOnce(null);
    expect(await s.hydrate({ ...run.rows[0], state: "pass1" })).toMatchObject({ state: "pending", results: [] });
  });

  it("degrades without Redis and on errors", async () => {
    const { run } = s.createRun("me@x.com", parsed, "r1");
    redis = null;
    expect(await s.saveRun(run)).toBe(false);
    expect(await s.loadRun("r1", "me@x.com")).toBeNull();
    redis = fake;
    fake.set.mockRejectedValueOnce(new Error("down"));
    expect(await s.saveRun(run)).toBe(false);
    fake.get.mockRejectedValueOnce(new Error("down"));
    expect(await s.loadRun("r1", "me@x.com")).toBeNull();
  });
});
```

`lib/ti/bulk/export.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { invalidCsv, toCsv, toJson } from "./export";
import type { RowSummary } from "./types";

const rows: RowSummary[] = [
  { id: 0, indicator: "1.2.3.4", kind: "ip", state: "partial", bucket: "C", verdict: "clean", riskScore: 3, pending: [], missing: ["virustotal", "abuseipdb"], checkedAt: "2026-10-07T01:00:00Z" },
  { id: 1, indicator: "xn--y3ctai2b.com", display: "หีหอม.com", kind: "domain", state: "feed-only", pending: [], missing: [], note: "Not in feeds, unchecked" },
  { id: 2, indicator: "-evil.com", kind: "domain", state: "internal", pending: [], missing: [], note: "Internal name, not sent to any source" },
];

describe("export", () => {
  it("writes a CSV with depth, display and note, and defuses formula cells", () => {
    const lines = toCsv(rows).trim().split("\n");
    expect(lines[0]).toBe("indicator,display,kind,verdict,risk_score,depth,state,bucket,missing,note,checked_at");
    expect(lines[1]).toBe("1.2.3.4,,ip,clean,3,free,partial,C,virustotal;abuseipdb,,2026-10-07T01:00:00Z");
    expect(lines[2]).toBe("xn--y3ctai2b.com,หีหอม.com,domain,,,feed,feed-only,,,\"Not in feeds, unchecked\",");
    expect(lines[3].startsWith("'-evil.com,")).toBe(true);
  });

  it("writes JSON rows with depth and without results", () => {
    expect(JSON.parse(toJson(rows))[0]).toEqual({
      indicator: "1.2.3.4", kind: "ip", verdict: "clean", riskScore: 3, depth: "free", state: "partial", bucket: "C", missing: ["virustotal", "abuseipdb"], checkedAt: "2026-10-07T01:00:00Z",
    });
  });

  it("writes the invalid list", () => {
    expect(invalidCsv([{ input: "=x", reason: "Not an IP or domain" }])).toBe("input,reason\n'=x,Not an IP or domain\n");
  });
});
```

Add to `lib/require-session.test.ts`, mocking `@/auth` the way the file already does:

```ts
it("hands back the signed-in user's email", async () => {
  authMock.mockResolvedValueOnce({ user: { email: "me@x.com" } });
  expect(await requireSessionUser()).toEqual({ email: "me@x.com" });
});
it("refuses a session with no email", async () => {
  authMock.mockResolvedValueOnce({ user: {} });
  expect(((await requireSessionUser()) as Response).status).toBe(401);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `bun run test lib/ti/bulk/run-store.test.ts lib/ti/bulk/export.test.ts lib/require-session.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `lib/ti/bulk/run-store.ts`**

```ts
import { getRedis } from "../cache";
import { newRow } from "./engine";
import type { ParsedBulk } from "./parse";
import { readBulkRowAny } from "./row-cache";
import type { BulkRow, BulkRun, RowSummary } from "./types";

const RUN_PREFIX = "ti:bulk:v1:run:";
const RUN_TTL = 7 * 24 * 60 * 60;

export function summarize(row: BulkRow): RowSummary {
  const { results: _results, ...summary } = row;
  return summary;
}

export function createRun(owner: string, parsed: ParsedBulk, id: string = crypto.randomUUID(), now: Date = new Date()): { run: BulkRun; rows: BulkRow[] } {
  const rows = parsed.items.map((item, i) => newRow(i, item));
  const run: BulkRun = {
    v: 1, id, owner, createdAt: now.toISOString(),
    rows: rows.map(summarize), invalid: parsed.invalid, duplicates: parsed.duplicates,
  };
  return { run, rows };
}

/** One runner works one chunk at a time, so load, merge and save need no lock.
 *  The record holds summaries only; results live in the row cache. */
export async function saveRun(run: BulkRun): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  try {
    await redis.set(RUN_PREFIX + run.id, run, { ex: RUN_TTL });
    return true;
  } catch (err) {
    console.error("[bulk] run save failed:", err);
    return false;
  }
}

export async function loadRun(id: string, owner: string): Promise<BulkRun | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const run = await redis.get<BulkRun>(RUN_PREFIX + id);
    return run?.owner === owner ? run : null;
  } catch (err) {
    console.error("[bulk] run load failed:", err);
    return null;
  }
}

export function mergeRows(run: BulkRun, rows: BulkRow[]): BulkRun {
  const byId = new Map(rows.map((r) => [r.id, summarize(r)]));
  return { ...run, rows: run.rows.map((r) => byId.get(r.id) ?? r) };
}

/** A summary plus its results. If the row cache has expired, start the row over. */
export async function hydrate(summary: RowSummary): Promise<BulkRow> {
  const cached = await readBulkRowAny(summary.kind, summary.indicator);
  if (cached) return { ...cached, id: summary.id };
  return { ...summary, state: "pending", results: [], pending: [], missing: [] };
}
```

- [ ] **Step 4: Implement `lib/ti/bulk/export.ts`**

```ts
import { depthOf, type InvalidInput, type RowSummary } from "./types";

const HEADER = "indicator,display,kind,verdict,risk_score,depth,state,bucket,missing,note,checked_at";

/** Spreadsheets run a cell that starts with one of these as a formula. */
function cell(value: string | number | undefined): string {
  const text = value === undefined ? "" : String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const line = (values: (string | number | undefined)[]) => values.map(cell).join(",");

export function toCsv(rows: RowSummary[]): string {
  const body = rows.map((r) =>
    line([r.indicator, r.display, r.kind, r.verdict, r.riskScore, depthOf(r), r.state, r.bucket, r.missing.join(";"), r.note, r.checkedAt]),
  );
  return [HEADER, ...body].join("\n") + "\n";
}

export function toJson(rows: RowSummary[]): string {
  return JSON.stringify(
    rows.map((r) => ({
      indicator: r.indicator, display: r.display, kind: r.kind, verdict: r.verdict, riskScore: r.riskScore,
      depth: depthOf(r), state: r.state, bucket: r.bucket, missing: r.missing, note: r.note, checkedAt: r.checkedAt,
    })),
  );
}

export function invalidCsv(invalid: InvalidInput[]): string {
  return ["input,reason", ...invalid.map((i) => line([i.input, i.reason]))].join("\n") + "\n";
}
```

(`JSON.stringify` drops `undefined` fields, which is why the JSON test's expected object has no `display` or `note`.)

- [ ] **Step 5: Add `requireSessionUser` to `lib/require-session.ts`**

```ts
/** Like requireSession, but hands back who is asking, for routes that keep
 *  per-user records (bulk runs). */
export async function requireSessionUser(): Promise<{ email: string } | Response> {
  const { auth } = await import("@/auth");
  const session = await auth();
  const email = session?.user?.email;
  if (email) return { email };
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
```

- [ ] **Step 6: Run tests**

Run: `bun run test lib/ti/bulk lib/require-session`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/ti/bulk/run-store.ts lib/ti/bulk/run-store.test.ts lib/ti/bulk/export.ts lib/ti/bulk/export.test.ts lib/require-session.ts lib/require-session.test.ts
git commit -m "feat(bulk): web run record of summaries, export with depth, session owner"
```

---

### Task 11: CLI run directory and concurrency helper

**Files:**
- Create: `lib/ti/bulk/run-dir.ts`, `lib/ti/bulk/limit.ts`
- Test: `lib/ti/bulk/run-dir.test.ts`, `lib/ti/bulk/limit.test.ts`

**Interfaces:**
- Consumes: Task 10 `toCsv`, `invalidCsv`, `summarize`; Task 6 `BulkItem`, `invalidSummary`; Task 1 types.
- Produces:
  - `mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>, onResult?: (r: R) => void): Promise<R[]>`
  - `interface RunState { v: 1; id: string; createdAt: string; phase: "pass0" | "pass1" | "pass2" | "done"; includeWeak: boolean; concurrency: number; confirmed: boolean; invalid: InvalidInput[]; duplicates: number }`
  - `defaultRoot(): string` (`~/.ophanim/bulk`), `resolveRunDir(resume: string, root?: string): string`
  - `initRunDir(dir: string, state: RunState, items: BulkItem[]): void`
  - `loadRunDir(dir: string): { state: RunState; items: BulkItem[]; rows: Map<number, BulkRow> }`
  - `appendRows(dir: string, rows: BulkRow[]): void`, `saveState(dir: string, state: RunState): void`
  - `isHit(row: RowSummary): boolean`
  - `writeOutputs(dir: string, rows: RowSummary[], state: RunState): string` (writes the four files and returns the summary text)

- [ ] **Step 1: Write the failing tests**

`lib/ti/bulk/limit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mapLimit } from "./limit";

describe("mapLimit", () => {
  it("keeps order, never exceeds the limit, and reports each result", async () => {
    let active = 0;
    let peak = 0;
    const seen: number[] = [];
    const out = await mapLimit([5, 1, 3, 2], 2, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, n));
      active--;
      return n * 10;
    }, (r) => seen.push(r));
    expect(out).toEqual([50, 10, 30, 20]);
    expect(peak).toBe(2);
    expect(seen.sort()).toEqual([10, 20, 30, 50]);
  });
  it("handles an empty list", async () => {
    expect(await mapLimit([], 3, async (x) => x)).toEqual([]);
  });
});
```

`lib/ti/bulk/run-dir.test.ts`:

```ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as d from "./run-dir";
import type { BulkRow } from "./types";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bulk-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const state = (): d.RunState => ({
  v: 1, id: "r1", createdAt: "2026-10-07T00:00:00Z", phase: "pass0", includeWeak: false, concurrency: 5, confirmed: false,
  invalid: [{ input: "10.0.0.1", reason: "Non-routable address, private" }], duplicates: 2,
});
const row = (id: number, over: Partial<BulkRow> = {}): BulkRow => ({ id, indicator: `1.1.1.${id}`, kind: "ip", state: "pending", results: [], pending: [], missing: [], ...over });

describe("run directory", () => {
  it("lives under ~/.ophanim/bulk by default and resolves an id or a path", () => {
    expect(d.defaultRoot()).toBe(join(homedir(), ".ophanim", "bulk"));
    expect(d.resolveRunDir("r1", root)).toBe(join(root, "r1"));
    expect(d.resolveRunDir("/abs/dir", root)).toBe("/abs/dir");
  });

  it("round-trips state, items and rows, the last row line winning", () => {
    const dir = join(root, "r1");
    d.initRunDir(dir, state(), [{ indicator: "1.1.1.0", kind: "ip" }, { indicator: "1.1.1.1", kind: "ip" }]);
    d.appendRows(dir, [row(0, { state: "pass1" }), row(1, { state: "feed-only" })]);
    d.appendRows(dir, [row(0, { state: "full" })]);
    d.saveState(dir, { ...state(), phase: "pass2" });
    const loaded = d.loadRunDir(dir);
    expect(loaded.state.phase).toBe("pass2");
    expect(loaded.items).toHaveLength(2);
    expect(loaded.rows.get(0)?.state).toBe("full");
    expect(loaded.rows.get(1)?.state).toBe("feed-only");
  });

  it("loads a run with no rows yet", () => {
    const dir = join(root, "r2");
    d.initRunDir(dir, state(), []);
    expect(d.loadRunDir(dir).rows.size).toBe(0);
  });

  it("calls a row a hit when listed or not quiet", () => {
    expect(d.isHit({ ...row(0), listedBy: ["ipsum"] })).toBe(true);
    expect(d.isHit({ ...row(0), verdict: "suspicious" })).toBe(true);
    expect(d.isHit({ ...row(0), verdict: "clean" })).toBe(false);
    expect(d.isHit({ ...row(0), verdict: "unknown", listedBy: [] })).toBe(false);
  });

  it("writes results, hits, invalid and a summary", () => {
    const dir = join(root, "r1");
    d.initRunDir(dir, state(), []);
    const text = d.writeOutputs(dir, [row(0, { state: "feed-only" }), row(1, { state: "full", verdict: "malicious", bucket: "A" })], state());
    expect(readFileSync(join(dir, "results.csv"), "utf8").trim().split("\n")).toHaveLength(3);
    expect(readFileSync(join(dir, "hits.csv"), "utf8").trim().split("\n")).toHaveLength(2);
    expect(readFileSync(join(dir, "invalid.csv"), "utf8")).toContain("10.0.0.1");
    expect(text).toContain("2 indicators");
    expect(text).toContain("feed 1");
    expect(text).toContain("full 1");
    expect(text).toContain("malicious 1");
    expect(text).toContain("Non-routable address 1");
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `bun run test lib/ti/bulk/limit.test.ts lib/ti/bulk/run-dir.test.ts`
Expected: FAIL, modules missing.

- [ ] **Step 3: Implement `lib/ti/bulk/limit.ts`**

```ts
/** Run fn over items with at most `limit` in flight, results in input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>, onResult?: (r: R) => void): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
      onResult?.(out[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
```

- [ ] **Step 4: Implement `lib/ti/bulk/run-dir.ts`**

```ts
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { invalidCsv, toCsv } from "./export";
import { invalidSummary, type BulkItem } from "./parse";
import { depthOf, type BulkRow, type InvalidInput, type RowSummary } from "./types";

export interface RunState {
  v: 1;
  id: string;
  createdAt: string;
  phase: "pass0" | "pass1" | "pass2" | "done";
  includeWeak: boolean;
  concurrency: number;
  confirmed: boolean;
  invalid: InvalidInput[];
  duplicates: number;
}

/** Outside the repo on purpose: these files hold customer IOCs and internal
 *  hostnames, and must never be one `git add .` away from a commit. */
export function defaultRoot(): string {
  return join(homedir(), ".ophanim", "bulk");
}

export function resolveRunDir(resume: string, root: string = defaultRoot()): string {
  return isAbsolute(resume) ? resume : join(root, resume);
}

const jsonl = (values: unknown[]) => values.map((v) => JSON.stringify(v)).join("\n") + (values.length ? "\n" : "");
const readJsonl = <T>(path: string): T[] =>
  existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as T) : [];

export function initRunDir(dir: string, state: RunState, items: BulkItem[]): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "state.json"), JSON.stringify(state, null, 2));
  writeFileSync(join(dir, "input.jsonl"), jsonl(items));
}

export function saveState(dir: string, state: RunState): void {
  writeFileSync(join(dir, "state.json"), JSON.stringify(state, null, 2));
}

export function appendRows(dir: string, rows: BulkRow[]): void {
  appendFileSync(join(dir, "rows.jsonl"), jsonl(rows));
}

export function loadRunDir(dir: string): { state: RunState; items: BulkItem[]; rows: Map<number, BulkRow> } {
  const state = JSON.parse(readFileSync(join(dir, "state.json"), "utf8")) as RunState;
  const items = readJsonl<BulkItem>(join(dir, "input.jsonl"));
  const rows = new Map<number, BulkRow>();
  for (const row of readJsonl<BulkRow>(join(dir, "rows.jsonl"))) rows.set(row.id, row);
  return { state, items, rows };
}

export function isHit(row: RowSummary): boolean {
  if (row.listedBy?.length) return true;
  return row.verdict !== undefined && row.verdict !== "clean" && row.verdict !== "unknown";
}

function tally<T extends string>(values: T[]): string {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].map(([k, n]) => `${k} ${n}`).join(", ");
}

export function writeOutputs(dir: string, rows: RowSummary[], state: RunState): string {
  writeFileSync(join(dir, "results.csv"), toCsv(rows));
  writeFileSync(join(dir, "hits.csv"), toCsv(rows.filter(isHit)));
  writeFileSync(join(dir, "invalid.csv"), invalidCsv(state.invalid));
  const invalid = Object.entries(invalidSummary(state.invalid)).map(([k, n]) => `${k} ${n}`).join(", ");
  const text = [
    `${rows.length} indicators, ${state.duplicates} duplicates, ${state.invalid.length} invalid`,
    `depth: ${tally(rows.map(depthOf))}`,
    `verdict: ${tally(rows.flatMap((r) => (r.verdict ? [r.verdict] : [])))}`,
    `invalid: ${invalid || "none"}`,
  ].join("\n") + "\n";
  writeFileSync(join(dir, "summary.txt"), text);
  return text;
}
```

- [ ] **Step 5: Run tests**

Run: `bun run test lib/ti/bulk/limit.test.ts lib/ti/bulk/run-dir.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/ti/bulk/limit.ts lib/ti/bulk/limit.test.ts lib/ti/bulk/run-dir.ts lib/ti/bulk/run-dir.test.ts
git commit -m "feat(bulk): CLI run directory and concurrency helper"
```

---

### Task 12: API routes

**Files:**
- Create: `lib/ti/bulk/api.ts`, `lib/ti/bulk/api.test.ts`
- Create: `app/api/bulk/route.ts`, `app/api/bulk/[runId]/route.ts`, `app/api/bulk/[runId]/pass1/route.ts`, `app/api/bulk/[runId]/pass2/route.ts`, `app/api/bulk/[runId]/export/route.ts`

Before writing, read `node_modules/next/dist/docs/` on route handlers and dynamic segments: in Next 16, `params` is a Promise.

**Interfaces:**
- Consumes: Tasks 3, 4, 6, 9 and 10.
- Produces (`lib/ti/bulk/api.ts`): `PASS1_CHUNK = 25`, `PASS2_CHUNK = 4`, `confirmAt()`, `readRowIds(body, max)`, `needsConfirmation(run)`, `ndjsonStream(work)`, `type BulkEvent`.

- [ ] **Step 1: Write the failing helper tests**

```ts
import { afterEach, describe, expect, it } from "vitest";
import { confirmAt, ndjsonStream, needsConfirmation, readRowIds } from "./api";
import type { BulkRun } from "./types";

afterEach(() => delete process.env.TI_BULK_CONFIRM_AT);

describe("readRowIds", () => {
  it("accepts a short list of non-negative integers", () => {
    expect(readRowIds({ rowIds: [0, 3] }, 25)).toEqual([0, 3]);
  });
  it("refuses anything else", () => {
    for (const body of [{ rowIds: [] }, { rowIds: [1.5] }, { rowIds: [-1] }, { rowIds: Array.from({ length: 26 }, (_, i) => i) }, null]) {
      expect(readRowIds(body, 25)).toBeNull();
    }
  });
});

describe("needsConfirmation", () => {
  const run = (pending: number, confirmed?: boolean): BulkRun => ({
    v: 1, id: "r", owner: "o", createdAt: "", invalid: [], duplicates: 0, confirmed,
    rows: Array.from({ length: pending }, (_, i) => ({ id: i, indicator: `x${i}`, kind: "ip" as const, state: "pass1" as const, bucket: "C" as const, pending: ["virustotal" as const], missing: [] })),
  });
  it("asks above the threshold, once", () => {
    process.env.TI_BULK_CONFIRM_AT = "3";
    expect(confirmAt()).toBe(3);
    expect(needsConfirmation(run(3))).toBe(false);
    expect(needsConfirmation(run(4))).toBe(true);
    expect(needsConfirmation(run(4, true))).toBe(false);
  });
  it("defaults to 50", () => {
    process.env.TI_BULK_CONFIRM_AT = "x";
    expect(confirmAt()).toBe(50);
  });
});

describe("ndjsonStream", () => {
  it("streams events and closes", async () => {
    const res = ndjsonStream(async (emit) => emit({ v: 1, type: "done" }));
    expect(res.headers.get("content-type")).toBe("application/x-ndjson");
    expect(await res.text()).toBe('{"v":1,"type":"done"}\n');
  });
  it("turns a throw into an error event", async () => {
    const res = ndjsonStream(async () => {
      throw new Error("boom");
    });
    expect(await res.text()).toBe('{"v":1,"type":"error","error":"boom"}\n');
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `bun run test lib/ti/bulk/api.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement `lib/ti/bulk/api.ts`**

```ts
import { estimate, estimateTotal } from "./engine";
import type { BulkRun, RowSummary } from "./types";

export const PASS1_CHUNK = 25;
export const PASS2_CHUNK = 4;

export type BulkEvent =
  | { v: 1; type: "row"; row: RowSummary }
  | { v: 1; type: "wait"; ms: number }
  | { v: 1; type: "done" }
  | { v: 1; type: "error"; error: string };

export function confirmAt(): number {
  const raw = Number(process.env.TI_BULK_CONFIRM_AT);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 50;
}

export function readRowIds(body: unknown, max: number): number[] | null {
  const ids = (body as { rowIds?: unknown } | null)?.rowIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > max) return null;
  return ids.every((n) => Number.isInteger(n) && n >= 0) ? (ids as number[]) : null;
}

export function needsConfirmation(run: BulkRun): boolean {
  return !run.confirmed && estimateTotal(estimate(run.rows)) > confirmAt();
}

export function ndjsonStream(work: (emit: (event: BulkEvent) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: BulkEvent) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        await work(emit);
      } catch (err) {
        emit({ v: 1, type: "error", error: err instanceof Error ? err.message : String(err) });
      }
      controller.close();
    },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson" } });
}
```

- [ ] **Step 4: Write the routes**

`app/api/bulk/route.ts`:

```ts
import { getRedis } from "@/lib/ti/cache";
import { parseBulkInput, WEB_CAP } from "@/lib/ti/bulk/parse";
import { createRun, saveRun } from "@/lib/ti/bulk/run-store";
import { requireSessionUser } from "@/lib/require-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await requireSessionUser();
  if (user instanceof Response) return user;
  if (!getRedis()) return Response.json({ error: "Bulk lookup needs the Redis cache" }, { status: 503 });

  const body = (await req.json().catch(() => null)) as { input?: unknown } | null;
  if (typeof body?.input !== "string") return Response.json({ error: "Missing 'input'" }, { status: 400 });

  const parsed = parseBulkInput(body.input);
  if (parsed.items.length === 0) return Response.json({ error: "No IPs or domains found", invalid: parsed.invalid.slice(0, 50) }, { status: 422 });
  if (parsed.items.length > WEB_CAP) {
    return Response.json({ error: `More than ${WEB_CAP} indicators, use the CLI: bun --env-file=.env.local scripts/bulk.ts <file>` }, { status: 413 });
  }
  const { run, rows } = createRun(user.email, parsed);
  if (!(await saveRun(run))) return Response.json({ error: "Could not save the run" }, { status: 503 });
  return Response.json({
    runId: run.id,
    rows: rows.length,
    internal: rows.filter((r) => r.state === "internal").length,
    invalid: run.invalid.slice(0, 50),
    invalidCount: run.invalid.length,
    duplicates: run.duplicates,
  });
}
```

`app/api/bulk/[runId]/route.ts`:

```ts
import { estimate } from "@/lib/ti/bulk/engine";
import { confirmAt, needsConfirmation } from "@/lib/ti/bulk/api";
import { remaining } from "@/lib/ti/bulk/quota";
import { loadRun } from "@/lib/ti/bulk/run-store";
import { requireSessionUser } from "@/lib/require-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const user = await requireSessionUser();
  if (user instanceof Response) return user;
  const run = await loadRun((await ctx.params).runId, user.email);
  if (!run) return Response.json({ error: "Run not found" }, { status: 404 });
  return Response.json({ run, estimate: estimate(run.rows), needsConfirmation: needsConfirmation(run), confirmAt: confirmAt(), quota: await remaining() });
}
```

`app/api/bulk/[runId]/pass1/route.ts`:

```ts
import { withLane } from "@/lib/ti/keys";
import { withRequestMemo } from "@/lib/ti/request-memo";
import { runPass1 } from "@/lib/ti/bulk/engine";
import { ndjsonStream, PASS1_CHUNK, readRowIds } from "@/lib/ti/bulk/api";
import { hydrate, loadRun, mergeRows, saveRun, summarize } from "@/lib/ti/bulk/run-store";
import { requireSessionUser } from "@/lib/require-session";
import type { BulkRow } from "@/lib/ti/bulk/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 25 rows in parallel, bounded by the slowest pass 1 source (15s) plus cache
// round trips; same reasoning as app/api/check/route.ts.
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const user = await requireSessionUser();
  if (user instanceof Response) return user;
  const run = await loadRun((await ctx.params).runId, user.email);
  if (!run) return Response.json({ error: "Run not found" }, { status: 404 });
  const ids = readRowIds(await req.json().catch(() => null), PASS1_CHUNK);
  if (!ids) return Response.json({ error: `Send 1 to ${PASS1_CHUNK} rowIds` }, { status: 400 });

  const summaries = run.rows.filter((r) => ids.includes(r.id) && r.state === "pending");
  return ndjsonStream(async (emit) => {
    const done: BulkRow[] = [];
    // One memo for the chunk, so the feeds every row consults are fetched once.
    await withLane("bulk", () =>
      withRequestMemo(() =>
        Promise.all(
          summaries.map(async (s) => {
            const next = await runPass1(await hydrate(s));
            done.push(next);
            emit({ v: 1, type: "row", row: summarize(next) });
          }),
        ),
      ),
    );
    await saveRun(mergeRows(run, done));
    emit({ v: 1, type: "done" });
  });
}
```

`app/api/bulk/[runId]/pass2/route.ts`:

```ts
import { withLane } from "@/lib/ti/keys";
import { estimate, runPass1, runPass2 } from "@/lib/ti/bulk/engine";
import { needsConfirmation, ndjsonStream, PASS2_CHUNK, readRowIds } from "@/lib/ti/bulk/api";
import { remaining } from "@/lib/ti/bulk/quota";
import { hydrate, loadRun, mergeRows, saveRun, summarize } from "@/lib/ti/bulk/run-store";
import { requireSessionUser } from "@/lib/require-session";
import type { BulkRow } from "@/lib/ti/bulk/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Rows run one after another so the VirusTotal minute cap is honoured in
// order: 4 rows of up to 4 metered calls at the longest 15s timeout.
export const maxDuration = 300;

export async function POST(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const user = await requireSessionUser();
  if (user instanceof Response) return user;
  let run = await loadRun((await ctx.params).runId, user.email);
  if (!run) return Response.json({ error: "Run not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { rowIds?: unknown; confirmed?: unknown } | null;
  const ids = readRowIds(body, PASS2_CHUNK);
  if (!ids) return Response.json({ error: `Send 1 to ${PASS2_CHUNK} rowIds` }, { status: 400 });

  if (body?.confirmed === true && !run.confirmed) run = { ...run, confirmed: true };
  if (needsConfirmation(run)) return Response.json({ estimate: estimate(run.rows), quota: await remaining() }, { status: 409 });

  const summaries = run.rows.filter((r) => ids.includes(r.id) && r.state === "pass1");
  const current = run;
  return ndjsonStream(async (emit) => {
    const done: BulkRow[] = [];
    await withLane("bulk", async () => {
      for (const s of summaries) {
        let row = await hydrate(s);
        // The row cache expired since pass 1: redo it rather than guess.
        if (row.state === "pending") row = await runPass1(row);
        const { row: next, waitMs } = await runPass2(row);
        done.push(next);
        emit({ v: 1, type: "row", row: summarize(next) });
        if (waitMs !== undefined) {
          emit({ v: 1, type: "wait", ms: waitMs });
          return;
        }
      }
    });
    await saveRun(mergeRows(current, done));
    emit({ v: 1, type: "done" });
  });
}
```

`app/api/bulk/[runId]/export/route.ts`:

```ts
import { toCsv, toJson } from "@/lib/ti/bulk/export";
import { loadRun } from "@/lib/ti/bulk/run-store";
import { requireSessionUser } from "@/lib/require-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const user = await requireSessionUser();
  if (user instanceof Response) return user;
  const run = await loadRun((await ctx.params).runId, user.email);
  if (!run) return Response.json({ error: "Run not found" }, { status: 404 });
  const json = new URL(req.url).searchParams.get("format") === "json";
  return new Response(json ? toJson(run.rows) : toCsv(run.rows), {
    headers: {
      "content-type": json ? "application/json" : "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="bulk-${run.id}.${json ? "json" : "csv"}"`,
    },
  });
}
```

- [ ] **Step 5: Typecheck, lint, test, build**

Run: `bun run typecheck && bun run lint && bun run test && bun run build`
Expected: all pass. The build lists the five `/api/bulk` routes as dynamic.

- [ ] **Step 6: Commit**

```bash
git add app/api/bulk lib/ti/bulk/api.ts lib/ti/bulk/api.test.ts
git commit -m "feat(bulk): API routes for create, pass 1, pass 2, status and export"
```

---

### Task 13: CLI

**Files:**
- Create: `scripts/bulk.ts`

**Interfaces:**
- Consumes: Tasks 3, 4, 6, 7, 9, 10 and 11.
- Produces: `bun --env-file=.env.local scripts/bulk.ts <file> [--include-weak] [--concurrency 5] [--yes] [--out-dir <dir>]` and `... scripts/bulk.ts --resume <runId|dir> [--yes]`.

`scripts/` is outside Sonar and coverage. The logic it calls is tested in `lib/`, and this task is verified by running it (Step 2).

- [ ] **Step 1: Write `scripts/bulk.ts`**

```ts
// Bulk lookup from a file, any size. Runs over 1,000 rows start with pass 0
// (local feeds) and escalate only strong hits. The run lives in a directory
// (default ~/.ophanim/bulk/<id>), so it can be stopped and resumed.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { withLane } from "@/lib/ti/keys";
import { withRequestMemo } from "@/lib/ti/request-memo";
import { confirmAt } from "@/lib/ti/bulk/api";
import { escalationQueue, estimate, estimateTotal, newRow, runPass1, runPass2 } from "@/lib/ti/bulk/engine";
import { mapLimit } from "@/lib/ti/bulk/limit";
import { parseBulkInput, WEB_CAP } from "@/lib/ti/bulk/parse";
import { runPass0, settlePass0 } from "@/lib/ti/bulk/pass0";
import { appendRows, defaultRoot, initRunDir, loadRunDir, resolveRunDir, saveState, writeOutputs, type RunState } from "@/lib/ti/bulk/run-dir";
import { summarize } from "@/lib/ti/bulk/run-store";
import type { BulkRow } from "@/lib/ti/bulk/types";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    resume: { type: "string" },
    "include-weak": { type: "boolean", default: false },
    concurrency: { type: "string", default: "5" },
    yes: { type: "boolean", default: false },
    "out-dir": { type: "string" },
  },
});

const PASS0_BATCH = 2000;
const log = (msg: string) => console.error(msg);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function start(): string {
  if (values.resume) return resolveRunDir(values.resume);
  const file = positionals[0];
  if (!file) throw new Error("Usage: scripts/bulk.ts <file> [--include-weak] [--concurrency n] [--yes] [--out-dir dir] | --resume <id|dir>");
  const parsed = parseBulkInput(readFileSync(file, "utf8"));
  const id = crypto.randomUUID();
  const dir = values["out-dir"] ?? join(defaultRoot(), id);
  const state: RunState = {
    v: 1, id, createdAt: new Date().toISOString(), phase: parsed.items.length > WEB_CAP ? "pass0" : "pass1",
    includeWeak: values["include-weak"]!, concurrency: Math.max(1, Number(values.concurrency) || 5),
    confirmed: false, invalid: parsed.invalid, duplicates: parsed.duplicates,
  };
  initRunDir(dir, state, parsed.items);
  log(`${parsed.items.length} indicators, ${parsed.duplicates} duplicates, ${parsed.invalid.length} invalid`);
  log(`run ${id} in ${dir}`);
  return dir;
}

async function pass0(dir: string, state: RunState, rows: Map<number, BulkRow>, items: ReturnType<typeof loadRunDir>["items"]) {
  const todo = items.map((item, i) => rows.get(i) ?? newRow(i, item)).filter((r) => r.state === "pending" && r.kind === "ip");
  for (let i = 0; i < todo.length; i += PASS0_BATCH) {
    const batch = todo.slice(i, i + PASS0_BATCH);
    const summaries = await Promise.all(batch.map((r) => runPass0(r.indicator)));
    const settled = batch.flatMap((r, j) => {
      const done = settlePass0(r, summaries[j], state.includeWeak);
      return done ? [done] : [];
    });
    appendRows(dir, settled);
    for (const r of settled) rows.set(r.id, r);
    log(`pass 0: ${Math.min(i + PASS0_BATCH, todo.length)}/${todo.length}`);
  }
}

async function pass1(dir: string, state: RunState, rows: Map<number, BulkRow>, items: ReturnType<typeof loadRunDir>["items"]) {
  const todo = items.map((item, i) => rows.get(i) ?? newRow(i, item)).filter((r) => r.state === "pending" || r.state === "internal");
  let n = 0;
  await withLane("bulk", () =>
    withRequestMemo(() =>
      mapLimit(todo, state.concurrency, (r) => runPass1(r), (r) => {
        appendRows(dir, [r]);
        rows.set(r.id, r);
        if (++n % 100 === 0 || n === todo.length) log(`pass 1: ${n}/${todo.length}`);
      }),
    ),
  );
}

async function pass2(dir: string, state: RunState, rows: Map<number, BulkRow>): Promise<boolean> {
  const all = [...rows.values()];
  const total = estimateTotal(estimate(all));
  if (!state.confirmed && total > confirmAt() && !values.yes) {
    log(`pass 2 needs ${total} metered calls: ${JSON.stringify(estimate(all))}`);
    log(`re-run with: bun --env-file=.env.local scripts/bulk.ts --resume ${state.id} --yes`);
    return false;
  }
  state.confirmed = true;
  saveState(dir, state);
  await withLane("bulk", async () => {
    for (let row = escalationQueue([...rows.values()])[0]; row; row = escalationQueue([...rows.values()])[0]) {
      const { row: next, waitMs } = await runPass2(row);
      appendRows(dir, [next]);
      rows.set(next.id, next);
      if (waitMs !== undefined) {
        log(`VirusTotal minute cap, waiting ${Math.ceil(waitMs / 1000)}s`);
        await sleep(waitMs);
      }
    }
  });
  return true;
}

const dir = start();
const { state, items, rows } = loadRunDir(dir);
if (state.phase === "pass0") {
  await pass0(dir, state, rows, items);
  state.phase = "pass1";
  saveState(dir, state);
}
if (state.phase === "pass1") {
  await pass1(dir, state, rows, items);
  state.phase = "pass2";
  saveState(dir, state);
}
if (state.phase === "pass2" && (await pass2(dir, state, rows))) {
  state.phase = "done";
  saveState(dir, state);
}
const ordered = items.map((item, i) => summarize(rows.get(i) ?? newRow(i, item)));
process.stdout.write(writeOutputs(dir, ordered, state));
log(`results in ${dir}`);
```

When a key is missing or there is no Redis, `reserveBulk` returns `nokey` or `unavailable`. Every pending source is then recorded as missing on the first call, the loop drains, and rows end `partial` with the reason, as the spec says.

- [ ] **Step 2: Verify by running it, small then large**

Small, with every real-input case:

```bash
printf '185.220.101.1\r\n1.1.1.1 \r\n15.03.05.16\r\nevil[.]com\r\ngoogle.com\r\nGvaq70s7he.ru\r\ngvaq70s7he.ru\r\nหีหอม.com\r\nSGPAPHQ-ADDC04.dc01.fujixerox.net\r\n216.126.237.0/24\r\nd41d8cd98f00b204e9800998ecf8427e\r\n' > /tmp/claude-1000/bulk-small.txt
TI_INTERNAL_SUFFIXES=dc01.fujixerox.net bun --env-file=.env.local scripts/bulk.ts /tmp/claude-1000/bulk-small.txt --out-dir /tmp/claude-1000/bulk-small --yes
cat /tmp/claude-1000/bulk-small/results.csv
```

Expected: 8 rows. `google.com` has depth `free` and bucket D. The fujixerox row is `internal`. `15.3.5.16` carries the leading-zero note. `xn--y3ctai2b.com` shows `หีหอม.com` as its display. `invalid.csv` lists the CIDR and the hash.

Large, on a 20k slice of the real file, to keep the run bounded:

```bash
head -n 40000 /home/siriwat-dev-debian/.claude/uploads/9e7ae34d-339c-4cc6-9adc-60eab9bf2ffc/e330a2cf-IPSVI.txt > /tmp/claude-1000/ips-slice.txt
bun --env-file=.env.local scripts/bulk.ts /tmp/claude-1000/ips-slice.txt --out-dir /tmp/claude-1000/bulk-large
# interrupt with Ctrl-C during pass 1, then:
bun --env-file=.env.local scripts/bulk.ts --resume /tmp/claude-1000/bulk-large
cat /tmp/claude-1000/bulk-large/summary.txt
```

Expected: pass 0 finishes in seconds. Most rows end at depth `feed`. Resume continues pass 1 without redoing settled rows (check that `rows.jsonl` has no duplicate ids from before the interrupt, other than a pass 1 then pass 2 progression). Pass 2 stops to ask for confirmation unless `--yes`.

- [ ] **Step 3: Commit**

```bash
git add scripts/bulk.ts
git commit -m "feat(bulk): CLI runner with pass 0, run directory and resume"
```

---

### Task 14: The `/bulk` page

**Files:**
- Modify: `lib/route-mode.ts` and `lib/route-mode.test.ts`
- Create: `app/bulk/page.tsx`, `components/Bulk/BulkLookup.tsx`, `components/Bulk/use-bulk-run.ts`, `components/Bulk/results-table.tsx`, `components/Bulk/confirm-bar.tsx`, `components/Bulk/quota-strip.tsx`
- Modify: `app/page.tsx` (a `Bulk lookup` link under the search box)

Before writing: read `node_modules/next/dist/docs/` for page and client component conventions, and `components/Checker/lookup.ts` for how the app reads NDJSON with `readNdjson` (`lib/ndjson.ts`).

**Interfaces:**
- Consumes: the Task 12 routes and their types (`BulkEvent`, `RowSummary`, `BulkRun`, `QuotaRemaining`, `MeteredId`, `depthOf`).

- [ ] **Step 1: Failing route-mode test**

```ts
it("reads /bulk as the passive landing page", () => {
  expect(modeRouteFor("/bulk")).toEqual({ mode: "passive" });
});
```

Run: `bun run test lib/route-mode.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement** in `modeRouteFor`:

```ts
  if (parts.length === 1) {
    if (parts[0] === "bulk") return { mode: "passive" };
    return parts[0] === SEGMENT_OF_MODE.active ? { mode: "active" } : null;
  }
```

Run the test again. Expected: PASS.

- [ ] **Step 3: The runner hook `components/Bulk/use-bulk-run.ts`**

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readNdjson } from "@/lib/ndjson";
import type { BulkEvent } from "@/lib/ti/bulk/api";
import type { QuotaRemaining } from "@/lib/ti/bulk/quota";
import type { BulkRun, MeteredId, RowSummary } from "@/lib/ti/bulk/types";

const PASS1_CHUNK = 25;
const PASS2_CHUNK = 4;

export interface RunView {
  run: BulkRun;
  estimate: Partial<Record<MeteredId, number>>;
  needsConfirmation: boolean;
  quota: QuotaRemaining[] | null;
}

export type Phase = "idle" | "pass1" | "confirm" | "pass2" | "waiting" | "done" | "error";

/** -1 means the server wants confirmation first. */
async function stream(url: string, body: unknown, onRow: (row: RowSummary) => void): Promise<number | undefined> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (res.status === 409) return -1;
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  let wait: number | undefined;
  for await (const event of readNdjson<BulkEvent>(res.body)) {
    if (event.type === "row") onRow(event.row);
    if (event.type === "wait") wait = event.ms;
    if (event.type === "error") throw new Error(event.error);
  }
  return wait;
}

/** Drives a run from the browser. The run record in Redis is the truth: every
 *  step re-reads it, so a reload picks up where the last chunk ended. */
export function useBulkRun(runId: string | null) {
  const [view, setView] = useState<RunView | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const confirmed = useRef(false);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/bulk/${runId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const next = (await res.json()) as RunView;
    setView(next);
    return next;
  }, [runId]);

  const patchRow = useCallback((row: RowSummary) => {
    setView((v) => (v ? { ...v, run: { ...v.run, rows: v.run.rows.map((r) => (r.id === row.id ? row : r)) } } : v));
  }, []);

  const runPass1 = useCallback(async (v: RunView) => {
    const pending = v.run.rows.filter((r) => r.state === "pending").map((r) => r.id);
    for (let i = 0; i < pending.length; i += PASS1_CHUNK) {
      await stream(`/api/bulk/${runId}/pass1`, { rowIds: pending.slice(i, i + PASS1_CHUNK) }, patchRow);
    }
  }, [runId, patchRow]);

  const runPass2 = useCallback(async (): Promise<"done" | "confirm"> => {
    for (;;) {
      const queue = (await refresh()).run.rows.filter((r) => r.state === "pass1").map((r) => r.id);
      if (queue.length === 0) return "done";
      const wait = await stream(`/api/bulk/${runId}/pass2`, { rowIds: queue.slice(0, PASS2_CHUNK), confirmed: confirmed.current }, patchRow);
      if (wait === -1) return "confirm";
      if (wait !== undefined) {
        setPhase("waiting");
        await new Promise((r) => setTimeout(r, wait));
        setPhase("pass2");
      }
    }
  }, [runId, refresh, patchRow]);

  const drive = useCallback(async () => {
    setPhase("pass1");
    await runPass1(await refresh());
    const v = await refresh();
    if (v.needsConfirmation && !confirmed.current) return setPhase("confirm");
    setPhase("pass2");
    setPhase(await runPass2());
  }, [refresh, runPass1, runPass2]);

  const go = useCallback(() => {
    drive().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    });
  }, [drive]);

  useEffect(() => {
    if (runId) go();
  }, [runId, go]);

  const accept = useCallback(() => {
    confirmed.current = true;
    go();
  }, [go]);
  const skip = useCallback(() => setPhase("done"), []);

  return { view, phase, error, accept, skip };
}
```

- [ ] **Step 4: The components**

`components/Bulk/confirm-bar.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";
import type { QuotaRemaining } from "@/lib/ti/bulk/quota";
import type { MeteredId, MeteredKeyEnv } from "@/lib/ti/bulk/types";

export const SOURCE_NAMES: Record<MeteredId, string> = {
  virustotal: "VirusTotal", abuseipdb: "AbuseIPDB", greynoise: "GreyNoise", otx: "OTX", safebrowsing: "Safe Browsing",
};
const KEY_OF: Record<MeteredId, MeteredKeyEnv> = {
  virustotal: "VIRUSTOTAL_API_KEY", abuseipdb: "ABUSEIPDB_API_KEY", greynoise: "GREYNOISE_API_KEY", otx: "OTX_API_KEY", safebrowsing: "GOOGLE_SAFE_BROWSING_API_KEY",
};

export function poolLabel(id: MeteredId, quota: QuotaRemaining[] | null): string {
  const pool = quota?.find((q) => q.keyEnv === KEY_OF[id]);
  return `${SOURCE_NAMES[id]} (${pool?.own ? "bulk key" : "shared"})`;
}

export function ConfirmBar({ estimate, quota, onAccept, onSkip }: {
  estimate: Partial<Record<MeteredId, number>>;
  quota: QuotaRemaining[] | null;
  onAccept: () => void;
  onSkip: () => void;
}) {
  const ids = Object.keys(estimate) as MeteredId[];
  const need = ids.map((id) => `${estimate[id]} ${poolLabel(id, quota)}`).join(", ");
  const left = ids.map((id) => quota?.find((q) => q.keyEnv === KEY_OF[id])?.bulkLeft ?? 0).join(" and ");
  return (
    <div role="status" className="flex items-center justify-between gap-4 rounded-md border border-border p-3 text-sm">
      <p>Enrichment needs {need} lookups. Bulk has {left} left today.</p>
      <div className="flex gap-2">
        <Button size="sm" onClick={onAccept}>Enrich</Button>
        <Button size="sm" variant="outline" onClick={onSkip}>Skip</Button>
      </div>
    </div>
  );
}
```

`components/Bulk/results-table.tsx` is a plain `<table>` with these columns:
- *Indicator*: the punycode, with `display` beneath it in muted text when present. It links to `passiveHref(row.indicator)`, except for `internal` rows, which show plain text.
- *Kind*.
- *Verdict*: reuse the verdict badge component from `components/CheckResults/`, found with `grep -rln "verdict" components/CheckResults | xargs grep -l "export function .*Verdict"`. If none is exported, render the word and colour it through the existing verdict colour tokens. `feed-only` and `internal` rows show the note instead of a verdict.
- *Score*.
- *Depth* (`depthOf`).
- *Note*: from a `noteFor(row)` helper. For `partial` rows it is `No ` followed by the missing source names joined with `, `. Otherwise it is `row.note`.

Sort by `severity(verdict)` (malicious, suspicious, low, clean, unknown, none), then by id. Add a depth filter (`All`, `Not full`) as two toggle buttons, and put the export links (`/api/bulk/<id>/export?format=csv` and `json`, as `<a download>`) in the header. Keep every function under complexity 15 by giving `noteFor` and `severity` their own functions.

`components/Bulk/quota-strip.tsx` has one line per `QuotaRemaining`: `VirusTotal, bulk key, 412 of 500 left` or `VirusTotal, shared, 212 left for bulk, 88 used today`. It renders nothing when `quota` is null or empty.

`components/Bulk/BulkLookup.tsx`:

```tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { parseBulkInput, WEB_CAP } from "@/lib/ti/bulk/parse";
import { ConfirmBar } from "./confirm-bar";
import { QuotaStrip } from "./quota-strip";
import { ResultsTable } from "./results-table";
import { useBulkRun } from "./use-bulk-run";

export function BulkLookup() {
  const router = useRouter();
  const runId = useSearchParams().get("run");
  const [text, setText] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { view, phase, error, accept, skip } = useBulkRun(runId);
  const parsed = useMemo(() => parseBulkInput(text), [text]);
  const ips = parsed.items.filter((i) => i.kind === "ip").length;
  const internal = parsed.items.filter((i) => i.internal).length;

  async function submit() {
    setSubmitError(null);
    const res = await fetch("/api/bulk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: text }) });
    const body = await res.json();
    if (!res.ok) return setSubmitError(body.error);
    router.push(`/bulk?run=${body.runId}`);
  }

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-4 p-6">
      <textarea
        aria-label="Indicators, one per line"
        className="h-40 w-full rounded-md border border-border bg-background p-3 font-mono text-sm"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste IPs and domains, one per line. Defanged is fine."
      />
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {parsed.items.length} indicators, {ips} IP, {parsed.items.length - ips} domain, {parsed.duplicates} duplicates, {internal} internal, {parsed.invalid.length} not supported
        </span>
        <Button onClick={submit} disabled={parsed.items.length === 0 || parsed.items.length > WEB_CAP}>Look up</Button>
      </div>
      {parsed.items.length > WEB_CAP && (
        <p className="text-sm">More than {WEB_CAP} indicators. Use the CLI: bun --env-file=.env.local scripts/bulk.ts your-file.txt</p>
      )}
      {submitError && <p role="alert" className="text-sm">{submitError}</p>}
      {error && <p role="alert" className="text-sm">{error}</p>}
      {phase === "confirm" && view && <ConfirmBar estimate={view.estimate} quota={view.quota} onAccept={accept} onSkip={skip} />}
      {phase === "waiting" && <p className="text-sm text-muted-foreground">VirusTotal allows 4 lookups a minute, continuing shortly.</p>}
      {view && <ResultsTable rows={view.run.rows} runId={view.run.id} />}
      {view && <QuotaStrip quota={view.quota} />}
    </section>
  );
}
```

Parsing on every keystroke runs over the whole textarea. At the 1,000-row cap that takes milliseconds, and `useMemo` keeps it to one pass per change.

`app/bulk/page.tsx`:

```tsx
import { Suspense } from "react";
import { BulkLookup } from "@/components/Bulk/BulkLookup";

export const metadata = { title: "Bulk lookup" };

export default function BulkPage() {
  return (
    <Suspense>
      <BulkLookup />
    </Suspense>
  );
}
```

In `app/page.tsx`, add `<Link href="/bulk">Bulk lookup</Link>` under the search box, styled like the page's existing secondary links.

- [ ] **Step 5: Lint, typecheck, test, build**

Run: `bun run typecheck && bun run lint && bun run test && bun run build`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add lib/route-mode.ts lib/route-mode.test.ts app/bulk app/page.tsx components/Bulk
git commit -m "feat(bulk): /bulk page with browser-paced runner, depth and per-key quota"
```

---

### Task 15: End-to-end verification

**Files:** none, unless a fix is needed.

- [ ] **Step 1: Full suite and coverage**

```bash
bun run typecheck && bun run lint && bun run test && bun run coverage
node scripts/coverage-gaps.mjs lib/ti/bulk
node scripts/coverage-gaps.mjs lib/ti/keys.ts
```

Expected: everything passes, and both gap outputs are empty.

- [ ] **Step 2: Production build on :3001** (never touch the user's `:3000`)

```bash
bun run build
AUTH_TRUST_HOST=true TI_INTERNAL_SUFFIXES=dc01.fujixerox.net bun run start -- -p 3001
```

- [ ] **Step 3: Drive `/bulk` with a minted session**

Mint an `authjs.session-token` with `encode()` from `@auth/core/jwt`, as `scripts/verify-loading.mjs` does. Then load `http://localhost:3001/bulk` at 1280 wide with Playwright and paste the contents of `DNSIOCSVI.txt` (from the user's upload, `aacbb6c3-DNSIOCSVI.txt`). Screenshot each check:

1. The parse line reads `114 indicators, ... 13 internal, ...` (adjust the count if `parseDomain` rejects any name, and note which).
2. The `fujixerox` rows are `internal`, have no link, and the server log shows no outbound request for them.
3. `หีหอม.com` appears under its punycode.
4. `accounts.google.com` is depth `free` with a vouch note. The typosquats `fyAA.mlcrosoft.win` and `raw.githubsercontent.com` are bucket C or B and queued for pass 2.
5. With `TI_BULK_CONFIRM_AT=0`, the confirm bar names pools as `bulk key` or `shared` correctly for the env present. `Skip` leaves rows at depth `free` with a `partial` note.
6. Reloading `/bulk?run=<id>` mid-run resumes without redoing settled rows.
7. CSV export opens with the `depth` column.
8. `/check/differentia.ru` after the run still shows its full context panel, which proves bulk never wrote the shared cache.

- [ ] **Step 4: Ledger sanity**

Read the day counters for every configured pool from Redis (`ti:quota:v1:*:day:<today>` via `SCAN`). Each bulk counter must be no higher than its day counter, and no higher than `daily × share`. A pool whose key has a `_BULK` variant must appear under a different fingerprint from the shared one.

- [ ] **Step 5: Report**

Post the screenshots, `summary.txt` from the Task 13 large slice run, and the pass 0 timing from Task 7 to the coordinator. **Do not open a PR.** The user decides when (memory rule *Ask before opening PRs*).

---

### Task 16: Tranco from a local list, with parent vouch (bulk lane)

**Files:**
- Create: `lib/ti/domain/tranco-list.ts`, `lib/ti/domain/tranco-list.test.ts`
- Modify: `lib/ti/domain/sources/tranco.ts` (the `check` method), `lib/ti/domain/sources/tranco.test.ts`
- Modify: `package.json` / `bun.lock` (`bun add tldts`)

**Interfaces:**
- Consumes: Task 3 `currentLane`, `getText` / `getJson` (`lib/ti/http.ts`), `sharedLoader` (`lib/ti/shared-feed.ts`).
- Produces: `parseTrancoCsv(text): Map<string, number>`; `SHARED_HOSTING: readonly string[]`; `parentDomain(host): string | null` (null for shared hosting, or when the host is its own registrable domain); `loadTopList(signal): Promise<Map<string, number>>`; `bulkTrancoFinding(domain, top): SourceFinding`.

Why this exists: in the 2026-10-07 spike, Tranco's API returned `429` on the
second domain, and `accounts.google.com` never vouched, because Tranco ranks
registrable domains only. See the spec, *Tranco in bulk*.

- [ ] **Step 1: Add the dependency**

Run: `bun add tldts`
Expected: `tldts` appears in `package.json` dependencies. The repo only has `tldts-icann` transitively, which lacks the PSL private section.

- [ ] **Step 2: Write the failing tests** (`lib/ti/domain/tranco-list.test.ts`)

```ts
import { afterEach, describe, expect, it } from "vitest";
import { bulkTrancoFinding, parentDomain, parseTrancoCsv } from "./tranco-list";

afterEach(() => delete process.env.TI_SHARED_HOSTING_SUFFIXES);

const top = parseTrancoCsv("1,google.com\r\n103,b-cdn.net\r\n445,tencent-cloud.net\r\n225,pages.dev\r\nbad line\r\n");

describe("parseTrancoCsv", () => {
  it("reads rank,domain lines and skips junk", () => {
    expect(top.get("google.com")).toBe(1);
    expect(top.size).toBe(4);
  });
});

describe("parentDomain", () => {
  it("returns the registrable parent of a subdomain", () => {
    expect(parentDomain("accounts.google.com")).toBe("google.com");
    expect(parentDomain("corporate.tops.co.th")).toBe("tops.co.th");
  });
  it("returns null for a registrable domain itself", () => {
    expect(parentDomain("google.com")).toBeNull();
  });
  it("never treats PSL-private or hand-listed shared hosting as a parent", () => {
    expect(parentDomain("x.pages.dev")).toBeNull();
    expect(parentDomain("adsninjacdn.b-cdn.net")).toBeNull();
    expect(parentDomain("ins-9hkazpwd.ias.tencent-cloud.net")).toBeNull();
    process.env.TI_SHARED_HOSTING_SUFFIXES = "tops.co.th";
    expect(parentDomain("corporate.tops.co.th")).toBeNull();
  });
});

describe("bulkTrancoFinding", () => {
  it("vouches an exact top-1,000 domain, as /check would", () => {
    expect(bulkTrancoFinding("google.com", top)).toMatchObject({ status: "ok", allowlisted: true });
  });
  it("gives a subdomain a parent vouch, never allowlisted", () => {
    const f = bulkTrancoFinding("accounts.google.com", top);
    expect(f.allowlisted).toBeFalsy();
    expect(f.details).toEqual({ parentVouch: { parent: "google.com", rank: 1 } });
    expect(f.summary).toBe("Under google.com, Tranco rank 1");
  });
  it("gives shared hosting and unknown domains nothing", () => {
    expect(bulkTrancoFinding("adsninjacdn.b-cdn.net", top)).toEqual({ status: "ok", summary: "Not in the Tranco top 1,000" });
    expect(bulkTrancoFinding("gvaq70s7he.ru", top)).toEqual({ status: "ok", summary: "Not in the Tranco top 1,000" });
  });
});
```

In `lib/ti/domain/sources/tranco.test.ts`, add cases using the file's existing fetch mock:
- In the `bulk` lane, `check("accounts.google.com")` makes **no** request to `/api/ranks/domain/` (it may request the two list endpoints once) and returns the parent vouch.
- If the list download fails in the `bulk` lane, the result is `status: "error"`, and there is no fallback to the per-domain API.
- In the `check` lane, behaviour is unchanged.

- [ ] **Step 3: Run to see them fail**

Run: `bun run test lib/ti/domain/tranco-list.test.ts lib/ti/domain/sources/tranco.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 4: Implement `lib/ti/domain/tranco-list.ts`**

```ts
import { getDomain } from "tldts";
import { getJson, getText } from "../http";
import { sharedLoader } from "../shared-feed";
import type { SourceFinding } from "../types";

const LATEST = "https://tranco-list.eu/api/lists/date/latest";
const TOP_N = 1000; // VOUCH_RANK: exactly the set that can vouch
const TTL_MS = 24 * 60 * 60 * 1000;

/** Popular registrable domains whose subdomains belong to customers, which the
 *  Public Suffix List's private section does not cover (checked 2026-10-07).
 *  Both appear in a real IOC file: adsninjacdn.b-cdn.net, *.tencent-cloud.net. */
export const SHARED_HOSTING: readonly string[] = ["b-cdn.net", "tencent-cloud.net"];

function sharedHosting(): string[] {
  const extra = (process.env.TI_SHARED_HOSTING_SUFFIXES ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [...SHARED_HOSTING, ...extra];
}

export function parseTrancoCsv(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of text.split(/\r?\n/)) {
    const [rank, domain] = line.split(",");
    const n = Number(rank);
    if (domain && Number.isInteger(n) && n > 0) out.set(domain.trim().toLowerCase(), n);
  }
  return out;
}

/** The registrable parent, or null when the host is its own registrable domain
 *  or sits under shared hosting, where a parent's popularity says nothing. */
export function parentDomain(host: string): string | null {
  const parent = getDomain(host, { allowPrivateDomains: true });
  if (!parent || parent === host) return null;
  return sharedHosting().includes(parent) ? null : parent;
}

let cache: { top: Map<string, number>; fetchedAt: number } | null = null;

const download = sharedLoader(async (signal) => {
  const latest = await getJson<{ list_id?: string }>(LATEST, signal);
  if (!latest.ok || !latest.data?.list_id) throw new Error(`Tranco list id unavailable (HTTP ${latest.status})`);
  const csv = await getText(`https://tranco-list.eu/download/${latest.data.list_id}/${TOP_N}`, signal);
  if (!csv.ok || !csv.text) throw new Error(`Tranco list unavailable (HTTP ${csv.status})`);
  cache = { top: parseTrancoCsv(csv.text), fetchedAt: Date.now() };
  return cache;
});

export async function loadTopList(signal: AbortSignal): Promise<Map<string, number>> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache.top;
  return (await download(signal)).top;
}

/** The bulk lane's answer. An exact hit is the vouch /check would give; a
 *  parent hit is bucketing only and deliberately not `allowlisted`. */
export function bulkTrancoFinding(domain: string, top: Map<string, number>): SourceFinding {
  const exact = top.get(domain);
  if (exact !== undefined) {
    return { status: "ok", allowlisted: true, summary: `Tranco rank ${exact}, a top-ranked domain`, details: { rank: exact, vouched: true } };
  }
  const parent = parentDomain(domain);
  const rank = parent ? top.get(parent) : undefined;
  if (parent && rank !== undefined) {
    return { status: "ok", summary: `Under ${parent}, Tranco rank ${rank}`, details: { parentVouch: { parent, rank } } };
  }
  return { status: "ok", summary: "Not in the Tranco top 1,000" };
}
```

Match `sharedLoader`'s exact signature in `lib/ti/shared-feed.ts`, and the `getText`/`getJson` return shapes in `lib/ti/http.ts`, the way `ipsum.ts` uses them.

- [ ] **Step 5: Route the adapter by lane** (`lib/ti/domain/sources/tranco.ts`, top of `check`)

```ts
import { currentLane } from "../../keys";
import { bulkTrancoFinding, loadTopList } from "../tranco-list";
// ...
  async check(domain, signal): Promise<SourceFinding> {
    // Bulk asks about thousands of domains; the per-domain API rate-limits on
    // the second. The daily top list answers the only question that moves a
    // score (rank <= VOUCH_RANK) from memory.
    if (currentLane() === "bulk") {
      try {
        return bulkTrancoFinding(domain, await loadTopList(signal));
      } catch (err) {
        return { status: isTimeout(err) ? "timeout" : "error", error: errorMessage(err) };
      }
    }
    // ...existing API path unchanged
```

- [ ] **Step 6: Run the tests, then probe the live list**

Run: `bun run test lib/ti/domain lib/ti/bulk`
Expected: PASS.

Then check against the live list with a throwaway file `.tranco-probe.ts` at the repo root (delete it afterwards). It should call `withLane("bulk", () => trancoSource.check(d, AbortSignal.timeout(20000)))` for `accounts.google.com`, `google.com`, `adsninjacdn.b-cdn.net`, `gvaq70s7he.ru` and `fyaa.mlcrosoft.win`, and print each result.

Expected:
- `accounts.google.com` has a parent vouch for `google.com`.
- `google.com` is allowlisted.
- The other three have nothing.
- There is no `429`.

- [ ] **Step 7: Commit**

```bash
git add package.json bun.lock lib/ti/domain/tranco-list.ts lib/ti/domain/tranco-list.test.ts lib/ti/domain/sources/tranco.ts lib/ti/domain/sources/tranco.test.ts
git commit -m "feat(bulk): Tranco from a daily top-1,000 list, parent vouch for bucketing"
```

---

## Self-review notes

- **Spec coverage.** Decision 13 (Tranco) → T16 and the T2 parent-vouch cases. Decisions 1 to 12 map to tasks: 1 → T6 (kinds) and T13 (sizes); 2 → T1, T9; 3 → T4, T5, T12; 4 → T8; 5 → T1, T9; 6 → T12, T13; 7 → T10 (web), T11 (CLI); 8 → T7, T13; 9 → T3, T4, T9 (`never borrows`); 10 → T6, T9 (`newRow`, `runPass1` guard); 11 → T6; 12 → T11. Depth → T1 (`depthOf`), T10 (export), T14 (UI). Real-input cases → the T6 fixtures and the T13 small file.
- **Names are consistent across tasks:** `reserveBulk(keyEnv)` / `Reservation` (`nokey` added), `markExhausted(keyEnv, lane)`, `runPass0` / `settlePass0`, `runPass1` / `runPass2`, `summarize` / `hydrate`, `RowSummary`, `depthOf`, `PASS1_CHUNK` / `PASS2_CHUNK`, `BulkEvent` with `v: 1`.
- **Judgment calls left to the executor, each with a fallback:** the verdict badge component (T14), and each adapter test's fetch-mock shape (T3).
