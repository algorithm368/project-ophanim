# Geolocation Confidence Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make geolocation confidence trustworthy by weighting providers per field, scoring each reconciled field numerically, clustering nearby cities, grading coordinates, adding a free `freeipapi.com` voter (single-IP + capped bulk fan-out), and surfacing an overall geo-confidence badge.

**Architecture:** All reconciliation stays in the existing pure core (`lib/ti/geo/reconcile.ts`), so single-IP and bulk both inherit the smarter algorithm; only coverage differs per path. A new `lib/ti/geo/weights.ts` holds a hand-tuned per-field reliability matrix + authority map + tunable thresholds. Display reads a new `GeoResolution.overall`. Risk scoring/verdict are untouched (geo sources stay `weight: 0`).

**Tech Stack:** TypeScript, Next.js 16 App Router, React 19, Vitest (unit, no network), the project's `lib/ti/http.ts` fetch helpers.

**Spec:** `docs/superpowers/specs/2026-06-13-geolocation-confidence-design.md`

---

### Task 1: Reliability weight matrix

**Files:**
- Create: `lib/ti/geo/weights.ts`
- Test: `lib/ti/geo/weights.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/ti/geo/weights.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { authorityFor, getWeight } from "./weights";

describe("getWeight", () => {
  it("returns the per-field weight for a known provider", () => {
    expect(getWeight("rdap-ip", "country")).toBe(1.0);
    expect(getWeight("ripestat", "asn")).toBe(1.0);
    expect(getWeight("reverse-dns", "city")).toBe(0.2);
  });

  it("falls back to the default weight for unknown providers or fields", () => {
    expect(getWeight("nope", "city")).toBe(0.5);
    expect(getWeight("rdap-ip", "city")).toBe(0.5); // rdap has no city entry
  });
});

describe("authorityFor", () => {
  it("names the allocation-authoritative provider per field", () => {
    expect(authorityFor("country")).toBe("rdap-ip");
    expect(authorityFor("asn")).toBe("ripestat");
    expect(authorityFor("city")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ti/geo/weights.test.ts`
Expected: FAIL with "Failed to resolve import './weights'".

- [ ] **Step 3: Write the implementation**

Create `lib/ti/geo/weights.ts`:

