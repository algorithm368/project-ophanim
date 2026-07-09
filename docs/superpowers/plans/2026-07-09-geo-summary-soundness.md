# Bulk Geo Summary Soundness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the bulk geolocation same-country callout and copy-friendly summary assert only what the reconciled data supports, and identify the network (ASN, ISP), not just the country.

**Architecture:** A new pure module `lib/ti/geo/summary.ts` turns `GeoRow[]` into one `CountrySummary` structure; the rendered sentence and the copied sentence are both derived from it so they cannot drift apart. Country votes are keyed through a batch-derived name-to-code index (`geokit.ts`), adopted by both `reconcileCountry` and `selectUncertainIps`, so a code-only provider and a name-only provider naming the same country stop tallying as a disagreement.

**Tech Stack:** TypeScript, React 19, Next.js 16 App Router, Vitest, Tailwind, shadcn primitives.

Spec: `docs/superpowers/specs/2026-07-09-geo-summary-soundness-design.md`

## Global Constraints

- **User-facing copy uses commas, never em/en dashes or " - " separators.**
- Tests are Vitest, colocated as `lib/**/*.test.ts`, pure, no network, `@/` alias available.
- `npm test` and `npm run lint` must both pass before any task is considered done.
- Do **not** change `bulkGeolocate` provider coverage. RDAP and freeipapi stay gated by `selectUncertainIps`.
- Do **not** change the meaning of `GeoResolution.providerCount` ("how many providers returned any geo at all"). The new sentence simply stops consuming it.
- Do **not** touch `lib/ti/geo/weights.ts` (weights, authority, thresholds).
- No new runtime dependencies. No ISO 3166 data file.
- `Confidence = "high" | "medium" | "low"` (`lib/ti/types.ts:168`).

---

### Task 1: Country vote-key normalization in geokit

**Files:**
- Modify: `lib/ti/geo/geokit.ts` (append)
- Test: `lib/ti/geo/geokit.test.ts` (append)

**Interfaces:**
- Consumes: `normalizeKey` (already in `geokit.ts`)
- Produces:
  - `countryKeyIndex(entries: Iterable<{ code?: string; name?: string }>): Map<string, string>`
  - `countryVoteKey(geo: { countryCode?: string; country?: string }, index: Map<string, string>): string`

- [ ] **Step 1: Write the failing tests**

Append to `lib/ti/geo/geokit.test.ts`, and add `countryKeyIndex, countryVoteKey` to the existing `./geokit` import at the top of the file:

```ts
describe("countryKeyIndex", () => {
  it("learns name -> code from an entry carrying both", () => {
    const index = countryKeyIndex([{ code: "AU", name: "Australia" }]);
    expect(index.get("australia")).toBe("AU");
  });

  it("seeds the canonical English name for a code-only entry", () => {
    const index = countryKeyIndex([{ code: "US" }]);
    expect(index.get("united states")).toBe("US");
  });

  it("ignores entries with no code", () => {
    const index = countryKeyIndex([{ name: "Atlantis" }]);
    expect(index.size).toBe(0);
  });
});

describe("countryVoteKey", () => {
  it("prefers the provider's own code, uppercased", () => {
    const index = new Map<string, string>();
    expect(countryVoteKey({ countryCode: "us", country: "Anything" }, index)).toBe("US");
  });

  it("maps a name-only vote onto a learned code", () => {
    const index = countryKeyIndex([{ code: "US", name: "United States" }]);
    expect(countryVoteKey({ country: "united  states" }, index)).toBe("US");
  });

  it("keys an unlearnable name on itself, so it stays a separate candidate", () => {
    const index = countryKeyIndex([{ code: "US", name: "United States" }]);
    expect(countryVoteKey({ country: "Atlantis" }, index)).toBe("atlantis");
  });

  it("returns empty string when neither code nor name is present", () => {
    expect(countryVoteKey({}, new Map())).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/ti/geo/geokit.test.ts`
Expected: FAIL, `countryKeyIndex is not a function` / import error for `countryVoteKey`.

- [ ] **Step 3: Implement**

Append to `lib/ti/geo/geokit.ts`:

