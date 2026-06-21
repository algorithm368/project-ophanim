# Theme B — Scoring-Model Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the aggregate verdict defensible: gate the hard `malicious` floor on weight/quorum, let allowlists and EICAR suppress false positives, and expose the score's intermediates so the narrative stops re-deriving them.

**Architecture:** Enrich `lib/ti/aggregate.ts` in place — `aggregateRisk` stays the one scoring entry point but is decomposed into named constants + a pure `computeFloor` helper and returns a `ScoreBreakdown`. EICAR/benign lives in a new `lib/ti/benign.ts` consulted at the assemble layer (it needs the indicator value, which `aggregateRisk` never sees). An additive `allowlisted` flag on `SourceFinding` carries the allowlist signal from sources to the aggregate.

**Tech Stack:** TypeScript, Next.js 16, Vitest (unit, no network, `@/` alias). Pure functions, colocated `*.test.ts`.

## Global Constraints

- **Tests:** Vitest, files are `lib/**/*.test.ts` colocated next to source; use the `@/` alias. Run `npm test` before declaring work done. No network in unit tests.
- **User-facing copy uses commas, not dashes** — no em/en-dash and no `" - "` separators in any narrative string (hyphenated compound words like "anti-malware" are fine).
- **Free APIs only** — no new paid sources; this change touches scoring only, adds none.
- **`aggregateRisk` return change is additive on the wire** — `scoreBreakdown` is optional on every result type, so older cached entries without it still deserialize.
- **Source adapter convention** (unchanged): catch errors, honor `AbortSignal`, never throw.

---

### Task 1: Types and constants foundation (B5 scaffolding)

Adds the `ScoreBreakdown` type, the `allowlisted` source flag, the `scoreBreakdown` field on all three result types, and the named constants in `aggregate.ts` (replacing the verdict-cutoff literals in `verdictFor`). Pure scaffolding + a behavior-preserving refactor covered by the existing `verdictFor` tests — no new test, the deliverable is "compiles, full suite still green."

**Files:**
- Modify: `lib/ti/types.ts` (add `allowlisted` to `SourceFinding`; add `ScoreBreakdown`; add `scoreBreakdown?` to `CheckResult`/`DomainCheckResult`/`HashCheckResult`)
- Modify: `lib/ti/aggregate.ts:1-11` (constants + `verdictFor`)
- Modify: `lib/ti/narrative.ts:10-29` (import `ScoreBreakdown`, add it to `ResultLike`)

**Interfaces:**
- Produces: `ScoreBreakdown` interface; `SourceFinding.allowlisted?: boolean`; `CheckResult.scoreBreakdown?`, `DomainCheckResult.scoreBreakdown?`, `HashCheckResult.scoreBreakdown?`; exported consts `MALICIOUS_AT`, `SUSPICIOUS_AT`, `LOW_AT`, `MAX_SIGNAL_WEIGHT`, `CONSENSUS_WEIGHT`, `MALICIOUS_FLOOR`, `QUORUM_FLOOR`, `FLOOR_MIN_WEIGHT`, `BORDERLINE_BAND` from `lib/ti/aggregate.ts`.

- [ ] **Step 1: Add `allowlisted` to `SourceFinding`**

In `lib/ti/types.ts`, inside `interface SourceFinding`, right after the `confidence` field (line 223):

```ts
  /** 0-100 confidence in the score. */
  confidence?: number;
  /** An authoritative allowlist explicitly vouches for this indicator
   *  (e.g. Maltiverse "whitelist", Hybrid-Analysis whitelisted, AbuseIPDB
   *  isWhitelisted). Read by aggregateRisk() to suppress a weak floor. */
  allowlisted?: boolean;
```

- [ ] **Step 2: Add the `ScoreBreakdown` interface**

In `lib/ti/types.ts`, immediately before `export interface CheckResult` (line 276):

```ts
/** The intermediates aggregateRisk() used to reach a score, so the narrative
 *  and UI can explain the verdict without re-deriving them. */
export interface ScoreBreakdown {
  /** Strongest weighted single signal (score * weight), rounded. */
  effectiveMax: number;
  /** Weighted consensus across scoring sources, rounded. */
  weightedAvg: number;
  /** Source id behind effectiveMax. */
  dominantSourceId?: string;
  /** A hard-listing floor actually raised the score above the blend. */
  floorApplied: boolean;
  /** Source id whose listing set the floor (only when floorApplied). */
  flooredBy?: string;
  /** The floor value applied (e.g. 75 or 50). */
  floorValue?: number;
  /** riskScore sits within BORDERLINE_BAND of a verdict cutoff. */
  borderline: boolean;
  /** A floor was withheld because an allowlist vouched for the indicator. */
  allowlistSuppressed: boolean;
  /** A forced-benign override fired (e.g. "eicar-test-file"). */
  benignOverride?: string;
}
```

- [ ] **Step 3: Add `scoreBreakdown?` to the three result types**

