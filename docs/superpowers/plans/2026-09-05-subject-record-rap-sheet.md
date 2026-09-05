# Subject Record Rap Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `ORIGIN` row (the geo country vote, IP only) and replace the single-winner `REPORTED FOR` row with a counted `PRIORS` row, so the subject record masthead reads as a rap sheet instead of an unreliable one-word verdict.

**Architecture:** Two new render-time-only resolvers in `lib/ti/subject-record.ts` (`originOf`, `priorsOf`), wired into the existing `buildSubjectRecord()` alongside the untouched `class`/`hostedOn` ladders. `components/CheckResults/record.tsx` gains one new row (`ORIGIN`) and simplifies the renamed one (`PRIORS`, was `REPORTED FOR`). No adapter, `aggregate.ts`, `threat-type.ts`, or cache-schema change — everything reads fields already present on `SourceResult[]`/`ScoreBreakdown`/`GeoResolution`.

**Tech Stack:** TypeScript, Vitest, React 19 (Next.js App Router), Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-05-subject-record-rap-sheet-design.md`

## Global Constraints

- No dashes as sentence separators in user-facing copy — commas only (house style, confirmed against existing labels like `"Amazon Web Services, eu-west-1, EC2"`).
- A count renders only when it changes how the row reads. Unanimous agreement stays silent; disagreement is named. (The spec's "counting rule".)
- `Row`'s `sources` prop is a bare list of source ids everywhere in this card — never mix in a second, unrelated number or sentence. (This is the exact bug self-review caught in the spec; Task 3 below must not reintroduce it.)
- `lib/ti/subject-record.ts` stays pure: no JSX, no network, computed entirely from the `SourceResult[]`/context/`ScoreBreakdown` already in the result.
- Before finishing any task: `bun run test` for the file(s) touched. Before finishing the last task: `bun run typecheck && bun run lint && bun run test` clean, since the Sonar `new_coverage` gate wants 80% on changed lines.

---

## Task 1: `originOf()` — the country the geo providers voted for

**Files:**
- Modify: `lib/ti/subject-record.ts:18` (add `Origin` type right after `Claim`) and after line 452 (`subjectOf`, add `originOf` right before it, or anywhere below the existing ladders — see Step 3 for the exact anchor)
- Test: `lib/ti/subject-record.test.ts` (new `describe("originOf", ...)` block, inserted after line 487, the closing `});` of `describe("threatClaim, hash rungs", ...)`, and before `import { lastResortClaim } ...` — at that point in the file, `ipResult`/`domainResult`/`hashResult` are already defined above)

**Interfaces:**
- Consumes: nothing new — `AnyResult`, `geoOf`, `geoResolutionOf` already exist in `lib/ti/subject-record.ts` (private, file-scoped helpers already used by `fromAsnTable`/`fromGeoFlags`/etc.)
- Produces: `export type Origin = Claim & { dissent?: { value: string; sources: string[] }[] }` and `export function originOf(r: AnyResult): Origin | undefined` — both consumed by Task 2

- [ ] **Step 1: Write the failing tests**

Add this import and `describe` block to `lib/ti/subject-record.test.ts`, right after the closing `});` of `describe("threatClaim, hash rungs", ...)` (the block ending `expect(threatClaim(hashResult([src({ id: "hashlookup" })]))).toBeNull(); });`) and before the `import { lastResortClaim } from "@/lib/ti/subject-record";` line:

```ts
import { originOf } from "@/lib/ti/subject-record";

/** A GeoResolution carrying only what originOf reads: the country vote,
 *  optionally a code, a city, and dissenting alternatives. */
function geoResolutionWithCountry(
  value: string,
  sources: string[],
  opts?: {
    countryCode?: string;
    city?: string;
    alternatives?: { value: string; sources: string[] }[];
  },
): NonNullable<CheckResult["geoResolution"]> {
  return {
    country: {
      value,
      confidence: "high",
      score: 1,
      agreement: 1,
      sources,
      alternatives: opts?.alternatives,
    },
    countryCode: opts?.countryCode,
    city: opts?.city
      ? { value: opts.city, confidence: "high", score: 1, agreement: 1, sources }
      : undefined,
    flags: { isHosting: false, isProxy: false, isMobile: false, sources: {} },
    providerCount: sources.length,
  };
}

