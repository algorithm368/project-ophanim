# Score Semantics, Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the assertion vocabulary and the one table that prices it, have eight adapters emit an assertion alongside their existing output, and prove the pricing against real behaviour, without any verdict moving.

**Architecture:** A source's `check()` gains an optional `assertion` field describing what it claims, on two axes (what the indicator is, what it did) plus a tier saying how firmly. `lib/ti/scale.ts` is the only place a tier becomes points. In this stage `aggregateRisk` is untouched and still reads the legacy `score` / `malicious` / `categories`, which converted adapters keep emitting unchanged. Only the calibration test reads the new field. That parallel-emit shape is what makes the stage safe: nothing downstream can move, and the new pricing gets checked against eight adapters' worth of real output before anything depends on it.

**Tech Stack:** TypeScript, Next.js 16, Vitest (`bun run test`), Bun as package manager and script runner.

**Spec:** `docs/superpowers/specs/2026-09-11-score-semantics-design.md`

## Global Constraints

- **Band preservation, not digit preservation.** `assertionScore()` will not reproduce every adapter's current integer and should not. What must not move is any calibration indicator's verdict band.
- **Nothing downstream reads `assertion` in this stage.** `aggregate.ts`, `confidence.ts`, `threat-type.ts`, `partial.ts`, `narrative.ts` and every component are untouched. A converted adapter emits `assertion` *in addition to* `score`, `malicious`, `categories` and `lastSeen`, all left exactly as they are.
- **Tests are pure and offline.** No network in any test. Fixtures are literal recorded payloads, colocated as `lib/**/*.test.ts`, using the `@/` alias.
- **New files under `lib/` need coverage before a PR**, per the Sonar new-code gate (80% on changed lines).
- **Adapters follow `lib/ti/sources/feodo.ts`**: catch errors and return `{ status: isTimeout(err) ? "timeout" : "error", error: errorMessage(err) }` rather than throwing; honour the `AbortSignal`; use the helpers in `lib/ti/http.ts`, never bare `fetch`.
- **User-facing copy uses commas, never dashes** (no em dash, en dash, or " - " as a separator).
- **Lint is an error gate**: `sonarjs/cognitive-complexity` at 15 and `no-nested-ternary` are errors under `bun run lint`.
- Run `bun run test`, `bun run lint` and `bun run typecheck` before every commit. Use `bun run test`, never `bun test`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/ti/assertion.ts` (create) | The vocabulary: `IdentityClass`, `AssertionTier`, `ProviderConfidence`, `Assertion`, `Instant`, and `toInstant()` |
| `lib/ti/assertion.test.ts` (create) | `toInstant` against the literal strings three providers actually return |
| `lib/ti/scale.ts` (create) | `TIER_BAND` and `assertionScore()`. The only place a tier becomes points |
| `lib/ti/scale.test.ts` (create) | The table is total over the enum; each tier prices inside its band |
| `lib/ti/types.ts` (modify) | `SourceFinding.assertion?`, `SourceMeta.lineage`, `SourceMeta.aggregates?` |
| `lib/ti/registry.test.ts` (modify) | Every registered source declares a lineage |
| `lib/ti/sources/{feodo,ipsum,abuseipdb,virustotal,greynoise,tor,dnsbl,et-open}.ts` (modify) | Each emits an assertion alongside its existing output |
| `lib/ti/calibration.ts` (create) | The calibration set: indicators, recorded source rows, expected bands |
| `lib/ti/calibration.test.ts` (create) | Legacy and assertion-priced scores land in the same band for every entry |

---

### Task 1: The assertion vocabulary

**Files:**
- Create: `lib/ti/assertion.ts`
- Test: `lib/ti/assertion.test.ts`

**Interfaces:**
- Consumes: `ThreatType` from `lib/ti/threat-type.ts`
- Produces: `IdentityClass`, `AssertionTier`, `ProviderConfidence`, `Assertion`, `Instant`, `toInstant(raw: string | number | null | undefined): Instant | undefined`

- [ ] **Step 1: Write the failing test**

`lib/ti/assertion.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toInstant } from "@/lib/ti/assertion";