In `lib/ti/types.ts`, add this line to `CheckResult`, `DomainCheckResult`, and `HashCheckResult` (next to each one's existing `cached?` field):

```ts
  /** How the aggregate score was reached, for the narrative + verdict UI. */
  scoreBreakdown?: ScoreBreakdown;
```

- [ ] **Step 4: Add named constants and refactor `verdictFor` in `aggregate.ts`**

Replace `lib/ti/aggregate.ts:1-11` (the imports, `FLAG_THRESHOLD`, and `verdictFor`) with:

```ts
import type { CheckStats, ScoreBreakdown, SourceResult, Verdict } from "./types";

export const FLAG_THRESHOLD = 40;

// Verdict cutoffs (inclusive lower bounds).
export const MALICIOUS_AT = 70;
export const SUSPICIOUS_AT = 40;
export const LOW_AT = 15;

// Blend: lean on the strongest weighted signal, leavened by the consensus.
export const MAX_SIGNAL_WEIGHT = 0.6;
export const CONSENSUS_WEIGHT = 0.4;

// Hard-listing floors and the gate that admits them.
export const MALICIOUS_FLOOR = 75; // one high-weight definitive listing
export const QUORUM_FLOOR = 50; // two or more weak listings agreeing
export const FLOOR_MIN_WEIGHT = 0.7; // authoritative enough to pin alone

// How close to a cutoff still counts as borderline.
export const BORDERLINE_BAND = 5;

const CUTOFFS = [LOW_AT, SUSPICIOUS_AT, MALICIOUS_AT];

export function verdictFor(score: number, hasData: boolean): Verdict {
  if (!hasData) return "unknown";
  if (score >= MALICIOUS_AT) return "malicious";
  if (score >= SUSPICIOUS_AT) return "suspicious";
  if (score >= LOW_AT) return "low";
  return "clean";
}
```

(`ScoreBreakdown` and `CUTOFFS` are imported/declared now; they are consumed in Task 2. An unused import would fail lint, so leave the `ScoreBreakdown` import only if Step 5 of THIS task is done in the same commit — it is.)

- [ ] **Step 5: Import `ScoreBreakdown` into `ResultLike`**

In `lib/ti/narrative.ts`, add `ScoreBreakdown` to the type import block (lines 10-18):

```ts
import type {
  CheckResult,
  CheckStats,
  DomainCheckResult,
  HashCheckResult,
  HistorySnapshot,
  ScoreBreakdown,
  SourceResult,
  Verdict,
} from "./types";
```

Then add `scoreBreakdown` to `ResultLike` (lines 21-29):

```ts
export type ResultLike = {
  riskScore: number;
  verdict: Verdict;
  checkedAt: string;
  cached?: boolean;
  sources: SourceResult[];
  stats: CheckStats;
  history?: HistorySnapshot[];
  scoreBreakdown?: ScoreBreakdown;
};
```

- [ ] **Step 6: Verify the suite is still green and types compile**

Run: `npm test`
Expected: PASS (all existing tests; `verdictFor` cases unchanged in behavior).

Run: `npx tsc --noEmit`
Expected: no errors. (`ScoreBreakdown` is imported and used in the `ResultLike` field; the `aggregate.ts` import resolves.)

- [ ] **Step 7: Commit**

```bash
git add lib/ti/types.ts lib/ti/aggregate.ts lib/ti/narrative.ts
git commit -m "refactor(scoring): name verdict/blend constants, add ScoreBreakdown + allowlisted types"
```

---

### Task 2: Gated two-tier floor + breakdown in `aggregateRisk` (B1 + B5)

The heart of the change. `aggregateRisk` returns `{ riskScore, verdict, breakdown }`, computes the floor via a gated two-tier `computeFloor`, and records the intermediates. Two existing `toEqual` tests are updated for the new return shape.

**Files:**
- Modify: `lib/ti/aggregate.ts:24-60` (rewrite `aggregateRisk`, add `computeFloor` + `emptyBreakdown`)
- Test: `lib/ti/aggregate.test.ts` (extend `src` helper; update 2 tests; add gate cases)

**Interfaces:**
- Consumes: constants + `ScoreBreakdown` from Task 1; `SourceResult.allowlisted`, `SourceResult.malicious`, `SourceResult.source.weight`.
- Produces: `aggregateRisk(results: SourceResult[]) => { riskScore: number; verdict: Verdict; breakdown: ScoreBreakdown }`.

- [ ] **Step 1: Extend the `src` test helper and add the failing gate tests**

In `lib/ti/aggregate.test.ts`, add `allowlisted` to the `src` helper options and body. Replace the helper (lines 5-27) with:

```ts
function src(opts: {
  status: SourceStatus;
  score?: number;
  malicious?: boolean;
  weight?: number;
  id?: string;
  allowlisted?: boolean;
}): SourceResult {
  return {
    source: {
      id: opts.id ?? "s",
      name: "Source",
      url: "https://example.test",
      category: "reputation",
      requiresKey: false,
      weight: opts.weight ?? 1,
    },
    enabled: true,
    durationMs: 1,
    status: opts.status,
    score: opts.score,
    malicious: opts.malicious,
    allowlisted: opts.allowlisted,
  };
}
```

Then add a new describe block at the end of the file (before the final closing of the file, after the `computeStats` describe):

```ts
describe("aggregateRisk — gated two-tier floor (B1)", () => {
  it("pins a single high-weight malicious listing to a 75 floor", () => {
    // Blend already below 75: malicious source carries no score of its own.
    const r = aggregateRisk([
      src({ status: "ok", score: 10, id: "weak", weight: 1 }),
      src({ status: "ok", malicious: true, score: 60, id: "vt", weight: 1 }),
    ]);
    expect(r.riskScore).toBe(75);
    expect(r.verdict).toBe("malicious");
    expect(r.breakdown.floorApplied).toBe(true);
    expect(r.breakdown.flooredBy).toBe("vt");
    expect(r.breakdown.floorValue).toBe(75);
  });

  it("does NOT floor a single low-weight malicious listing", () => {
    const r = aggregateRisk([
      src({ status: "ok", score: 30, malicious: true, id: "tor", weight: 0.4 }),
    ]);
    expect(r.breakdown.floorApplied).toBe(false);
    expect(r.verdict).toBe("low"); // stands on the weighted blend, not 75
  });

  it("raises two agreeing weak listings to a 50 quorum floor", () => {
    const r = aggregateRisk([
      src({ status: "ok", score: 30, malicious: true, id: "tor", weight: 0.4 }),
      src({ status: "ok", score: 40, malicious: true, id: "dnsbl", weight: 0.5 }),
    ]);
    expect(r.riskScore).toBe(50);
    expect(r.verdict).toBe("suspicious");
    expect(r.breakdown.floorValue).toBe(50);
    expect(r.breakdown.flooredBy).toBe("dnsbl"); // strongest of the weak set
  });

  it("lets an allowlist suppress a quorum floor", () => {
    const r = aggregateRisk([
      src({ status: "ok", score: 30, malicious: true, id: "tor", weight: 0.4 }),
      src({ status: "ok", score: 40, malicious: true, id: "dnsbl", weight: 0.5 }),
      src({ status: "ok", score: 0, allowlisted: true, id: "maltiverse", weight: 0.7 }),
    ]);
    expect(r.breakdown.allowlistSuppressed).toBe(true);
    expect(r.breakdown.floorApplied).toBe(false);
    expect(r.verdict).toBe("low"); // 50 floor withheld
  });

  it("lets a high-weight detection beat the allowlist", () => {
    const r = aggregateRisk([
      src({ status: "ok", score: 60, malicious: true, id: "vt", weight: 1 }),
      src({ status: "ok", score: 0, allowlisted: true, id: "maltiverse", weight: 0.7 }),
    ]);
    expect(r.breakdown.allowlistSuppressed).toBe(false);
    expect(r.breakdown.floorApplied).toBe(true);
    expect(r.breakdown.floorValue).toBe(75);
    expect(r.verdict).toBe("malicious");
  });

  it("flags a score near a cutoff as borderline", () => {
    // 0.6*90 + 0.4*45 = 72, two points above the 70 cutoff.
    const near = aggregateRisk([
      src({ status: "ok", score: 90, id: "a" }),
      src({ status: "ok", score: 0, id: "b" }),
    ]);
    expect(near.riskScore).toBe(72);
    expect(near.breakdown.borderline).toBe(true);
    // 0.6*60 + 0.4*60 = 60, ten points from the nearest cutoff.
    const far = aggregateRisk([
      src({ status: "ok", score: 60, id: "a" }),
      src({ status: "ok", score: 60, id: "b" }),
    ]);
    expect(far.riskScore).toBe(60);
    expect(far.breakdown.borderline).toBe(false);
  });

  it("populates the breakdown intermediates", () => {
    const r = aggregateRisk([
      src({ status: "ok", score: 80, id: "vt", weight: 1 }),
      src({ status: "ok", score: 90, id: "ipsum", weight: 0.3 }),
    ]);
    // vt effective 80 beats ipsum effective 27 -> vt dominant.
    expect(r.breakdown.dominantSourceId).toBe("vt");
    expect(r.breakdown.effectiveMax).toBe(80);
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npm test -- aggregate`
Expected: FAIL — `r.breakdown` is undefined (`aggregateRisk` still returns only `{ riskScore, verdict }`).

- [ ] **Step 3: Rewrite `aggregateRisk` and add `computeFloor` + `emptyBreakdown`**

Replace `lib/ti/aggregate.ts:24-60` (the entire current `aggregateRisk`) with:

```ts
function emptyBreakdown(): ScoreBreakdown {
  return {
    effectiveMax: 0,
    weightedAvg: 0,
    floorApplied: false,
    borderline: false,
    allowlistSuppressed: false,
  };
}

/**
 * Decide the hard-listing floor a result qualifies for, if any. Only `ok`,
 * weighted, `malicious===true` sources count. A single high-weight listing pins
 * "malicious" (75); two or more weak ones reach "suspicious" (50); a single weak
 * one pins nothing. Returns the candidate floor plus the facts the caller needs
 * to apply the allowlist-suppression policy.
 */
function computeFloor(results: SourceResult[]): {
  floor: number;
  flooredBy: string;
  highWeight: boolean;
  allowlisted: boolean;
} | null {
  const malicious = results.filter(
    (r) =>
      r.status === "ok" &&
      (r.source.weight ?? 1) > 0 &&
      r.malicious === true,
  );
  if (malicious.length === 0) return null;

  const strongest = malicious.reduce((a, b) =>
    (b.source.weight ?? 1) > (a.source.weight ?? 1) ? b : a,
  );
  const highWeight = (strongest.source.weight ?? 1) >= FLOOR_MIN_WEIGHT;

  let floor: number | null = null;
  if (highWeight) floor = MALICIOUS_FLOOR;
  else if (malicious.length >= 2) floor = QUORUM_FLOOR;
  if (floor === null) return null;

  const allowlisted = results.some(
    (r) => r.status === "ok" && r.allowlisted === true,
  );
  return { floor, flooredBy: strongest.source.id, highWeight, allowlisted };
}

export function aggregateRisk(results: SourceResult[]): {
  riskScore: number;
  verdict: Verdict;
  breakdown: ScoreBreakdown;
} {
  const scored = results.filter(
    (r) =>
      r.status === "ok" &&
      typeof r.score === "number" &&
      (r.source.weight ?? 1) > 0,
  );

  if (scored.length === 0) {
    return { riskScore: 0, verdict: "unknown", breakdown: emptyBreakdown() };
  }

  let weightSum = 0;
  let weightedScoreSum = 0;
  let effectiveMax = 0;
  let dominant = scored[0];
  for (const r of scored) {
    const weight = r.source.weight ?? 1;
    const score = r.score as number;
    weightSum += weight;
    weightedScoreSum += score * weight;
    const eff = score * weight;
    if (eff > effectiveMax) {
      effectiveMax = eff;
      dominant = r;
    }
  }

  const weightedAvg = weightSum > 0 ? weightedScoreSum / weightSum : 0;
  let risk = Math.round(
    MAX_SIGNAL_WEIGHT * effectiveMax + CONSENSUS_WEIGHT * weightedAvg,
  );

  const breakdown: ScoreBreakdown = {
    effectiveMax: Math.round(effectiveMax),
    weightedAvg: Math.round(weightedAvg),
    dominantSourceId: dominant.source.id,
    floorApplied: false,
    borderline: false,
    allowlistSuppressed: false,
  };

  const gate = computeFloor(results);
  if (gate && gate.floor > risk) {
    const suppress = gate.allowlisted && !gate.highWeight;
    if (suppress) {
      breakdown.allowlistSuppressed = true;
    } else {
      risk = gate.floor;
      breakdown.floorApplied = true;
      breakdown.flooredBy = gate.flooredBy;
      breakdown.floorValue = gate.floor;
    }
  }

  risk = Math.min(100, Math.max(0, risk));
  breakdown.borderline = CUTOFFS.some((c) => Math.abs(risk - c) <= BORDERLINE_BAND);

  return { riskScore: risk, verdict: verdictFor(risk, true), breakdown };
}
```

- [ ] **Step 4: Update the two existing tests that assert the old return shape**

In `lib/ti/aggregate.test.ts`, replace the test at the old lines 49-52:

```ts
  it("returns unknown when no source produced a numeric score", () => {
    const r = aggregateRisk([src({ status: "ok" }), src({ status: "skipped" })]);
    expect(r.riskScore).toBe(0);
    expect(r.verdict).toBe("unknown");
  });
```

And replace the test at the old lines 54-59:

```ts
  it("scores a single strong, trusted hit as malicious", () => {
    const r = aggregateRisk([src({ status: "ok", score: 80 })]);
    expect(r.riskScore).toBe(80);
    expect(r.verdict).toBe("malicious");
  });
```

(The remaining `aggregateRisk` tests — "lets the strongest signal lead", "ignores zero-weight sources", "applies a hard-malicious floor of 75" — already use field access and stay green; the last one's malicious source defaults to weight 1, so it still floors to 75.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- aggregate`
Expected: PASS (all gate cases + updated shape tests).

Run: `npx tsc --noEmit`
Expected: no errors (the 3 `assemble.ts` callers destructure `{ riskScore, verdict }` and silently ignore the new `breakdown` field — still valid).

- [ ] **Step 6: Commit**

```bash
git add lib/ti/aggregate.ts lib/ti/aggregate.test.ts
git commit -m "feat(scoring): gate the malicious floor on weight/quorum, return a ScoreBreakdown"
```

---

### Task 3: Assemble-layer wiring + EICAR benign override (B2 hard half)

Attach `scoreBreakdown` to every assembled result and force EICAR (and any future known-benign hash) to clean at the hash assembler.

**Files:**
- Create: `lib/ti/benign.ts`
- Create: `lib/ti/benign.test.ts`
- Modify: `lib/ti/assemble.ts:23-46` (IP), `:56-84` (domain), `:94-111` (hash); imports
- Test: `lib/ti/assemble.test.ts` (add `assembleHashResult` import + benign case)

**Interfaces:**
- Consumes: `aggregateRisk(...).breakdown` from Task 2.
- Produces: `isKnownBenignHash(hash: string) => string | undefined`; `KNOWN_BENIGN_HASHES: Set<string>`; all three assemblers now set `scoreBreakdown`.

- [ ] **Step 1: Write the failing benign test**

Create `lib/ti/benign.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isKnownBenignHash } from "./benign";

describe("isKnownBenignHash", () => {
  it("flags the EICAR md5/sha1/sha256", () => {
    expect(isKnownBenignHash("44d88612fea8a8f36de82e1278abb02f")).toBe(
      "eicar-test-file",
    );
    expect(isKnownBenignHash("3395856ce81f2b7382dee72602f798b642f14140")).toBe(
      "eicar-test-file",
    );
    expect(
      isKnownBenignHash(
        "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f",
      ),
    ).toBe("eicar-test-file");
  });

  it("is case-insensitive", () => {
    expect(isKnownBenignHash("44D88612FEA8A8F36DE82E1278ABB02F")).toBe(
      "eicar-test-file",
    );
  });

  it("returns undefined for an arbitrary hash", () => {
    expect(isKnownBenignHash("deadbeefdeadbeefdeadbeefdeadbeef")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- benign`
Expected: FAIL — cannot resolve `./benign`.

- [ ] **Step 3: Create `lib/ti/benign.ts`**

```ts
/**
 * Hashes that are benign by definition, so the aggregate must not label them
 * malicious no matter how many scanners flag them. Today this is the EICAR
 * standard anti-malware test file (all three digests); add other vendor test
 * artifacts here as needed.
 */
export const KNOWN_BENIGN_HASHES = new Set<string>([
  "44d88612fea8a8f36de82e1278abb02f", // EICAR md5
  "3395856ce81f2b7382dee72602f798b642f14140", // EICAR sha1
  "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f", // EICAR sha256
]);

/** Returns a stable marker for a known-benign hash, else undefined. */
export function isKnownBenignHash(hash: string): string | undefined {
  return KNOWN_BENIGN_HASHES.has(hash.toLowerCase())
    ? "eicar-test-file"
    : undefined;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- benign`
Expected: PASS.

- [ ] **Step 5: Write the failing assemble test for the EICAR override + breakdown wiring**

In `lib/ti/assemble.test.ts`, change the import on line 2 to add `assembleHashResult`:

```ts
import {
  assembleDomainResult,
  assembleHashResult,
  assembleIpResult,
} from "./assemble";
```

Then append two describe blocks at the end of the file:

```ts
describe("assembleIpResult — breakdown wiring", () => {
  it("attaches the score breakdown", () => {
    const r = assembleIpResult(
      "1.2.3.4",
      [ok("feodo", 1, 60, { malicious: true })],
      "t",
    );
    expect(r.scoreBreakdown).toBeDefined();
    expect(r.scoreBreakdown?.floorApplied).toBe(true);
    expect(r.scoreBreakdown?.floorValue).toBe(75);
  });
});

describe("assembleHashResult — benign override (B2)", () => {
  it("forces EICAR clean despite vendor detections, keeping the rows", () => {
    const r = assembleHashResult(
      "44d88612fea8a8f36de82e1278abb02f",
      "md5",
      [
        ok("vt", 1, 90, { malicious: true }),
        ok("kaspersky", 0.9, 90, { malicious: true }),
      ],
      "t",
    );
    expect(r.verdict).toBe("clean");
    expect(r.riskScore).toBe(0);
    expect(r.scoreBreakdown?.benignOverride).toBe("eicar-test-file");
    expect(r.scoreBreakdown?.floorApplied).toBe(false);
    // The AV detections stay visible on the source rows.
    expect(r.sources.filter((s) => s.malicious).length).toBe(2);
  });

  it("scores a non-benign hash normally", () => {
    const r = assembleHashResult(
      "a".repeat(64),
      "sha256",
      [ok("vt", 1, 90, { malicious: true })],
      "t",
    );
    expect(r.verdict).toBe("malicious");
    expect(r.scoreBreakdown?.benignOverride).toBeUndefined();
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm test -- assemble`
Expected: FAIL — `r.scoreBreakdown` is undefined and EICAR is not overridden (assemblers don't set it yet).

- [ ] **Step 7: Wire the breakdown into all three assemblers + the EICAR override**

In `lib/ti/assemble.ts`, add the import near the top (after line 12):

```ts
import { isKnownBenignHash } from "./benign";
```

In `assembleIpResult`, change line 28 and the return object. Replace:

```ts
  const { riskScore, verdict } = aggregateRisk(results);
```
with:
```ts
  const { riskScore, verdict, breakdown } = aggregateRisk(results);
```
and add `scoreBreakdown: breakdown,` to the returned object (next to `stats: computeStats(results),`).

In `assembleDomainResult`, replace line 61:

```ts
  const { riskScore, verdict, breakdown } = aggregateRisk(results);
```
and add `scoreBreakdown: breakdown,` to the returned object (after `stats,`).

Replace `assembleHashResult` (lines 94-111) entirely with:

```ts
export function assembleHashResult(
  hash: string,
  algorithm: HashAlgorithm,
  results: SourceResult[],
  checkedAt: string,
): HashCheckResult {
  const { riskScore, verdict, breakdown } = aggregateRisk(results);
  // EICAR and other known-benign artifacts are benign by definition; the source
  // rows still show every detection, but the aggregate verdict is corrected.
  const benignOverride = isKnownBenignHash(hash);
  return {
    hash,
    algorithm,
    checkedAt,
    riskScore: benignOverride ? 0 : riskScore,
    verdict: benignOverride ? "clean" : verdict,
    context: mergeHashContext(results),
    sources: results,
    stats: computeStats(results),
    scoreBreakdown: benignOverride
      ? { ...breakdown, benignOverride, floorApplied: false }
      : breakdown,
  };
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm test -- assemble`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add lib/ti/benign.ts lib/ti/benign.test.ts lib/ti/assemble.ts lib/ti/assemble.test.ts
git commit -m "feat(scoring): wire scoreBreakdown into assembly, force EICAR clean (B2)"
```

---

### Task 4: Source-level signals (B1 abuseipdb threshold + B2 allowlisted propagation)

Tighten AbuseIPDB's `malicious` threshold to 75, and emit the `allowlisted` flag from AbuseIPDB, Maltiverse, and Hybrid-Analysis.

**Files:**
- Modify: `lib/ti/sources/abuseipdb.ts:85-86` (threshold), `:138-162` (allowlisted in finding)
- Modify: `lib/ti/sources/abuseipdb.test.ts:53-56` (threshold test)
- Modify: `lib/ti/hash/sources/maltiverse.ts:20-28` (`classificationScore` returns `allowlisted`), `:75`, `:107-124` (set on finding)
- Modify: `lib/ti/hash/sources/maltiverse.test.ts:4-21` (toEqual with `allowlisted`)
- Modify: `lib/ti/hash/sources/hybrid-analysis.ts:126-128` (set `allowlisted` on finding)

**Interfaces:**
- Consumes: `SourceFinding.allowlisted` from Task 1.
- Produces: `summarizeAbuse` flips `malicious` at 75; `classificationScore` returns `{ score, malicious, allowlisted }`; all three adapters set `allowlisted` on their `ok` findings.

- [ ] **Step 1: Update the AbuseIPDB threshold test (failing)**

In `lib/ti/sources/abuseipdb.test.ts`, replace the test at lines 53-56:

```ts
  it("uses 75% as the malicious threshold for a definitive listing", () => {
    expect(summarizeAbuse({ abuseConfidenceScore: 74 }).malicious).toBe(false);
    expect(summarizeAbuse({ abuseConfidenceScore: 75 }).malicious).toBe(true);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- abuseipdb`
Expected: FAIL — `summarizeAbuse({ abuseConfidenceScore: 74 }).malicious` is currently `true` (threshold is 50).

- [ ] **Step 3: Tighten the AbuseIPDB threshold + emit `allowlisted`**

In `lib/ti/sources/abuseipdb.ts`, replace lines 85-86:

```ts
    // AbuseIPDB's own confidence >=75% is the bar for a *definitive* listing;
    // 50-74% still scores but must not trip the aggregate's hard floor.
    malicious: score >= 75,
```

Then in `check()`, add `allowlisted` to the `ok` finding. After line 140 (`malicious,`) add:

```ts
        malicious,
        allowlisted: Boolean(d.isWhitelisted),
```

- [ ] **Step 4: Run the AbuseIPDB tests**

Run: `npm test -- abuseipdb`
Expected: PASS (threshold test; the 87% and empty-record tests still hold).

- [ ] **Step 5: Update the Maltiverse `classificationScore` tests (failing)**

In `lib/ti/hash/sources/maltiverse.test.ts`, replace the whole `describe` body (lines 4-21):

```ts
describe("classificationScore", () => {
  it("scores known classifications", () => {
    expect(classificationScore("malicious")).toEqual({
      score: 85,
      malicious: true,
      allowlisted: false,
    });
    expect(classificationScore("suspicious")).toEqual({
      score: 50,
      malicious: false,
      allowlisted: false,
    });
    expect(classificationScore("whitelist")).toEqual({
      score: 0,
      malicious: false,
      allowlisted: true,
    });
  });

  it("returns undefined score for neutral/unknown (absence is not clean)", () => {
    expect(classificationScore("neutral")).toEqual({
      score: undefined,
      malicious: false,
      allowlisted: false,
    });
    expect(classificationScore(undefined)).toEqual({
      score: undefined,
      malicious: false,
      allowlisted: false,
    });
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm test -- maltiverse`
Expected: FAIL — `classificationScore` returns no `allowlisted` key yet.

- [ ] **Step 7: Emit `allowlisted` from Maltiverse**

In `lib/ti/hash/sources/maltiverse.ts`, replace `classificationScore` (lines 19-28):

```ts
/** classification → score; undefined when neutral/unknown (absence ≠ clean). */
export function classificationScore(c: string | undefined): {
  score: number | undefined;
  malicious: boolean;
  allowlisted: boolean;
} {
  if (c === "malicious") return { score: 85, malicious: true, allowlisted: false };
  if (c === "suspicious") return { score: 50, malicious: false, allowlisted: false };
  if (c === "whitelist") return { score: 0, malicious: false, allowlisted: true };
  return { score: undefined, malicious: false, allowlisted: false };
}
```

Then in `check()`, replace line 75:

```ts
      const { score, malicious, allowlisted } = classificationScore(
        data.classification,
      );
```

And add `allowlisted` to the `ok` finding — after the `malicious,` line in the return (line 109):

```ts
        malicious,
        allowlisted,
        score,
```

- [ ] **Step 8: Run the Maltiverse tests**

Run: `npm test -- maltiverse`
Expected: PASS.

- [ ] **Step 9: Emit `allowlisted` from Hybrid-Analysis**

In `lib/ti/hash/sources/hybrid-analysis.ts`, in the `ok` return (line 128), add `allowlisted` right after `malicious`:

```ts
        malicious: verdict === "malicious",
        allowlisted: Boolean(data.whitelisted) || verdict === "whitelisted",
```

(No unit test: `check()` has no pure helper for this and the existing suite only tests `hybridAnalysisScore`. The behavior is covered at the aggregate level in Task 2's allowlist-suppression cases. `tsc` confirms it compiles.)

- [ ] **Step 10: Verify the full suite + types**

Run: `npm test`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add lib/ti/sources/abuseipdb.ts lib/ti/sources/abuseipdb.test.ts lib/ti/hash/sources/maltiverse.ts lib/ti/hash/sources/maltiverse.test.ts lib/ti/hash/sources/hybrid-analysis.ts
git commit -m "feat(scoring): raise AbuseIPDB malicious bar to 75, propagate allowlist signals (B1/B2)"
```

---

### Task 5: `scoreExplanation` reads the breakdown (B5 drift fix)

Rewrite `scoreExplanation` to consume `result.scoreBreakdown` instead of independently re-deriving the dominant source and floor, and to surface the floor/allowlist/borderline/benign facts.

**Files:**
- Modify: `lib/ti/narrative.ts:9` (import `MALICIOUS_FLOOR`), `:537-570` (rewrite `scoreExplanation`)
- Test: `lib/ti/narrative.test.ts` (import `scoreExplanation`; add describe block)

**Interfaces:**
- Consumes: `ResultLike.scoreBreakdown` (Task 1); `MALICIOUS_FLOOR` (Task 1).
- Produces: `scoreExplanation(result: ResultLike) => string[]` reading the breakdown.

- [ ] **Step 1: Write the failing tests**

In `lib/ti/narrative.test.ts`, add `scoreExplanation` to the import block (lines 2-10):

```ts
import {
  aggregateCategories,
  buildDomainNarrative,
  buildHashNarrative,
  buildNarrative,
  consensusBuckets,
  type ResultLike,
  scoreExplanation,
  threatSentences,
} from "./narrative";
```

Append this describe block at the end of the file:

```ts
describe("scoreExplanation — reads the breakdown (B5)", () => {
  const base = (over: Partial<ResultLike>): ResultLike => ({
    riskScore: 50,
    verdict: "suspicious",
    checkedAt: "2026-06-21T00:00:00Z",
    sources: [],
    stats: makeStats(),
    ...over,
  });

  it("returns the EICAR note for a benign override", () => {
    const text = scoreExplanation(
      base({
        riskScore: 0,
        verdict: "clean",
        sources: [makeSource({ name: "VirusTotal", score: 90, malicious: true })],
        scoreBreakdown: {
          effectiveMax: 90,
          weightedAvg: 90,
          floorApplied: false,
          borderline: false,
          allowlistSuppressed: false,
          benignOverride: "eicar-test-file",
        },
      }),
    ).join(" ");
    expect(text).toContain("EICAR");
    expect(text).toContain("benign");
  });

  it("names the dominant source from the breakdown field, not a re-derivation", () => {
    const vt = makeSource({ name: "VirusTotal", score: 80, weight: 1 }); // eff 80
    const ipsum = makeSource({ name: "IPsum", score: 90, weight: 0.3 }); // eff 27
    // Breakdown deliberately points at IPsum; a re-derivation would pick VT.
    const text = scoreExplanation(
      base({
        riskScore: 60,
        sources: [vt, ipsum],
        scoreBreakdown: {
          effectiveMax: 27,
          weightedAvg: 60,
          dominantSourceId: "ipsum",
          floorApplied: false,
          borderline: false,
          allowlistSuppressed: false,
        },
      }),
    ).join(" ");
    expect(text).toContain("IPsum (which rated it 90)");
  });

  it("explains a definitive high-weight floor and a borderline score", () => {
    const text = scoreExplanation(
      base({
        riskScore: 75,
        verdict: "malicious",
        sources: [makeSource({ name: "AbuseIPDB", score: 60, malicious: true })],
        scoreBreakdown: {
          effectiveMax: 60,
          weightedAvg: 60,
          dominantSourceId: "abuseipdb",
          floorApplied: true,
          flooredBy: "abuseipdb",
          floorValue: 75,
          borderline: true,
          allowlistSuppressed: false,
        },
      }),
    ).join(" ");
    expect(text).toContain("AbuseIPDB");
    expect(text).toContain("75");
    expect(text).toMatch(/borderline/i);
  });

  it("explains a quorum floor distinctly from a definitive one", () => {
    const text = scoreExplanation(
      base({
        riskScore: 50,
        verdict: "suspicious",
        sources: [
          makeSource({ name: "Tor", score: 30, weight: 0.4, malicious: true }),
          makeSource({ name: "DNSBL", score: 40, weight: 0.5, malicious: true }),
        ],
        scoreBreakdown: {
          effectiveMax: 20,
          weightedAvg: 36,
          dominantSourceId: "dnsbl",
          floorApplied: true,
          flooredBy: "dnsbl",
          floorValue: 50,
          borderline: false,
          allowlistSuppressed: false,
        },
      }),
    ).join(" ");
    expect(text).toContain("agreeing");
    expect(text).toContain("50");
  });

  it("notes when an allowlist suppressed the floor", () => {
    const text = scoreExplanation(
      base({
        riskScore: 20,
        verdict: "low",
        sources: [
          makeSource({ name: "Maltiverse", score: 0, weight: 0.7, allowlisted: true }),
        ],
        scoreBreakdown: {
          effectiveMax: 0,
          weightedAvg: 20,
          dominantSourceId: "maltiverse",
          floorApplied: false,
          borderline: false,
          allowlistSuppressed: true,
        },
      }),
    ).join(" ");
    expect(text).toMatch(/allowlist/i);
  });

  it("returns nothing when no scoring source settled", () => {
    expect(
      scoreExplanation(base({ sources: [], scoreBreakdown: undefined })),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- narrative`
Expected: FAIL — current `scoreExplanation` re-derives `dominant` from raw `sources` (the "names from breakdown field" test fails: it would pick VirusTotal), and emits no quorum/allowlist/borderline/benign lines.

- [ ] **Step 3: Import `MALICIOUS_FLOOR` and rewrite `scoreExplanation`**

In `lib/ti/narrative.ts`, change line 9:

```ts
import { FLAG_THRESHOLD, MALICIOUS_FLOOR } from "./aggregate";
```

Replace `scoreExplanation` (lines 537-570, the JSDoc through the closing brace) with:

```ts
/**
 * Plain-language account of how the aggregate score was reached. Reads the
 * intermediates aggregateRisk() recorded in `result.scoreBreakdown` rather than
 * re-deriving them, so the explanation can never drift from the score.
 */
export function scoreExplanation(result: ResultLike): string[] {
  const bd = result.scoreBreakdown;

  // A forced-benign override (e.g. EICAR) supersedes the blend entirely.
  if (bd?.benignOverride === "eicar-test-file") {
    return [
      "Forced clean, this is the EICAR standard anti-malware test file, a benign artifact used to verify scanners. Vendor detections are expected and do not make it harmful.",
    ];
  }

  const scored = result.sources.filter(
    (s) =>
      s.status === "ok" &&
      typeof s.score === "number" &&
      (s.source.weight ?? 1) > 0,
  );
  if (scored.length === 0) return [];

  const dominant = bd?.dominantSourceId
    ? result.sources.find((s) => s.source.id === bd.dominantSourceId)
    : undefined;
  const dominantName = dominant?.source.name ?? "the strongest source";
  const dominantScore = dominant?.score ?? 0;

  const out = [
    `The ${result.riskScore}/100 is weighted most heavily toward ${dominantName} (which rated it ${dominantScore}), blended with the weighted average across ${scored.length} scoring source${scored.length === 1 ? "" : "s"}. More authoritative feeds count for more, so the dominant source isn't always the highest raw score.`,
  ];

  if (bd?.floorApplied && bd.floorValue) {
    const by = bd.flooredBy
      ? result.sources.find((s) => s.source.id === bd.flooredBy)?.source.name
      : undefined;
    const byText = by ? ` by ${by}` : "";
    out.push(
      bd.floorValue >= MALICIOUS_FLOOR
        ? `It has a definitive malicious listing${byText}, which holds the score at ${bd.floorValue} or above.`
        : `Two or more agreeing listings${byText} raised the score to a floor of ${bd.floorValue}.`,
    );
  }

  if (bd?.allowlistSuppressed) {
    out.push(
      "An allowlist source vouches for this indicator, so a weak listing did not raise the floor.",
    );
  }

  if (bd?.borderline) {
    out.push(
      "This score sits within five points of a verdict boundary, so treat the label as borderline.",
    );
  }

  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- narrative`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/narrative.ts lib/ti/narrative.test.ts
git commit -m "refactor(scoring): scoreExplanation reads the breakdown, no re-derivation (B5)"
```

---

### Task 6: Full verification

Confirm the whole suite, lint, and types pass together, then exercise the real pipeline end-to-end.

**Files:** none (verification only).

- [ ] **Step 1: Full unit suite**

Run: `npm test`
Expected: PASS, no failures.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors or warnings.

- [ ] **Step 3: Types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Live pipeline sanity (no keys required)**

Run: `npm run dev`, then in a second shell:

```bash
curl -s localhost:3000/api/check-hash/44d88612fea8a8f36de82e1278abb02f | npx --yes json verdict riskScore scoreBreakdown.benignOverride
```
Expected: `verdict` = `clean`, `riskScore` = `0`, `benignOverride` = `eicar-test-file`. (If `json` is unavailable, eyeball the raw JSON for those fields.)

Then a Tor-only-style IP and a known-bad IP, confirming the floor behaves:

```bash
curl -s localhost:3000/api/check/185.220.101.1 | npx --yes json verdict riskScore scoreBreakdown
```
Expected: a `scoreBreakdown` object is present; `floorApplied`/`flooredBy` reflect the real listings (a high-weight VT/AbuseIPDB hit still pins; a Tor-only signal does not).

- [ ] **Step 5: Note any deviation**

If a live indicator's data has shifted since the analyst review (sources rate-limited, listings changed), record what was observed rather than asserting the expected value. The unit tests are the source of truth for the logic; the live check confirms wiring.

---

## Self-Review

**1. Spec coverage:**
- B1 floor gating (two-tier, weight/quorum) → Task 2 (`computeFloor` + tests).
- B1 abuseipdb threshold 50→75 → Task 4 Steps 1-4.
- B2 allowlist counter-signal → Task 1 (`allowlisted` field), Task 4 (emit from 3 sources), Task 2 (suppression logic + test).
- B2 EICAR/benign override → Task 3 (`benign.ts` + hash assembler).
- B5 named constants → Task 1. `ScoreBreakdown` return → Task 2. `scoreExplanation` reads it → Task 5. Borderline annotation → Task 2 (compute) + Task 5 (surface).
- Out-of-scope items (A1 rendering, A3 confidence tier, B3 decay, B4 context) → correctly absent.

**2. Placeholder scan:** No TBD/TODO; every code step shows full code; every test step shows the assertions.

**3. Type consistency:** `aggregateRisk` returns `{ riskScore, verdict, breakdown }` (Task 2) and all three assemblers (Task 3) destructure `breakdown` and set `scoreBreakdown`. `ScoreBreakdown` field names used in tests (Task 2/3/5) match the interface (Task 1): `effectiveMax`, `weightedAvg`, `dominantSourceId`, `floorApplied`, `flooredBy`, `floorValue`, `borderline`, `allowlistSuppressed`, `benignOverride`. `classificationScore` returns `{ score, malicious, allowlisted }` consistently in source (Task 4 Step 7), tests (Step 5), and consumer (Step 7). `isKnownBenignHash` returns `string | undefined` in def (Task 3 Step 3) and is used as a truthy marker in the assembler (Step 7). `MALICIOUS_FLOOR` imported in Task 5 matches the const exported in Task 1.

No gaps found.
