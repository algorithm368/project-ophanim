# Geo & DNS Accuracy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace single-provider IP geolocation and domain DNS lookups with multi-provider reconciliation that exposes an explicit per-field confidence signal, plus richer DNS data (more records, PTR/FCrDNS, DNSSEC, multi-resolver agreement), surfaced prominently in the result UI.

**Architecture:** Each geo/DNS provider stays an ordinary `TiSource` (`category: "context"`, `weight: 0`) emitting a plain `GeoContext`/`DomainContext`. A new pure `reconcileGeo` function votes across all contributed geo objects per field, producing a `GeoResolution` with confidence + alternatives. DNS gains a shared DoH client, pure parsers, multi-resolver agreement, and an FCrDNS step. UI layers confidence chips and disclosure affordances onto the existing sketch-styled cards.

**Tech Stack:** TypeScript, Next.js 16 (App Router), React 19, Vitest (colocated unit tests, no network), the `@/` import alias, and the existing `lib/ti/http.ts` fetch helpers.

**Spec:** `docs/superpowers/specs/2026-06-03-geo-dns-accuracy-design.md`

---

## File Structure

**Phase 1 — data model, reconciliation, IP providers**
- `lib/ti/types.ts` (modify) — `Confidence`, `ResolvedField<T>`, `GeoFlags`, `GeoResolution`, `FcrdnsResult`; extend `GeoContext`, `DomainContext`, `CheckResult`.
- `lib/ti/geo/reconcile.ts` (create) — pure reconciliation: `reconcileGeo`, helpers.
- `lib/ti/geo/reconcile.test.ts` (create) — reconciliation unit tests.
- `lib/ti/geo/geokit.ts` (create) — `haversineKm`, `normalizeKey`, `canonicalAsn`.
- `lib/ti/geo/geokit.test.ts` (create) — geo-math/normalize unit tests.
- `lib/ti/sources/ipwhois.ts` (create) + `.test.ts` — ipwho.is provider.
- `lib/ti/sources/rdap-ip.ts` (create) + `.test.ts` — RDAP/RIR provider.
- `lib/ti/sources/ipinfo.ts` (create) + `.test.ts` — ipinfo.io provider (key-gated).
- `lib/ti/sources/ipgeolocation.ts` (create) + `.test.ts` — ipgeolocation.io provider (key-gated).
- `lib/ti/registry.ts` (modify) — register the four new providers.
- `lib/ti/check.ts` (modify) — `mergeGeo` → `reconcileGeo`; build the flattened `geo` compat view.

**Phase 2 — DNS enrichment**
- `lib/ti/dns/doh.ts` (create) — shared DoH client + `RESOLVERS` + `answers`.
- `lib/ti/dns/parse.ts` (create) — pure parsers: SPF/DMARC extract, MX/host normalize, resolver-agreement, DNSSEC.
- `lib/ti/dns/parse.test.ts` (create) — parser unit tests.
- `lib/ti/dns/fcrdns.ts` (create) + `.test.ts` — `reversePointer`, `verifyFcrdns` (injectable query fn).
- `lib/ti/sources/reverse-dns.ts` (create) — IP-side FCrDNS provider (context, weight 0).
- `lib/ti/registry.ts` (modify) — register the reverse-dns provider.
- `lib/ti/domain/sources/dns.ts` (modify) — use shared DoH + parsers; add records, multi-resolver, PTR, DNSSEC.

**Phase 3 — UI surfacing**
- `components/CheckResults/confidence.tsx` (create) — `ConfidenceChip`, `Disagreement` disclosure.
- `components/CheckResults/profile.tsx` (modify) — confidence chips, disagreement, FCrDNS badge.
- The domain DNS view component (modify) — DNSSEC badge, resolver-agreement indicator, new records.

---

## Phase 1 — Data model, reconciliation, IP providers

### Task 1: Data model types

**Files:**
- Modify: `lib/ti/types.ts`

- [ ] **Step 1: Add the reconciliation + FCrDNS types**

Add near the existing `GeoContext` block in `lib/ti/types.ts`:

```ts
export type Confidence = "high" | "medium" | "low";

/** One reconciled field: winning value + how sure we are + what else was seen. */
export interface ResolvedField<T> {
  value: T;
  /** high = providers agree, low = single provider or tie. */
  confidence: Confidence;
  /** agreeing providers / providers that reported this field (0–1). */
  agreement: number;
  /** provider ids backing the winning value. */
  sources: string[];
  /** dissenting values, when providers disagreed. */
  alternatives?: { value: T; sources: string[] }[];
}

export interface GeoFlags {
  isHosting: boolean;
  isProxy: boolean;
  isMobile: boolean;
  /** flag name -> provider ids that asserted it. */
  sources: Record<string, string[]>;
}

/** Forward-confirmed reverse DNS result for an IP. */
export interface FcrdnsResult {
  hostname: string;
  /** PTR host forward-resolves back to the original IP. */
  verified: boolean;
}

/** Reconciled geolocation. Each estimated field carries confidence. */
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
}
```

- [ ] **Step 2: Extend `GeoContext`**

Add to the existing `GeoContext` interface:

```ts
  /** Forward-confirmed reverse DNS (contributed by the reverse-dns source). */
  fcrdns?: FcrdnsResult;
```

- [ ] **Step 3: Extend `DomainContext`**

Add to the existing `DomainContext` interface:

```ts
  /** PTR hostnames for the resolved IPs. */
  reverse?: string[];
  /** DNSSEC posture from the resolver's AD flag. */
  dnssec?: "signed" | "unsigned" | "unknown";
  txt?: string[];
  /** SPF record extracted from TXT. */
  spf?: string;
  /** DMARC record from the _dmarc subdomain. */
  dmarc?: string;
  caa?: string[];
  soa?: string;
  cname?: string[];
  /** false when DoH resolvers returned differing A answer sets. */
  resolverAgreement?: boolean;
```

- [ ] **Step 4: Add `geoResolution` to `CheckResult`**

Find the `CheckResult` interface (it currently has `geo?: GeoContext`) and add beneath it:

```ts
  /** Multi-provider reconciled geo with per-field confidence. */
  geoResolution?: GeoResolution;
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no usages yet; pure additive types).

- [ ] **Step 6: Commit**

```bash
git add lib/ti/types.ts
git commit -m "feat(types): add geo reconciliation + DNS enrichment types"
```

---

### Task 2: Geo math + normalization kit

**Files:**
- Create: `lib/ti/geo/geokit.ts`
- Test: `lib/ti/geo/geokit.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/ti/geo/geokit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canonicalAsn, haversineKm, normalizeKey } from "./geokit";

describe("normalizeKey", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    expect(normalizeKey("  Mountain   View ")).toBe("mountain view");
  });
  it("returns empty string for nullish", () => {
    expect(normalizeKey(undefined)).toBe("");
    expect(normalizeKey("")).toBe("");
  });
});

describe("canonicalAsn", () => {
  it("extracts the AS number, dropping the org tail", () => {
    expect(canonicalAsn("AS15169 Google LLC")).toBe("AS15169");
  });
  it("normalizes a bare number", () => {
    expect(canonicalAsn("15169")).toBe("AS15169");
  });
  it("returns empty string when no number present", () => {
    expect(canonicalAsn("Google")).toBe("");
  });
});