describe("originOf", () => {
  it("names the country the vote agreed on, with the code and city folded in", () => {
    const claim = originOf(
      ipResult(
        [],
        undefined,
        geoResolutionWithCountry("Germany", ["ip-api", "ipwhois"], {
          countryCode: "DE",
          city: "Berlin",
        }),
      ),
    );
    expect(claim).toEqual({
      label: "Germany (DE), Berlin",
      sources: ["ip-api", "ipwhois"],
      dissent: undefined,
    });
  });

  it("names the dissent only when the vote actually split", () => {
    const claim = originOf(
      ipResult(
        [],
        undefined,
        geoResolutionWithCountry("Germany", ["ip-api"], {
          countryCode: "DE",
          alternatives: [{ value: "Netherlands", sources: ["ipwhois", "rdap-ip"] }],
        }),
      ),
    );
    expect(claim?.dissent).toEqual([{ value: "Netherlands", sources: ["ipwhois", "rdap-ip"] }]);
  });

  it("falls back to raw geo when the caller never reconciled", () => {
    const claim = originOf(
      ipResult([], { country: "Australia", countryCode: "AU", city: "Brisbane" }),
    );
    expect(claim).toEqual({ label: "Australia (AU), Brisbane", sources: [] });
  });

  it("is undefined for a domain, a hash, and an IP with no geo at all", () => {
    expect(originOf(domainResult([], { resolvedIps: ["1.2.3.4"] }))).toBeUndefined();
    expect(originOf(hashResult([]))).toBeUndefined();
    expect(originOf(ipResult([]))).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test lib/ti/subject-record.test.ts`
Expected: FAIL — `originOf` is not exported from `@/lib/ti/subject-record`.

- [ ] **Step 3: Implement `Origin` and `originOf`**

In `lib/ti/subject-record.ts`, change line 18 from:

```ts
export type Claim = { label: string; sources: string[] };
```

to:

```ts
export type Claim = { label: string; sources: string[] };

/** The country the geo providers voted for. `dissent` is populated only when
 *  the vote actually split; see the counting rule in the design doc. */
export type Origin = Claim & {
  dissent?: { value: string; sources: string[] }[];
};
```

Then, immediately before `function subjectOf(r: AnyResult): string {` (currently line 452), add:

```ts
/**
 * The country the geo providers voted for, IP only. Reads the reconciled vote
 * (`geoResolution.country`) when one exists, falling back to a single
 * provider's raw `geo.country` when the caller never reconciled. Domains
 * carry no geo at all today (the domain pipeline fetches none), and a hash
 * has no origin by nature, so `geoOf`/`geoResolutionOf` returning undefined
 * for both already makes this undefined for them too.
 */
export function originOf(r: AnyResult): Origin | undefined {
  const resolution = geoResolutionOf(r);
  const country = resolution?.country;
  if (country) {
    const code = resolution?.countryCode;
    const city = resolution?.city?.value;
    const label = [code ? `${country.value} (${code})` : country.value, city]
      .filter(Boolean)
      .join(", ");
    return {
      label,
      sources: country.sources,
      dissent: country.alternatives?.length
        ? country.alternatives.map((a) => ({ value: a.value, sources: a.sources }))
        : undefined,
    };
  }
  const geo = geoOf(r);
  if (!geo?.country) return undefined;
  const label = [geo.countryCode ? `${geo.country} (${geo.countryCode})` : geo.country, geo.city]
    .filter(Boolean)
    .join(", ");
  return { label, sources: [] };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test lib/ti/subject-record.test.ts`
Expected: PASS, all `originOf` cases green, and every prior test in the file still passes (nothing else changed).

- [ ] **Step 5: Commit**

```bash
git add lib/ti/subject-record.ts lib/ti/subject-record.test.ts
git commit -m "feat(ti): add originOf, the country the geo vote agreed on"
```

---

## Task 2: Wire `origin` into `SubjectRecord` and `buildSubjectRecord`

**Files:**
- Modify: `lib/ti/subject-record.ts:20-45` (`SubjectRecord` type), `lib/ti/subject-record.ts:467-494` (`buildSubjectRecord`)
- Test: `lib/ti/subject-record.test.ts` (new case inside the existing `describe("buildSubjectRecord", ...)` block)

**Interfaces:**
- Consumes: `Origin`, `originOf` from Task 1
- Produces: `SubjectRecord.origin?: Origin`, populated by `buildSubjectRecord`

- [ ] **Step 1: Write the failing test**

Add this case inside the existing `describe("buildSubjectRecord", ...)` block in `lib/ti/subject-record.test.ts` (anywhere among the other `it(...)` cases — e.g. right after the `"carries the algorithm as the hash qualifier"` case):

```ts
it("carries the country vote on an IP, and nothing on a domain or hash", () => {
  const rec = buildSubjectRecord(ipResult([], { country: "Germany", countryCode: "DE" }));
  expect(rec.origin).toEqual({ label: "Germany (DE)", sources: [] });
  expect(buildSubjectRecord(domainResult([])).origin).toBeUndefined();
  expect(buildSubjectRecord(hashResult([])).origin).toBeUndefined();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test lib/ti/subject-record.test.ts -t "carries the country vote"`
Expected: FAIL — `rec.origin` is `undefined` where `{ label: "Germany (DE)", sources: [] }` was expected (the field is not wired yet).

- [ ] **Step 3: Wire `origin` into the type and the builder**

In `lib/ti/subject-record.ts`, change the `SubjectRecord` type (currently lines 20-45) so it reads, in full:

```ts
export type SubjectRecord = {
  /** The indicator, verbatim. */
  subject: string;
  /** Hash only: the algorithm, rendered as the chip beside the heading. */
  qualifier?: string;
  /** What it is. The threat identity when there is one, else the
   *  infrastructure identity, else the per-type classifier. */
  class: Claim;
  /** The country the geo providers voted for. IP only: the domain pipeline
   *  fetches no geo, and a hash has no origin by nature. */
  origin?: Origin;
  /** Who runs the box. Undefined when `class` already carries it, so the same
   *  fact never renders on two rows. */
  hostedOn?: Claim;
  /** What it did, as reported. */
  reportedFor?: Claim & { also: string[] };
  /**
   * Hash only: the multi-engine detection tally. Undefined for IP and domain,
   * and undefined on a hash when VirusTotal (key-gated, the only source that
   * sets it) did not answer. This is display text, not a sprite input: it may
   * come and go with a key or a quota without ever moving the picture, which
   * is exactly the distinction the ladders in this file exist to enforce.
   * Never promote it into a resolver rung.
   */
  detections?: { malicious: number; total: number };
  /** ISO days. */
  seen?: { first?: string; last?: string };
  sprite: SpriteSpec;
};
```

(Only the `origin?: Origin;` field and its doc comment are new here — `reportedFor` is untouched in this task; it is renamed in Task 4.)

In `buildSubjectRecord` (currently lines 467-494), add one line to the returned object, right after `class: klass,`:

```ts
  return {
    subject: subjectOf(r),
    qualifier: isHash(r) ? HASH_ALGO_LABEL[r.algorithm] : undefined,
    class: klass,
    origin: originOf(r),
    hostedOn,
    reportedFor: behaviour
      ? { label: behaviour.type, sources: behaviour.sources, also: behaviour.also }
      : undefined,
    detections: isHash(r) ? r.context?.detectionRatio : undefined,
    seen: seenRange(r.sources, isHash(r) ? r.context : undefined),
    sprite: spriteFor(r, infra, threat, flagged),
  };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test lib/ti/subject-record.test.ts`
Expected: PASS, including every pre-existing `buildSubjectRecord` case (none of them assert on `origin`, so none should break).

- [ ] **Step 5: Commit**

```bash
git add lib/ti/subject-record.ts lib/ti/subject-record.test.ts
git commit -m "feat(ti): surface origin on the subject record"
```

---

## Task 3: `priorsOf()` — counted charges instead of an elected label

**Files:**
- Modify: `lib/ti/subject-record.ts` (add `import type { ThreatTypeVerdict } from "./threat-type";`; add the rung functions and `priorsOf` immediately before `function subjectOf` — i.e. in the same location Task 1 added `originOf`, either just above or just below it)
- Test: `lib/ti/subject-record.test.ts` (new `describe("priorsOf", ...)` block, appended after the `describe("originOf", ...)` block from Task 1, before the `import { lastResortClaim } ...` line)

**Interfaces:**
- Consumes: `Claim` (existing), `ok()` (existing file-private helper), `ThreatTypeVerdict` (from `lib/ti/threat-type.ts`, already exported for `IDENTIFIERS`'s sake)
- Produces: `export function priorsOf(r: AnyResult, behaviour: ThreatTypeVerdict | null, klass: Claim): Claim & { also: string[] }` — consumed by Task 4. Never returns `null`; rung 4 always answers.

- [ ] **Step 1: Write the failing tests**

Add this import and `describe` block to `lib/ti/subject-record.test.ts`, right after the `describe("originOf", ...)` block added in Task 1 (still before `import { lastResortClaim } from "@/lib/ti/subject-record";`):

```ts
import { priorsOf } from "@/lib/ti/subject-record";
import type { ThreatTypeVerdict } from "@/lib/ti/threat-type";

describe("priorsOf", () => {
  it("rung 1: counts AbuseIPDB's own report taxonomy, not the tor tag it also carries", () => {
    const claim = priorsOf(
      ipResult([
        src({
          id: "abuseipdb",
          malicious: true,
          categories: ["tor", "Fixed Line ISP", "web app attack", "hacking", "brute-force"],
          details: {
            totalReports: 148,
            reportCategories: [
              { name: "Web App Attack", count: 70 },
              { name: "Hacking", count: 49 },
              { name: "Brute-Force", count: 18 },
              { name: "Port Scan", count: 9 },
            ],
          },
        }),
      ]),
      null,
      { label: "Tor exit node", sources: ["tor-project"] },
    );
    expect(claim).toEqual({
      label: "148 reports, led by web app attack (70), hacking (49), brute force (18)",
      sources: ["abuseipdb"],
      also: [],
    });
  });

  it("rung 2: falls back to the behaviour ballot when AbuseIPDB has no report breakdown", () => {
    const behaviour: ThreatTypeVerdict = { type: "brute force", sources: ["otx"], also: ["scanner"] };
    const claim = priorsOf(ipResult([]), behaviour, { label: "Hosting / Datacenter", sources: [] });
    expect(claim).toEqual({ label: "Brute force", sources: ["otx"], also: ["scanner"] });
  });

  it("rung 3: names who flagged it, with a vendor count, when VirusTotal alone floored the score", () => {
    const flagged = ipResult([
      src({
        id: "virustotal",
        malicious: true,
        score: 100,
        details: { maliciousVendors: 15, totalVendors: 91 },
      }),
    ]);
    flagged.verdict = "malicious";
    flagged.scoreBreakdown = {
      effectiveMax: 100,
      weightedAvg: 15,
      floorApplied: true,
      flooredBy: "virustotal",
      floorValue: 75,
      borderline: true,
      allowlistSuppressed: false,
    };
    const claim = priorsOf(flagged, null, { label: "Hosting / Datacenter", sources: ["geo flags"] });
    expect(claim).toEqual({
      label: "Flagged by virustotal (15 of 91 vendors)",
      sources: ["virustotal"],
      also: [],
    });
  });

  it("rung 3: names a non-VirusTotal flooring source without a count it cannot generically read", () => {
    const flagged = ipResult([src({ id: "feodo", malicious: true })]);
    flagged.verdict = "malicious";
    flagged.scoreBreakdown = {
      effectiveMax: 100,
      weightedAvg: 60,
      floorApplied: true,
      flooredBy: "feodo",
      floorValue: 75,
      borderline: false,
      allowlistSuppressed: false,
    };
    const claim = priorsOf(flagged, null, { label: "Hosting / Datacenter", sources: [] });
    expect(claim).toEqual({ label: "Flagged by feodo", sources: ["feodo"], also: [] });
  });

  it("rung 4: says so when there is nothing to charge", () => {
    const clean = ipResult([]);
    clean.verdict = "clean";
    expect(priorsOf(clean, null, { label: "Hosting / Datacenter", sources: [] })).toEqual({
      label: "No record",
      sources: [],
      also: [],
    });
  });

  it("rung 4: names the Tranco voucher when CLASS did not already claim it", () => {
    const clean = domainResult([src({ id: "tranco", details: { rank: 412, vouched: true } })]);
    clean.verdict = "clean";
    const claim = priorsOf(clean, null, { label: "Hosting / Datacenter", sources: [] });
    expect(claim).toEqual({
      label: "No record, vouched by Tranco (rank 412)",
      sources: ["tranco"],
      also: [],
    });
  });

  it("rung 4: does not repeat Tranco's vouch when CLASS already carries it", () => {
    const clean = domainResult([src({ id: "tranco", details: { rank: 1, vouched: true } })]);
    clean.verdict = "clean";
    const claim = priorsOf(clean, null, {
      label: "Popular domain, Tranco rank 1",
      sources: ["tranco"],
    });
    expect(claim).toEqual({ label: "No record", sources: [], also: [] });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test lib/ti/subject-record.test.ts -t "priorsOf"`
Expected: FAIL — `priorsOf` is not exported from `@/lib/ti/subject-record`.

- [ ] **Step 3: Implement the ladder**

In `lib/ti/subject-record.ts`, add the import near the top, alongside the existing `threat-type` import:

```ts
import { IDENTIFIERS, threatTypeOf } from "./threat-type";
import type { ThreatTypeVerdict } from "./threat-type";
```

Then, immediately before `function subjectOf(r: AnyResult): string {`, add (alongside `originOf` from Task 1 — order between the two does not matter):

```ts
type ReportCategory = { name: string; count: number };

/** AbuseIPDB's own named report-reason tally, count descending (already
 *  sorted by categoryBreakdown in lib/ti/sources/abuseipdb.ts) — never the
 *  `categories` array a `tor` tag can slip into. */
function reportCategoriesOf(details: Record<string, unknown> | undefined): ReportCategory[] {
  const raw = details?.reportCategories;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (c): c is ReportCategory =>
      typeof c === "object" &&
      c !== null &&
      typeof (c as ReportCategory).name === "string" &&
      typeof (c as ReportCategory).count === "number",
  );
}

/**
 * Rung 1: counted charges. The report total leads the label rather than
 * living in the provenance line, which is a bare list of source ids
 * everywhere else in this file. The three shown counts do not have to sum to
 * the total (one report can carry several categories), so "led by", not
 * "for": these are the largest buckets, not claimed to be all of them.
 */
function fromAbuseReports(r: AnyResult): (Claim & { also: string[] }) | null {
  const hit = ok(r.sources, "abuseipdb");
  const total = hit?.details?.totalReports;
  const cats = reportCategoriesOf(hit?.details);
  if (typeof total !== "number" || cats.length === 0) return null;
  const top = cats.slice(0, 3).map((c) => `${c.name.toLowerCase()} (${c.count})`);
  return { label: `${total} reports, led by ${top.join(", ")}`, sources: ["abuseipdb"], also: [] };
}

/** Rung 2: the existing behaviour ballot, unchanged. Capitalized here, once,
 *  rather than with a CSS transform in record.tsx: a per-word CSS capitalize
 *  would wrongly title-case rung 1 and rung 3's multi-word sentences too, and
 *  this is the only rung whose label was ever a bare lowercase enum value. */
function fromBehaviour(behaviour: ThreatTypeVerdict | null): (Claim & { also: string[] }) | null {
  if (!behaviour) return null;
  const label = behaviour.type.charAt(0).toUpperCase() + behaviour.type.slice(1);
  return { label, sources: behaviour.sources, also: behaviour.also };
}

/**
 * Rung 3: flagged with no charges. Names who flagged it rather than leaving
 * the row silent under a malicious/suspicious verdict. Only VirusTotal gets a
 * vendor-count parenthetical, since it is the one source whose `details`
 * shape this file already reads elsewhere (`maliciousVendors`/
 * `totalVendors`); every other flooring/dominant source is still named, just
 * without a count this function has no generic way to read.
 */
function fromFloorOrDominant(r: AnyResult): (Claim & { also: string[] }) | null {
  if (r.verdict !== "malicious" && r.verdict !== "suspicious") return null;
  const sb = r.scoreBreakdown;
  const sourceId = sb?.flooredBy ?? sb?.dominantSourceId;
  if (!sourceId) return null;
  const hit = ok(r.sources, sourceId);
  if (!hit) return null;
  const name = hit.source.name;
  if (sourceId === "virustotal") {
    const malicious = hit.details?.maliciousVendors;
    const total = hit.details?.totalVendors;
    if (typeof malicious === "number" && typeof total === "number") {
      return {
        label: `Flagged by ${name} (${malicious} of ${total} vendors)`,
        sources: [sourceId],
        also: [],
      };
    }
  }
  return { label: `Flagged by ${name}`, sources: [sourceId], also: [] };
}

/**
 * Rung 4: no charges, nothing flagged. Names the voucher when one cleared it
 * (Tranco rank, hashlookup known-good), unless `klass` already carries that
 * same fact: a Tranco-vouched popular domain already says so in `CLASS`
 * (`lastResortClaim`'s `fromTranco`), and citing it again here would repeat a
 * row rather than add one — the same failure mode `hostedOn` already guards
 * against for `class`.
 */
function fromNoRecord(r: AnyResult, klass: Claim): Claim & { also: string[] } {
  if (!klass.sources.includes("tranco")) {
    const tranco = ok(r.sources, "tranco");
    const rank = tranco?.details?.rank;
    if (tranco?.details?.vouched === true && typeof rank === "number") {
      return { label: `No record, vouched by Tranco (rank ${rank})`, sources: ["tranco"], also: [] };
    }
  }
  if (!klass.sources.includes("hashlookup")) {
    const hashlookup = ok(r.sources, "hashlookup");
    if (hashlookup && hashlookup.malicious !== true && hashlookup.score === 0) {
      return { label: "No record, vouched by hashlookup", sources: ["hashlookup"], also: [] };
    }
  }
  return { label: "No record", sources: [], also: [] };
}

/**
 * What the subject is charged with, counted rather than elected. A rap sheet
 * lists charges; it does not pick one word to summarise a person, which is
 * what the single-winner ballot in threatTypeOf did when a stray "tor"
 * category (emitted by non-identifier sources like virustotal and abuseipdb)
 * out-voted 148 real abuse reports on 185.220.101.42. This routes around that
 * bug rather than fixing threatTypeOf itself, which verdict.tsx still calls
 * unfiltered for the headline. Never returns null: rung 4 always answers.
 */
export function priorsOf(
  r: AnyResult,
  behaviour: ThreatTypeVerdict | null,
  klass: Claim,
): Claim & { also: string[] } {
  return (
    fromAbuseReports(r) ?? fromBehaviour(behaviour) ?? fromFloorOrDominant(r) ?? fromNoRecord(r, klass)
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test lib/ti/subject-record.test.ts`
Expected: PASS, every `priorsOf` case, and every pre-existing test in the file (this task does not touch `buildSubjectRecord`, so `reportedFor` still works exactly as before — that wiring changes in Task 4).

- [ ] **Step 5: Commit**

```bash
git add lib/ti/subject-record.ts lib/ti/subject-record.test.ts
git commit -m "feat(ti): add priorsOf, counted charges instead of an elected label"
```

---

## Task 4: Rename `reportedFor` to `priors`, wire it in, update the callers

**Files:**
- Modify: `lib/ti/subject-record.ts` (`SubjectRecord` type, `buildSubjectRecord`)
- Modify: `lib/ti/subject-record.test.ts` (three existing assertions that reference `rec.reportedFor`, plus one new integration test)

**Interfaces:**
- Consumes: `priorsOf` from Task 3
- Produces: `SubjectRecord.priors: Claim & { also: string[] }` (required — no `?`), populated by `buildSubjectRecord`. `reportedFor` no longer exists anywhere in the codebase after this task.

- [ ] **Step 1: Update the three existing test assertions (this makes them fail first, honestly)**

In `lib/ti/subject-record.test.ts`, inside `describe("buildSubjectRecord", ...)`:

Change:

```ts
    expect(rec.reportedFor?.label).toBe("brute force");
    expect(rec.reportedFor?.sources).toEqual(expect.arrayContaining(["abuseipdb", "otx"]));
```

to:

```ts
    expect(rec.priors.label).toBe("Brute force");
    expect(rec.priors.sources).toEqual(expect.arrayContaining(["abuseipdb", "otx"]));
```

(This is the `"surfaces both axes for the case that motivated the split"` test. Its `abuseipdb` fixture sets `categories` but no `details`, so `fromAbuseReports` still declines and rung 2 — the unchanged behaviour ballot — still wins, same as today; only the field name and the now-capitalized label text change.)

And change:

```ts
    expect(rec.reportedFor).toBeUndefined();
```

to:

```ts
    expect(rec.priors).toEqual({ label: "No record", sources: [], also: [] });
```

(This is the `"says so rather than leaving a gap"` test. `ipResult([])` has no sources at all, `verdict: "unknown"`, so rungs 1–3 all decline and rung 4 falls all the way to the bare no-voucher case.)

Also add this new case to the same `describe` block, verifying the exact scenario Task 3 added the `klass` guard for:

```ts
it("does not repeat the Tranco vouch in priors when CLASS already used it", () => {
  const clean = domainResult([src({ id: "tranco", details: { rank: 1, vouched: true } })]);
  clean.verdict = "clean";
  const rec = buildSubjectRecord(clean);
  expect(rec.class.label).toBe("Popular domain, Tranco rank 1");
  expect(rec.priors).toEqual({ label: "No record", sources: [], also: [] });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test lib/ti/subject-record.test.ts`
Expected: FAIL — `rec.priors` is `undefined` (the field is still called `reportedFor` and is still optional in the type).

- [ ] **Step 3: Rename and wire**

In `lib/ti/subject-record.ts`, in the `SubjectRecord` type, change:

```ts
  /** Who runs the box. Undefined when `class` already carries it, so the same
   *  fact never renders on two rows. */
  hostedOn?: Claim;
  /** What it did, as reported. */
  reportedFor?: Claim & { also: string[] };
```

to:

```ts
  /** Who runs the box. Undefined when `class` already carries it, so the same
   *  fact never renders on two rows. */
  hostedOn?: Claim;
  /** What the subject is charged with: counted priors, not an elected label.
   *  Always present — rung 4 of `priorsOf` answers "No record" when nothing
   *  else does. */
  priors: Claim & { also: string[] };
```

In `buildSubjectRecord`, change:

```ts
    hostedOn,
    reportedFor: behaviour
      ? { label: behaviour.type, sources: behaviour.sources, also: behaviour.also }
      : undefined,
```

to:

```ts
    hostedOn,
    priors: priorsOf(r, behaviour, klass),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test lib/ti/subject-record.test.ts`
Expected: PASS, all cases in the file.

- [ ] **Step 5: Confirm nothing outside this file still references the old name**

Run: `grep -rn "reportedFor" --include="*.ts" --include="*.tsx" .`
Expected: no matches (the only other reference, `components/CheckResults/record.tsx`, is updated in Task 5 — if this greps anything else, stop and check it before proceeding).

- [ ] **Step 6: Commit**

```bash
git add lib/ti/subject-record.ts lib/ti/subject-record.test.ts
git commit -m "feat(ti): rename reportedFor to priors, wire priorsOf into buildSubjectRecord"
```

---

## Task 5: Render `ORIGIN` and `PRIORS` in the masthead, verify end to end

**Files:**
- Modify: `components/CheckResults/record.tsx` (whole file — see Step 1 for the complete new content)

**Interfaces:**
- Consumes: `SubjectRecord.origin`, `SubjectRecord.priors` (required) from Tasks 2 and 4
- Produces: no new exports; `Row` gains an internal `note?: string` prop (not exported, file-local)

This task has no dedicated test file (`record.tsx` has none today); verification is `bun run typecheck`/`lint`/`test` plus a live browser check, per this project's convention for UI changes.

- [ ] **Step 1: Replace the contents of `components/CheckResults/record.tsx`**

```tsx
"use client";

import type { ReactNode } from "react";
import { memo } from "react";
import type { SubjectRecord } from "@/lib/ti/subject-record";
import type { Verdict } from "@/lib/ti/types";
import { cn } from "@/lib/utils";
import { Sprite } from "./sprite";
import { VERDICT_STYLE } from "./verdict";

/** One labelled row, with the sources that backed it underneath. The provenance
 *  line is what stops this card repeating VerdictHero: the hero says how bad,
 *  this says what, and who said so. `note` is a pre-formatted alternative to
 *  `sources` for a row whose provenance is not a plain list of source ids (the
 *  Origin row's dissent sentence) — the two are mutually exclusive, and no row
 *  ever needs both. */
function Row({
    label,
    sources,
    note,
    children,
}: Readonly<{
    label: string;
    sources?: string[];
    note?: string;
    children: ReactNode;
}>) {
    return (
        <div className="flex flex-wrap items-baseline gap-x-3 py-1.5 sm:flex-nowrap">
            <dt className="w-32 shrink-0 font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                {label}
            </dt>
            <dd className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">{children}</div>
                {sources?.length ? (
                    <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        {sources.join(", ")}
                    </div>
                ) : note ? (
                    <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{note}</div>
                ) : null}
            </dd>
        </div>
    );
}

function seenText(seen: SubjectRecord["seen"]): string | null {
    if (!seen) return null;
    if (seen.first && seen.last) return `${seen.first} to ${seen.last}`;
    if (seen.last) return `Last seen ${seen.last}`;
    if (seen.first) return `First seen ${seen.first}`;
    return null;
}

/** "2 sources say Netherlands" for one dissenting value, joined with a comma
 *  when more than one alternative was reported. Rendered only when the
 *  country vote actually split; see the counting rule in the design doc. */
function dissentText(dissent: NonNullable<SubjectRecord["origin"]>["dissent"]): string {
    return (dissent ?? [])
        .map((d) =>
            d.sources.length === 1
                ? `1 source says ${d.value}`
                : `${d.sources.length} sources say ${d.value}`,
        )
        .join(", ");
}

export const SubjectMasthead = memo(function SubjectMasthead({
    record,
    verdict,
}: Readonly<{ record: SubjectRecord; verdict: Verdict }>) {
    const seen = seenText(record.seen);
    const priors = record.priors;
    const alsoText = priors.also.length ? `, also described as ${priors.also.join(", ")}` : "";

    return (
        <div className="flex items-start justify-between gap-4">
            <dl className="min-w-0 flex-1">
                <Row label="Subject">
                    <span className="font-mono break-all">{record.subject}</span>
                    {record.qualifier && (
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                            {record.qualifier}
                        </span>
                    )}
                </Row>
                <Row label="Class" sources={record.class.sources}>
                    {record.class.label}
                </Row>
                {record.origin && (
                    <Row
                        label="Origin"
                        note={
                            record.origin.dissent?.length
                                ? dissentText(record.origin.dissent)
                                : undefined
                        }
                    >
                        {record.origin.label}
                    </Row>
                )}
                {record.hostedOn && (
                    <Row label="Hosted on" sources={record.hostedOn.sources}>
                        {record.hostedOn.label}
                    </Row>
                )}
                <Row label="Priors" sources={priors.sources}>
                    {priors.label}
                    <span className="text-muted-foreground">{alsoText}</span>
                </Row>
                {record.detections && (
                    // VirusTotal is the only source that sets detectionRatio, and it is
                    // key-gated: on a keyless deployment this row simply does not render,
                    // same as hostedOn or seen when nothing backs them. That is correct,
                    // this is text on the card, not a rung the sprite depends on, so it
                    // never needs the free-source guard the ladders in subject-record.ts
                    // enforce. Do not turn this into a resolver rung.
                    <Row label="Detections" sources={["virustotal"]}>
                        {record.detections.malicious} of {record.detections.total} engines
                    </Row>
                )}
                {seen && <Row label="Record">{seen}</Row>}
            </dl>

            <div
                className={cn(
                    "flex size-16 shrink-0 items-center justify-center rounded-md border border-foreground/20 bg-background sm:size-20",
                    VERDICT_STYLE[verdict].text,
                )}
            >
                <Sprite
                    spec={record.sprite}
                    px={48}
                    title={record.class.label}
                    className="sm:hidden"
                />
                <Sprite
                    spec={record.sprite}
                    px={64}
                    title={record.class.label}
                    className="hidden sm:block"
                />
            </div>
        </div>
    );
});

/** Matches the row rhythm above, so the card does not jump when the result
 *  lands. Mirrors the skeleton already in IpDossierCard. */
export function SubjectMastheadSkeleton() {
    return (
        <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-3">
                {["w-48", "w-36", "w-44", "w-40"].map((w) => (
                    <div key={w} className="flex items-baseline gap-3">
                        <span className="sweep h-3 w-24 shrink-0 rounded" />
                        <span className={cn("sweep h-3 rounded", w)} />
                    </div>
                ))}
            </div>
            <span className="sweep size-16 shrink-0 rounded-md sm:size-20" />
        </div>
    );
}
```

Note what disappeared versus the previous version: the `reported ? (...) : "Nothing on file"` ternary (priors is never absent now, so there is nothing to fall back to), and the `capitalize`/`normal-case` class pair (rung 2 pre-capitalizes its own label now, in `fromBehaviour`, so a per-word CSS transform is never applied to the multi-word sentences rungs 1/3/4 produce).

- [ ] **Step 2: Typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: both clean. If `typecheck` complains about `SubjectRecord["origin"]` being possibly `undefined` inside `dissentText`'s parameter type, confirm the `NonNullable<...>` wrapper is present exactly as written above — it strips the `| undefined` from `origin?`, and the function's own parameter type still carries `dissent`'s own optionality, which the `dissent ?? []` guard inside handles.

- [ ] **Step 3: Run the full test suite**

Run: `bun run test`
Expected: PASS. This is a full-suite run, not scoped to one file, since Tasks 1–4 already covered `lib/ti/subject-record.test.ts` in isolation — this step is the check that nothing elsewhere in the suite (e.g. any snapshot or integration test touching `CheckResults`) broke.

- [ ] **Step 4: Verify in the browser against the two real cases that motivated this design**

The dev server is already running on `:3000` (confirm with `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/` — expect `200`; do not start a second server, and never broadly `pkill` anything on this machine). Auth is bypassed under local `next dev` (see `proxy.ts`), so no session token is needed.

Using a browser tool (e.g. Playwright), navigate to:

- `http://localhost:3000/check/185.220.101.42` — confirm the masthead reads, in order: `SUBJECT`, `CLASS: Tor exit node`, `ORIGIN: Germany (DE), Berlin` with no provenance line beneath it (the country vote was unanimous), `HOSTED ON: Non-Profit, Zwiebelfreunde`, `PRIORS: 148 reports, led by web app attack (70), hacking (49), brute force (18)` with `abuseipdb` beneath it, and the word "anonymizer" appearing nowhere in the `PRIORS` row.
- `http://localhost:3000/check/45.155.205.233` — confirm `PRIORS: Flagged by VirusTotal (15 of 91 vendors)` renders directly beneath `CLASS: Hosting / Datacenter` — no more "Nothing on file" beneath a red `MALICIOUS` banner.

If either card's data has drifted since these were last fetched (TI sources update over time), re-derive the expected numbers from that check's own `SOURCE BREAKDOWN` section at the bottom of the page (AbuseIPDB's own report count and top categories; VirusTotal's own vendor count) rather than assuming the numbers above are still current — the wiring is what is being verified, not that these two specific addresses are still flagged the same way today.

- [ ] **Step 5: Commit**

```bash
git add components/CheckResults/record.tsx
git commit -m "feat(ui): render ORIGIN and PRIORS in the subject record masthead"
```