```ts
/** One provider's country claim, as fed to the vote-key index. */
export interface CountryVote {
  code?: string;
  name?: string;
}

let regionNames: Intl.DisplayNames | undefined;

/** Canonical English name for an ISO alpha-2 code, or undefined when the
 *  runtime cannot name it (unsupported locale, invalid code). */
function canonicalCountryName(code: string): string | undefined {
  try {
    regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
    const name = regionNames.of(code);
    return name && name !== code ? name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Learn a normalized-name -> ISO-code map from the batch itself, so a code-only
 * provider (RDAP: "US") and a name-only provider ("United States") tally as one
 * country instead of registering a false disagreement. Two sources of truth:
 * inputs that carry both fields, then the canonical English name of every code
 * observed. No ISO table is bundled.
 */
export function countryKeyIndex(
  entries: Iterable<CountryVote>,
): Map<string, string> {
  const index = new Map<string, string>();
  const codes = new Set<string>();
  for (const entry of entries) {
    const code = entry.code?.trim().toUpperCase();
    if (!code) continue;
    codes.add(code);
    const name = normalizeKey(entry.name);
    if (name && !index.has(name)) index.set(name, code);
  }
  for (const code of codes) {
    const canonical = normalizeKey(canonicalCountryName(code));
    if (canonical && !index.has(canonical)) index.set(canonical, code);
  }
  return index;
}

/** Vote key for one provider's country: its own code, else a code learned from
 *  the batch, else its normalized name (which keeps it a separate candidate,
 *  because nothing in the data proves it is the same country). "" when silent. */
export function countryVoteKey(
  geo: { countryCode?: string; country?: string },
  index: Map<string, string>,
): string {
  const code = geo.countryCode?.trim().toUpperCase();
  if (code) return code;
  const name = normalizeKey(geo.country);
  if (!name) return "";
  return index.get(name) ?? name;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/ti/geo/geokit.test.ts`