describe("haversineKm", () => {
  it("is ~0 for identical points", () => {
    expect(haversineKm({ lat: 37.4, lon: -122 }, { lat: 37.4, lon: -122 })).toBeCloseTo(0, 5);
  });
  it("computes a known distance (SF -> LA ~559km)", () => {
    const d = haversineKm({ lat: 37.7749, lon: -122.4194 }, { lat: 34.0522, lon: -118.2437 });
    expect(d).toBeGreaterThan(540);
    expect(d).toBeLessThan(580);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- geokit`
Expected: FAIL ("Cannot find module './geokit'").

- [ ] **Step 3: Write the implementation**

Create `lib/ti/geo/geokit.ts`:

```ts
/** Normalize a string for grouping: trim, collapse whitespace, lowercase. */
export function normalizeKey(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Canonical "AS####" form, dropping any org tail. "" when no number found. */
export function canonicalAsn(value: string | undefined): string {
  const m = (value ?? "").match(/(\d+)/);
  return m ? `AS${m[1]}` : "";
}

export interface LatLon {
  lat: number;
  lon: number;
}

/** Great-circle distance between two points, in kilometres. */
export function haversineKm(a: LatLon, b: LatLon): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- geokit`
Expected: PASS (3 describes, all green).

- [ ] **Step 5: Commit**

```bash
git add lib/ti/geo/geokit.ts lib/ti/geo/geokit.test.ts
git commit -m "feat(geo): add haversine + normalization helpers"
```

---

### Task 3: Reconciliation core — categorical fields

**Files:**
- Create: `lib/ti/geo/reconcile.ts`
- Test: `lib/ti/geo/reconcile.test.ts`

The reconciler consumes `SourceResult[]`. For testing we pass lightweight objects shaped like `{ source: { id }, status, geo }`; the real `SourceResult` is a superset, so a small local helper keeps tests readable.

- [ ] **Step 1: Write the failing test (categorical fields)**

Create `lib/ti/geo/reconcile.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { SourceResult } from "../types";
import { reconcileGeo } from "./reconcile";

/** Minimal SourceResult factory for reconcile tests. */
function r(id: string, geo: Record<string, unknown>): SourceResult {
  return {
    source: { id, name: id, url: "", category: "context", requiresKey: false, weight: 0 },
    enabled: true,
    status: "ok",
    durationMs: 1,
    geo,
  } as unknown as SourceResult;
}

describe("reconcileGeo — categorical fields", () => {
  it("returns undefined when no source has geo", () => {
    expect(reconcileGeo([])).toBeUndefined();
  });

  it("unanimous agreement is high confidence", () => {
    const res = reconcileGeo([
      r("a", { city: "Berlin" }),
      r("b", { city: "Berlin" }),
      r("c", { city: "Berlin" }),
    ])!;
    expect(res.city!.value).toBe("Berlin");
    expect(res.city!.confidence).toBe("high");
    expect(res.city!.agreement).toBeCloseTo(1);
    expect(res.city!.sources.sort()).toEqual(["a", "b", "c"]);
    expect(res.city!.alternatives).toBeUndefined();
  });

  it("a single dissenter against a 2/3 majority is high and records alternatives", () => {
    const res = reconcileGeo([
      r("a", { city: "Berlin" }),
      r("b", { city: "Berlin" }),
      r("c", { city: "Munich" }),
    ])!;
    expect(res.city!.value).toBe("Berlin");
    expect(res.city!.confidence).toBe("high");
    expect(res.city!.agreement).toBeCloseTo(2 / 3);
    expect(res.city!.alternatives).toEqual([{ value: "Munich", sources: ["c"] }]);
  });

  it("a contested plurality below 2/3 is medium", () => {
    const res = reconcileGeo([
      r("a", { city: "Berlin" }),
      r("b", { city: "Munich" }),
      r("c", { city: "Hamburg" }),
      r("d", { city: "Berlin" }),
      r("e", { city: "Munich" }),
    ])!;
    // Berlin & Munich tie at 2 each -> not a strict plurality -> low.
    expect(res.city!.confidence).toBe("low");
  });

  it("a single provider is low confidence", () => {
    const res = reconcileGeo([r("a", { city: "Berlin" })])!;
    expect(res.city!.value).toBe("Berlin");
    expect(res.city!.confidence).toBe("low");
    expect(res.city!.agreement).toBeCloseTo(1);
  });

  it("normalizes ASN before voting", () => {
    const res = reconcileGeo([
      r("a", { asn: "AS15169 Google LLC" }),
      r("b", { asn: "15169" }),
    ])!;
    expect(res.asn!.value).toBe("AS15169");
    expect(res.asn!.confidence).toBe("high");
  });

  it("counts only providers that reported the field", () => {
    const res = reconcileGeo([
      r("a", { city: "Berlin", country: "Germany" }),
      r("b", { country: "Germany" }),
    ])!;
    expect(res.city!.agreement).toBeCloseTo(1); // only 'a' reported city
    expect(res.providerCount).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- reconcile`
Expected: FAIL ("Cannot find module './reconcile'").

- [ ] **Step 3: Write the categorical reconciliation**

Create `lib/ti/geo/reconcile.ts`:

```ts
import type {
  Confidence,
  GeoContext,
  GeoResolution,
  ResolvedField,
  SourceResult,
} from "../types";
import { canonicalAsn, normalizeKey } from "./geokit";

interface GeoInput {
  id: string;
  geo: GeoContext;
}

interface Vote {
  /** grouping key (normalized) */
  key: string;
  /** display value (original casing of the first contributor) */
  value: string;
  ids: string[];
}

function tally(
  inputs: GeoInput[],
  field: keyof GeoContext,
  normalize: (v: string) => string,
): ResolvedField<string> | undefined {
  const votes = new Map<string, Vote>();
  let reporting = 0;

  for (const { id, geo } of inputs) {
    const raw = geo[field];
    if (typeof raw !== "string" || raw.trim() === "") continue;
    reporting++;
    const key = normalize(raw);
    if (key === "") continue;
    const existing = votes.get(key);
    if (existing) existing.ids.push(id);
    else votes.set(key, { key, value: raw.trim(), ids: [id] });
  }

  if (reporting === 0) return undefined;

  const ranked = [...votes.values()].sort((a, b) => b.ids.length - a.ids.length);
  const winner = ranked[0];
  const top = winner.ids.length;
  const second = ranked.find((v) => v !== winner)?.ids.length ?? 0;
  const agreement = top / reporting;

  let confidence: Confidence;
  if (reporting >= 2 && agreement >= 2 / 3) confidence = "high";
  else if (reporting >= 2 && top > second) confidence = "medium";
  else confidence = "low";

  const alternatives = ranked
    .filter((v) => v !== winner)
    .map((v) => ({ value: v.value, sources: v.ids }));

  return {
    value: winner.value,
    confidence,
    agreement,
    sources: winner.ids,
    ...(alternatives.length ? { alternatives } : {}),
  };
}

export function reconcileGeo(results: SourceResult[]): GeoResolution | undefined {
  const inputs: GeoInput[] = results
    .filter((res) => res.status === "ok" && res.geo)
    .map((res) => ({ id: res.source.id, geo: res.geo as GeoContext }));

  if (inputs.length === 0) return undefined;

  return {
    country: undefined, // filled in Task 4 (reconcileCountry)
    countryCode: undefined, // filled in Task 4
    region: tally(inputs, "region", normalizeKey),
    city: tally(inputs, "city", normalizeKey),
    asn: tally(inputs, "asn", canonicalAsn),
    asnOrg: tally(inputs, "asnOrg", normalizeKey),
    isp: tally(inputs, "isp", normalizeKey),
    coordinates: undefined, // filled in Task 4
    flags: { isHosting: false, isProxy: false, isMobile: false, sources: {} }, // Task 4
    providerCount: inputs.length,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- reconcile`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/geo/reconcile.ts lib/ti/geo/reconcile.test.ts
git commit -m "feat(geo): reconcile categorical geo fields with confidence"
```

---

### Task 4: Reconciliation — coordinates, flags, country authority

**Files:**
- Modify: `lib/ti/geo/reconcile.ts`
- Test: `lib/ti/geo/reconcile.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `lib/ti/geo/reconcile.test.ts`:

```ts
describe("reconcileGeo — coordinates", () => {
  it("returns undefined coordinates when none reported", () => {
    const res = reconcileGeo([r("a", { city: "Berlin" })])!;
    expect(res.coordinates).toBeUndefined();
  });

  it("clustered points are high confidence at the centroid", () => {
    const res = reconcileGeo([
      r("a", { lat: 52.52, lon: 13.405 }),
      r("b", { lat: 52.5, lon: 13.4 }),
    ])!;
    expect(res.coordinates!.confidence).toBe("high");
    expect(res.coordinates!.value.lat).toBeCloseTo(52.51, 1);
  });

  it("far-apart points drop to low confidence and record alternatives", () => {
    const res = reconcileGeo([
      r("a", { lat: 37.77, lon: -122.42 }),
      r("b", { lat: 34.05, lon: -118.24 }),
    ])!;
    expect(res.coordinates!.confidence).toBe("low");
    expect(res.coordinates!.alternatives!.length).toBe(2);
  });

  it("a single coordinate is low confidence", () => {
    const res = reconcileGeo([r("a", { lat: 52.52, lon: 13.405 })])!;
    expect(res.coordinates!.confidence).toBe("low");
  });
});

describe("reconcileGeo — flags", () => {
  it("ORs flags across providers and attributes each", () => {
    const res = reconcileGeo([
      r("a", { isProxy: true }),
      r("b", { isHosting: true }),
      r("c", { isProxy: true, isMobile: false }),
    ])!;
    expect(res.flags.isProxy).toBe(true);
    expect(res.flags.isHosting).toBe(true);
    expect(res.flags.isMobile).toBe(false);
    expect(res.flags.sources.isProxy.sort()).toEqual(["a", "c"]);
    expect(res.flags.sources.isHosting).toEqual(["b"]);
  });
});

describe("reconcileGeo — country authority", () => {
  it("RDAP breaks a country split and is high confidence", () => {
    const res = reconcileGeo([
      r("a", { country: "United States", countryCode: "US" }),
      r("b", { country: "Canada", countryCode: "CA" }),
      r("rdap-ip", { country: "Canada", countryCode: "CA" }),
    ])!;
    expect(res.country!.value).toBe("Canada");
    expect(res.country!.confidence).toBe("high");
    expect(res.countryCode).toBe("CA");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- reconcile`
Expected: FAIL (coordinates undefined, flags all false).

- [ ] **Step 3: Implement coordinates + flags**

In `lib/ti/geo/reconcile.ts`, add the import for `haversineKm` and a `LatLon`-style local type, and two helpers:

Update the import line:

```ts
import { canonicalAsn, haversineKm, normalizeKey } from "./geokit";
```

Add before `reconcileGeo`:

```ts
const SPREAD_KM = 50;

function reconcileCoordinates(
  inputs: GeoInput[],
): ResolvedField<{ lat: number; lon: number }> | undefined {
  const points = inputs
    .filter((i) => typeof i.geo.lat === "number" && typeof i.geo.lon === "number")
    .map((i) => ({ id: i.id, lat: i.geo.lat as number, lon: i.geo.lon as number }));

  if (points.length === 0) return undefined;

  const centroid = {
    lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
    lon: points.reduce((s, p) => s + p.lon, 0) / points.length,
  };
  const spread = Math.max(...points.map((p) => haversineKm(centroid, p)));

  let confidence: Confidence;
  if (points.length === 1) confidence = "low";
  else if (spread <= SPREAD_KM) confidence = "high";
  else confidence = "low";

  const result: ResolvedField<{ lat: number; lon: number }> = {
    value: centroid,
    confidence,
    agreement: points.length === 1 ? 1 : (spread <= SPREAD_KM ? 1 : 0),
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

const COUNTRY_AUTHORITY = "rdap-ip";

/** Country is reconciled separately: votes group by ISO code (so RDAP, which
 *  emits only a code, participates), and RDAP's allocation country breaks ties. */
function reconcileCountry(inputs: GeoInput[]): {
  field?: ResolvedField<string>;
  code?: string;
} {
  interface CVote {
    code: string;
    name: string;
    ids: string[];
  }
  const votes = new Map<string, CVote>();
  let reporting = 0;

  for (const { id, geo } of inputs) {
    const code = geo.countryCode?.trim().toUpperCase() ?? "";
    const name = geo.country?.trim() ?? "";
    if (!code && !name) continue;
    reporting++;
    const key = code || normalizeKey(name);
    const existing = votes.get(key);
    if (existing) {
      existing.ids.push(id);
      if (!existing.name && name) existing.name = name;
      if (!existing.code && code) existing.code = code;
    } else {
      votes.set(key, { code, name, ids: [id] });
    }
  }

  if (reporting === 0) return {};

  const ranked = [...votes.values()].sort((a, b) => b.ids.length - a.ids.length);
  const authoritative = ranked.find((v) => v.ids.includes(COUNTRY_AUTHORITY));
  const winner = authoritative ?? ranked[0];
  const top = winner.ids.length;
  const second = ranked.find((v) => v !== winner)?.ids.length ?? 0;
  const agreement = top / reporting;

  let confidence: Confidence;
  if (authoritative) confidence = "high";
  else if (reporting >= 2 && agreement >= 2 / 3) confidence = "high";
  else if (reporting >= 2 && top > second) confidence = "medium";
  else confidence = "low";

  const alternatives = ranked
    .filter((v) => v !== winner)
    .map((v) => ({ value: v.name || v.code, sources: v.ids }));

  const field: ResolvedField<string> = {
    value: winner.name || winner.code,
    confidence,
    agreement,
    sources: winner.ids,
    ...(alternatives.length ? { alternatives } : {}),
  };
  return { field, code: winner.code || undefined };
}
```

Then in `reconcileGeo`, replace the `country:`, `countryCode:`, `coordinates:`, and `flags:` lines:

```ts
    country: reconcileCountry(inputs).field,
    countryCode: reconcileCountry(inputs).code,
    coordinates: reconcileCoordinates(inputs),
    flags: reconcileFlags(inputs),
```

(Calling `reconcileCountry` twice is fine — it's cheap and pure; or hoist it to a `const c = reconcileCountry(inputs)` above the return and use `c.field` / `c.code` if you prefer.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- reconcile`
Expected: PASS (all reconcile describes green).

- [ ] **Step 5: Commit**

```bash
git add lib/ti/geo/reconcile.ts lib/ti/geo/reconcile.test.ts
git commit -m "feat(geo): reconcile coordinates, flags, and country authority"
```

---

### Task 5: ipwho.is provider (no key)

**Files:**
- Create: `lib/ti/sources/ipwhois.ts`
- Test: `lib/ti/sources/ipwhois.test.ts`

ipwho.is returns: `{ success, ip, country, country_code, region, city, latitude, longitude, connection: { asn, org, isp }, ... }`. We map to `GeoContext`.

- [ ] **Step 1: Write the failing test**

Create `lib/ti/sources/ipwhois.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ipWhoIsToGeo, type IpWhoIsResponse } from "./ipwhois";

describe("ipWhoIsToGeo", () => {
  it("maps an ipwho.is success payload to GeoContext", () => {
    const data: IpWhoIsResponse = {
      success: true,
      country: "Germany",
      country_code: "DE",
      region: "Berlin",
      city: "Berlin",
      latitude: 52.52,
      longitude: 13.405,
      connection: { asn: 3320, org: "Deutsche Telekom AG", isp: "Telekom" },
    };
    expect(ipWhoIsToGeo(data)).toEqual({
      country: "Germany",
      countryCode: "DE",
      region: "Berlin",
      city: "Berlin",
      lat: 52.52,
      lon: 13.405,
      asn: "AS3320",
      asnOrg: "Deutsche Telekom AG",
      isp: "Telekom",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ipwhois`
Expected: FAIL ("Cannot find module './ipwhois'").

- [ ] **Step 3: Write the implementation**

Create `lib/ti/sources/ipwhois.ts`:

```ts
import type { GeoContext, SourceFinding, TiSource } from "../types";
import { errorMessage, getJson, isTimeout } from "../http";

export interface IpWhoIsResponse {
  success: boolean;
  message?: string;
  country?: string;
  country_code?: string;
  region?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  connection?: { asn?: number; org?: string; isp?: string };
}

export function ipWhoIsToGeo(data: IpWhoIsResponse): GeoContext {
  return {
    country: data.country,
    countryCode: data.country_code,
    region: data.region,
    city: data.city,
    lat: data.latitude,
    lon: data.longitude,
    asn: data.connection?.asn ? `AS${data.connection.asn}` : undefined,
    asnOrg: data.connection?.org,
    isp: data.connection?.isp,
  };
}

/** ipwho.is: free geolocation/ASN context (no key). Context only, no risk score. */
export const ipWhoIsSource: TiSource = {
  meta: {
    id: "ipwhois",
    name: "ipwho.is",
    url: "https://ipwho.is",
    category: "context",
    requiresKey: false,
    weight: 0,
  },
  isEnabled: () => true,
  async check(ip, signal): Promise<SourceFinding> {
    try {
      const { data } = await getJson<IpWhoIsResponse>(`https://ipwho.is/${ip}`, signal);
      if (!data || !data.success) {
        return { status: "error", error: data?.message ?? "Lookup failed" };
      }
      const geo = ipWhoIsToGeo(data);
      return {
        status: "ok",
        summary: [data.city, data.region, data.country].filter(Boolean).join(", "),
        geo,
        raw: data,
      };
    } catch (err) {
      return { status: isTimeout(err) ? "timeout" : "error", error: errorMessage(err) };
    }
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- ipwhois`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/sources/ipwhois.ts lib/ti/sources/ipwhois.test.ts
git commit -m "feat(sources): add ipwho.is geo provider"
```

---

### Task 6: RDAP/RIR provider (no key, authoritative country)

**Files:**
- Create: `lib/ti/sources/rdap-ip.ts`
- Test: `lib/ti/sources/rdap-ip.test.ts`

RDAP via the IANA bootstrap endpoint `https://rdap.org/ip/<ip>` (follows redirects to the right RIR). The response has a `country` (ISO code), a `name` (network name), and `entities` for the registrant. We surface allocation country + network name.

- [ ] **Step 1: Write the failing test**

Create `lib/ti/sources/rdap-ip.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { rdapIpToGeo, type RdapIpResponse } from "./rdap-ip";

describe("rdapIpToGeo", () => {
  it("maps allocation country and network name", () => {
    const data: RdapIpResponse = {
      country: "CA",
      name: "SHAW-COMMUNICATIONS",
      startAddress: "24.64.0.0",
    };
    expect(rdapIpToGeo(data)).toEqual({
      countryCode: "CA",
      asnOrg: "SHAW-COMMUNICATIONS",
    });
  });

  it("omits country when absent", () => {
    expect(rdapIpToGeo({ name: "EXAMPLE-NET" })).toEqual({
      asnOrg: "EXAMPLE-NET",
    });
  });
});
```

Note: RDAP returns only an ISO `country` code, not a display name, so `rdapIpToGeo` sets `countryCode` (and `asnOrg` from the network name) but leaves `country` unset — geo-IP providers supply the country *name*. The dedicated `reconcileCountry` helper (Task 4) groups votes by `countryCode` (not name), so RDAP participates fully in the country tiebreak and the winning group's display name is borrowed from whichever geo provider supplied one. RDAP's value therefore serves as both the `countryCode` ground truth and the network-name (`asnOrg`) vote.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- rdap-ip`
Expected: FAIL ("Cannot find module './rdap-ip'").

- [ ] **Step 3: Write the implementation**

Create `lib/ti/sources/rdap-ip.ts`:

```ts
import type { GeoContext, SourceFinding, TiSource } from "../types";
import { errorMessage, getJson, isTimeout } from "../http";

export interface RdapIpResponse {
  country?: string;
  name?: string;
  startAddress?: string;
  endAddress?: string;
  handle?: string;
}

export function rdapIpToGeo(data: RdapIpResponse): GeoContext {
  const geo: GeoContext = {};
  if (data.country) geo.countryCode = data.country;
  if (data.name) geo.asnOrg = data.name;
  return geo;
}

/** RDAP via rdap.org bootstrap: authoritative RIR allocation (no key). Context only. */
export const rdapIpSource: TiSource = {
  meta: {
    id: "rdap-ip",
    name: "RDAP (RIR)",
    url: "https://rdap.org",
    category: "context",
    requiresKey: false,
    weight: 0,
  },
  isEnabled: () => true,
  async check(ip, signal): Promise<SourceFinding> {
    try {
      const { ok, status, data } = await getJson<RdapIpResponse>(
        `https://rdap.org/ip/${ip}`,
        signal,
      );
      if (!ok || !data) {
        return { status: "error", error: `HTTP ${status}` };
      }
      const geo = rdapIpToGeo(data);
      return {
        status: "ok",
        summary: [data.name, data.country].filter(Boolean).join(" · ") || "Allocation found",
        geo,
        details: {
          networkName: data.name,
          allocationCountry: data.country,
          range: [data.startAddress, data.endAddress].filter(Boolean).join(" – "),
        },
        raw: data,
      };
    } catch (err) {
      return { status: isTimeout(err) ? "timeout" : "error", error: errorMessage(err) };
    }
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- rdap-ip`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/sources/rdap-ip.ts lib/ti/sources/rdap-ip.test.ts
git commit -m "feat(sources): add RDAP/RIR authoritative geo provider"
```

---

### Task 7: ipinfo.io provider (key-gated)

**Files:**
- Create: `lib/ti/sources/ipinfo.ts`
- Test: `lib/ti/sources/ipinfo.test.ts`

ipinfo.io `/json` returns `{ city, region, country (ISO code), loc: "lat,lon", org: "AS#### Name", hostname, ... }`. Key via `IPINFO_TOKEN`.

- [ ] **Step 1: Write the failing test**

Create `lib/ti/sources/ipinfo.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ipInfoToGeo, type IpInfoResponse } from "./ipinfo";

describe("ipInfoToGeo", () => {
  it("parses loc and org into GeoContext fields", () => {
    const data: IpInfoResponse = {
      city: "Mountain View",
      region: "California",
      country: "US",
      loc: "37.4056,-122.0775",
      org: "AS15169 Google LLC",
      hostname: "dns.google",
    };
    expect(ipInfoToGeo(data)).toEqual({
      city: "Mountain View",
      region: "California",
      countryCode: "US",
      lat: 37.4056,
      lon: -122.0775,
      asn: "AS15169",
      asnOrg: "Google LLC",
      reverse: "dns.google",
    });
  });

  it("tolerates a missing loc", () => {
    expect(ipInfoToGeo({ country: "US", org: "AS15169 Google LLC" })).toEqual({
      countryCode: "US",
      asn: "AS15169",
      asnOrg: "Google LLC",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ipinfo`
Expected: FAIL ("Cannot find module './ipinfo'").

- [ ] **Step 3: Write the implementation**

Create `lib/ti/sources/ipinfo.ts`:

```ts
import type { GeoContext, SourceFinding, TiSource } from "../types";
import { errorMessage, getJson, isTimeout } from "../http";

export interface IpInfoResponse {
  city?: string;
  region?: string;
  country?: string;
  loc?: string;
  org?: string;
  hostname?: string;
  bogon?: boolean;
}

export function ipInfoToGeo(data: IpInfoResponse): GeoContext {
  const geo: GeoContext = {};
  if (data.city) geo.city = data.city;
  if (data.region) geo.region = data.region;
  if (data.country) geo.countryCode = data.country;
  if (data.hostname) geo.reverse = data.hostname;
  if (data.loc) {
    const [lat, lon] = data.loc.split(",").map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      geo.lat = lat;
      geo.lon = lon;
    }
  }
  if (data.org) {
    const m = data.org.match(/^(AS\d+)\s+(.*)$/);
    if (m) {
      geo.asn = m[1];
      geo.asnOrg = m[2];
    } else {
      geo.asnOrg = data.org;
    }
  }
  return geo;
}

/** ipinfo.io: strong ASN/company + geo (free token via IPINFO_TOKEN). Context only. */
export const ipInfoSource: TiSource = {
  meta: {
    id: "ipinfo",
    name: "ipinfo.io",
    url: "https://ipinfo.io",
    category: "context",
    requiresKey: true,
    weight: 0,
    keyEnv: "IPINFO_TOKEN",
  },
  isEnabled: () => Boolean(process.env.IPINFO_TOKEN),
  async check(ip, signal): Promise<SourceFinding> {
    const token = process.env.IPINFO_TOKEN;
    if (!token) return { status: "skipped" };
    try {
      const { ok, status, data } = await getJson<IpInfoResponse>(
        `https://ipinfo.io/${ip}/json?token=${token}`,
        signal,
      );
      if (!ok || !data || data.bogon) {
        return { status: "error", error: `HTTP ${status}` };
      }
      const geo = ipInfoToGeo(data);
      return {
        status: "ok",
        summary: [data.city, data.region, data.country].filter(Boolean).join(", "),
        geo,
        raw: data,
      };
    } catch (err) {
      return { status: isTimeout(err) ? "timeout" : "error", error: errorMessage(err) };
    }
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- ipinfo`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/sources/ipinfo.ts lib/ti/sources/ipinfo.test.ts
git commit -m "feat(sources): add ipinfo.io geo provider (key-gated)"
```

---

### Task 8: ipgeolocation.io provider (key-gated)

**Files:**
- Create: `lib/ti/sources/ipgeolocation.ts`
- Test: `lib/ti/sources/ipgeolocation.test.ts`

ipgeolocation.io `/ipgeo` returns `{ country_name, country_code2, state_prov, city, latitude (string), longitude (string), isp, organization, asn }`. Key via `IPGEOLOCATION_API_KEY`.

- [ ] **Step 1: Write the failing test**

Create `lib/ti/sources/ipgeolocation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ipGeolocationToGeo, type IpGeolocationResponse } from "./ipgeolocation";

describe("ipGeolocationToGeo", () => {
  it("maps fields and parses string coordinates", () => {
    const data: IpGeolocationResponse = {
      country_name: "United States",
      country_code2: "US",
      state_prov: "California",
      city: "Mountain View",
      latitude: "37.40599",
      longitude: "-122.07840",
      isp: "Google LLC",
      organization: "Google LLC",
      asn: "AS15169",
    };
    expect(ipGeolocationToGeo(data)).toEqual({
      country: "United States",
      countryCode: "US",
      region: "California",
      city: "Mountain View",
      lat: 37.40599,
      lon: -122.0784,
      isp: "Google LLC",
      asnOrg: "Google LLC",
      asn: "AS15169",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ipgeolocation`
Expected: FAIL ("Cannot find module './ipgeolocation'").

- [ ] **Step 3: Write the implementation**

Create `lib/ti/sources/ipgeolocation.ts`:

```ts
import type { GeoContext, SourceFinding, TiSource } from "../types";
import { errorMessage, getJson, isTimeout } from "../http";

export interface IpGeolocationResponse {
  message?: string;
  country_name?: string;
  country_code2?: string;
  state_prov?: string;
  city?: string;
  latitude?: string;
  longitude?: string;
  isp?: string;
  organization?: string;
  asn?: string;
}

export function ipGeolocationToGeo(data: IpGeolocationResponse): GeoContext {
  const geo: GeoContext = {};
  if (data.country_name) geo.country = data.country_name;
  if (data.country_code2) geo.countryCode = data.country_code2;
  if (data.state_prov) geo.region = data.state_prov;
  if (data.city) geo.city = data.city;
  if (data.isp) geo.isp = data.isp;
  if (data.organization) geo.asnOrg = data.organization;
  if (data.asn) geo.asn = data.asn;
  const lat = Number(data.latitude);
  const lon = Number(data.longitude);
  if (Number.isFinite(lat) && data.latitude) geo.lat = lat;
  if (Number.isFinite(lon) && data.longitude) geo.lon = lon;
  return geo;
}

/** ipgeolocation.io: extra geo + ASN vote (key via IPGEOLOCATION_API_KEY). Context only. */
export const ipGeolocationSource: TiSource = {
  meta: {
    id: "ipgeolocation",
    name: "ipgeolocation.io",
    url: "https://ipgeolocation.io",
    category: "context",
    requiresKey: true,
    weight: 0,
    keyEnv: "IPGEOLOCATION_API_KEY",
  },
  isEnabled: () => Boolean(process.env.IPGEOLOCATION_API_KEY),
  async check(ip, signal): Promise<SourceFinding> {
    const key = process.env.IPGEOLOCATION_API_KEY;
    if (!key) return { status: "skipped" };
    try {
      const { ok, status, data } = await getJson<IpGeolocationResponse>(
        `https://api.ipgeolocation.io/ipgeo?apiKey=${key}&ip=${ip}`,
        signal,
      );
      if (!ok || !data || data.message) {
        return { status: "error", error: data?.message ?? `HTTP ${status}` };
      }
      const geo = ipGeolocationToGeo(data);
      return {
        status: "ok",
        summary: [data.city, data.state_prov, data.country_name].filter(Boolean).join(", "),
        geo,
        raw: data,
      };
    } catch (err) {
      return { status: isTimeout(err) ? "timeout" : "error", error: errorMessage(err) };
    }
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- ipgeolocation`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/sources/ipgeolocation.ts lib/ti/sources/ipgeolocation.test.ts
git commit -m "feat(sources): add ipgeolocation.io geo provider (key-gated)"
```

---

### Task 9: Register providers + wire reconciliation into checkIp

**Files:**
- Modify: `lib/ti/registry.ts`
- Modify: `lib/ti/check.ts`

- [ ] **Step 1: Register the four geo providers**

In `lib/ti/registry.ts`, add imports after the existing source imports:

```ts
import { ipWhoIsSource } from "./sources/ipwhois";
import { rdapIpSource } from "./sources/rdap-ip";
import { ipInfoSource } from "./sources/ipinfo";
import { ipGeolocationSource } from "./sources/ipgeolocation";
```

And add them to the `sources` array, right after `ipApiSource` (keep geo/context providers grouped at the top):

```ts
  ipApiSource,
  ipWhoIsSource,
  rdapIpSource,
  ipInfoSource,
  ipGeolocationSource,
```

- [ ] **Step 2: Swap mergeGeo → reconcileGeo in checkIp**

Replace the contents of `lib/ti/check.ts` with:

```ts
import type { CheckResult, GeoContext, GeoResolution, SourceResult } from "./types";
import { sources } from "./registry";
import { aggregateRisk, computeStats } from "./aggregate";
import { runAll } from "./orchestrate";
import { reconcileGeo } from "./geo/reconcile";

/** Flatten a GeoResolution into the legacy GeoContext (winning values only),
 *  so existing consumers (OG image, history, bulk geo) keep working. */
function flattenResolution(
  res: GeoResolution | undefined,
  results: SourceResult[],
): GeoContext | undefined {
  if (!res) return undefined;
  // reverse / fcrdns are not reconciled fields; take them from any source that has them.
  const reverse = results.find((r) => r.geo?.reverse)?.geo?.reverse;
  const fcrdns = results.find((r) => r.geo?.fcrdns)?.geo?.fcrdns;
  return {
    country: res.country?.value,
    countryCode: res.countryCode,
    region: res.region?.value,
    city: res.city?.value,
    lat: res.coordinates?.value.lat,
    lon: res.coordinates?.value.lon,
    asn: res.asn?.value,
    asnOrg: res.asnOrg?.value,
    isp: res.isp?.value,
    reverse,
    fcrdns,
    isHosting: res.flags.isHosting,
    isProxy: res.flags.isProxy,
    isMobile: res.flags.isMobile,
  };
}

export async function checkIp(
  ip: string,
  onSettled?: (result: SourceResult) => void,
): Promise<CheckResult> {
  const results = await runAll(sources, ip, onSettled);
  const { riskScore, verdict } = aggregateRisk(results);
  const geoResolution = reconcileGeo(results);

  return {
    ip,
    checkedAt: new Date().toISOString(),
    riskScore,
    verdict,
    geo: flattenResolution(geoResolution, results),
    geoResolution,
    sources: results,
    stats: computeStats(results),
  };
}
```

- [ ] **Step 3: Run the full unit suite + lint + typecheck**

Run: `npm test && npm run lint && npx tsc --noEmit`
Expected: PASS (existing tests unaffected; `mergeGeo`/`mergeFields` removal from check.ts is fine — `mergeFields` is still used by domain/check.ts).

- [ ] **Step 4: Manual end-to-end check (no-key providers)**

Run: `npm run dev`, then in another shell:
`curl -s localhost:3000/api/check?ip=8.8.8.8 | npx json geoResolution`
Expected: a `geoResolution` object with `country`/`asn` at high confidence (ip-api + ipwho.is + RDAP agree on US / AS15169) and a `providerCount` ≥ 3.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/registry.ts lib/ti/check.ts
git commit -m "feat(ip): reconcile geo across providers with confidence"
```

---

## Phase 2 — DNS enrichment

### Task 10: Shared DoH client

**Files:**
- Create: `lib/ti/dns/doh.ts`

This extracts the DoH plumbing so both the domain source and the IP reverse-dns source share it. No new behavior yet — pure refactor target.

- [ ] **Step 1: Write the DoH client**

Create `lib/ti/dns/doh.ts`:

```ts
import { getJson } from "../http";

export interface DohAnswer {
  name?: string;
  type?: number;
  data?: string;
}

export interface DohResponse {
  Status?: number;
  /** Authenticated Data — set when the resolver validated DNSSEC. */
  AD?: boolean;
  Answer?: DohAnswer[];
}

export type RecordType = "A" | "AAAA" | "MX" | "NS" | "TXT" | "SOA" | "CNAME" | "CAA" | "PTR";

/** DoH JSON resolvers, by id. */
export const RESOLVERS: Record<string, string> = {
  cloudflare: "https://cloudflare-dns.com/dns-query",
  google: "https://dns.google/resolve",
  quad9: "https://dns.quad9.net:5053/dns-query",
};

/** Query one resolver. `dnssec: true` sets the DO bit so the AD flag is meaningful. */
export async function dohQuery(
  resolver: string,
  name: string,
  type: RecordType,
  signal: AbortSignal,
  dnssec = false,
): Promise<DohResponse | null> {
  const url =
    `${resolver}?name=${encodeURIComponent(name)}&type=${type}` +
    (dnssec ? "&do=1" : "");
  const { data } = await getJson<DohResponse>(url, signal, {
    Accept: "application/dns-json",
  });
  return data;
}

/** Flatten answer `data` values, stripping the trailing dot. */
export function answers(res: DohResponse | null): string[] {
  return (res?.Answer ?? [])
    .map((a) => a.data?.replace(/\.$/, ""))
    .filter((d): d is string => Boolean(d));
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/ti/dns/doh.ts
git commit -m "feat(dns): add shared DoH client"
```

---

### Task 11: DNS parsers (pure)

**Files:**
- Create: `lib/ti/dns/parse.ts`
- Test: `lib/ti/dns/parse.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/ti/dns/parse.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  extractDmarc,
  extractSpf,
  normalizeMxHosts,
  resolversAgree,
  dnssecStatus,
} from "./parse";

describe("extractSpf", () => {
  it("finds the SPF record among TXT records", () => {
    expect(extractSpf(['"v=spf1 include:_spf.google.com ~all"', "google-site-verification=x"]))
      .toBe("v=spf1 include:_spf.google.com ~all");
  });
  it("returns undefined when no SPF present", () => {
    expect(extractSpf(["google-site-verification=x"])).toBeUndefined();
  });
});

describe("extractDmarc", () => {
  it("finds the DMARC record and strips quotes", () => {
    expect(extractDmarc(['"v=DMARC1; p=reject; rua=mailto:x@y.com"']))
      .toBe("v=DMARC1; p=reject; rua=mailto:x@y.com");
  });
  it("returns undefined when no DMARC present", () => {
    expect(extractDmarc(['"v=spf1 ~all"'])).toBeUndefined();
  });
});

describe("normalizeMxHosts", () => {
  it("strips the priority prefix and keeps the host", () => {
    expect(normalizeMxHosts(["10 mail.example.com", "20 alt.example.com"]))
      .toEqual(["mail.example.com", "alt.example.com"]);
  });
});

describe("resolversAgree", () => {
  it("is true when answer sets match regardless of order", () => {
    expect(resolversAgree([["1.1.1.1", "2.2.2.2"], ["2.2.2.2", "1.1.1.1"]])).toBe(true);
  });
  it("is false when answer sets differ", () => {
    expect(resolversAgree([["1.1.1.1"], ["9.9.9.9"]])).toBe(false);
  });
  it("ignores resolvers that returned nothing", () => {
    expect(resolversAgree([["1.1.1.1"], []])).toBe(true);
  });
});

describe("dnssecStatus", () => {
  it("signed when any resolver set AD", () => {
    expect(dnssecStatus([{ AD: true }, { AD: false }])).toBe("signed");
  });
  it("unsigned when all resolvers answered without AD", () => {
    expect(dnssecStatus([{ AD: false }, { Status: 0 }])).toBe("unsigned");
  });
  it("unknown when no resolver responded", () => {
    expect(dnssecStatus([null, null])).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- dns/parse`
Expected: FAIL ("Cannot find module './parse'").

- [ ] **Step 3: Write the implementation**

Create `lib/ti/dns/parse.ts`:

```ts
import type { DohResponse } from "./doh";

/** Strip surrounding quotes and concatenate split TXT chunks. */
function cleanTxt(txt: string): string {
  return txt.replace(/^"|"$/g, "").replace(/"\s+"/g, "");
}

export function extractSpf(txt: string[]): string | undefined {
  const hit = txt.map(cleanTxt).find((t) => t.toLowerCase().startsWith("v=spf1"));
  return hit;
}

export function extractDmarc(txt: string[]): string | undefined {
  const hit = txt.map(cleanTxt).find((t) => t.toLowerCase().startsWith("v=dmarc1"));
  return hit;
}

/** "10 mail.example.com" -> "mail.example.com". */
export function normalizeMxHosts(mx: string[]): string[] {
  return mx.map((m) => m.split(/\s+/).pop() ?? m);
}

/** True when every non-empty answer set is identical (order-insensitive). */
export function resolversAgree(answerSets: string[][]): boolean {
  const nonEmpty = answerSets.filter((s) => s.length > 0);
  if (nonEmpty.length < 2) return true;
  const canon = (s: string[]) => [...s].sort().join(",");
  const first = canon(nonEmpty[0]);
  return nonEmpty.every((s) => canon(s) === first);
}

export function dnssecStatus(
  responses: (DohResponse | null)[],
): "signed" | "unsigned" | "unknown" {
  const answered = responses.filter((r): r is DohResponse => r != null);
  if (answered.length === 0) return "unknown";
  return answered.some((r) => r.AD === true) ? "signed" : "unsigned";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- dns/parse`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/dns/parse.ts lib/ti/dns/parse.test.ts
git commit -m "feat(dns): add pure DNS record parsers"
```

---

### Task 12: FCrDNS helper (pure, injectable query)

**Files:**
- Create: `lib/ti/dns/fcrdns.ts`
- Test: `lib/ti/dns/fcrdns.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/ti/dns/fcrdns.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { reversePointer, verifyFcrdns } from "./fcrdns";

describe("reversePointer", () => {
  it("builds the in-addr.arpa name for IPv4", () => {
    expect(reversePointer("8.8.4.4")).toBe("4.4.8.8.in-addr.arpa");
  });
});

describe("verifyFcrdns", () => {
  it("verified when forward resolution includes the original IP", async () => {
    const res = await verifyFcrdns(
      "8.8.4.4",
      async (name, type) =>
        type === "PTR" ? ["dns.google"] : name === "dns.google" ? ["8.8.4.4", "8.8.8.8"] : [],
    );
    expect(res).toEqual({ hostname: "dns.google", verified: true });
  });

  it("unverified when forward resolution does not include the IP", async () => {
    const res = await verifyFcrdns(
      "1.2.3.4",
      async (_name, type) => (type === "PTR" ? ["evil.example.com"] : ["9.9.9.9"]),
    );
    expect(res).toEqual({ hostname: "evil.example.com", verified: false });
  });

  it("null when there is no PTR", async () => {
    const res = await verifyFcrdns("1.2.3.4", async () => []);
    expect(res).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- fcrdns`
Expected: FAIL ("Cannot find module './fcrdns'").

- [ ] **Step 3: Write the implementation**

Create `lib/ti/dns/fcrdns.ts`:

```ts
import type { FcrdnsResult } from "../types";

/** Build the reverse-DNS PTR name for an IPv4 address. */
export function reversePointer(ip: string): string {
  return `${ip.split(".").reverse().join(".")}.in-addr.arpa`;
}

/** A minimal name->records resolver, injected so this stays pure/testable. */
export type ResolveFn = (name: string, type: "PTR" | "A") => Promise<string[]>;

/**
 * Forward-confirmed reverse DNS: PTR the IP, forward-resolve the hostname, and
 * confirm it points back. Returns null when the IP has no PTR.
 */
export async function verifyFcrdns(
  ip: string,
  resolve: ResolveFn,
): Promise<FcrdnsResult | null> {
  const ptr = await resolve(reversePointer(ip), "PTR");
  const hostname = ptr[0];
  if (!hostname) return null;
  const forward = await resolve(hostname, "A");
  return { hostname, verified: forward.includes(ip) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- fcrdns`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/dns/fcrdns.ts lib/ti/dns/fcrdns.test.ts
git commit -m "feat(dns): add forward-confirmed reverse DNS helper"
```

---

### Task 13: reverse-dns IP source

**Files:**
- Create: `lib/ti/sources/reverse-dns.ts`
- Modify: `lib/ti/registry.ts`

- [ ] **Step 1: Write the source**

Create `lib/ti/sources/reverse-dns.ts`:

```ts
import type { SourceFinding, TiSource } from "../types";
import { errorMessage, isTimeout } from "../http";
import { RESOLVERS, answers, dohQuery, type RecordType } from "../dns/doh";
import { verifyFcrdns } from "../dns/fcrdns";

/** FCrDNS for an IP via Cloudflare DoH (no key). Context only, no risk score. */
export const reverseDnsSource: TiSource = {
  meta: {
    id: "reverse-dns",
    name: "Reverse DNS (FCrDNS)",
    url: "https://cloudflare-dns.com",
    category: "context",
    requiresKey: false,
    weight: 0,
  },
  isEnabled: () => true,
  async check(ip, signal): Promise<SourceFinding> {
    try {
      const resolve = async (name: string, type: "PTR" | "A") =>
        answers(await dohQuery(RESOLVERS.cloudflare, name, type as RecordType, signal));

      const fcrdns = await verifyFcrdns(ip, resolve);
      if (!fcrdns) {
        return { status: "ok", summary: "No PTR record" };
      }
      return {
        status: "ok",
        summary: fcrdns.verified
          ? `PTR ${fcrdns.hostname} (forward-confirmed)`
          : `PTR ${fcrdns.hostname} (unconfirmed — forward record does not match)`,
        details: { hostname: fcrdns.hostname, forwardConfirmed: fcrdns.verified },
        geo: { reverse: fcrdns.hostname, fcrdns },
      };
    } catch (err) {
      return { status: isTimeout(err) ? "timeout" : "error", error: errorMessage(err) };
    }
  },
};
```

- [ ] **Step 2: Register it**

In `lib/ti/registry.ts`, add the import:

```ts
import { reverseDnsSource } from "./sources/reverse-dns";
```

And add `reverseDnsSource` to the `sources` array, right after `ipGeolocationSource`.

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 4: Manual end-to-end check**

Run: `npm run dev`, then:
`curl -s localhost:3000/api/check?ip=8.8.4.4 | npx json geo.fcrdns`
Expected: `{ "hostname": "dns.google", "verified": true }`.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/sources/reverse-dns.ts lib/ti/registry.ts
git commit -m "feat(sources): add FCrDNS reverse-dns provider"
```

---

### Task 14: Enrich the domain DNS source

**Files:**
- Modify: `lib/ti/domain/sources/dns.ts`

- [ ] **Step 1: Rewrite the source to use the shared client + parsers + enrichments**

Replace the contents of `lib/ti/domain/sources/dns.ts` with:

```ts
import type { SourceFinding, TiSource } from "../../types";
import { errorMessage, isTimeout } from "../../http";
import { RESOLVERS, answers, dohQuery, type DohResponse } from "../../dns/doh";
import {
  dnssecStatus,
  extractDmarc,
  extractSpf,
  normalizeMxHosts,
  resolversAgree,
} from "../../dns/parse";

const CF = RESOLVERS.cloudflare;

/** PTR each resolved IPv4, returning the first hostname per IP. */
async function ptrAll(ips: string[], signal: AbortSignal): Promise<string[]> {
  const names = await Promise.all(
    ips.map(async (ip) => {
      const ptr = `${ip.split(".").reverse().join(".")}.in-addr.arpa`;
      return answers(await dohQuery(CF, ptr, "PTR", signal))[0];
    }),
  );
  return names.filter((n): n is string => Boolean(n));
}

/** DNS-over-HTTPS resolution with multi-resolver agreement, records, PTR, DNSSEC. */
export const dnsSource: TiSource = {
  meta: {
    id: "dns",
    name: "DNS Records",
    url: "https://cloudflare-dns.com",
    category: "context",
    requiresKey: false,
    weight: 0,
  },
  isEnabled: () => true,
  async check(domain, signal): Promise<SourceFinding> {
    try {
      // A across three resolvers (DNSSEC DO bit set) for an agreement check.
      const [aCf, aGoogle, aQuad9] = await Promise.all([
        dohQuery(CF, domain, "A", signal, true),
        dohQuery(RESOLVERS.google, domain, "A", signal, true),
        dohQuery(RESOLVERS.quad9, domain, "A", signal, true),
      ]);

      // Everything else from Cloudflare only, in parallel.
      const [aaaa, mx, ns, txt, soa, cname, caa, dmarcTxt] = await Promise.all([
        dohQuery(CF, domain, "AAAA", signal),
        dohQuery(CF, domain, "MX", signal),
        dohQuery(CF, domain, "NS", signal),
        dohQuery(CF, domain, "TXT", signal),
        dohQuery(CF, domain, "SOA", signal),
        dohQuery(CF, domain, "CNAME", signal),
        dohQuery(CF, domain, "CAA", signal),
        dohQuery(CF, `_dmarc.${domain}`, "TXT", signal),
      ]);

      const resolvedIps = answers(aCf);
      const ipv6 = answers(aaaa);
      const mxHosts = normalizeMxHosts(answers(mx));
      const nsHosts = answers(ns);
      const txtRecords = answers(txt);
      const dmarcRecords = answers(dmarcTxt);
      const reverse = await ptrAll(resolvedIps, signal);

      const aSets = [answers(aCf), answers(aGoogle), answers(aQuad9)];
      const resolverAgreement = resolversAgree(aSets);
      const dnssec = dnssecStatus([aCf, aGoogle, aQuad9] as (DohResponse | null)[]);

      const resolves = resolvedIps.length > 0 || ipv6.length > 0;
      const nxdomain = aCf?.Status === 3;

      let summary: string;
      if (resolves) {
        const first = resolvedIps[0] ?? ipv6[0];
        const hostCount = resolvedIps.length + ipv6.length;
        const extra =
          hostCount > 1
            ? ` (+${hostCount - 1} more host${hostCount - 1 > 1 ? "s" : ""})`
            : "";
        const mail =
          mxHosts.length > 0
            ? ` Mail routed via ${mxHosts[0]}.`
            : " No MX present; not mail-bearing.";
        const disagree = resolverAgreement ? "" : " Resolvers disagree on the A record.";
        summary = `Live infrastructure at check time. Apex resolves to ${first}${extra}.${mail}${disagree}`;
      } else if (nxdomain) {
        summary =
          "Apex returns NXDOMAIN. No live infrastructure (parked, expired, or sinkholed); not currently actionable as a host.";
      } else {
        summary =
          "DNS zone present but no A/AAAA at the apex; domain not serving content directly at time of check.";
      }

      return {
        status: "ok",
        summary,
        details: {
          resolvesTo: resolvedIps,
          ipv6,
          mx: mxHosts,
          nameservers: nsHosts,
          reverse,
          spf: extractSpf(txtRecords),
          dmarc: extractDmarc(dmarcRecords),
          caa: answers(caa),
          dnssec,
          resolverAgreement,
          nxdomain,
        },
        domainContext: {
          resolvedIps,
          ipv6,
          mx: mxHosts,
          nameservers: nsHosts,
          reverse,
          txt: txtRecords,
          spf: extractSpf(txtRecords),
          dmarc: extractDmarc(dmarcRecords),
          caa: answers(caa),
          soa: answers(soa)[0],
          cname: answers(cname),
          dnssec,
          resolverAgreement,
        },
        raw: { aCf, aGoogle, aQuad9, aaaa, mx, ns, txt, soa, cname, caa, dmarcTxt },
      };
    } catch (err) {
      return { status: isTimeout(err) ? "timeout" : "error", error: errorMessage(err) };
    }
  },
};
```

- [ ] **Step 2: Run unit suite + lint + typecheck**

Run: `npm test && npm run lint && npx tsc --noEmit`
Expected: PASS (parsers covered by Task 11; this source is exercised manually).

- [ ] **Step 3: Manual end-to-end check**

Run: `npm run dev`, then:
`curl -s localhost:3000/api/check-domain?domain=google.com | npx json context.dnssec context.spf context.resolverAgreement`
Expected: `dnssec` present (`signed`/`unsigned`), an `spf` string, and `resolverAgreement: true` for a stable domain.

- [ ] **Step 4: Commit**

```bash
git add lib/ti/domain/sources/dns.ts
git commit -m "feat(dns): enrich domain DNS with records, PTR, DNSSEC, resolver agreement"
```

---

## Phase 3 — UI surfacing

### Task 15: Confidence UI primitives

**Files:**
- Create: `components/CheckResults/confidence.tsx`

First inspect the existing primitives so the new components match house style:

- [ ] **Step 1: Read the existing primitives**

Run: `sed -n '1,80p' components/CheckResults/primitives.tsx`
Note the exported helpers (badges, pivots) and the `cn`/class conventions in use.

- [ ] **Step 2: Write the confidence components**

Create `components/CheckResults/confidence.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { Confidence, ResolvedField } from "@/lib/ti/types";

const TONE: Record<Confidence, string> = {
  high: "border-emerald-600/40 text-emerald-700 dark:text-emerald-400",
  medium: "border-amber-600/40 text-amber-700 dark:text-amber-400",
  low: "border-foreground/25 text-muted-foreground",
};

const LABEL: Record<Confidence, string> = {
  high: "high confidence",
  medium: "medium confidence",
  low: "low confidence",
};

/** Small inline chip indicating how trustworthy a reconciled field is. */
export function ConfidenceChip({ confidence }: { confidence: Confidence }) {
  return (
    <span
      title={LABEL[confidence]}
      className={`ml-2 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${TONE[confidence]}`}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {confidence}
    </span>
  );
}

/** Tappable disclosure of which providers disagreed on a field. */
export function Disagreement<T>({ field }: { field: ResolvedField<T> }) {
  const [open, setOpen] = useState(false);
  const alts = field.alternatives;
  if (!alts || alts.length === 0) return null;
  const dissenters = alts.reduce((n, a) => n + a.sources.length, 0);

  return (
    <span className="ml-2 text-[11px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="underline decoration-dotted underline-offset-2 text-muted-foreground hover:text-foreground"
      >
        {field.sources.length} agree · {dissenters} disagree
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5 text-muted-foreground">
          {alts.map((a, i) => (
            <li key={i}>
              {String(a.value)} — {a.sources.join(", ")}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/CheckResults/confidence.tsx
git commit -m "feat(ui): add confidence chip + disagreement disclosure"
```

---

### Task 16: Wire confidence into the IP geo card

**Files:**
- Modify: `components/CheckResults/profile.tsx`

The card currently reads `result.geo`. We layer in `result.geoResolution` for confidence chips, disagreement, the provider count, and the FCrDNS badge — falling back gracefully when `geoResolution` is absent (e.g. cached older results).

- [ ] **Step 1: Read the current card markup**

Run: `sed -n '50,260p' components/CheckResults/profile.tsx`
Identify the JSX nodes that render country (around the `geo?.country` block), city/region (`cityRegion`), the ASN block, and the reverse-DNS row.

- [ ] **Step 2: Import the confidence components and pull the resolution**

At the top of `components/CheckResults/profile.tsx`, add:

```tsx
import { ConfidenceChip, Disagreement } from "./confidence";
```

Inside the component, alongside `const geo = result.geo;`, add:

```tsx
const res = result.geoResolution;
```

- [ ] **Step 3: Add the chip + disagreement to the country heading**

Find the country heading node (renders `{geo?.country ?? "Parts unknown"}` near line 161). Immediately after the country/code span, insert:

```tsx
{res?.country && (
  <>
    <ConfidenceChip confidence={res.country.confidence} />
    <Disagreement field={res.country} />
  </>
)}
```

- [ ] **Step 4: Add the chip to the city/region line**

Find the `{cityRegion && (...)}` block (near line 168) and add, right after the city/region text:

```tsx
{res?.city && <ConfidenceChip confidence={res.city.confidence} />}
```

- [ ] **Step 5: Add the chip + disagreement to the ASN block**

Find the `{geo!.asn && (...)}` node (near line 210) and add after the ASN value:

```tsx
{res?.asn && (
  <>
    <ConfidenceChip confidence={res.asn.confidence} />
    <Disagreement field={res.asn} />
  </>
)}
```

- [ ] **Step 6: Add the FCrDNS badge to the reverse row**

Find the reverse-DNS row (`{geo!.reverse && (...)}` near line 232). After the `<Pivot value={geo!.reverse} />`, add:

```tsx
{geo?.fcrdns && (
  <span
    className={`ml-2 rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
      geo.fcrdns.verified
        ? "border-emerald-600/40 text-emerald-700 dark:text-emerald-400"
        : "border-red-600/40 text-red-700 dark:text-red-400"
    }`}
    title={geo.fcrdns.verified ? "Forward-confirmed reverse DNS" : "PTR not forward-confirmed"}
  >
    {geo.fcrdns.verified ? "FCrDNS ✓" : "FCrDNS ✗"}
  </span>
)}
```

- [ ] **Step 7: Add the "based on N providers" line**

At the end of the geo card body (after the ASN/details block closes, before the card's closing tag), add:

```tsx
{res && res.providerCount > 0 && (
  <p className="relative mt-3 text-[11px] text-muted-foreground">
    Based on {res.providerCount} provider{res.providerCount > 1 ? "s" : ""}.
  </p>
)}
```

- [ ] **Step 8: Typecheck + lint + tests**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: PASS.

- [ ] **Step 9: Visual check**

Run: `npm run dev`, then `node scripts/shot.mjs` against `/check/8.8.8.8` (adjust the script's URL/arg as needed).
Expected: country/city/ASN show confidence chips; reverse-DNS shows an FCrDNS badge; a "Based on N providers" line appears. If you cannot run the browser, say so explicitly.

- [ ] **Step 10: Commit**

```bash
git add components/CheckResults/profile.tsx
git commit -m "feat(ui): surface geo confidence + FCrDNS on the IP profile card"
```

---

### Task 17: Surface DNSSEC + resolver agreement + new records in the domain view

**Files:**
- Modify: the domain DNS view component

The domain result UI renders `context` (a `DomainContext`). Locate the component first, then add the badges/records.

- [ ] **Step 1: Find the domain DNS view component**

Run: `grep -rln "domainContext\|context\.\(resolvedIps\|nameservers\|mx\)\|nameservers" components/`
Open the component that renders the domain `context` (the DNS/records card). Note how `context.resolvedIps` / `context.mx` / `context.nameservers` are currently rendered so the new rows match.

- [ ] **Step 2: Add a DNSSEC + resolver-agreement badge row**

In that component, where the DNS card header/records render, add (using the same `context` variable the file already uses):

```tsx
<div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wide">
  {context.dnssec && context.dnssec !== "unknown" && (
    <span
      className={`rounded-full border px-1.5 py-0.5 ${
        context.dnssec === "signed"
          ? "border-emerald-600/40 text-emerald-700 dark:text-emerald-400"
          : "border-foreground/25 text-muted-foreground"
      }`}
    >
      DNSSEC {context.dnssec}
    </span>
  )}
  {context.resolverAgreement === false && (
    <span className="rounded-full border border-red-600/40 px-1.5 py-0.5 text-red-700 dark:text-red-400">
      Resolvers disagree
    </span>
  )}
</div>
```

- [ ] **Step 3: Render the new records (SPF / DMARC / CAA / PTR)**

Below the existing records list, following the same row markup the file uses for `mx`/`nameservers`, add rows guarded by presence:

```tsx
{context.spf && <DnsRow label="SPF" value={context.spf} />}
{context.dmarc && <DnsRow label="DMARC" value={context.dmarc} />}
{context.caa && context.caa.length > 0 && <DnsRow label="CAA" value={context.caa.join(", ")} />}
{context.reverse && context.reverse.length > 0 && (
  <DnsRow label="PTR" value={context.reverse.join(", ")} />
)}
```

If the file has no reusable row component, inline the same JSX the existing rows use (label + value) instead of `DnsRow` — match the surrounding markup exactly rather than introducing a new component.

- [ ] **Step 4: Typecheck + lint + tests**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: PASS.

- [ ] **Step 5: Visual check**

Run: `npm run dev`, then load `/check/google.com`.
Expected: a DNSSEC badge, SPF/DMARC/CAA/PTR rows when present, and a "Resolvers disagree" badge only when applicable. If you cannot run the browser, say so explicitly.

- [ ] **Step 6: Commit**

```bash
git add components/
git commit -m "feat(ui): surface DNSSEC, resolver agreement, and new DNS records"
```

---

### Task 18: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite**

Run: `npm test && npm run lint && npx tsc --noEmit`
Expected: all PASS.

- [ ] **Step 2: End-to-end smoke (no-key path)**

Run: `npm run dev`, then exercise:
- `curl -s localhost:3000/api/check?ip=8.8.8.8 | npx json geoResolution.country geoResolution.providerCount`
- `curl -s localhost:3000/api/check?ip=8.8.4.4 | npx json geo.fcrdns`
- `curl -s localhost:3000/api/check-domain?domain=google.com | npx json context.dnssec context.resolverAgreement`

Expected: reconciled country with high confidence and providerCount ≥ 3; a verified FCrDNS for 8.8.4.4; DNSSEC + resolver agreement present for google.com.

- [ ] **Step 3: Confirm graceful degradation without keys**

With `IPINFO_TOKEN` / `IPGEOLOCATION_API_KEY` unset, confirm those two sources report `skipped` (not `error`) and reconciliation still produces a result from the no-key providers.

Run: `curl -s localhost:3000/api/check?ip=8.8.8.8 | npx json sources`
Expected: `ipinfo` and `ipgeolocation` show `status: "skipped"`; `ip-api`, `ipwhois`, `rdap-ip`, `reverse-dns` show `ok`.

- [ ] **Step 4: Update docs if needed**

If the README enumerates the source list, add the four new geo providers + reverse-dns, noting which require keys (`IPINFO_TOKEN`, `IPGEOLOCATION_API_KEY`). Commit any doc change:

```bash
git add README.md
git commit -m "docs: list new geo/DNS accuracy sources"
```

---

## Self-Review Notes

- **Spec coverage:** multi-provider geo (Tasks 5–8), reconciliation + confidence (Tasks 3–4), RDAP country authority (Tasks 6, 4), DNS records + SPF/DMARC/CAA/SOA/CNAME (Tasks 11, 14), multi-resolver agreement (Tasks 11, 14), DNSSEC (Tasks 11, 14), PTR (Task 14), FCrDNS (Tasks 12–13), UI confidence chips/disagreement/FCrDNS/DNSSEC/resolver badges (Tasks 15–17), graceful no-key degradation (Task 18). All spec sections map to tasks.
- **Type consistency:** `ResolvedField<T>`, `GeoResolution`, `GeoFlags`, `FcrdnsResult`, `Confidence` defined in Task 1 and used identically through Tasks 3–4, 12–13, 15–16. `DohResponse`/`RecordType` defined in Task 10 and consumed in Tasks 11, 13, 14. Provider `id`s (`ipwhois`, `rdap-ip`, `ipinfo`, `ipgeolocation`, `reverse-dns`) are consistent between adapters, registry, and the `AUTHORITY` map.
- **City low-confidence display:** the spec's "show city even at low confidence" is satisfied — the city value always renders; the chip merely flags it (Task 16 Step 4).