describe("toInstant", () => {
  // The three formats three live adapters hand us today, verbatim. Every
  // expectation is second-precision: `toInstant` strips the milliseconds
  // `Date.toISOString()` always emits, because no provider in the panel
  // publishes them and ".000Z" on every timestamp is noise in a rendered field.
  it("passes an ISO 8601 string with an offset through as UTC", () => {
    // abuseipdb: d.lastReportedAt
    expect(toInstant("2026-08-30T03:00:00+02:00")).toBe("2026-08-30T01:00:00Z");
  });

  it("reads a zoneless space-separated stamp as UTC", () => {
    // tor (Onionoo): relay.last_seen
    expect(toInstant("2026-08-30 01:00:00")).toBe("2026-08-30T01:00:00Z");
  });

  it("reads a UTC-suffixed space-separated stamp", () => {
    // urlhaus: data.lastseen
    expect(toInstant("2026-08-30 01:00:00 UTC")).toBe("2026-08-30T01:00:00Z");
  });

  it("reads epoch seconds", () => {
    expect(toInstant(1788051600)).toBe("2026-08-30T01:00:00Z");
  });

  it("reads a bare date as UTC midnight", () => {
    // feodo: hit.last_online
    expect(toInstant("2026-08-30")).toBe("2026-08-30T00:00:00Z");
  });

  it("returns undefined rather than an Invalid Date for junk", () => {
    expect(toInstant("not a date")).toBeUndefined();
    expect(toInstant("")).toBeUndefined();
    expect(toInstant(undefined)).toBeUndefined();
    expect(toInstant(null)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- assertion`
Expected: FAIL, cannot resolve `@/lib/ti/assertion`.

- [ ] **Step 3: Write the implementation**

`lib/ti/assertion.ts`:

```ts
import type { ThreatType } from "./threat-type";

/**
 * What an indicator *is*, as opposed to what it did.
 *
 * One value per assertion: an address is not two kinds of thing. This is the
 * axis AbuseIPDB's `usageType` belongs on, and the reason `USAGE_NOISE` exists
 * in `threat-type.ts` to filter it back out of a list it should never have
 * entered. `anonymizer` lives here rather than in `ThreatType` because being a
 * Tor exit is a kind of address; whether that is bad is the reader's policy.
 */
export type IdentityClass =
  | "hosting"
  | "residential"
  | "mobile"
  | "business"
  | "education"
  | "government"
  | "cdn"
  | "dns-infra"
  | "anonymizer"
  | "unknown";

/**
 * How firmly a source stands behind what it says.
 *
 * This is what "the weight of the evidence" means, made discrete. Each value
 * has to be defensible in a sentence, which is the test for whether a new one
 * belongs here.
 */
export type AssertionTier =
  /** The source holds the artefact itself: an extracted C2 config, the sample. */
  | "confirmed"
  /** The source asserts it from its own analysis, without a first-party artefact. */
  | "attributed"
  /** Third parties reported it to the source. Evidence, not confirmation. */
  | "reported"
  /** The source saw the behaviour, which is not inherently adverse. */
  | "observed"
  /** Looked, and found nothing adverse. */
  | "none"
  /** Has no record of this indicator at all. Not evidence of cleanliness. */
  | "no-record"
  /** An authoritative allowlist explicitly vouches for it. */
  | "vouched";

/**
 * The provider's own published figure, where one genuinely exists.
 *
 * Never invented to fill the field. It modulates within a tier and can never
 * move across one: a 60/90 VirusTotal and a 2/90 VirusTotal differ, and both
 * are still one piece of evidence at VirusTotal's tier.
 */
export interface ProviderConfidence {
  /** The provider's number. */
  value: number;
  /** The denominator, when the figure is a ratio (60 of 90 vendors). */
  of?: number;
  /** What the provider calls it, for the tooltip. */
  label: string;
  /**
   * Which kind of number this is, because the two are priced differently and
   * the difference is not visible in the digits.
   *
   * A `ratio` is a count of voters out of a population: sixteen of eighty-nine
   * vendors, three of five DNSBL zones. It is sublinear in evidence, since the
   * first few voters carry most of the information and the eightieth carries
   * almost none, so `scale.ts` curves it.
   *
   * A `calibrated` figure is one the provider already decayed and scaled for
   * us, AbuseIPDB's abuse confidence being the case in the panel. Curving it
   * would inflate a number that has already been shaped once: measured against
   * a real row, a 12% confidence priced at 31 instead of 13.
   */
  kind: "ratio" | "calibrated";
}

/** ISO 8601 in UTC, e.g. "2026-08-30T01:00:00Z". */
export type Instant = string;

/** What a source claims about an indicator. */
export interface Assertion {
  identity?: IdentityClass;
  /** Ordered by the source's own ranking, deduped by the emitter. */
  behavior?: ThreatType[];
  /** Required: a source that cannot say how firmly it believes something has
   *  not made an assertion. */
  tier: AssertionTier;
  providerConfidence?: ProviderConfidence;
  /** When the source last observed what it is asserting. */
  observedAt?: Instant;
}

// "2026-08-30 01:00:00" and "2026-08-30 01:00:00 UTC". Neither is parseable by
// `new Date()` consistently across runtimes, and the first carries no zone at
// all, so both are rewritten into the one form that is unambiguous.
const SPACE_SEPARATED = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?: UTC)?$/;

/**
 * Normalise whatever a provider calls a timestamp into one UTC instant.
 *
 * Returns undefined rather than an Invalid Date: a field that silently holds
 * `"Invalid Date"` is worse than an absent one, because it renders.
 */
export function toInstant(
  raw: string | number | null | undefined,
): Instant | undefined {
  if (raw === null || raw === undefined || raw === "") return undefined;

  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return undefined;
    return iso(new Date(raw * 1000));
  }

  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  const spaced = SPACE_SEPARATED.exec(trimmed);
  const candidate = spaced ? `${spaced[1]}T${spaced[2]}Z` : trimmed;

  return iso(new Date(candidate));
}

// Second precision. No provider in the panel publishes milliseconds, so the
// ".000Z" that toISOString() always appends is three characters of noise in a
// field an analyst reads.
function iso(d: Date): Instant | undefined {
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- assertion`
Expected: PASS, 5 tests.

- [ ] **Step 5: Verify and commit**

```bash
bun run lint && bun run typecheck
git add lib/ti/assertion.ts lib/ti/assertion.test.ts
git commit -m "feat(ti): add the assertion vocabulary and one UTC instant"
```

---

### Task 2: The scale, the one table that prices a tier

**Files:**
- Create: `lib/ti/scale.ts`
- Test: `lib/ti/scale.test.ts`

**Interfaces:**
- Consumes: `Assertion`, `AssertionTier`, `ProviderConfidence` from `lib/ti/assertion.ts`
- Produces: `TIER_BAND: Record<AssertionTier, Band | null>`, `type Band = { floor: number; ceil: number }`, `assertionScore(a: Assertion): number | undefined`, `assertionIsDefinite(a: Assertion): boolean`

- [ ] **Step 1: Write the failing test**

`lib/ti/scale.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AssertionTier } from "@/lib/ti/assertion";
import { TIER_BAND, assertionScore, assertionIsDefinite } from "@/lib/ti/scale";

const ALL_TIERS: AssertionTier[] = [
  "confirmed",
  "attributed",
  "reported",
  "observed",
  "none",
  "no-record",
  "vouched",
];

describe("TIER_BAND", () => {
  it("prices every tier, so a new one cannot be added without pricing it", () => {
    for (const tier of ALL_TIERS) {
      expect(Object.hasOwn(TIER_BAND, tier)).toBe(true);
    }
    expect(Object.keys(TIER_BAND).sort()).toEqual([...ALL_TIERS].sort());
  });

  it("orders the adverse tiers, strongest first, by both ends", () => {
    // The bands overlap by design. A strong `attributed` should outscore a weak
    // `confirmed`, because the strength of a finding and the firmness of the
    // claim are different axes. What must hold is the ordering of each end.
    expect(TIER_BAND.confirmed!.ceil).toBeGreaterThan(TIER_BAND.attributed!.ceil);
    expect(TIER_BAND.confirmed!.floor).toBeGreaterThan(TIER_BAND.attributed!.floor);
    expect(TIER_BAND.attributed!.ceil).toBeGreaterThan(TIER_BAND.reported!.ceil);
    expect(TIER_BAND.attributed!.floor).toBeGreaterThan(TIER_BAND.reported!.floor);
    expect(TIER_BAND.reported!.ceil).toBeGreaterThan(TIER_BAND.observed!.ceil);
    expect(TIER_BAND.reported!.floor).toBeGreaterThan(TIER_BAND.observed!.floor);
  });

  it("lets a confirmed finding pin the aggregate's floor from anywhere in band", () => {
    // MALICIOUS_FLOOR in aggregate.ts is 75.
    expect(TIER_BAND.confirmed!.floor).toBe(75);
  });

  it("gives the adverse tiers room to say weak", () => {
    // The first draft's 25-point attributed band could not: four of eighty-nine
    // vendors priced above sixteen of eighty-nine did under the old scale.
    for (const t of ["attributed", "reported"] as const) {
      const b = TIER_BAND[t]!;
      expect(b.ceil - b.floor, `${t} band is too narrow`).toBeGreaterThanOrEqual(50);
    }
  });
});

describe("assertionScore", () => {
  it("takes a tier at its midpoint when the source published no figure", () => {
    const { floor, ceil } = TIER_BAND.confirmed!;
    expect(assertionScore({ tier: "confirmed" })).toBe(Math.round((floor + ceil) / 2));
  });

  it("places a provider figure inside the tier's band, never outside it", () => {
    const band = TIER_BAND.reported!;
    const low = assertionScore({
      tier: "reported",
      providerConfidence: { value: 0, of: 100, label: "zones", kind: "ratio" },
    });
    const high = assertionScore({
      tier: "reported",
      providerConfidence: { value: 100, of: 100, label: "zones", kind: "ratio" },
    });
    expect(low).toBe(band.floor);
    expect(high).toBe(band.ceil);
  });

  it("clamps a provider figure that overruns its own denominator", () => {
    expect(
      assertionScore({
        tier: "observed",
        providerConfidence: { value: 300, of: 100, label: "nonsense", kind: "ratio" },
      }),
    ).toBe(TIER_BAND.observed!.ceil);
  });

  it("uses a calibrated figure exactly as published", () => {
    // AbuseIPDB already decayed and scaled this. Curving it would shape a
    // number that has been shaped once, which prices a 12% confidence at 31.
    const band = TIER_BAND.reported!;
    expect(
      assertionScore({
        tier: "reported",
        providerConfidence: { value: 0.5, label: "abuse confidence", kind: "calibrated" },
      }),
    ).toBe(Math.round(band.floor + (band.ceil - band.floor) * 0.5));
  });

  it("curves a ratio, so a small minority reads as a small minority", () => {
    const band = TIER_BAND.attributed!;
    const mid = Math.round(band.floor + (band.ceil - band.floor) * 0.5);
    const score = (value: number) =>
      assertionScore({
        tier: "attributed",
        providerConfidence: { value, of: 89, label: "vendors flagging", kind: "ratio" },
      })!;

    // Four of eighty-nine has to stay in the bottom half of the band. Under the
    // first draft's flat 60-to-85 band it priced at 61, above the 49 the old
    // arbitrary scale gave it, while sixteen of eighty-nine fell to 64.
    expect(score(4)).toBeLessThan(mid);
    // And the ordering has to survive the curve.
    expect(score(4)).toBeLessThan(score(16));
    expect(score(16)).toBeLessThan(score(60));
    expect(score(89)).toBe(band.ceil);
  });

  it("bends the curve rather than bending the band", () => {
    // A curved ratio always scores at or above the straight line, which is what
    // makes the first few voters count for more than their share.
    const straight = (x: number) => 25 + (85 - 25) * x;
    for (const x of [0.1, 0.25, 0.5, 0.75]) {
      const curved = assertionScore({
        tier: "attributed",
        providerConfidence: { value: x, label: "share", kind: "ratio" },
      })!;
      expect(curved).toBeGreaterThanOrEqual(Math.round(straight(x)));
    }
  });

  it("scores a clean look at zero, and a vouch at zero", () => {
    expect(assertionScore({ tier: "none" })).toBe(0);
    expect(assertionScore({ tier: "vouched" })).toBe(0);
  });

  it("returns undefined for no-record, which is not evidence of cleanliness", () => {
    expect(assertionScore({ tier: "no-record" })).toBeUndefined();
  });
});

describe("assertionIsDefinite", () => {
  it("is true only for the tiers allowed to pin a floor", () => {
    expect(assertionIsDefinite({ tier: "confirmed" })).toBe(true);
    expect(assertionIsDefinite({ tier: "attributed" })).toBe(true);
    expect(assertionIsDefinite({ tier: "reported" })).toBe(false);
    expect(assertionIsDefinite({ tier: "observed" })).toBe(false);
    expect(assertionIsDefinite({ tier: "none" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- scale`
Expected: FAIL, cannot resolve `@/lib/ti/scale`.

- [ ] **Step 3: Write the implementation**

`lib/ti/scale.ts`:

```ts
import type { Assertion, AssertionTier, ProviderConfidence } from "./assertion";

export type Band = { floor: number; ceil: number };

/**
 * What a tier is worth, and nothing else in the codebase gets to decide.
 *
 * This table is the answer to "what is the difference between 85 and 90", the
 * question fifty-seven adapters could not answer because each picked its own
 * number. If a row here cannot be justified in its comment, the row is wrong.
 *
 * The values are a starting point, tuned against the calibration set in
 * `calibration.ts`. Moving one is a decision that has to be argued for in the
 * same commit that moves it, which is what the calibration test enforces.
 */
export const TIER_BAND: Record<AssertionTier, Band | null> = {
  // The source holds the artefact. Nothing stronger is available to us, so this
  // band reaches the top, and its floor sits exactly at the aggregate's
  // MALICIOUS_FLOOR of 75 so a confirmed listing can pin a verdict from
  // anywhere inside it.
  confirmed: { floor: 75, ceil: 100 },

  // The source's own analysis, without the artefact.
  //
  // The band is wide on purpose, and the first draft's 60 to 85 was wrong.
  // A floor of 60 is a floor on the *score*, so a VirusTotal row with four of
  // eighty-nine vendors flagging priced at 61, above the 49 the old arbitrary
  // scale gave it, while sixteen of eighty-nine fell from 100 to 64: the weak
  // case went up and the strong case went down. Twenty-five points is not
  // enough room to say "this is a weak attribution".
  attributed: { floor: 25, ceil: 85 },

  // Third parties reported it. Wide for the same reason, and its ceiling stops
  // below `attributed`'s ceiling on purpose: no volume of reports becomes an
  // analysis.
  reported: { floor: 5, ceil: 70 },

  // The source saw the behaviour and the behaviour is not inherently adverse.
  // Scanning the internet is rude, not criminal, and a Tor relay is neither.
  observed: { floor: 2, ceil: 35 },

  // Looked, found nothing.
  none: { floor: 0, ceil: 0 },

  // Vouched for. Zero here, and the vouch itself is what `computeFloor` reads.
  vouched: { floor: 0, ceil: 0 },

  // Has no record. Deliberately null rather than 0: "we have never seen this"
  // is not "we looked and it is fine", and a source with no record must not
  // pull a weighted average down as though it had exonerated anything.
  "no-record": null,
};

/** The tiers permitted to pin a hard floor. `reported` is absent on purpose. */
const DEFINITE: ReadonlySet<AssertionTier> = new Set<AssertionTier>([
  "confirmed",
  "attributed",
]);

// How sharply a vote ratio bends. Two is the gentlest curve that removes the
// inversion the flat bands produced, measured over five recorded lookups.
// Higher exponents also hold every band, but at four they lift 8.8.8.8 to 14
// against a `low` cutoff of 15, which is no margin for an address whose only
// adverse row is a single UCEPROTECT listing.
const RATIO_CURVE = 2;

/**
 * Normalise a provider's own figure to 0..1, by its kind.
 *
 * A ratio is curved: the first few voters out of a large panel carry most of
 * the information and the eightieth carries almost none, so four of eighty-nine
 * vendors and sixteen of eighty-nine have to be separable at the bottom of the
 * range rather than being two points apart near the top.
 *
 * A calibrated figure is used as published. The provider already shaped it, and
 * shaping it twice is how a 12% abuse confidence prices at 31.
 *
 * Both are clamped: a provider that overruns its own denominator should reach
 * the top of the band and go no further.
 */
function normalize(c: ProviderConfidence): number {
  const raw = c.of && c.of > 0 ? c.value / c.of : c.value;
  if (!Number.isFinite(raw)) return 0;
  const x = Math.min(1, Math.max(0, raw));
  return c.kind === "ratio" ? 1 - Math.pow(1 - x, RATIO_CURVE) : x;
}

/**
 * Price an assertion.
 *
 * Undefined means the assertion carries no score at all, which is different
 * from scoring zero, and callers must keep the two apart.
 */
export function assertionScore(a: Assertion): number | undefined {
  const band = TIER_BAND[a.tier];
  if (!band) return undefined;
  if (band.floor === band.ceil) return band.floor;

  const fraction = a.providerConfidence
    ? normalize(a.providerConfidence)
    : // No published figure, so the tier is taken at its middle: the source
      // told us how firmly it believes this and nothing more.
      0.5;

  return Math.round(band.floor + (band.ceil - band.floor) * fraction);
}

/** Whether this assertion is the kind that may pin a hard floor. */
export function assertionIsDefinite(a: Assertion): boolean {
  return DEFINITE.has(a.tier);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- scale`
Expected: PASS, 9 tests.

- [ ] **Step 5: Verify and commit**

```bash
bun run lint && bun run typecheck
git add lib/ti/scale.ts lib/ti/scale.test.ts
git commit -m "feat(ti): price a tier in one table, and only there"
```

---

### Task 3: Plumb `assertion` and `lineage` through the model

**Files:**
- Modify: `lib/ti/types.ts` (`SourceFinding` at :322, `SourceMeta` at :36)
- Modify: `lib/ti/registry.test.ts`
- Test: `lib/ti/orchestrate.test.ts` (add one case)

**Interfaces:**
- Consumes: `Assertion` from `lib/ti/assertion.ts`
- Produces: `SourceFinding.assertion?: Assertion`, `SourceMeta.lineage: "first-party" | "aggregate"`, `SourceMeta.aggregates?: string[]`

- [ ] **Step 1: Write the failing tests**

Add to `lib/ti/registry.test.ts`:

```ts
import { sources } from "@/lib/ti/registry";
import { domainSources } from "@/lib/ti/domain/registry";
import { hashSources } from "@/lib/ti/hash/registry";

describe("lineage", () => {
  const all = [...sources, ...domainSources, ...hashSources];

  it("is declared by every registered source", () => {
    const missing = all.filter((s) => !s.meta.lineage).map((s) => s.meta.id);
    expect(missing).toEqual([]);
  });

  it("is only declared aggregate by sources that republish others", () => {
    const aggregates = all
      .filter((s) => s.meta.lineage === "aggregate")
      .map((s) => s.meta.id);
    // Named rather than counted, so adding one is a deliberate edit here.
    expect(new Set(aggregates)).toEqual(
      new Set(["ipsum", "virustotal", "dshield"]),
    );
  });

  // Before writing this list, read every registry entry and decide. Three is
  // the set this plan is confident about; `otx`, `cymru-mhr`, `hashlookup` and
  // `maltiverse` are the plausible fourth, fifth and sixth, and each is a
  // judgement about whether the source observed what it reports. Deciding one
  // of them is an aggregate means editing this test, which is the point.
});
```

Add to `lib/ti/orchestrate.test.ts`:

```ts
it("carries an assertion through runSource, and still drops raw", async () => {
  const source: TiSource = {
    meta: {
      id: "stub",
      name: "Stub",
      url: "https://example.invalid",
      category: "blocklist",
      requiresKey: false,
      weight: 1,
      lineage: "first-party",
    },
    isEnabled: () => true,
    check: async () => ({
      status: "ok" as const,
      score: 95,
      assertion: { tier: "confirmed" as const, behavior: ["c2" as const] },
      raw: { secret: "should not survive" },
    }),
  };

  const result = await runSource(source, "1.2.3.4", new AbortController().signal);

  expect(result.assertion).toEqual({ tier: "confirmed", behavior: ["c2"] });
  expect(result.raw).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- registry orchestrate`
Expected: FAIL. `lineage` does not exist on `SourceMeta` (typecheck error), and the registry test reports every source id as missing.

- [ ] **Step 3: Write the implementation**

In `lib/ti/types.ts`, add the import at the top:

```ts
import type { Assertion } from "./assertion";
```

Add to `SourceMeta`, after `weight`:

```ts
  /**
   * Whether this source observed what it reports, or republishes what others
   * observed.
   *
   * Corroboration is counted over distinct evidence origins, so an aggregate
   * contributes at most one however many feeds are inside it. `dshield.ts`
   * already had this instinct in a comment ("the threatfeeds map is largely
   * other people's feeds") and expressed it by zeroing its weight; this makes
   * it a property of the source rather than a workaround at one call site.
   */
  lineage: "first-party" | "aggregate";
  /**
   * For aggregates, the feed ids it republishes, where they are knowable.
   *
   * Often they are not: IPsum does not publish which of its thirty lists fired
   * for a given IP, so the collapse is a cap rather than a true dedupe, and the
   * page says so next to the source.
   */
  aggregates?: string[];
```

Add to `SourceFinding`, immediately after `score`:

```ts
  /**
   * What this source claims, on the closed vocabulary.
   *
   * Emitted in parallel with `score` / `malicious` / `categories` while the
   * adapters are converted. Nothing downstream reads it yet; `calibration.ts`
   * is the only consumer until stage 2 switches `aggregateRisk` over.
   */
  assertion?: Assertion;
```

Then add `lineage: "first-party"` to the `meta` block of every source in `lib/ti/sources/`, `lib/ti/domain/sources/` and `lib/ti/hash/sources/`, except `ipsum`, `virustotal` and `dshield`, which take `lineage: "aggregate"`. Typecheck names every file that still needs it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test && bun run typecheck`
Expected: PASS. No existing test changes behaviour, because nothing reads either new field.

- [ ] **Step 5: Commit**

```bash
bun run lint
git add lib/ti/types.ts lib/ti/registry.test.ts lib/ti/orchestrate.test.ts lib/ti/sources lib/ti/domain/sources lib/ti/hash/sources
git commit -m "feat(ti): give every source a lineage, and a place to put an assertion"
```

---

### Task 4: Feodo asserts `confirmed`

**Files:**
- Modify: `lib/ti/sources/feodo.ts:78` (`feodoFinding`)
- Test: `lib/ti/sources/feodo.test.ts`

**Interfaces:**
- Consumes: `Assertion` from `lib/ti/assertion.ts`, `toInstant` from `lib/ti/assertion.ts`
- Produces: nothing new; `feodoFinding` keeps its signature

- [ ] **Step 1: Write the failing test**

Add to `lib/ti/sources/feodo.test.ts`:

```ts
import { assertionScore } from "@/lib/ti/scale";

describe("feodoFinding assertion", () => {
  const hit = {
    ip_address: "1.2.3.4",
    malware: "Emotet",
    status: "online",
    last_online: "2026-08-30",
  };

  it("asserts confirmed: the tracker holds the extracted C2 config", () => {
    const f = feodoFinding(hit);
    expect(f.assertion?.tier).toBe("confirmed");
    expect(f.assertion?.behavior).toEqual(["c2"]);
  });

  it("normalises the observation time", () => {
    expect(feodoFinding(hit).assertion?.observedAt).toBe("2026-08-30T00:00:00Z");
  });

  it("prices inside the band that can pin a floor alone", () => {
    expect(assertionScore(feodoFinding(hit).assertion!)).toBeGreaterThanOrEqual(75);
  });

  it("leaves the legacy fields exactly as they were", () => {
    const f = feodoFinding(hit);
    expect(f.score).toBe(95);
    expect(f.malicious).toBe(true);
    expect(f.categories).toEqual(["botnet-c2", "Emotet"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- feodo`
Expected: FAIL, `f.assertion` is undefined.

- [ ] **Step 3: Write the implementation**

In `lib/ti/sources/feodo.ts`, add to the imports:

```ts
import { toInstant } from "../assertion";
```

In `feodoFinding`, add the assertion to the returned object, leaving every other field untouched:

```ts
    assertion: {
      // Feodo Tracker lists an address because someone pulled a C2 config out
      // of a sample and this is the address in it. That is the artefact, which
      // is what separates `confirmed` from `attributed`.
      tier: "confirmed",
      behavior: ["c2"],
      observedAt: toInstant(hit.last_online),
    },
```

And in the not-listed branch of `check()`, alongside the existing `score: 0`:

```ts
          assertion: { tier: "none" },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- feodo`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

```bash
bun run test && bun run lint && bun run typecheck
git add lib/ti/sources/feodo.ts lib/ti/sources/feodo.test.ts
git commit -m "feat(feodo): assert confirmed, because the tracker holds the config"
```

---

### Task 5: IPsum asserts by list count, as an aggregate

**Files:**
- Modify: `lib/ti/sources/ipsum.ts`
- Test: `lib/ti/sources/ipsum.test.ts`

**Interfaces:**
- Consumes: `Assertion` from `lib/ti/assertion.ts`
- Produces: `ipsumAssertion(count: number): Assertion`, exported for the test and for `calibration.ts`

- [ ] **Step 1: Write the failing test**

Add to `lib/ti/sources/ipsum.test.ts`:

```ts
import { ipsumAssertion } from "@/lib/ti/sources/ipsum";
import { assertionScore } from "@/lib/ti/scale";

describe("ipsumAssertion", () => {
  it("calls one list a report, not an analysis", () => {
    // The adapter's own comment: a hit on a single list is noisy. A single
    // noisy list must never reach the tier that can pin a floor.
    expect(ipsumAssertion(1).tier).toBe("reported");
    expect(ipsumAssertion(2).tier).toBe("reported");
  });

  it("calls three or more lists an attribution, matching ipsumMalicious", () => {
    expect(ipsumAssertion(3).tier).toBe("attributed");
    expect(ipsumAssertion(12).tier).toBe("attributed");
  });

  it("carries the list count as the provider's own figure", () => {
    expect(ipsumAssertion(6).providerConfidence).toEqual({
      value: 6,
      of: 10,
      label: "blocklists",
      kind: "ratio",
    });
  });

  it("keeps one noisy list cheap", () => {
    expect(assertionScore(ipsumAssertion(1))!).toBeLessThan(25);
  });

  it("rises with the count, and stops rising at the band ceiling", () => {
    expect(assertionScore(ipsumAssertion(3))!).toBeLessThan(
      assertionScore(ipsumAssertion(8))!,
    );
    expect(assertionScore(ipsumAssertion(10))).toBe(
      assertionScore(ipsumAssertion(40)),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- ipsum`
Expected: FAIL, `ipsumAssertion` is not exported.

- [ ] **Step 3: Write the implementation**

In `lib/ti/sources/ipsum.ts`, add the import and the function beside `ipsumMalicious`:

```ts
import type { Assertion } from "../assertion";

// Above this many lists, more lists stop telling us anything: the address is
// on everyone's list and the marginal list adds no independent observation.
const COUNT_CEILING = 10;

/**
 * What IPsum is entitled to claim, given how many of its lists fired.
 *
 * The threshold is the one `ipsumMalicious` already uses and for the reason
 * already written there: one list is noisy, three independent lists are a
 * consensus. Expressing it as a tier is what stops a single noisy list from
 * being priced as though three had agreed.
 *
 * The tier is capped at `attributed` whatever the count. IPsum holds no
 * artefact; it republishes other people's listings, which is also why its meta
 * carries `lineage: "aggregate"` and it counts once toward corroboration.
 */
export function ipsumAssertion(count: number): Assertion {
  return {
    tier: ipsumMalicious(count) ? "attributed" : "reported",
    providerConfidence: {
      value: Math.min(count, COUNT_CEILING),
      of: COUNT_CEILING,
      label: "blocklists",
      kind: "ratio",
    },
  };
}
```

In the source's `meta`, change `lineage` to `"aggregate"` and add the note:

```ts
    lineage: "aggregate",
    // Thirty-plus lists, and IPsum does not publish which of them fired, so
    // the dedupe against separately registered feeds is a cap rather than a
    // true collapse. Said out loud here and on the page.
    aggregates: [],
```

In `check()`, add `assertion: ipsumAssertion(count)` to the listed branch and `assertion: { tier: "none" }` to the not-listed branch, leaving `score`, `malicious` and `summary` untouched.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- ipsum`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

```bash
bun run test && bun run lint && bun run typecheck
git add lib/ti/sources/ipsum.ts lib/ti/sources/ipsum.test.ts
git commit -m "feat(ipsum): tier by list count, and declare the aggregation"
```

---

### Task 6: AbuseIPDB asserts `reported`, and moves usage onto the identity axis

**Files:**
- Modify: `lib/ti/sources/abuseipdb.ts:66` (`summarizeAbuse`)
- Test: `lib/ti/sources/abuseipdb.test.ts`

**Interfaces:**
- Consumes: `Assertion`, `IdentityClass`, `toInstant`; `classifyCategory` from `lib/ti/threat-type.ts`
- Produces: `abuseIdentity(usageType: string | undefined): IdentityClass | undefined`, and `summarizeAbuse` gains an `assertion` in its return object

- [ ] **Step 1: Write the failing test**

Add to `lib/ti/sources/abuseipdb.test.ts`:

```ts
import { abuseIdentity, summarizeAbuse } from "@/lib/ti/sources/abuseipdb";

describe("abuseIdentity", () => {
  it("reads AbuseIPDB's own usage vocabulary onto the identity axis", () => {
    expect(abuseIdentity("Data Center/Web Hosting/Transit")).toBe("hosting");
    expect(abuseIdentity("Fixed Line ISP")).toBe("residential");
    expect(abuseIdentity("Mobile ISP")).toBe("mobile");
    expect(abuseIdentity("University/College/School")).toBe("education");
    expect(abuseIdentity("Government")).toBe("government");
    expect(abuseIdentity("Content Delivery Network")).toBe("cdn");
  });

  it("returns undefined for a usage type it does not know", () => {
    expect(abuseIdentity("Something New")).toBeUndefined();
    expect(abuseIdentity(undefined)).toBeUndefined();
  });
});

describe("summarizeAbuse assertion", () => {
  // Category 18 is AbuseIPDB's "Brute-Force", which `classifyCategory` maps to
  // "brute force" through its EXACT table. Only ids whose mapping is known are
  // used here, so a fixture cannot quietly depend on a guess.
  const reported = {
    abuseConfidenceScore: 90,
    totalReports: 200,
    usageType: "Data Center/Web Hosting/Transit",
    lastReportedAt: "2026-08-30T03:00:00+02:00",
    reports: [{ categories: [18] }, { categories: [18] }],
  };

  it("asserts reported, never attributed, whatever the confidence", () => {
    expect(summarizeAbuse(reported).assertion.tier).toBe("reported");
    expect(
      summarizeAbuse({ ...reported, abuseConfidenceScore: 100 }).assertion.tier,
    ).toBe("reported");
  });

  it("carries AbuseIPDB's own confidence as the provider figure", () => {
    expect(summarizeAbuse(reported).assertion.providerConfidence).toEqual({
      value: 0.9,
      label: "abuse confidence",
      kind: "calibrated",
    });
  });

  it("puts the usage type on identity, not into the behaviour list", () => {
    const a = summarizeAbuse(reported).assertion;
    expect(a.identity).toBe("hosting");
    expect(a.behavior).not.toContain("hosting");
    expect(a.behavior).toEqual(["brute force"]);
  });

  it("says none, not reported, when there is nothing to report", () => {
    const clean = { abuseConfidenceScore: 0, totalReports: 0, reports: [] };
    expect(summarizeAbuse(clean).assertion.tier).toBe("none");
  });

  it("leaves the legacy fields exactly as they were", () => {
    const s = summarizeAbuse(reported);
    expect(s.score).toBe(90);
    expect(s.malicious).toBe(true);
    expect(s.categories).toContain("data center/web hosting/transit");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- abuseipdb`
Expected: FAIL, `abuseIdentity` is not exported and `summarizeAbuse(...).assertion` is undefined.

- [ ] **Step 3: Write the implementation**

In `lib/ti/sources/abuseipdb.ts`, add the imports:

```ts
import type { Assertion, IdentityClass } from "../assertion";
import { toInstant } from "../assertion";
import type { ThreatType } from "../threat-type";
import { classifyCategory } from "../threat-type";
```

Add above `summarizeAbuse`:

```ts
/**
 * AbuseIPDB's `usageType` vocabulary, mapped onto the identity axis.
 *
 * This is the field that currently gets pushed into `categories` and then
 * filtered back out by `USAGE_NOISE` in `threat-type.ts`, which is how
 * "flagged it for Fixed Line ISP" happened. It was never a category; it is the
 * one source in the panel that will tell you plainly what kind of address this
 * is, and putting it on its own axis is the whole point of having two.
 */
const USAGE_IDENTITY: Record<string, IdentityClass> = {
  "data center/web hosting/transit": "hosting",
  "fixed line isp": "residential",
  "mobile isp": "mobile",
  commercial: "business",
  organization: "business",
  "university/college/school": "education",
  government: "government",
  military: "government",
  library: "education",
  "content delivery network": "cdn",
};

export function abuseIdentity(
  usageType: string | undefined,
): IdentityClass | undefined {
  if (!usageType) return undefined;
  return USAGE_IDENTITY[usageType.trim().toLowerCase()];
}
```

Change `summarizeAbuse`'s return type to add `assertion: Assertion`, and build it from the data it already has, leaving every existing field untouched:

```ts
  // Built from the numeric report ids the adapter already holds, by way of the
  // display names, until stage 2 lets the ids reach classification directly.
  const behavior: ThreatType[] = [
    ...new Set(
      breakdown
        .map((b) => classifyCategory(b.name))
        .filter((t): t is ThreatType => t !== undefined),
    ),
  ];

  const assertion: Assertion = {
    // Reports, however many and however confident. AbuseIPDB did not analyse
    // this address, people told it about the address, and no volume of telling
    // becomes an analysis. This is the change that stops a 75% confidence from
    // pinning the aggregate's hard floor on its own.
    tier: (d.totalReports ?? 0) > 0 ? "reported" : "none",
    identity: abuseIdentity(d.usageType),
    behavior: behavior.length > 0 ? behavior : undefined,
    providerConfidence:
      (d.totalReports ?? 0) > 0
        ? {
            // Calibrated, not a ratio: AbuseIPDB decays its own reports and
            // publishes the result, so it is carried as a 0-1 fraction and
            // used as published.
            value: score / 100,
            label: "abuse confidence",
            kind: "calibrated" as const,
          }
        : undefined,
    observedAt: toInstant(d.lastReportedAt),
  };
```

and add `assertion` to the returned object.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- abuseipdb`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

```bash
bun run test && bun run lint && bun run typecheck
git add lib/ti/sources/abuseipdb.ts lib/ti/sources/abuseipdb.test.ts
git commit -m "feat(abuseipdb): reports are reports, and usage type is an identity"
```

---

### Task 7: VirusTotal asserts once, at a high tier, carrying the vendor ratio

**Files:**
- Modify: `lib/ti/sources/virustotal.ts:54`
- Test: `lib/ti/sources/virustotal.test.ts`

**Interfaces:**
- Consumes: `Assertion` from `lib/ti/assertion.ts`
- Produces: `vtAssertion(stats: { malicious: number; suspicious: number; harmless: number; undetected: number }): Assertion`

- [ ] **Step 1: Write the failing test**

Add to `lib/ti/sources/virustotal.test.ts`:

```ts
import { vtAssertion } from "@/lib/ti/sources/virustotal";
import { assertionScore, TIER_BAND } from "@/lib/ti/scale";

describe("vtAssertion", () => {
  it("is one piece of evidence at a high tier, not ninety votes", () => {
    const a = vtAssertion({ malicious: 60, suspicious: 0, harmless: 20, undetected: 10 });
    expect(a.tier).toBe("attributed");
    expect(assertionScore(a)!).toBeLessThanOrEqual(TIER_BAND.attributed!.ceil);
  });

  it("carries the vendor ratio as the provider figure", () => {
    const a = vtAssertion({ malicious: 60, suspicious: 0, harmless: 20, undetected: 10 });
    expect(a.providerConfidence).toEqual({
      value: 60,
      of: 90,
      label: "vendors flagging",
      kind: "ratio",
    });
  });

  it("separates two vendors from sixty", () => {
    const few = vtAssertion({ malicious: 2, suspicious: 0, harmless: 78, undetected: 10 });
    const many = vtAssertion({ malicious: 60, suspicious: 0, harmless: 20, undetected: 10 });
    expect(assertionScore(few)!).toBeLessThan(assertionScore(many)!);
  });

  it("counts a suspicious vendor as a third of a flagging one", () => {
    const a = vtAssertion({ malicious: 0, suspicious: 3, harmless: 87, undetected: 0 });
    expect(a.providerConfidence?.value).toBe(1);
  });

  it("says none when every vendor looked and none flagged", () => {
    expect(
      vtAssertion({ malicious: 0, suspicious: 0, harmless: 70, undetected: 20 }).tier,
    ).toBe("none");
  });

  it("says no-record when no vendor looked at all", () => {
    expect(
      vtAssertion({ malicious: 0, suspicious: 0, harmless: 0, undetected: 0 }).tier,
    ).toBe("no-record");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- virustotal`
Expected: FAIL, `vtAssertion` is not exported.

- [ ] **Step 3: Write the implementation**

In `lib/ti/sources/virustotal.ts`, add:

```ts
import type { Assertion } from "../assertion";

/**
 * What VirusTotal is entitled to claim.
 *
 * Ninety vendors agreeing is real evidence and it is still *one* piece of it:
 * many of those engines consume the same upstream feeds, so counting them
 * individually would be counting one observation ninety times. The source's
 * meta carries `lineage: "aggregate"` for the same reason, and corroboration
 * collapses it to one origin.
 *
 * The tier is `attributed` rather than `confirmed` because VirusTotal reports
 * what its engines concluded, not an artefact it holds. The vendor ratio rides
 * along as the provider's own figure, which is what separates 60 of 90 from
 * 2 of 90 without letting either cross a tier.
 */
export function vtAssertion(stats: {
  malicious: number;
  suspicious: number;
  harmless: number;
  undetected: number;
}): Assertion {
  const total =
    stats.malicious + stats.suspicious + stats.harmless + stats.undetected;

  // Nobody looked. Distinct from "everyone looked and found nothing", which is
  // the distinction `partial.ts` already draws between noRecord and clean.
  if (total === 0) return { tier: "no-record" };

  // A suspicious verdict is a third of a flagging one, the same ratio the
  // legacy vtScore uses (10x malicious, 3x suspicious), kept so the two
  // pricings can be compared in the calibration set.
  const flagging = Math.round(stats.malicious + stats.suspicious / 3);
  if (flagging === 0) return { tier: "none" };

  return {
    tier: "attributed",
    providerConfidence: {
      value: flagging,
      of: total,
      label: "vendors flagging",
      kind: "ratio",
    },
  };
}
```

Set `lineage: "aggregate"` in the source's `meta`, and call `vtAssertion(stats)` where the finding is built, adding `assertion` beside the existing `score` and `malicious`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- virustotal`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

```bash
bun run test && bun run lint && bun run typecheck
git add lib/ti/sources/virustotal.ts lib/ti/sources/virustotal.test.ts
git commit -m "feat(virustotal): ninety vendors are one piece of evidence"
```

---

### Task 8: GreyNoise and Tor assert what an address *is*

**Files:**
- Modify: `lib/ti/sources/greynoise.ts:56` (`findingFromIdentification`)
- Modify: `lib/ti/sources/tor.ts`
- Test: `lib/ti/sources/greynoise.test.ts`, `lib/ti/sources/tor.test.ts`

**Interfaces:**
- Consumes: `Assertion`, `toInstant`
- Produces: `greyNoiseAssertion(id: { classification?: string; noise?: boolean; riot?: boolean; lastSeen?: string }): Assertion`, `torAssertion(isExit: boolean, lastSeen: string | undefined): Assertion`

These two are one task because they make the same point from two directions: both are sources whose whole job is to say what an address *is*, and both currently express that as a risk number.

- [ ] **Step 1: Write the failing tests**

Add to `lib/ti/sources/greynoise.test.ts`:

```ts
import { greyNoiseAssertion } from "@/lib/ti/sources/greynoise";

describe("greyNoiseAssertion", () => {
  it("vouches for a benign classification, rather than scoring it low", () => {
    expect(greyNoiseAssertion({ classification: "benign" }).tier).toBe("vouched");
  });

  it("vouches for a RIOT hit and calls it a business address", () => {
    const a = greyNoiseAssertion({ classification: "unknown", riot: true });
    expect(a.tier).toBe("vouched");
    expect(a.identity).toBe("business");
  });

  it("attributes a malicious classification, which is GreyNoise's own analysis", () => {
    expect(greyNoiseAssertion({ classification: "malicious" }).tier).toBe("attributed");
  });

  it("merely observes a scanner, because scanning is rude, not criminal", () => {
    const a = greyNoiseAssertion({ classification: "unknown", noise: true });
    expect(a.tier).toBe("observed");
    expect(a.behavior).toEqual(["scanner"]);
  });
});
```

Add to `lib/ti/sources/tor.test.ts`:

```ts
import { torAssertion } from "@/lib/ti/sources/tor";
import { assertionScore } from "@/lib/ti/scale";

describe("torAssertion", () => {
  it("calls a Tor node what it is, on the identity axis", () => {
    expect(torAssertion(true, undefined).identity).toBe("anonymizer");
    expect(torAssertion(false, undefined).identity).toBe("anonymizer");
  });

  it("observes rather than accuses: running Tor is not an offence", () => {
    expect(torAssertion(true, undefined).tier).toBe("observed");
    expect(torAssertion(false, undefined).tier).toBe("observed");
  });

  it("prices an exit above a relay, since only an exit carries traffic out", () => {
    expect(assertionScore(torAssertion(true, undefined))!).toBeGreaterThan(
      assertionScore(torAssertion(false, undefined))!,
    );
  });

  it("normalises Onionoo's zoneless timestamp", () => {
    expect(torAssertion(true, "2026-08-30 01:00:00").observedAt).toBe(
      "2026-08-30T01:00:00Z",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- greynoise tor`
Expected: FAIL, neither function is exported.

- [ ] **Step 3: Write the implementation**

In `lib/ti/sources/greynoise.ts`:

```ts
import type { Assertion } from "../assertion";
import { toInstant } from "../assertion";

/**
 * GreyNoise exists to answer "is this internet background noise", so most of
 * what it returns is an identification rather than an accusation, and the tier
 * is where that finally gets to be said.
 *
 * A `benign` classification and a RIOT hit are both positive identifications,
 * which is the argument `greyNoiseVouches` already makes; `vouched` is the same
 * claim with a name. `malicious` is GreyNoise's own analysis, so `attributed`.
 * Everything else is an observation of scanning, which is rude and not
 * criminal, so `observed`.
 */
export function greyNoiseAssertion(id: {
  classification?: string;
  noise?: boolean;
  riot?: boolean;
  lastSeen?: string;
}): Assertion {
  const observedAt = toInstant(id.lastSeen);
  const identity = id.riot ? ("business" as const) : undefined;

  if (greyNoiseVouches(id.classification, id.riot)) {
    return { tier: "vouched", identity, observedAt };
  }
  if (id.classification === "malicious") {
    return { tier: "attributed", identity, observedAt };
  }
  return {
    tier: id.noise ? "observed" : "no-record",
    identity,
    behavior: id.noise ? ["scanner"] : undefined,
    observedAt,
  };
}
```

Call it from `findingFromIdentification`, adding `assertion: greyNoiseAssertion({ classification, noise, riot, lastSeen })` beside the existing fields.

In `lib/ti/sources/tor.ts`:

```ts
import type { Assertion } from "../assertion";
import { toInstant } from "../assertion";

// An exit carries other people's traffic out to the open internet, so it is
// the address a victim's logs will show. A relay only ever talks to other
// relays. Both are the same kind of thing and only one of them turns up in an
// investigation, which is the whole of the difference priced here.
const EXIT_WEIGHT = 1;
const RELAY_WEIGHT = 0.3;

/**
 * Being a Tor node goes on the identity axis, not the behaviour one.
 *
 * It is a kind of address, not something the address did, and whether it is
 * acceptable is the reader's policy rather than our finding. `observed` is the
 * honest tier: the Tor Project publishes the list, so the fact is certain while
 * the accusation it is not.
 */
export function torAssertion(
  isExit: boolean,
  lastSeen: string | undefined,
): Assertion {
  return {
    tier: "observed",
    identity: "anonymizer",
    providerConfidence: {
      // Calibrated, not a ratio: these are our own two settings for what an
      // exit costs against a relay, already on the 0-1 scale we want.
      value: isExit ? EXIT_WEIGHT : RELAY_WEIGHT,
      label: isExit ? "exit node" : "relay",
      kind: "calibrated",
    },
    observedAt: toInstant(lastSeen),
  };
}
```

Call it where the finding is built, passing whether `hostMatches(relay.exit_addresses, ip)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test -- greynoise tor`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

```bash
bun run test && bun run lint && bun run typecheck
git add lib/ti/sources/greynoise.ts lib/ti/sources/greynoise.test.ts lib/ti/sources/tor.ts lib/ti/sources/tor.test.ts
git commit -m "feat(greynoise,tor): say what an address is, not how bad it scores"
```

---

### Task 9: The blocklists assert `attributed`, gated on how many agree

**Files:**
- Modify: `lib/ti/sources/dnsbl.ts`
- Modify: `lib/ti/sources/et-open.ts`
- Test: `lib/ti/sources/dnsbl.test.ts`, `lib/ti/sources/et-open.test.ts`

**Interfaces:**
- Consumes: `Assertion` from `lib/ti/assertion.ts`
- Produces: `dnsblAssertion(listedCount: number, checked: number): Assertion`, `etOpenAssertion(): Assertion`

- [ ] **Step 1: Write the failing tests**

Add to `lib/ti/sources/dnsbl.test.ts`:

```ts
import { dnsblAssertion } from "@/lib/ti/sources/dnsbl";

describe("dnsblAssertion", () => {
  it("calls one zone a report: public zones list broadly", () => {
    expect(dnsblAssertion(1, 5).tier).toBe("reported");
  });

  it("calls two or more agreeing zones an attribution", () => {
    expect(dnsblAssertion(2, 5).tier).toBe("attributed");
  });

  it("says none when every zone was checked and none listed", () => {
    expect(dnsblAssertion(0, 5).tier).toBe("none");
  });

  it("says no-record when no zone could be checked at all", () => {
    // Every zone blocked or errored, which is not the same as clean.
    expect(dnsblAssertion(0, 0).tier).toBe("no-record");
  });

  it("carries the listed-over-checked ratio as the provider figure", () => {
    expect(dnsblAssertion(3, 5).providerConfidence).toEqual({
      value: 3,
      of: 5,
      label: "zones listing",
      kind: "ratio",
    });
  });

  it("always says spam, which is what these zones are about", () => {
    expect(dnsblAssertion(2, 5).behavior).toEqual(["spam"]);
  });
});
```

Add to `lib/ti/sources/et-open.test.ts`:

```ts
import { etOpenAssertion } from "@/lib/ti/sources/et-open";

describe("etOpenAssertion", () => {
  it("attributes rather than confirms: ET publishes the list, not the sample", () => {
    expect(etOpenAssertion().tier).toBe("attributed");
  });

  it("says what the list is a list of", () => {
    expect(etOpenAssertion().behavior).toEqual(["compromised host"]);
  });

  it("publishes no per-address figure, so it carries none", () => {
    expect(etOpenAssertion().providerConfidence).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- dnsbl et-open`
Expected: FAIL, neither function is exported.

- [ ] **Step 3: Write the implementation**

In `lib/ti/sources/dnsbl.ts`:

```ts
import type { Assertion } from "../assertion";

// One zone listing an address is a report; two agreeing is an attribution. The
// adapter's meta already says why the bar is here rather than at one: some
// public zones list broadly, which is the reason its weight is 0.5.
const AGREEMENT_BAR = 2;

export function dnsblAssertion(listedCount: number, checked: number): Assertion {
  // No zone could be reached, which is a gap in the evidence and not evidence.
  if (checked === 0) return { tier: "no-record" };
  if (listedCount === 0) return { tier: "none" };

  return {
    tier: listedCount >= AGREEMENT_BAR ? "attributed" : "reported",
    behavior: ["spam"],
    providerConfidence: {
      value: listedCount,
      of: checked,
      label: "zones listing",
      kind: "ratio",
    },
  };
}
```

Call it in `check()` with the `listed.length` and `checked` values the function already computes, adding `assertion` beside the existing `score`.

In `lib/ti/sources/et-open.ts`:

```ts
import type { Assertion } from "../assertion";

/**
 * ET Open publishes a list of compromised hosts. It is Emerging Threats'
 * analysis, and Emerging Threats is not handing us the artefact, so this is
 * `attributed` and not `confirmed`. It publishes no per-address confidence, so
 * it carries none: inventing one to fill the field is exactly what this whole
 * change exists to stop.
 */
export function etOpenAssertion(): Assertion {
  return { tier: "attributed", behavior: ["compromised host"] };
}
```

Call it in the listed branch of `check()`, and add `assertion: { tier: "none" }` to the not-listed branch.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test -- dnsbl et-open`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

```bash
bun run test && bun run lint && bun run typecheck
git add lib/ti/sources/dnsbl.ts lib/ti/sources/dnsbl.test.ts lib/ti/sources/et-open.ts lib/ti/sources/et-open.test.ts
git commit -m "feat(dnsbl,et-open): attribute a listing, gated on how many agree"
```

---

### Task 10: The calibration set, and the test that freezes the bands

**Files:**
- Create: `lib/ti/calibration.ts`
- Test: `lib/ti/calibration.test.ts`

**Interfaces:**
- Consumes: `assertionScore` from `lib/ti/scale.ts`, `aggregateRisk` and `verdictFor` from `lib/ti/aggregate.ts`, `SourceResult` from `lib/ti/types.ts`
- Produces: `CALIBRATION: CalibrationCase[]`, `type CalibrationCase`

This task is what makes the whole stage safe, and it is where the numbers in `scale.ts` get tuned rather than guessed. Expect to edit `TIER_BAND` while working on it. That is the intended outcome, not a failure.

- [ ] **Step 1: Write the calibration set**

`lib/ti/calibration.ts`:

```ts
import type { SourceResult, Verdict } from "./types";

/**
 * Indicators with a known right answer, and the source rows that produced it.
 *
 * This exists because the tier-to-points table in `scale.ts` cannot be tuned by
 * eye against whatever indicator happens to be open, which is how the fifty-
 * seven numbers it replaces came to be. Every entry carries the band it must
 * land in and one line saying why that band is right.
 *
 * Moving an entry across a band is allowed. Moving it without editing its
 * `why` in the same commit is not, which is what the test enforces.
 */
export interface CalibrationCase {
  name: string;
  /** The band this indicator must land in, under either pricing. */
  expect: Verdict;
  /** One line: why that band is the right answer for this indicator. */
  why: string;
  /** Recorded source rows, legacy fields and assertion together. */
  rows: SourceResult[];
}
```

Populate `CALIBRATION` with at least the entries below. Capture each one's rows against the real pipeline rather than writing them by hand, so the set describes what the panel does and not what someone expected it to do. Tasks 4 to 9 must be merged first, or the captured rows carry no assertion.

```bash
bun run dev -- -p 3001                       # :3000 is the user's own server
# in another shell, for each indicator in the table:
curl -s localhost:3001/api/check/8.8.8.8 \
  | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));
      console.log(JSON.stringify(r.sources.map(s=>({
        source:s.source, status:s.status, score:s.score,
        malicious:s.malicious, allowlisted:s.allowlisted, assertion:s.assertion,
      })), null, 2));'
```

Use `/api/check-domain/<domain>` and `/api/check-hash/<hash>` for the other two types. Paste each result in as a `rows` array, and record the date of capture in the entry's `why`: a live capture is a snapshot, and an entry that silently ages is worse than one that says when it was taken.

| Entry | Expect | Why it is in the set |
| --- | --- | --- |
| `8.8.8.8` | `clean` | A famous clean address with one adverse dot on a 27 source panel; the case where one noisy source must not carry a verdict |
| A current Feodo C2 | `malicious` | A single `confirmed` source alone must still pin the top band |
| An AbuseIPDB-only address at 75 to 90% confidence | `suspicious` | The deliberate change: reports are evidence, not confirmation, so this drops out of `malicious` where the old floor put it |
| An address on one IPsum list only | `low` | One noisy list must stay cheap |
| An address on eight-plus IPsum lists | `suspicious` | Volume within one aggregate must move the number without reaching `confirmed` |
| A Shodan census scanner (e.g. `71.6.146.185`) | `suspicious` | Named in `threat-type.ts`; the scanner cap must survive, and its identity must not read as an accusation |
| A busy Tor exit (e.g. `185.220.101.1`) | `malicious` | An exit that is also genuinely abused: 263 abuse reports, 13 VirusTotal detections, 3 spam zones. It is malicious *as well as* being an exit, not because of it |
| A quiet Tor exit, picked from the Onionoo list with no abuse history | `low` | The identity case proper: being an exit is a kind of address, not an accusation. This is the entry the busy exit above cannot stand in for |
| A live Feodo C2 (e.g. `50.16.16.211`) | `malicious` | The `confirmed` midpoint path, which no other entry exercises, since Feodo publishes no per-address figure |
| The zero-byte file digest `da39a3ee5e6b4b0d3255bfef95601890afd80709` | `clean` | Named in `aggregate.ts:186`; the vouch quorum must still hold off the URLhaus listing |
| A known-bad hash on MalwareBazaar | `malicious` | `confirmed` on the hash path |
| A clean domain (e.g. `google.com`) | `clean` | The domain path, where the weighted panel is thinner |
| An NXDOMAIN domain | `unknown` | No data is not clean |
| An IPv6 address | `clean` | A thin panel must not read as a suspicious one |

- [ ] **Step 2: Write the failing test**

`lib/ti/calibration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CALIBRATION } from "@/lib/ti/calibration";
import { aggregateRisk, verdictFor } from "@/lib/ti/aggregate";
import { assertionScore } from "@/lib/ti/scale";

describe("the calibration set itself", () => {
  it("covers every verdict band, so the set cannot drift to one corner", () => {
    const bands = new Set(CALIBRATION.map((c) => c.expect));
    expect(bands).toEqual(
      new Set(["clean", "low", "suspicious", "malicious", "unknown"]),
    );
  });

  it("gives every entry a reason, because a band with no argument is a guess", () => {
    for (const c of CALIBRATION) {
      expect(c.why.trim().length, `${c.name} has no why`).toBeGreaterThan(20);
    }
  });
});

describe("today's pricing", () => {
  it.each(CALIBRATION)("$name lands in $expect", (c) => {
    expect(aggregateRisk(c.rows).verdict).toBe(c.expect);
  });
});

describe("assertion pricing lands in the same band", () => {
  // What this does NOT prove, stated so a green run is not over-read: only the
  // eight adapters converted in this stage carry an assertion, so a row from
  // any of the other forty-nine keeps its legacy score and this is a mixed
  // pricing. It is enough to catch a tier priced wildly wrong, which is what
  // stage 1 needs. It is not enough to sign off stage 2, where the same test
  // runs again with every row repriced and is expected to move entries.
  it.each(CALIBRATION)("$name still lands in $expect: $why", (c) => {
    const repriced = c.rows.map((r) =>
      r.assertion ? { ...r, score: assertionScore(r.assertion) } : r,
    );
    expect(aggregateRisk(repriced).verdict).toBe(c.expect);
  });

  it("reprices enough rows to be worth running", () => {
    const withAssertion = CALIBRATION.flatMap((c) => c.rows).filter(
      (r) => r.assertion,
    );
    expect(withAssertion.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun run test -- calibration`
Expected: FAIL. Several entries land in a different band under assertion pricing. This is the information the task exists to produce.

**Measured baseline, 2026-09-11.** Five of these entries were already run
end to end against the live pipeline while the scale was being designed, with
the eight adapters' assertions built by hand and fed through the real
`aggregateRisk` and `applyScannerPolicy`. Under the bands and curve now in
`scale.ts`, all five held their band:

| Indicator | Today | Repriced |
| --- | --- | --- |
| `8.8.8.8` | clean 6 | clean 9 |
| `71.6.146.185` | suspicious 73 | suspicious 52 |
| `185.220.101.1` | malicious 75 | malicious 75 |
| `50.16.16.211` | malicious 75 | malicious 75 |
| `162.243.103.246` | malicious 76 | malicious 75 |

This is a floor for the task, not a result: it was measured against a
hand-written copy of the adapter logic, and the point of the task is to measure
it against the adapters themselves. If a number here does not reproduce, the
adapter and the hand-written copy disagree, and the adapter is the one that
counts.

- [ ] **Step 4: Tune `TIER_BAND` until the bands agree**

For each failing entry, decide which of two things is true and write it down:

1. **The band is wrong for this indicator.** Edit the entry's `expect` and its `why` in the same change, saying what was learned.
2. **The pricing is wrong.** Edit `TIER_BAND` in `lib/ti/scale.ts` and update that row's comment to say what moved it.

Do not add a special case to any adapter to make a calibration entry pass. If an adapter genuinely asserts the wrong tier, fix the tier, and say so in that adapter's test.

The AbuseIPDB-only entry is expected to move from `malicious` to `suspicious` and must be resolved by route 1: that drop is the intended consequence of `reported` never pinning a floor, and its `why` should say so.

- [ ] **Step 5: Run the full suite**

Run: `bun run test && bun run lint && bun run typecheck`
Expected: PASS, all of it. If a test outside `calibration.test.ts` changed behaviour, something in this stage reached further than it should have: nothing but the calibration test reads an assertion.

- [ ] **Step 6: Commit**

```bash
git add lib/ti/calibration.ts lib/ti/calibration.test.ts lib/ti/scale.ts
git commit -m "test(ti): freeze the verdict bands against a calibration set"
```

- [ ] **Step 7: Check coverage before opening a PR**

```bash
bun run coverage
```

Every new file under `lib/` needs 80% on changed lines for the Sonar new-code gate: `assertion.ts`, `scale.ts`, `calibration.ts`.

---

## Done when

- `bun run test`, `bun run lint`, `bun run typecheck` and `bun run build` all pass.
- Eight adapters emit an assertion; every registered source declares a lineage.
- The calibration set covers all five bands and passes under both pricings.
- No file outside `lib/ti/assertion.ts`, `lib/ti/scale.ts`, `lib/ti/calibration.ts`, `lib/ti/types.ts` and the eight adapters has changed behaviour.
- `scale.ts` can answer, in its own comments, what every tier is worth and why.