```ts
export type GeoField = "country" | "region" | "city" | "coords" | "asn" | "isp";

/** Per-field reliability, 0-1. Unlisted providers/fields use DEFAULT_WEIGHT. */
const PROVIDER_WEIGHTS: Record<string, Partial<Record<GeoField, number>>> = {
  "rdap-ip": { country: 1.0, asn: 0.7 },
  ripestat: { country: 0.8, asn: 1.0, isp: 0.3 },
  "ip-api": { country: 0.85, region: 0.85, city: 0.85, coords: 0.85, asn: 0.8, isp: 0.85 },
  ipinfo: { country: 0.85, region: 0.8, city: 0.85, coords: 0.85, asn: 0.85, isp: 0.8 },
  ipgeolocation: { country: 0.8, region: 0.8, city: 0.8, coords: 0.8, asn: 0.75, isp: 0.8 },
  ipwhois: { country: 0.7, region: 0.7, city: 0.7, coords: 0.7, asn: 0.7, isp: 0.7 },
  freeipapi: { country: 0.65, region: 0.65, city: 0.7, coords: 0.65, asn: 0.65, isp: 0.5 },
  abuseipdb: { country: 0.6, isp: 0.5 },
  "reverse-dns": { country: 0.3, region: 0.2, city: 0.2 },
};

const DEFAULT_WEIGHT = 0.5;

export function getWeight(id: string, field: GeoField): number {
  return PROVIDER_WEIGHTS[id]?.[field] ?? DEFAULT_WEIGHT;
}

/** Provider that is allocation-authoritative for a field (forces high when it
 *  backs the winning value). Subsumes the old COUNTRY_AUTHORITY constant. */
const AUTHORITY: Partial<Record<GeoField, string>> = {
  country: "rdap-ip",
  asn: "ripestat",
};

export function authorityFor(field: GeoField): string | undefined {
  return AUTHORITY[field];
}

// Tunables (exported so tests pin them).
export const CORROBORATION_TARGET = 1.5; // summed weight that counts as fully corroborated
export const HIGH_SCORE = 0.66;
export const MEDIUM_SCORE = 0.45;
export const CITY_CLUSTER_KM = 25; // merge same-area cities into one candidate
export const COORD_HIGH_KM = 25; // multi-point spread bands
export const COORD_MEDIUM_KM = 75;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ti/geo/weights.test.ts`
Expected: PASS (5 assertions across 3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ti/geo/weights.ts lib/ti/geo/weights.test.ts
git commit -m "feat(geo): per-field provider reliability weight matrix"
```

---

### Task 2: Weighted reconciliation core (score, country authority, graded coords, city clustering, overall)

This is the heart of the change. It replaces the equal-vote tally with weighted
voting, makes `ResolvedField.score` a required field, adds `GeoResolution.overall`,
grades coordinates, and clusters nearby cities. The full new `reconcile.ts` is
given so there is no half-compiled state.

**Files:**
- Modify: `lib/ti/types.ts` (add `score` to `ResolvedField`, add `overall` to `GeoResolution`)
- Modify: `lib/ti/geo/reconcile.ts` (full rewrite of the vote logic)
- Test: `lib/ti/geo/reconcile.test.ts` (append new describe blocks)

- [ ] **Step 1: Write the failing tests**

Append to `lib/ti/geo/reconcile.test.ts` (keep all existing tests):

```ts
describe("reconcileGeo — weighted reliability", () => {
  it("a heavier provider outweighs a lighter majority", () => {
    const res = reconcileGeo([
      r("ip-api", { city: "Berlin" }), // weight 0.85
      r("reverse-dns", { city: "Paris" }), // weight 0.2
      r("abuseipdb", { city: "Paris" }), // weight 0.5 (no city entry -> default)
    ])!;
    expect(res.city!.value).toBe("Berlin");
    expect(res.city!.confidence).toBe("medium");
    expect(res.city!.alternatives).toEqual([
      { value: "Paris", sources: ["reverse-dns", "abuseipdb"] },
    ]);
  });

  it("ripestat is authoritative for ASN and forces high", () => {
    const res = reconcileGeo([
      r("ip-api", { asn: "AS111" }),
      r("ipinfo", { asn: "AS111" }),
      r("ripestat", { asn: "AS222" }),
    ])!;
    expect(res.asn!.value).toBe("AS222");
    expect(res.asn!.confidence).toBe("high");
  });

  it("a single strong provider is medium, a single weak provider is low", () => {
    expect(reconcileGeo([r("ipinfo", { city: "Berlin" })])!.city!.confidence).toBe("medium");
    expect(reconcileGeo([r("reverse-dns", { city: "Berlin" })])!.city!.confidence).toBe("low");
  });

  it("every resolved field carries a numeric score", () => {
    const res = reconcileGeo([
      r("ip-api", { city: "Berlin", country: "Germany", countryCode: "DE" }),
      r("ipinfo", { city: "Berlin", country: "Germany", countryCode: "DE" }),
    ])!;
    expect(typeof res.city!.score).toBe("number");
    expect(typeof res.country!.score).toBe("number");
  });
});

describe("reconcileGeo — graded coordinates", () => {
  it("a single high-reliability provider is medium", () => {
    const res = reconcileGeo([r("ip-api", { lat: 1, lon: 1 })])!;
    expect(res.coordinates!.confidence).toBe("medium");
  });

  it("points ~100 km apart land in the medium band", () => {
    // ~0.9 deg latitude ~= 100 km, so each point is ~50 km from the centroid.
    const res = reconcileGeo([
      r("ip-api", { lat: 52.0, lon: 13.0 }),
      r("ipinfo", { lat: 52.9, lon: 13.0 }),
    ])!;
    expect(res.coordinates!.confidence).toBe("medium");
  });
});

describe("reconcileGeo — city proximity clustering", () => {
  it("near cities with coordinates corroborate instead of splitting", () => {
    const res = reconcileGeo([
      r("ip-api", { city: "Mountain View", lat: 37.42, lon: -122.08 }),
      r("ipinfo", { city: "Palo Alto", lat: 37.44, lon: -122.14 }),
    ])!;
    expect(res.city!.confidence).toBe("high");
    expect(res.city!.sources.sort()).toEqual(["ip-api", "ipinfo"]);
    expect(res.city!.alternatives).toBeUndefined();
  });

  it("far-apart cities stay split", () => {
    const res = reconcileGeo([
      r("ip-api", { city: "Berlin", lat: 52.52, lon: 13.4 }),
      r("ipinfo", { city: "Munich", lat: 48.14, lon: 11.58 }),
    ])!;
    expect(res.city!.alternatives!.length).toBe(1);
  });
});

describe("reconcileGeo — overall confidence", () => {
  it("blends present fields into an overall score and tier", () => {
    const res = reconcileGeo([
      r("ip-api", { country: "Germany", countryCode: "DE", city: "Berlin", lat: 52.52, lon: 13.4, asn: "AS3320" }),
      r("ipinfo", { country: "Germany", countryCode: "DE", city: "Berlin", lat: 52.5, lon: 13.4, asn: "AS3320" }),
    ])!;
    expect(res.overall).toBeDefined();
    expect(res.overall!.confidence).toBe("high");
    expect(res.overall!.score).toBeGreaterThan(0.66);
  });

  it("omits overall when no located field is present", () => {
    const res = reconcileGeo([r("ip-api", { isProxy: true })])!;
    expect(res.overall).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/ti/geo/reconcile.test.ts`
Expected: FAIL — new cases fail (e.g. `confidence` mismatches, `res.overall` undefined, `score` undefined).

- [ ] **Step 3: Add `score` and `overall` to the types**

In `lib/ti/types.ts`, change the `ResolvedField` interface to add the required
`score` field (after `confidence`):

```ts
export interface ResolvedField<T> {
  value: T;
  /** high = providers agree, low = single provider or tie. */
  confidence: Confidence;
  /** weighted 0-1 measure that drives the tier (provider-reliability aware). */
  score: number;
  /** agreeing providers / providers that reported this field (0–1). */
  agreement: number;
  /** provider ids backing the winning value. */
  sources: string[];
  /** dissenting values, when providers disagreed. */
  alternatives?: { value: T; sources: string[] }[];
}
```

In the same file, add `overall` to `GeoResolution` (after `providerCount`):

```ts
export interface GeoResolution {
  country?: ResolvedField<string>;
  /** ISO code paired with the winning country value. */
  countryCode?: string;
  region?: ResolvedField<string>;
  city?: ResolvedField<string>;
  coordinates?: ResolvedField<{ lat: number; lon: number }>;
  asn?: ResolvedField<string>;
  asnOrg?: ResolvedField<string>;
  isp?: ResolvedField<string>;
  flags: GeoFlags;
  /** how many providers returned any geo at all. */
  providerCount: number;
  /** blended confidence across the located fields. */
  overall?: { score: number; confidence: Confidence };
}
```

- [ ] **Step 4: Rewrite `lib/ti/geo/reconcile.ts`**

Replace the entire contents of `lib/ti/geo/reconcile.ts` with:

```ts
import type {
  Confidence,
  GeoContext,
  GeoResolution,
  ResolvedField,
  SourceResult,
} from "../types";
import { canonicalAsn, haversineKm, normalizeKey } from "./geokit";
import {
  authorityFor,
  CITY_CLUSTER_KM,
  COORD_HIGH_KM,
  COORD_MEDIUM_KM,
  CORROBORATION_TARGET,
  getWeight,
  HIGH_SCORE,
  MEDIUM_SCORE,
  type GeoField,
} from "./weights";

export interface GeoInput {
  id: string;
  geo: GeoContext;
}

function tierFromScore(score: number): Confidence {
  if (score >= HIGH_SCORE) return "high";
  if (score >= MEDIUM_SCORE) return "medium";
  return "low";
}

interface WVote {
  key: string;
  value: string;
  ids: string[];
  weight: number;
}

/** Rank weighted votes, derive confidence + score, collect alternatives.
 *  `authorityFor(weightField)` forces high when it backs the winner. */
function finalizeVotes(
  votes: WVote[],
  reporting: number,
  reportingWeight: number,
  weightField: GeoField,
): ResolvedField<string> {
  const authority = authorityFor(weightField);
  votes.sort((a, b) => b.weight - a.weight || b.ids.length - a.ids.length);
  const authoritativeVote = authority
    ? votes.find((v) => v.ids.includes(authority))
    : undefined;
  const winner = authoritativeVote ?? votes[0];
  const agreement = winner.ids.length / reporting;
  const coverage = Math.min(1, reportingWeight / CORROBORATION_TARGET);
  const score = (winner.weight / reportingWeight) * coverage;
  const confidence: Confidence = authoritativeVote ? "high" : tierFromScore(score);
  const alternatives = votes
    .filter((v) => v !== winner)
    .map((v) => ({ value: v.value, sources: v.ids }));
  return {
    value: winner.value,
    confidence,
    score,
    agreement,
    sources: winner.ids,
    ...(alternatives.length ? { alternatives } : {}),
  };
}

/** Weighted plurality vote over a string field. `weightField` selects the
 *  per-provider reliability column; `normalize` controls grouping. */
function tally(
  inputs: GeoInput[],
  field: keyof GeoContext,
  weightField: GeoField,
  normalize: (v: string) => string,
): ResolvedField<string> | undefined {
  const votes = new Map<string, WVote>();
  let reporting = 0;
  let reportingWeight = 0;

  for (const { id, geo } of inputs) {
    const raw = geo[field];
    if (typeof raw !== "string" || raw.trim() === "") continue;
    const key = normalize(raw);
    if (key === "") continue;
    const w = getWeight(id, weightField);
    reporting++;
    reportingWeight += w;
    const existing = votes.get(key);
    if (existing) {
      existing.ids.push(id);
      existing.weight += w;
    } else {
      votes.set(key, { key, value: raw.trim(), ids: [id], weight: w });
    }
  }

  if (reporting === 0 || reportingWeight === 0) return undefined;
  return finalizeVotes([...votes.values()], reporting, reportingWeight, weightField);
}

interface CityCand {
  value: string;
  ids: string[];
  weight: number;
  lat?: number;
  lon?: number;
  coordCount: number;
}

/** City is reconciled with coordinate awareness: candidates whose representative
 *  coordinates fall within CITY_CLUSTER_KM collapse into one, so adjacent place
 *  names corroborate instead of splitting. Falls back to string grouping when a
 *  provider has no coordinates. */
function reconcileCity(inputs: GeoInput[]): ResolvedField<string> | undefined {
  const byKey = new Map<string, CityCand>();
  let reporting = 0;
  let reportingWeight = 0;

  for (const { id, geo } of inputs) {
    const raw = geo.city;
    if (typeof raw !== "string" || raw.trim() === "") continue;
    const key = normalizeKey(raw);
    if (key === "") continue;
    const w = getWeight(id, "city");
    reporting++;
    reportingWeight += w;
    const hasCoord = typeof geo.lat === "number" && typeof geo.lon === "number";
    let c = byKey.get(key);
    if (!c) {
      c = { value: raw.trim(), ids: [], weight: 0, coordCount: 0 };
      byKey.set(key, c);
    }
    c.ids.push(id);
    c.weight += w;
    if (hasCoord) {
      const n = c.coordCount;
      c.lat = ((c.lat ?? 0) * n + (geo.lat as number)) / (n + 1);
      c.lon = ((c.lon ?? 0) * n + (geo.lon as number)) / (n + 1);
      c.coordCount = n + 1;
    }
  }

  if (reporting === 0 || reportingWeight === 0) return undefined;

  const merged: CityCand[] = [];
  for (const cand of byKey.values()) {
    const near =
      cand.coordCount > 0
        ? merged.find(
            (m) =>
              m.coordCount > 0 &&
              haversineKm(
                { lat: m.lat as number, lon: m.lon as number },
                { lat: cand.lat as number, lon: cand.lon as number },
              ) <= CITY_CLUSTER_KM,
          )
        : undefined;
    if (near) {
      const total = near.coordCount + cand.coordCount;
      if (cand.weight > near.weight) near.value = cand.value;
      near.lat =
        ((near.lat as number) * near.coordCount +
          (cand.lat as number) * cand.coordCount) /
        total;
      near.lon =
        ((near.lon as number) * near.coordCount +
          (cand.lon as number) * cand.coordCount) /
        total;
      near.ids = [...near.ids, ...cand.ids];
      near.weight += cand.weight;
      near.coordCount = total;
    } else {
      merged.push({ ...cand });
    }
  }

  return finalizeVotes(
    merged.map((c) => ({ key: c.value, value: c.value, ids: c.ids, weight: c.weight })),
    reporting,
    reportingWeight,
    "city",
  );
}

function reconcileCoordinates(
  inputs: GeoInput[],
): ResolvedField<{ lat: number; lon: number }> | undefined {
  const points = inputs
    .filter((i) => typeof i.geo.lat === "number" && typeof i.geo.lon === "number")
    .map((i) => ({
      id: i.id,
      lat: i.geo.lat as number,
      lon: i.geo.lon as number,
      w: getWeight(i.id, "coords"),
    }));

  if (points.length === 0) return undefined;

  const totalW = points.reduce((s, p) => s + p.w, 0) || points.length;
  const centroid = {
    lat: points.reduce((s, p) => s + p.lat * p.w, 0) / totalW,
    lon: points.reduce((s, p) => s + p.lon * p.w, 0) / totalW,
  };
  const coverage = Math.min(1, totalW / CORROBORATION_TARGET);

  let confidence: Confidence;
  let agreement: number;
  if (points.length === 1) {
    confidence = points[0].w >= 0.7 ? "medium" : "low";
    agreement = 1;
  } else {
    const spread = Math.max(...points.map((p) => haversineKm(centroid, p)));
    if (spread <= COORD_HIGH_KM) {
      confidence = "high";
      agreement = 1;
    } else if (spread <= COORD_MEDIUM_KM) {
      confidence = "medium";
      agreement = 0.6;
    } else {
      confidence = "low";
      agreement = 0.2;
    }
  }

  const result: ResolvedField<{ lat: number; lon: number }> = {
    value: centroid,
    confidence,
    score: agreement * coverage,
    agreement,
    sources: points.map((p) => p.id),
  };
  if (confidence === "low" && points.length > 1) {
    result.alternatives = points.map((p) => ({
      value: { lat: p.lat, lon: p.lon },
      sources: [p.id],
    }));
  }
  return result;
}

function reconcileFlags(inputs: GeoInput[]): GeoResolution["flags"] {
  const flags = {
    isHosting: false,
    isProxy: false,
    isMobile: false,
    sources: {} as Record<string, string[]>,
  };
  const keys = ["isHosting", "isProxy", "isMobile"] as const;
  for (const { id, geo } of inputs) {
    for (const k of keys) {
      if (geo[k] === true) {
        flags[k] = true;
        (flags.sources[k] ??= []).push(id);
      }
    }
  }
  return flags;
}

/** Country votes group by ISO code (so RDAP, which emits only a code,
 *  participates), and RDAP's allocation country is authoritative. */
function reconcileCountry(inputs: GeoInput[]): {
  field?: ResolvedField<string>;
  code?: string;
} {
  interface CVote {
    code: string;
    name: string;
    ids: string[];
    weight: number;
  }
  const votes = new Map<string, CVote>();
  let reporting = 0;
  let reportingWeight = 0;

  for (const { id, geo } of inputs) {
    const code = geo.countryCode?.trim().toUpperCase() ?? "";
    const name = geo.country?.trim() ?? "";
    if (!code && !name) continue;
    const w = getWeight(id, "country");
    reporting++;
    reportingWeight += w;
    const key = code || normalizeKey(name);
    const existing = votes.get(key);
    if (existing) {
      existing.ids.push(id);
      existing.weight += w;
      if (!existing.name && name) existing.name = name;
      if (!existing.code && code) existing.code = code;
    } else {
      votes.set(key, { code, name, ids: [id], weight: w });
    }
  }

  if (reporting === 0) return {};

  const authority = authorityFor("country");
  const ranked = [...votes.values()].sort(
    (a, b) => b.weight - a.weight || b.ids.length - a.ids.length,
  );
  const authoritativeVote = authority
    ? ranked.find((v) => v.ids.includes(authority))
    : undefined;
  const winner = authoritativeVote ?? ranked[0];
  const agreement = winner.ids.length / reporting;
  const coverage = Math.min(1, reportingWeight / CORROBORATION_TARGET);
  const score = (winner.weight / reportingWeight) * coverage;
  const confidence: Confidence = authoritativeVote ? "high" : tierFromScore(score);
  const alternatives = ranked
    .filter((v) => v !== winner)
    .map((v) => ({ value: v.name || v.code, sources: v.ids }));

  const field: ResolvedField<string> = {
    value: winner.name || winner.code,
    confidence,
    score,
    agreement,
    sources: winner.ids,
    ...(alternatives.length ? { alternatives } : {}),
  };
  return { field, code: winner.code || undefined };
}

/** Blend the located fields into one overall confidence, importance-weighted
 *  over the fields that are present. */
function computeOverall(res: GeoResolution): GeoResolution["overall"] {
  const parts: [number, number | undefined][] = [
    [0.3, res.country?.score],
    [0.3, res.city?.score],
    [0.25, res.coordinates?.score],
    [0.15, res.asn?.score],
  ];
  let num = 0;
  let den = 0;
  for (const [w, s] of parts) {
    if (s !== undefined) {
      num += w * s;
      den += w;
    }
  }
  if (den === 0) return undefined;
  const score = num / den;
  return { score, confidence: tierFromScore(score) };
}

/** Pure reconciliation core: votes over already-extracted provider inputs. */
export function reconcileGeoInputs(
  inputs: GeoInput[],
): GeoResolution | undefined {
  if (inputs.length === 0) return undefined;

  const country = reconcileCountry(inputs);
  const resolution: GeoResolution = {
    country: country.field,
    countryCode: country.code,
    region: tally(inputs, "region", "region", normalizeKey),
    city: reconcileCity(inputs),
    asn: tally(inputs, "asn", "asn", canonicalAsn),
    asnOrg: tally(inputs, "asnOrg", "asn", normalizeKey),
    isp: tally(inputs, "isp", "isp", normalizeKey),
    coordinates: reconcileCoordinates(inputs),
    flags: reconcileFlags(inputs),
    providerCount: inputs.length,
  };
  resolution.overall = computeOverall(resolution);
  return resolution;
}

/** Thin adapter for single-IP callers that hold full SourceResults. */
export function reconcileGeo(
  results: SourceResult[],
): GeoResolution | undefined {
  const inputs: GeoInput[] = results
    .filter((res) => res.status === "ok" && res.geo)
    .map((res) => ({ id: res.source.id, geo: res.geo as GeoContext }));
  return reconcileGeoInputs(inputs);
}

/** Project a GeoResolution onto a base GeoContext (the legacy flat view used by
 *  the OG image, history, and bulk geo). Present reconciled winners overlay the
 *  base; absent winners leave the base value intact (so provider-only fields
 *  like `org`, and `reverse`/`fcrdns` passed in via `base`, survive). Flags are
 *  written explicitly from the resolution (already OR'd across providers). */
export function overlayResolution(
  res: GeoResolution,
  base: GeoContext = {},
): GeoContext {
  const geo: GeoContext = { ...base };
  if (res.country) geo.country = res.country.value;
  if (res.countryCode) geo.countryCode = res.countryCode;
  if (res.region) geo.region = res.region.value;
  if (res.city) geo.city = res.city.value;
  if (res.asn) geo.asn = res.asn.value;
  if (res.asnOrg) geo.asnOrg = res.asnOrg.value;
  if (res.isp) geo.isp = res.isp.value;
  if (res.coordinates) {
    geo.lat = res.coordinates.value.lat;
    geo.lon = res.coordinates.value.lon;
  }
  geo.isHosting = res.flags.isHosting;
  geo.isProxy = res.flags.isProxy;
  geo.isMobile = res.flags.isMobile;
  return geo;
}
```

- [ ] **Step 5: Run the full geo + type-check suite to verify it passes**

Run: `npx vitest run lib/ti/geo/reconcile.test.ts`
Expected: PASS — all existing tests still green (synthetic ids use the 0.5
default weight, so equal-weight cases are unchanged) plus the new blocks.

- [ ] **Step 6: Commit**

```bash
git add lib/ti/types.ts lib/ti/geo/reconcile.ts lib/ti/geo/reconcile.test.ts
git commit -m "feat(geo): weighted reconciliation with score, graded coords, city clustering, overall"
```

---

### Task 3: freeipapi single-IP source

**Files:**
- Create: `lib/ti/sources/freeipapi.ts`
- Modify: `lib/ti/registry.ts`
- Test: `lib/ti/sources/freeipapi.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/ti/sources/freeipapi.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { freeIpApiToGeo, type FreeIpApiResponse } from "./freeipapi";

describe("freeIpApiToGeo", () => {
  it("maps a freeipapi payload to GeoContext", () => {
    const data: FreeIpApiResponse = {
      countryName: "United States",
      countryCode: "US",
      regionName: "California",
      cityName: "Mountain View",
      latitude: 37.422,
      longitude: -122.085,
      asn: "15169",
      asnOrganization: "Google LLC",
      isProxy: false,
    };
    expect(freeIpApiToGeo(data)).toEqual({
      country: "United States",
      countryCode: "US",
      region: "California",
      city: "Mountain View",
      lat: 37.422,
      lon: -122.085,
      asn: "AS15169",
      asnOrg: "Google LLC",
      isProxy: undefined,
    });
  });

  it("drops null-island coordinates", () => {
    const geo = freeIpApiToGeo({ countryCode: "US", latitude: 0, longitude: 0 });
    expect(geo.lat).toBeUndefined();
    expect(geo.lon).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ti/sources/freeipapi.test.ts`
Expected: FAIL with "Failed to resolve import './freeipapi'".

- [ ] **Step 3: Write the source adapter**

Create `lib/ti/sources/freeipapi.ts`:

```ts
import type { GeoContext, SourceFinding, TiSource } from "../types";
import { errorMessage, getJson, isTimeout } from "../http";

export interface FreeIpApiResponse {
  ipVersion?: number;
  ipAddress?: string;
  latitude?: number;
  longitude?: number;
  countryName?: string;
  countryCode?: string;
  regionName?: string;
  cityName?: string;
  asn?: string;
  asnOrganization?: string;
  isProxy?: boolean;
}

export function freeIpApiToGeo(data: FreeIpApiResponse): GeoContext {
  const asn = data.asn?.trim();
  const hasCoord =
    typeof data.latitude === "number" &&
    typeof data.longitude === "number" &&
    !(data.latitude === 0 && data.longitude === 0);
  return {
    country: data.countryName || undefined,
    countryCode: data.countryCode || undefined,
    region: data.regionName || undefined,
    city: data.cityName || undefined,
    lat: hasCoord ? data.latitude : undefined,
    lon: hasCoord ? data.longitude : undefined,
    asn: asn ? `AS${asn.replace(/^AS/i, "")}` : undefined,
    asnOrg: data.asnOrganization || undefined,
    isProxy: data.isProxy === true ? true : undefined,
  };
}

/** freeipapi.com: free geolocation/ASN context (no key). Context only, no risk
 *  score. Uses the default fetch mode (it issues a redirect, which undici
 *  follows; no-cors would hang on the redirect, see lib/ti/http.ts). */
export const freeIpApiSource: TiSource = {
  meta: {
    id: "freeipapi",
    name: "freeipapi.com",
    url: "https://freeipapi.com",
    category: "context",
    requiresKey: false,
    weight: 0,
  },
  isEnabled: () => true,
  async check(ip, signal): Promise<SourceFinding> {
    try {
      const { ok, data } = await getJson<FreeIpApiResponse>(
        `https://freeipapi.com/api/json/${ip}`,
        signal,
      );
      if (!ok || !data || (!data.countryCode && !data.countryName)) {
        return { status: "error", error: "Lookup failed" };
      }
      const geo = freeIpApiToGeo(data);
      return {
        status: "ok",
        summary: [data.cityName, data.regionName, data.countryName]
          .filter(Boolean)
          .join(", "),
        geo,
        raw: data,
      };
    } catch (err) {
      return { status: isTimeout(err) ? "timeout" : "error", error: errorMessage(err) };
    }
  },
};
```

- [ ] **Step 4: Register the source**

In `lib/ti/registry.ts`, add the import after the `ipGeolocationSource` import:

```ts
import { ipGeolocationSource } from "./sources/ipgeolocation";
import { freeIpApiSource } from "./sources/freeipapi";
```

And add it to the `sources` array right after `ipGeolocationSource,`:

```ts
  ipGeolocationSource,
  freeIpApiSource,
  reverseDnsSource,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/ti/sources/freeipapi.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/ti/sources/freeipapi.ts lib/ti/sources/freeipapi.test.ts lib/ti/registry.ts
git commit -m "feat(geo): add freeipapi.com as a free single-IP geo voter"
```

---

### Task 4: Bulk freeipapi fan-out

**Files:**
- Modify: `lib/ti/geo/bulk.ts` (add `fetchFreeIpApiGeo` + env cap helpers)
- Modify: `lib/ti/geo.ts` (wire the fan-out into `bulkGeolocate`)
- Test: `lib/ti/geo/bulk.test.ts` (append `fetchFreeIpApiGeo` cases)

- [ ] **Step 1: Write the failing tests**

Append to `lib/ti/geo/bulk.test.ts`:

```ts
import { fetchFreeIpApiGeo } from "./bulk";

describe("fetchFreeIpApiGeo", () => {
  it("maps freeipapi responses to GeoContext by IP", async () => {
    vi.mocked(getJson).mockResolvedValue({
      ok: true,
      data: {
        countryCode: "US",
        countryName: "United States",
        cityName: "Ashburn",
        latitude: 39.0,
        longitude: -77.5,
        asn: "14618",
        asnOrganization: "Amazon",
      },
    } as never);
    const out = await fetchFreeIpApiGeo(["1.2.3.4"], new AbortController().signal, 2);
    expect(out.get("1.2.3.4")?.city).toBe("Ashburn");
    expect(out.get("1.2.3.4")?.asn).toBe("AS14618");
  });

  it("propagates an abort/timeout instead of swallowing it", async () => {
    const abortErr = new DOMException("The operation was aborted", "AbortError");
    vi.mocked(getJson).mockRejectedValue(abortErr);
    await expect(
      fetchFreeIpApiGeo(["1.1.1.1"], new AbortController().signal, 2),
    ).rejects.toBe(abortErr);
  });

  it("degrades to an empty map on a real network error", async () => {
    vi.mocked(getJson).mockRejectedValue(new Error("ECONNRESET"));
    const out = await fetchFreeIpApiGeo(["1.1.1.1"], new AbortController().signal, 2);
    expect(out.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/ti/geo/bulk.test.ts`
Expected: FAIL with "fetchFreeIpApiGeo is not a function" / import error.

- [ ] **Step 3: Implement `fetchFreeIpApiGeo` + env caps in `bulk.ts`**

In `lib/ti/geo/bulk.ts`, add the import near the top (after the rdap import):

```ts
import { type RdapIpResponse, rdapIpToGeo } from "../sources/rdap-ip";
import { type FreeIpApiResponse, freeIpApiToGeo } from "../sources/freeipapi";
```

Add this function after `fetchRdapCountries` (it reuses the existing `mapLimit`,
`getJson`, and `isTimeout` already imported in the file):

```ts
/** Fetch freeipapi geo per IP, concurrency-capped. A third city/coords voter
 *  for the bulk path. Failures drop out silently; aborts propagate. */
export async function fetchFreeIpApiGeo(
  ips: string[],
  signal: AbortSignal,
  concurrency: number,
): Promise<Map<string, GeoContext>> {
  const out = new Map<string, GeoContext>();
  if (ips.length === 0) return out;
  await mapLimit(ips, concurrency, async (ip) => {
    try {
      const { ok, data } = await getJson<FreeIpApiResponse>(
        `https://freeipapi.com/api/json/${ip}`,
        signal,
      );
      if (ok && data && (data.countryCode || data.countryName)) {
        out.set(ip, freeIpApiToGeo(data));
      }
    } catch (err) {
      if (isTimeout(err)) throw err; // propagate abort/cancel; degrade on real errors
    }
  });
  return out;
}
```

Add the two cap helpers at the bottom of the file, beside the RDAP ones:

```ts
/** Hard ceiling on per-request freeipapi fan-out lookups (latency guard). */
export const bulkGeoFanoutMax = (): number => intEnv("BULK_GEO_FANOUT_MAX", 15);
/** Max concurrent freeipapi fan-out requests. */
export const bulkGeoFanoutConcurrency = (): number =>
  intEnv("BULK_GEO_FANOUT_CONCURRENCY", 8);
```

- [ ] **Step 4: Wire the fan-out into `bulkGeolocate` (`lib/ti/geo.ts`)**

In `lib/ti/geo.ts`, extend the bulk import block to include the new helpers:

```ts
import {
  bulkGeoFanoutConcurrency,
  bulkGeoFanoutMax,
  bulkRdapConcurrency,
  bulkRdapMax,
  fetchFreeIpApiGeo,
  fetchRdapCountries,
  selectUncertainIps,
  transposeByIp,
} from "./geo/bulk";
```

Replace step 4 (the RDAP block, currently lines ~98-114, from the
`// 4. Adaptive RDAP...` comment through the `for (const [ip, geo] of rdapByIp)`
loop) with this combined, concurrent fan-out:

```ts
  // 4. Adaptive authority + corroboration for uncertain IPs. RDAP gives an
  //    allocation country; freeipapi adds a third city/coords voter. Both are
  //    capped (latency guard) and run concurrently; over-cap IPs are logged.
  const qualifying = selectUncertainIps(perIp, Number.POSITIVE_INFINITY);
  const rdapCap = bulkRdapMax();
  const fanoutCap = bulkGeoFanoutMax();
  if (qualifying.length > rdapCap) {
    console.warn(
      `bulkGeolocate: ${qualifying.length - rdapCap} uncertain IP(s) skipped RDAP (cap ${rdapCap})`,
    );
  }
  if (qualifying.length > fanoutCap) {
    console.warn(
      `bulkGeolocate: ${qualifying.length - fanoutCap} uncertain IP(s) skipped freeipapi fan-out (cap ${fanoutCap})`,
    );
  }
  const [rdapByIp, freeIpByIp] = await Promise.all([
    fetchRdapCountries(qualifying.slice(0, rdapCap), signal, bulkRdapConcurrency()),
    fetchFreeIpApiGeo(qualifying.slice(0, fanoutCap), signal, bulkGeoFanoutConcurrency()),
  ]);
  for (const [ip, geo] of rdapByIp) {
    perIp.get(ip)?.push({ id: "rdap-ip", geo });
  }
  for (const [ip, geo] of freeIpByIp) {
    perIp.get(ip)?.push({ id: "freeipapi", geo });
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/ti/geo/bulk.test.ts`
Expected: PASS — the three new `fetchFreeIpApiGeo` tests plus all existing
`transposeByIp` / `selectUncertainIps` / `fetchRdapCountries` tests.

- [ ] **Step 6: Commit**

```bash
git add lib/ti/geo/bulk.ts lib/ti/geo.ts lib/ti/geo/bulk.test.ts
git commit -m "feat(geo): capped freeipapi fan-out for uncertain IPs in bulk"
```

---

### Task 5: Overall confidence badge + display wiring

UI change — no unit test (per project convention UI is verified in the browser).
Verify with lint + build + a dev smoke check.

**Files:**
- Modify: `components/CheckResults/confidence.tsx` (add `OverallConfidence` + `geoConfidenceReason`)
- Modify: `components/CheckResults/profile.tsx` (render the badge + reason)

- [ ] **Step 1: Add the badge component and reason helper**

In `components/CheckResults/confidence.tsx`, extend the type import to include
`GeoResolution`:

```ts
import type { Confidence, GeoResolution, ResolvedField } from "@/lib/ti/types";
```

Append to the end of the file:

```tsx
/** Larger chip summarizing overall geolocation confidence. */
export function OverallConfidence({
  confidence,
}: {
  confidence: Confidence;
}) {
  return (
    <span
      title={LABEL[confidence]}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium",
        TONE[confidence],
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      Geo confidence: {confidence}
    </span>
  );
}

/** One-line, comma-separated explanation of the geo confidence (house style:
 *  commas, no dashes). */
export function geoConfidenceReason(res: GeoResolution): string {
  const parts: string[] = [
    `${res.providerCount} provider${res.providerCount === 1 ? "" : "s"}`,
  ];
  if (res.country) {
    parts.push(`${res.country.sources.length} agree on country`);
  }
  if (res.city && res.city.confidence !== "low") {
    parts.push("city corroborated");
  }
  if (res.coordinates && res.coordinates.sources.length > 1) {
    parts.push(
      res.coordinates.confidence === "high"
        ? "coordinates tightly clustered"
        : "coordinates loosely clustered",
    );
  }
  return parts.join(", ");
}
```

- [ ] **Step 2: Render it in the profile card**

In `components/CheckResults/profile.tsx`, extend the confidence import:

```tsx
import { Disagreement, OverallConfidence, geoConfidenceReason } from "./confidence";
```

Replace the existing "Reconciled from N geo providers" paragraph (the
`{res && res.providerCount > 0 && ( ... )}` block near the end of `ProfileCard`)
with:

```tsx
                {res?.overall && (
                    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <OverallConfidence confidence={res.overall.confidence} />
                        <span>{geoConfidenceReason(res)}</span>
                    </div>
                )}
```

- [ ] **Step 3: Verify lint and build pass**

Run: `npm run lint`
Expected: no new errors in `confidence.tsx` / `profile.tsx`.

Run: `npm run build`
Expected: build completes (the `geoResolution.overall` type is recognized).

- [ ] **Step 4: Dev smoke check (manual)**

Run the app (use the user's existing dev server on :3000; do NOT kill it). Visit
`/check/8.8.8.8` and confirm the Geolocation card shows a "Geo confidence: high"
(or medium) badge with a reason like "N providers, M agree on country, city
corroborated". If you cannot verify the UI in this environment, say so explicitly
rather than claiming it works.

- [ ] **Step 5: Commit**

```bash
git add components/CheckResults/confidence.tsx components/CheckResults/profile.tsx
git commit -m "feat(geo): overall geo-confidence badge + reason in profile card"
```

---

### Task 6: Docs + full verification

**Files:**
- Modify: `README.md` (add freeipapi to the no-key source table)
- Modify: `.env.example` (document the bulk geo tuning env vars)

- [ ] **Step 1: Add freeipapi to the README source table**

In `README.md`, in the "Works out of the box, no API key required" table, add a
row directly after the `ipwho.is` row:

```markdown
| ipwho.is           | Second geolocation/ASN opinion (reconciled)     |
| freeipapi.com      | Third geolocation/ASN opinion (reconciled)      |
```

- [ ] **Step 2: Document the bulk geo tuning vars**

In `.env.example`, append after the `IPGEOLOCATION_API_KEY=` line:

```bash

# Bulk geolocation tuning (optional; sane defaults apply if unset).
# Uncertain IPs per bulk request that get an RDAP allocation-country lookup.
BULK_RDAP_MAX=25
BULK_RDAP_CONCURRENCY=8
# Uncertain IPs per bulk request that get a freeipapi corroboration lookup.
BULK_GEO_FANOUT_MAX=15
BULK_GEO_FANOUT_CONCURRENCY=8
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS, no failures. (If any pre-existing unrelated WIP test fails, note
it but do not fix it as part of this task.)

- [ ] **Step 4: Run lint and build**

Run: `npm run lint && npm run build`
Expected: both succeed with no new errors.

- [ ] **Step 5: Commit**

```bash
git add README.md .env.example
git commit -m "docs(geo): document freeipapi source + bulk geo tuning env vars"
```

---

## Self-Review notes

- **Spec coverage:** weighting matrix (Task 1) → `weights.ts`; weighted tally +
  authority + per-field `score` + `overall` (Task 2); proximity city + graded
  coords (Task 2); freeipapi single-IP (Task 3) + bulk fan-out (Task 4); badge +
  reason (Task 5); README/.env + verification (Task 6). All four user-selected
  dimensions (algorithm, coverage, granularity, display) are covered.
- **Backward-compatibility:** existing `reconcile.test.ts` cases use synthetic
  ids (`a`/`b`/`c`) that resolve to `DEFAULT_WEIGHT` (0.5), so equal-weight
  outcomes (high/medium/low and the rdap country-authority case) are unchanged;
  only the new real-id cases exercise the weighting. The deep-equal
  refactor-safety test still holds because both code paths gain `score`/`overall`
  identically.
- **Type consistency:** `getWeight(id, GeoField)` and `authorityFor(GeoField)`
  are used with the same `GeoField` literals throughout; `ResolvedField.score`
  is set in every producer (`tally` via `finalizeVotes`, `reconcileCountry`,
  `reconcileCoordinates`); `GeoResolution.overall` is produced only in
  `computeOverall` and consumed only in `profile.tsx`.
- **No placeholders:** every code step contains complete code; every run step has
  an exact command and expected result.
```