Expected: PASS, all `countryKeyIndex` and `countryVoteKey` cases green.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/geo/geokit.ts lib/ti/geo/geokit.test.ts
git commit -m "feat(geo): derive country vote keys from the batch"
```

---

### Task 2: Adopt the vote key in reconcileCountry

**Files:**
- Modify: `lib/ti/geo/reconcile.ts` (the `reconcileCountry` function, and the `./geokit` import)
- Test: `lib/ti/geo/reconcile.test.ts` (append)

**Interfaces:**
- Consumes: `countryKeyIndex`, `countryVoteKey` from Task 1.
- Produces: no signature change. `reconcileGeoInputs(inputs: GeoInput[]): GeoResolution | undefined` behaves as before, minus the false disagreement.

- [ ] **Step 1: Write the failing test**

Append to `lib/ti/geo/reconcile.test.ts` (it already imports `reconcileGeoInputs` from `./reconcile`):

```ts
describe("reconcileCountry vote keys", () => {
  it("tallies a code-only and a name-only vote for one country as a single vote", () => {
    const res = reconcileGeoInputs([
      { id: "rdap-ip", geo: { countryCode: "US" } },
      { id: "freeipapi", geo: { country: "United States" } },
    ]);
    expect(res?.countryCode).toBe("US");
    expect(res?.country?.value).toBe("United States");
    expect(res?.country?.sources).toEqual(["rdap-ip", "freeipapi"]);
    expect(res?.country?.alternatives).toBeUndefined();
    expect(res?.country?.confidence).toBe("high");
  });

  it("keeps genuinely different countries as separate candidates", () => {
    const res = reconcileGeoInputs([
      { id: "rdap-ip", geo: { countryCode: "US" } },
      { id: "freeipapi", geo: { country: "Australia" } },
    ]);
    expect(res?.country?.alternatives).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ti/geo/reconcile.test.ts -t "single vote"`
Expected: FAIL. `country.sources` is `["rdap-ip"]` and `alternatives` has one entry, because `"US"` and `"united states"` keyed separately.

- [ ] **Step 3: Implement**

In `lib/ti/geo/reconcile.ts`, extend the existing geokit import:

```ts
import {
  canonicalAsn,
  countryKeyIndex,
  countryVoteKey,
  haversineKm,
  normalizeKey,
} from "./geokit";
```

Inside `reconcileCountry`, build the index before the tally loop and key each vote through it. Replace the loop header and the `key` line:

```ts
  const index = countryKeyIndex(
    inputs.map(({ geo }) => ({ code: geo.countryCode, name: geo.country })),
  );

  for (const { id, geo } of inputs) {
    const code = geo.countryCode?.trim().toUpperCase() ?? "";
    const name = geo.country?.trim() ?? "";
    const key = countryVoteKey(geo, index);
    if (!key) continue;
    const w = getWeight(id, "country");
    reporting++;
    reportingWeight += w;
    const existing = votes.get(key);
```

Delete the now-dead `if (!code && !name) continue;` line and the old `const key = code || normalizeKey(name);` line. The rest of the loop body, which back-fills `existing.name` and `existing.code`, is unchanged and is what lets the merged vote resolve to `value: "United States"`, `code: "US"`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/ti/geo/reconcile.test.ts`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/geo/reconcile.ts lib/ti/geo/reconcile.test.ts
git commit -m "fix(geo): merge code-only and name-only country votes"
```

---

### Task 3: Adopt the vote key in selectUncertainIps

**Files:**
- Modify: `lib/ti/geo/bulk.ts` (delete local `countryKey`, rework `selectUncertainIps`, fix imports)
- Test: `lib/ti/geo/bulk.test.ts` (append)

**Interfaces:**
- Consumes: `countryKeyIndex`, `countryVoteKey` from Task 1.
- Produces: no signature change. `selectUncertainIps(perIp: Map<string, GeoInput[]>, max: number): string[]`.

- [ ] **Step 1: Write the failing test**

Append to `lib/ti/geo/bulk.test.ts`, inside the existing `describe("selectUncertainIps", ...)` block:

```ts
  it("does not flag a code-only and name-only vote for the same country", () => {
    const perIp = new Map([
      [
        "a",
        [
          { id: "rdap-ip", geo: { countryCode: "US" } },
          { id: "freeipapi", geo: { country: "United States" } },
        ],
      ],
    ]);
    expect(selectUncertainIps(perIp, Infinity)).not.toContain("a");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ti/geo/bulk.test.ts -t "code-only and name-only"`
Expected: FAIL. `"a"` is flagged, because `codes` holds both `"US"` and `"united states"` so `codes.size > 1` reads as a disagreement.

- [ ] **Step 3: Implement**

In `lib/ti/geo/bulk.ts`, replace the `normalizeKey` import with the vote-key helpers:

```ts
import { countryKeyIndex, countryVoteKey } from "./geokit";
```

Delete the local `countryKey` function entirely (the one documented as *"Normalized country key for an input: ISO code preferred, else country name"*), and rewrite `selectUncertainIps`'s per-IP loop to key through a per-IP index:

```ts
export function selectUncertainIps(
  perIp: Map<string, GeoInput[]>,
  max: number,
): string[] {
  const disagree: string[] = [];
  const single: string[] = [];
  for (const [ip, inputs] of perIp) {
    let reporting = 0;
    const codes = new Set<string>();
    const index = countryKeyIndex(
      inputs.map(({ geo }) => ({ code: geo.countryCode, name: geo.country })),
    );
    for (const inp of inputs) {
      const key = countryVoteKey(inp.geo, index);
      if (key) {
        reporting++;
        codes.add(key);
      }
    }
    if (codes.size > 1) disagree.push(ip);
    else if (reporting < 2) single.push(ip);
  }
  return [...disagree, ...single].slice(0, Math.max(0, max));
}
```

Verify `normalizeKey` has no other use in `bulk.ts` before removing it from the import. Run: `grep -n "normalizeKey" lib/ti/geo/bulk.ts` and expect no hits after the edit.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/ti/geo/bulk.test.ts`
Expected: PASS, including the pre-existing "flags disagreements and single-voter IPs" test.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/geo/bulk.ts lib/ti/geo/bulk.test.ts
git commit -m "fix(geo): stop flagging name/code country votes as disagreement"
```

---

### Task 4: The CountrySummary structure

**Files:**
- Create: `lib/ti/geo/summary.ts`
- Test: `lib/ti/geo/summary.test.ts`

**Interfaces:**
- Consumes: `GeoRow` (type-only, from `lib/ti/geo.ts`), `Confidence` (from `lib/ti/types.ts`).
- Produces:
  - `countryCodeOf(row: GeoRow): string | undefined`
  - `providerLabel(id: string): string`
  - `interface CountrySummary { country: string; code: string; ips: string[]; located: number; total: number; confidence: Confidence; agreedBy: string[]; contested: number }`
  - `summarizeCountries(rows: GeoRow[]): CountrySummary | null`

**Note on imports:** `lib/ti/geo.ts` does not import `summary.ts`, so importing `GeoRow` from `"../geo"` creates no cycle. It is a type-only import regardless.

- [ ] **Step 1: Write the failing tests**

Create `lib/ti/geo/summary.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { GeoRow } from "../geo";
import { countryCodeOf, summarizeCountries } from "./summary";

/** A located row whose country resolved with the given sources/confidence. */
function row(
  ip: string,
  code: string,
  confidence: "high" | "medium" | "low",
  sources: string[],
  alternatives?: { value: string; sources: string[] }[],
): GeoRow {
  return {
    ip,
    version: 4,
    status: "ok",
    geo: { country: "United States", countryCode: code },
    resolution: {
      country: {
        value: "United States",
        confidence,
        score: 1,
        agreement: 1,
        sources,
        ...(alternatives ? { alternatives } : {}),
      },
      countryCode: code,
      flags: { isHosting: false, isProxy: false, isMobile: false, sources: {} },
      providerCount: sources.length,
    },
  };
}

describe("countryCodeOf", () => {
  it("uses the reconciled code", () => {
    expect(countryCodeOf(row("1.1.1.1", "US", "high", ["ip-api"]))).toBe("US");
  });

  it("returns undefined when a resolution won on name only, ignoring the stale base code", () => {
    const r: GeoRow = {
      ip: "1.1.1.1",
      version: 4,
      status: "ok",
      geo: { country: "United States", countryCode: "AU" },
      resolution: {
        country: { value: "United States", confidence: "low", score: 0.4, agreement: 1, sources: ["freeipapi"] },
        flags: { isHosting: false, isProxy: false, isMobile: false, sources: {} },
        providerCount: 1,
      },
    };
    expect(countryCodeOf(r)).toBeUndefined();
  });

  it("falls back to the raw code when nothing reconciled", () => {
    const r: GeoRow = { ip: "1.1.1.1", version: 4, status: "ok", geo: { countryCode: "us" } };
    expect(countryCodeOf(r)).toBe("US");
  });

  it("returns undefined for an error row", () => {
    const r: GeoRow = { ip: "1.1.1.1", version: 4, status: "error", error: "Lookup failed" };
    expect(countryCodeOf(r)).toBeUndefined();
  });
});

describe("summarizeCountries", () => {
  it("returns null below two located rows", () => {
    expect(summarizeCountries([row("1.1.1.1", "US", "high", ["ip-api"])])).toBeNull();
  });

  it("returns null when located rows disagree on country", () => {
    const rows = [row("1.1.1.1", "US", "high", ["ip-api"]), row("8.8.8.8", "AU", "high", ["ip-api"])];
    expect(summarizeCountries(rows)).toBeNull();
  });

  it("takes the weakest located confidence, not the first or the average", () => {
    const rows = [row("1.1.1.1", "US", "high", ["ip-api"]), row("8.8.8.8", "US", "low", ["ip-api"])];
    expect(summarizeCountries(rows)?.confidence).toBe("low");
  });

  it("intersects agreeing providers across rows and labels them", () => {
    const rows = [
      row("1.1.1.1", "US", "high", ["ip-api", "ipinfo"]),
      row("8.8.8.8", "US", "high", ["ip-api", "rdap-ip"]),
    ];
    expect(summarizeCountries(rows)?.agreedBy).toEqual(["ip-api.com"]);
  });

  it("yields an empty intersection when no provider backed every row", () => {
    const rows = [row("1.1.1.1", "US", "high", ["ipinfo"]), row("8.8.8.8", "US", "high", ["rdap-ip"])];
    expect(summarizeCountries(rows)?.agreedBy).toEqual([]);
  });

  it("counts contested rows and reports coverage against the full batch", () => {
    const rows: GeoRow[] = [
      row("1.1.1.1", "US", "high", ["ip-api"]),
      row("8.8.8.8", "US", "medium", ["ip-api"], [{ value: "Australia", sources: ["ipinfo"] }]),
      { ip: "203.0.113.7", version: 4, status: "error", error: "Lookup failed" },
    ];
    const s = summarizeCountries(rows);
    expect(s?.contested).toBe(1);
    expect(s?.located).toBe(2);
    expect(s?.total).toBe(3);
    expect(s?.ips).toEqual(["1.1.1.1", "8.8.8.8"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/ti/geo/summary.test.ts`
Expected: FAIL, cannot resolve module `./summary`.

- [ ] **Step 3: Implement**

Create `lib/ti/geo/summary.ts`:

```ts
/**
 * Pure summaries of a bulk geolocation batch, rendered by
 * `components/BulkGeoResults.tsx` and copied verbatim by its Copy buttons.
 *
 * Sibling of `lib/ti/narrative.ts`, and it inherits that file's rule: keep them
 * honest, the summary must never describe something the data doesn't support.
 * Every claim here is traceable to a reconciled field.
 */
import type { Confidence } from "../types";
import type { GeoRow } from "../geo";

/** Provider ids as users should read them. Unlisted ids pass through, so a new
 *  provider degrades to a readable id rather than vanishing from attribution. */
const PROVIDER_LABEL: Record<string, string> = {
  "ip-api": "ip-api.com",
  ipinfo: "IPinfo",
  "rdap-ip": "RDAP",
  freeipapi: "freeipapi",
  ripestat: "RIPEstat",
  ipgeolocation: "ipgeolocation.io",
  ipwhois: "ipwhois.io",
};

export function providerLabel(id: string): string {
  return PROVIDER_LABEL[id] ?? id;
}

const RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

/**
 * Country code for a row, or undefined when nothing trustworthy is known.
 *
 * When a resolution exists but produced no code, the winning vote was name-only
 * and `overlayResolution` left the *base* provider's code in `geo.countryCode`.
 * That code can name a country the vote rejected, so we refuse it rather than
 * pair a reconciled name with a losing code.
 */
export function countryCodeOf(row: GeoRow): string | undefined {
  if (row.status !== "ok") return undefined;
  if (row.resolution) return row.resolution.countryCode?.toUpperCase();
  return row.geo?.countryCode?.toUpperCase();
}

export interface CountrySummary {
  country: string;
  code: string;
  ips: string[];
  located: number;
  total: number;
  /** weakest located row, so the batch is never claimed stronger than its floor. */
  confidence: Confidence;
  /** display names of providers that backed the winner on *every* located row. */
  agreedBy: string[];
  /** located rows whose country vote carried dissenting alternatives. */
  contested: number;
}

/** Null unless at least two rows located to one shared country. */
export function summarizeCountries(rows: GeoRow[]): CountrySummary | null {
  const located = rows.filter((r) => countryCodeOf(r) !== undefined);
  if (located.length < 2) return null;
  const code = countryCodeOf(located[0]) as string;
  if (!located.every((r) => countryCodeOf(r) === code)) return null;

  let confidence: Confidence = "high";
  let contested = 0;
  let agreed: string[] | null = null;

  for (const r of located) {
    const country = r.resolution?.country;
    const rowConfidence = country?.confidence ?? "low";
    if (RANK[rowConfidence] < RANK[confidence]) confidence = rowConfidence;
    if (country?.alternatives?.length) contested++;
    const sources = country?.sources ?? [];
    agreed =
      agreed === null ? [...sources] : agreed.filter((id) => sources.includes(id));
  }

  const first = located[0];
  return {
    country: first.resolution?.country?.value ?? first.geo?.country ?? code,
    code,
    ips: located.map((r) => r.ip),
    located: located.length,
    total: rows.length,
    confidence,
    agreedBy: (agreed ?? []).map(providerLabel),
    contested,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/ti/geo/summary.test.ts`
Expected: PASS, all 10 cases.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/geo/summary.ts lib/ti/geo/summary.test.ts
git commit -m "feat(geo): add pure CountrySummary for bulk results"
```

---

### Task 5: The same-country sentence

**Files:**
- Modify: `lib/ti/geo/summary.ts` (append)
- Test: `lib/ti/geo/summary.test.ts` (append)

**Interfaces:**
- Consumes: `CountrySummary` from Task 4.
- Produces:
  - `interface SameCountryText { lead: string; place: string; tail: string }`
  - `sameCountryText(s: CountrySummary): SameCountryText`
  - `sameCountrySentence(s: CountrySummary): string`

`sameCountrySentence` is exactly `` `${lead} ${place}${tail}` ``. The component renders `lead`, then `place` bolded, then a `ConfidenceChip`, then `tail`. Deriving both from one function is what guarantees the copied text and the rendered text assert the same thing.

- [ ] **Step 1: Write the failing tests**

Append to `lib/ti/geo/summary.test.ts`, extending the import to `{ countryCodeOf, sameCountrySentence, sameCountryText, summarizeCountries }`:

```ts
/** Build a summary directly, so sentence tests don't depend on row plumbing. */
function summary(over: Partial<CountrySummary> = {}): CountrySummary {
  return {
    country: "United States",
    code: "US",
    ips: ["1.1.1.1", "8.8.8.8"],
    located: 2,
    total: 2,
    confidence: "high",
    agreedBy: ["ip-api.com", "IPinfo"],
    contested: 0,
    ...over,
  };
}

describe("sameCountrySentence", () => {
  it("states coverage, the country, and multi-provider agreement", () => {
    expect(sameCountrySentence(summary())).toBe(
      "2 of 2 addresses resolved to a country. All 2 are located in the same country, " +
        "United States (US), agreed by ip-api.com and IPinfo on all 2 addresses.",
    );
  });

  it("hedges the verb below high confidence", () => {
    expect(sameCountrySentence(summary({ confidence: "medium" }))).toContain(
      "All 2 are likely located in the same country",
    );
  });

  it("says reported, not agreed, for a lone provider", () => {
    const s = summary({ agreedBy: ["ip-api.com"] });
    expect(sameCountrySentence(s)).toContain("as reported by ip-api.com on all 2 addresses.");
    expect(sameCountrySentence(s)).not.toContain("agreed by");
  });

  it("names no provider when none backed every address", () => {
    expect(sameCountrySentence(summary({ agreedBy: [] }))).toContain(
      "backed by different providers per address.",
    );
  });

  it("appends the disagreement clause, pluralized", () => {
    expect(sameCountrySentence(summary({ contested: 1 }))).toContain(
      ", providers disagreed on 1 address.",
    );
    expect(sameCountrySentence(summary({ contested: 2 }))).toContain(
      ", providers disagreed on 2 addresses.",
    );
  });

  it("reports partial coverage against the full batch", () => {
    expect(sameCountrySentence(summary({ located: 2, total: 6 }))).toContain(
      "2 of 6 addresses resolved to a country.",
    );
  });

  it("joins three or more providers with commas and a trailing and", () => {
    const s = summary({ agreedBy: ["ip-api.com", "IPinfo", "RDAP"] });
    expect(sameCountrySentence(s)).toContain("agreed by ip-api.com, IPinfo and RDAP");
  });

  it("concatenates back to the rendered parts exactly", () => {
    const s = summary({ contested: 1 });
    const t = sameCountryText(s);
    expect(`${t.lead} ${t.place}${t.tail}`).toBe(sameCountrySentence(s));
    expect(t.place).toBe("United States (US)");
  });
});
```

Add `CountrySummary` to the type import at the top of the test file:

```ts
import type { CountrySummary } from "./summary";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/ti/geo/summary.test.ts -t "sameCountrySentence"`
Expected: FAIL, `sameCountrySentence is not a function`.

- [ ] **Step 3: Implement**

Append to `lib/ti/geo/summary.ts`:

```ts
/** Join with commas and a trailing "and": `a, b and c` (or `a and b`). */
function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** How the winning country was backed, phrased so a lone provider never "agrees". */
function attribution(s: CountrySummary): string {
  if (s.agreedBy.length === 0) return "backed by different providers per address";
  const verb = s.agreedBy.length >= 2 ? "agreed by" : "as reported by";
  return `${verb} ${joinAnd(s.agreedBy)} on all ${s.located} addresses`;
}

/** The sentence split at the point where the rendered version inserts a chip. */
export interface SameCountryText {
  lead: string;
  place: string;
  tail: string;
}

export function sameCountryText(s: CountrySummary): SameCountryText {
  const verb = s.confidence === "high" ? "are located in" : "are likely located in";
  const contested =
    s.contested > 0
      ? `, providers disagreed on ${s.contested} ${s.contested === 1 ? "address" : "addresses"}`
      : "";
  return {
    lead:
      `${s.located} of ${s.total} addresses resolved to a country. ` +
      `All ${s.located} ${verb} the same country,`,
    place: `${s.country} (${s.code})`,
    tail: `, ${attribution(s)}${contested}.`,
  };
}

/** Plain-text form, used by the Copy button. Identical wording to the render. */
export function sameCountrySentence(s: CountrySummary): string {
  const { lead, place, tail } = sameCountryText(s);
  return `${lead} ${place}${tail}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/ti/geo/summary.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/geo/summary.ts lib/ti/geo/summary.test.ts
git commit -m "feat(geo): honest same-country sentence with coverage and attribution"
```

---

### Task 6: The copy block

**Files:**
- Modify: `lib/ti/geo/summary.ts` (append)
- Test: `lib/ti/geo/summary.test.ts` (append)

**Interfaces:**
- Consumes: `countryCodeOf` from Task 4.
- Produces: `copyBlock(rows: GeoRow[]): string`

Column order is IP, country, ASN, ISP. A `?` **suffix** means the value resolved but not at `high` confidence. A **bare** `?` means no data. Nothing is ever truncated: clipping `Cloudflare, Inc.` would name a different organization than the data holds.

- [ ] **Step 1: Write the failing tests**

Append to `lib/ti/geo/summary.test.ts`, adding `copyBlock` to the `./summary` import:

```ts
/** A row with independent per-field confidences. */
function netRow(
  ip: string,
  opts: {
    country?: [string, Confidence];
    asn?: [string, Confidence];
    isp?: [string, Confidence];
    asnOrg?: [string, Confidence];
  },
): GeoRow {
  const field = (v?: [string, Confidence]) =>
    v ? { value: v[0], confidence: v[1], score: 1, agreement: 1, sources: ["ip-api"] } : undefined;
  return {
    ip,
    version: 4,
    status: "ok",
    geo: {},
    resolution: {
      country: field(opts.country),
      countryCode: opts.country?.[0],
      asn: field(opts.asn),
      asnOrg: field(opts.asnOrg),
      isp: field(opts.isp),
      flags: { isHosting: false, isProxy: false, isMobile: false, sources: {} },
      providerCount: 2,
    },
  };
}

describe("copyBlock", () => {
  it("aligns columns to the widest value and clips nothing", () => {
    const block = copyBlock([
      netRow("1.1.1.1", { country: ["US", "high"], asn: ["AS13335", "high"], isp: ["Cloudflare, Inc.", "high"] }),
      netRow("203.0.113.254", { country: ["US", "high"], asn: ["AS15169", "high"], isp: ["Google LLC", "high"] }),
    ]);
    expect(block).toBe(
      "1.1.1.1        US  AS13335  Cloudflare, Inc.\n" +
        "203.0.113.254  US  AS15169  Google LLC",
    );
  });

  it("omits the legend when every field is high confidence", () => {
    const block = copyBlock([netRow("1.1.1.1", { country: ["US", "high"], asn: ["AS13335", "high"], isp: ["Cloudflare, Inc.", "high"] })]);
    expect(block).not.toContain("no data");
    expect(block).not.toContain("contested");
  });

  it("suffixes fields below high confidence, per field", () => {
    const block = copyBlock([netRow("9.9.9.9", { country: ["US", "high"], asn: ["AS19281", "medium"], isp: ["Quad9", "high"] })]);
    expect(block).toContain("9.9.9.9  US  AS19281?  Quad9");
    expect(block).toContain("AS19281?  contested or single provider");
  });

  it("prints a bare ? and its legend for an error row", () => {
    const rows: GeoRow[] = [
      netRow("1.1.1.1", { country: ["US", "high"], asn: ["AS13335", "high"], isp: ["Cloudflare, Inc.", "high"] }),
      { ip: "203.0.113.7", version: 4, status: "error", error: "Lookup failed" },
    ];
    const block = copyBlock(rows);
    expect(block).toContain("203.0.113.7  ?   ?        ?");
    expect(block).toContain("?    no data");
  });

  it("walks the ISP ladder: isp, then asnOrg, then a bare ?", () => {
    expect(copyBlock([netRow("1.1.1.1", { asnOrg: ["Cloudflare", "high"] })])).toContain("Cloudflare");
    expect(copyBlock([netRow("1.1.1.1", {})])).toContain("1.1.1.1  ?  ?  ?");
  });

  it("never promotes the unreconciled org field into the confidence-marked column", () => {
    const r: GeoRow = {
      ip: "1.1.1.1",
      version: 4,
      status: "ok",
      geo: { org: "Some Org" },
      resolution: {
        flags: { isHosting: false, isProxy: false, isMobile: false, sources: {} },
        providerCount: 1,
      },
    };
    expect(copyBlock([r])).not.toContain("Some Org");
  });

  it("suffixes raw geo values when nothing reconciled at all", () => {
    const r: GeoRow = {
      ip: "1.1.1.1",
      version: 4,
      status: "ok",
      geo: { countryCode: "US", asn: "AS13335", org: "Cloudflare" },
    };
    expect(copyBlock([r])).toContain("1.1.1.1  US?  AS13335?  Cloudflare?");
  });
});
```

Add `Confidence` to the test file's type imports:

```ts
import type { Confidence } from "../types";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/ti/geo/summary.test.ts -t "copyBlock"`
Expected: FAIL, `copyBlock is not a function`.

- [ ] **Step 3: Implement**

Append to `lib/ti/geo/summary.ts`:

```ts
import type { ResolvedField } from "../types";

/** A resolved value, suffixed with "?" unless providers agreed on it. */
function marked(field: ResolvedField<string>): string {
  return field.confidence === "high" ? field.value : `${field.value}?`;
}

function countryCell(row: GeoRow): string {
  const code = countryCodeOf(row);
  if (!code) return "?";
  const field = row.resolution?.country;
  if (!field) return `${code}?`;
  return field.confidence === "high" ? code : `${code}?`;
}

function asnCell(row: GeoRow): string {
  const res = row.resolution;
  if (res) return res.asn ? marked(res.asn) : "?";
  const raw = row.geo?.asn;
  return raw ? `${raw}?` : "?";
}

/** isp, then asnOrg, then a bare ?. `geo.org` never enters this column: it is a
 *  raw provider field that never went through reconciliation, and this column's
 *  legend promises confidence marking. */
function ispCell(row: GeoRow): string {
  const res = row.resolution;
  if (res) {
    if (res.isp) return marked(res.isp);
    if (res.asnOrg) return marked(res.asnOrg);
    return "?";
  }
  const raw = row.geo?.isp ?? row.geo?.org;
  return raw ? `${raw}?` : "?";
}

/**
 * Aligned monospace columns: IP, country, ASN, ISP. Columns rather than a
 * comma-separated line because ISP names contain commas ("Cloudflare, Inc.").
 * Widths size to content, so nothing is ever clipped into a different name.
 */
export function copyBlock(rows: GeoRow[]): string {
  if (rows.length === 0) return "";
  const cells = rows.map((r) => [r.ip, countryCell(r), asnCell(r), ispCell(r)]);
  const widths = [0, 1, 2].map((col) =>
    Math.max(...cells.map((row) => row[col].length)),
  );
  const lines = cells.map((row) =>
    `${row[0].padEnd(widths[0])}  ${row[1].padEnd(widths[1])}  ${row[2].padEnd(widths[2])}  ${row[3]}`.trimEnd(),
  );

  const suffixed = cells.flat().find((c) => c.length > 1 && c.endsWith("?"));
  const hasBare = cells.flat().some((c) => c === "?");
  const legend: string[] = [];
  if (suffixed) legend.push(`${suffixed}  contested or single provider`);
  if (hasBare) legend.push("?    no data");

  return legend.length ? `${lines.join("\n")}\n\n${legend.join("\n")}` : lines.join("\n");
}
```

Merge the new `ResolvedField` import into the existing `import type { Confidence } from "../types";` line rather than adding a second import statement.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/ti/geo/summary.test.ts`
Expected: PASS. If an alignment assertion fails, print the actual block with `console.log(JSON.stringify(block))` and fix the expected string, not the padding rule, unless the padding is genuinely wrong.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/geo/summary.ts lib/ti/geo/summary.test.ts
git commit -m "feat(geo): copy block with ASN, ISP, and per-field confidence markers"
```

---

### Task 7: Wire the component

**Files:**
- Modify: `components/BulkGeoResults.tsx`

**Interfaces:**
- Consumes: `summarizeCountries`, `sameCountryText`, `sameCountrySentence`, `copyBlock` from Tasks 4 to 6.
- Produces: no exported change. `BulkGeoResults({ rows }: { rows: GeoRow[] })`.

All summary assembly leaves the component. `codeOf`, `copyLineOf`, `joinIps`, `RANK`, and `sameCountryOf` are deleted.

- [ ] **Step 1: Delete the inline logic**

Remove from `components/BulkGeoResults.tsx`: `codeOf`, `copyLineOf`, `joinIps`, `RANK`, and `sameCountryOf` (lines 12 to 60). Replace the `Confidence` type import with:

```ts
import {
  copyBlock,
  sameCountrySentence,
  sameCountryText,
  summarizeCountries,
} from "@/lib/ti/geo/summary";
```

- [ ] **Step 2: Rewrite CopyableList**

The box now shows exactly the text the button copies:

```tsx
/** A selectable, monospace block of the per-address summary with a copy button. */
function CopyableList({ rows }: { rows: GeoRow[] }) {
  const block = copyBlock(rows);
  const [copied, copy] = useCopied();
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-hand text-sm font-semibold text-muted-foreground">
          Copy-friendly summary
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-label="Copy summary"
          className="font-hand -mr-1.5 gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          onClick={() => copy(block)}
        >
          {copied ? (
            <>
              <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
              Copied
            </>
          ) : (
            <>
              <Copy className="size-3.5" />
              Copy
            </>
          )}
        </Button>
      </div>
      <pre className="max-h-48 overflow-auto rounded-md border-2 border-foreground/20 bg-background/60 px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre select-all">
        {block}
      </pre>
    </div>
  );
}
```

Note the two deliberate class changes: `whitespace-pre` replaces `break-all whitespace-pre-wrap` (wrapping would destroy the column alignment), and `max-h-48` replaces `max-h-32` since the block is now one line per address.

- [ ] **Step 3: Rewrite SameCountryCallout**

```tsx
/** Callout shown when every located IP resolves to one country. The copied
 *  sentence and the rendered sentence are the same words, from one source. */
function SameCountryCallout({ rows }: { rows: GeoRow[] }) {
  const summary = summarizeCountries(rows);
  const [copied, copy] = useCopied();
  if (!summary) return null;
  const { lead, place, tail } = sameCountryText(summary);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-hand text-sm font-semibold text-muted-foreground">
          Same-country summary
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-label="Copy same-country summary"
          className="font-hand -mr-1.5 gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          onClick={() => copy(sameCountrySentence(summary))}
        >
          {copied ? (
            <>
              <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
              Copied
            </>
          ) : (
            <>
              <Copy className="size-3.5" />
              Copy
            </>
          )}
        </Button>
      </div>
      <div className="rounded-md border-2 border-emerald-500/40 bg-emerald-500/10 px-3.5 py-3 select-all">
        <p className="font-sans text-sm leading-relaxed text-foreground/90">
          {lead} <span className="font-semibold">{place}</span>
          <ConfidenceChip confidence={summary.confidence} />
          {tail}
        </p>
      </div>
    </div>
  );
}
```

The table body below is untouched, except that its country cell keeps using `row.resolution?.countryCode ?? g?.countryCode` for the flag. Leave it: the flag is decorative and absent for an unknown code.

- [ ] **Step 4: Verify the whole suite and the linter**

Run: `npm test`
Expected: PASS, all files.

Run: `npm run lint`
Expected: no errors. If `Confidence` or `GeoRow` is now an unused import in `BulkGeoResults.tsx`, remove it.

- [ ] **Step 5: Verify in the browser**

Tests do not prove column alignment or chip placement. Start the app (the user already runs `next dev` on :3000; do not kill it, reuse it) and paste a batch mixing one clean address, one contested address, and one unlocatable address, for example `1.1.1.1`, `8.8.8.8`, `203.0.113.7`. Confirm:

- the copy block's columns line up and no org name is clipped,
- the legend lists only the markers actually present,
- the same-country sentence states coverage, and its chip sits after the country,
- clicking each Copy button yields text identical to what is displayed.

Take a screenshot with `node scripts/shot.mjs` for the record. If the UI cannot be verified, say so explicitly rather than claiming it works.

- [ ] **Step 6: Commit**

```bash
git add components/BulkGeoResults.tsx
git commit -m "feat(ui): render bulk geo summaries from the pure summary module"
```

---

## Self-Review

**Spec coverage.** Defects 1 and 2 are retired by Tasks 4 and 5 (the sentence stops consuming `providerCount`; attribution comes from the `agreedBy` intersection and confidence from the weakest row). Defect 3 is Task 5's `attribution`. Defect 4 is `contested`, Tasks 4 and 5. Defect 5 is the mandatory coverage clause, Task 5. Defect 6 is `countryCodeOf`, Task 4. Defect 7 is the ASN and ISP columns, Task 6. Defect 8 is Tasks 1 to 3. The spec's error-handling section maps to `summarizeCountries` returning `null`, `countryCodeOf` returning `undefined`, and the `try/catch` around `Intl.DisplayNames`. Non-goals are restated as Global Constraints.

**Type consistency.** `CountrySummary` field names are identical in Tasks 4, 5, 6 and 7. `sameCountryText` returns `{ lead, place, tail }` in Task 5 and is destructured with those names in Task 7. `copyBlock(rows: GeoRow[]): string` in Task 6 is called with `rows` in Task 7. `providerLabel` is exported in Task 4 and consumed only inside Task 4's `summarizeCountries`.
