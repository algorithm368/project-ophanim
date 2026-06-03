# Bulk Geolocation Accuracy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile multiple geo providers per IP in the bulk path (reusing the single-IP `reconcileGeo` logic), with adaptive RDAP country authority and per-IP confidence surfaced in the bulk UI.

**Architecture:** Extract a pure `reconcileGeoInputs` core from the existing `reconcileGeo`. `bulkGeolocate` becomes a small orchestrator: ip-api `/batch` + ipinfo `/batch` (if token) → transpose into per-IP inputs → adaptive RDAP for uncertain IPs (capped/concurrency-limited) → `reconcileGeoInputs` per IP. `GeoRow` gains a `resolution` field; the UI shows a confidence chip and reads reconciled country.

**Tech Stack:** TypeScript, Next.js, Vitest (colocated pure unit tests, no network), existing `lib/ti` source/http helpers.

---

## File Structure

- `lib/ti/geo/reconcile.ts` — extract `reconcileGeoInputs(inputs)`, export `GeoInput`, add `flattenResolution`. (+ `reconcile.test.ts`)
- `lib/ti/sources/ipinfo.ts` — add `mapIpInfoBatch` (pure) + `bulkIpInfo` (network). (+ `ipinfo.test.ts`)
- `lib/ti/geo/bulk.ts` — NEW: `ProviderContexts`, `transposeByIp`, `selectUncertainIps`, `fetchRdapCountries`, env knobs. (+ `bulk.test.ts`)
- `lib/ti/geo.ts` — `GeoRow.resolution`; rewrite `bulkGeolocate` orchestrator.
- `components/BulkGeoResults.tsx` — confidence chip on Country cell; reconciled country in copy summary + same-country callout.

---

## Task 1: Extract `reconcileGeoInputs` core + `flattenResolution`

**Files:**
- Modify: `lib/ti/geo/reconcile.ts`
- Test: `lib/ti/geo/reconcile.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `lib/ti/geo/reconcile.test.ts`:

```ts
import { flattenResolution, reconcileGeoInputs } from "./reconcile";
import type { GeoContext } from "../types";

describe("reconcileGeoInputs — refactor-safety", () => {
  it("matches reconcileGeo on the same data", () => {
    const results = [
      r("a", { city: "Berlin", countryCode: "DE" }),
      r("b", { city: "Berlin", countryCode: "DE" }),
    ];
    const viaResults = reconcileGeo(results);
    const viaInputs = reconcileGeoInputs([
      { id: "a", geo: { city: "Berlin", countryCode: "DE" } },
      { id: "b", geo: { city: "Berlin", countryCode: "DE" } },
    ]);
    expect(viaInputs).toEqual(viaResults);
  });

  it("returns undefined on empty inputs", () => {
    expect(reconcileGeoInputs([])).toBeUndefined();
  });
});

describe("flattenResolution", () => {
  it("overlays reconciled winners onto a base GeoContext", () => {
    const res = reconcileGeoInputs([
      { id: "a", geo: { countryCode: "US", country: "United States", isp: "X" } },
      { id: "b", geo: { countryCode: "US", country: "United States" } },
    ])!;
    const base: GeoContext = { org: "Acme", countryCode: "ZZ" };
    const geo = flattenResolution(res, base);
    expect(geo.countryCode).toBe("US");      // reconciled winner overrides base
    expect(geo.org).toBe("Acme");            // base-only field preserved
  });

  it("OR's flags from the resolution", () => {
    const res = reconcileGeoInputs([
      { id: "a", geo: { countryCode: "US", isProxy: true } },
      { id: "b", geo: { countryCode: "US" } },
    ])!;
    expect(flattenResolution(res).isProxy).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ti/geo/reconcile.test.ts`
Expected: FAIL — `reconcileGeoInputs`/`flattenResolution` are not exported.

- [ ] **Step 3: Implement the refactor**

In `lib/ti/geo/reconcile.ts`, change the local `interface GeoInput` to an export, and replace the `reconcileGeo` function at the bottom with the split below. Add `GeoResolution` is already imported; ensure `GeoContext` import remains.

Change:
```ts
interface GeoInput {
  id: string;
  geo: GeoContext;
}
```
to:
```ts
export interface GeoInput {
  id: string;
  geo: GeoContext;
}
```

Replace the existing `export function reconcileGeo(...) { ... }` block with:
```ts
/** Pure reconciliation core: votes over already-extracted provider inputs. */
export function reconcileGeoInputs(
  inputs: GeoInput[],
): GeoResolution | undefined {
  if (inputs.length === 0) return undefined;

  const country = reconcileCountry(inputs);

  return {
    country: country.field,
    countryCode: country.code,
    region: tally(inputs, "region", normalizeKey),
    city: tally(inputs, "city", normalizeKey),
    asn: tally(inputs, "asn", canonicalAsn),
    asnOrg: tally(inputs, "asnOrg", normalizeKey),
    isp: tally(inputs, "isp", normalizeKey),
    coordinates: reconcileCoordinates(inputs),
    flags: reconcileFlags(inputs),
    providerCount: inputs.length,
  };
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

/** Overlay reconciled winning values onto a base GeoContext (compatibility
 *  view). Base-only fields (e.g. org, ip-api flags) are preserved. */
export function flattenResolution(
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
  if (res.flags.isHosting) geo.isHosting = true;
  if (res.flags.isProxy) geo.isProxy = true;
  if (res.flags.isMobile) geo.isMobile = true;
  return geo;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/ti/geo/reconcile.test.ts`
Expected: PASS (all existing reconcile tests + the new ones).

- [ ] **Step 5: Commit**

```bash
git add lib/ti/geo/reconcile.ts lib/ti/geo/reconcile.test.ts
git commit -m "refactor(geo): extract reconcileGeoInputs core + flattenResolution"
```

---

## Task 2: ipinfo batch helper

**Files:**
- Modify: `lib/ti/sources/ipinfo.ts`
- Test: `lib/ti/sources/ipinfo.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `lib/ti/sources/ipinfo.test.ts`:

```ts
import { mapIpInfoBatch } from "./ipinfo";

describe("mapIpInfoBatch", () => {
  it("maps object entries by IP and skips missing/bogon/string entries", () => {
    const out = mapIpInfoBatch(["8.8.8.8", "1.1.1.1", "10.0.0.1", "9.9.9.9"], {
      "8.8.8.8": { city: "Mountain View", country: "US", org: "AS15169 Google LLC" },
      "1.1.1.1": "1.1.1.1", // ipinfo can echo a string for some entries
      "10.0.0.1": { bogon: true },
      // 9.9.9.9 absent entirely
    });
    expect(out.get("8.8.8.8")).toEqual({
      city: "Mountain View",
      countryCode: "US",
      asn: "AS15169",
      asnOrg: "Google LLC",
    });
    expect(out.has("1.1.1.1")).toBe(false);
    expect(out.has("10.0.0.1")).toBe(false);
    expect(out.has("9.9.9.9")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ti/sources/ipinfo.test.ts`
Expected: FAIL — `mapIpInfoBatch` not exported.

- [ ] **Step 3: Implement the helpers**

In `lib/ti/sources/ipinfo.ts`, update the http import to add `postJson`:
```ts
import { errorMessage, getJson, isTimeout, postJson } from "../http";
```

Add after `ipInfoToGeo`:
```ts
/** Pure: shape an ipinfo /batch response (ip -> entry) into ip -> GeoContext.
 *  Non-object entries (string echoes), bogons, and missing IPs are omitted. */
export function mapIpInfoBatch(
  ips: string[],
  data: Record<string, IpInfoResponse | string>,
): Map<string, GeoContext> {
  const out = new Map<string, GeoContext>();
  for (const ip of ips) {
    const entry = data[ip];
    if (entry && typeof entry === "object" && !entry.bogon) {
      out.set(ip, ipInfoToGeo(entry));
    }
  }
  return out;
}

/** Geolocate many IPs in one ipinfo /batch call. Empty map when no token or on
 *  any failure — the caller treats that as "ipinfo did not vote". */
export async function bulkIpInfo(
  ips: string[],
  signal: AbortSignal,
): Promise<Map<string, GeoContext>> {
  const token = process.env.IPINFO_TOKEN;
  if (!token || ips.length === 0) return new Map();
  try {
    const { ok, data } = await postJson<Record<string, IpInfoResponse | string>>(
      `https://ipinfo.io/batch?token=${token}`,
      signal,
      ips,
    );
    if (!ok || !data) return new Map();
    return mapIpInfoBatch(ips, data);
  } catch {
    return new Map();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ti/sources/ipinfo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/sources/ipinfo.ts lib/ti/sources/ipinfo.test.ts
git commit -m "feat(geo): add ipinfo /batch helper for bulk lookups"
```

---

## Task 3: Bulk pure helpers — transpose + uncertain selection

**Files:**
- Create: `lib/ti/geo/bulk.ts`
- Test: `lib/ti/geo/bulk.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/ti/geo/bulk.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { selectUncertainIps, transposeByIp } from "./bulk";

describe("transposeByIp", () => {
  it("collects each provider's GeoContext per IP, skipping gaps", () => {
    const perIp = transposeByIp(
      ["1.1.1.1", "8.8.8.8"],
      [
        { id: "ip-api", byIp: new Map([["1.1.1.1", { countryCode: "US" }], ["8.8.8.8", { countryCode: "US" }]]) },
        { id: "ipinfo", byIp: new Map([["1.1.1.1", { countryCode: "AU" }]]) },
      ],
    );
    expect(perIp.get("1.1.1.1")).toEqual([
      { id: "ip-api", geo: { countryCode: "US" } },
      { id: "ipinfo", geo: { countryCode: "AU" } },
    ]);
    expect(perIp.get("8.8.8.8")).toEqual([{ id: "ip-api", geo: { countryCode: "US" } }]);
  });
});

describe("selectUncertainIps", () => {
  it("flags disagreements and single-voter IPs, skips confident agreement", () => {
    const perIp = new Map([
      // disagreement (US vs AU)
      ["d", [{ id: "a", geo: { countryCode: "US" } }, { id: "b", geo: { countryCode: "AU" } }]],
      // single voter
      ["s", [{ id: "a", geo: { countryCode: "US" } }]],
      // confident: 2 voters agree -> NOT uncertain
      ["c", [{ id: "a", geo: { countryCode: "US" } }, { id: "b", geo: { countryCode: "US" } }]],
      // zero country voters -> single (uncertain)
      ["z", [{ id: "a", geo: { city: "Nowhere" } }]],
    ]);
    const picked = selectUncertainIps(perIp, Infinity);
    expect(picked).toContain("d");
    expect(picked).toContain("s");
    expect(picked).toContain("z");
    expect(picked).not.toContain("c");
    // disagreements come first
    expect(picked[0]).toBe("d");
  });

  it("enforces the max ceiling", () => {
    const perIp = new Map([
      ["a", [{ id: "x", geo: { countryCode: "US" } }]],
      ["b", [{ id: "x", geo: { countryCode: "US" } }]],
      ["c", [{ id: "x", geo: { countryCode: "US" } }]],
    ]);
    expect(selectUncertainIps(perIp, 2)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ti/geo/bulk.test.ts`
Expected: FAIL — `./bulk` does not exist.

- [ ] **Step 3: Implement the pure helpers**

Create `lib/ti/geo/bulk.ts`:

```ts
import type { GeoContext } from "../types";
import { getJson } from "../http";
import { type RdapIpResponse, rdapIpToGeo } from "../sources/rdap-ip";
import { normalizeKey } from "./geokit";
import type { GeoInput } from "./reconcile";

/** A provider's geo answers keyed by IP, ready to transpose. */
export interface ProviderContexts {
  id: string;
  byIp: Map<string, GeoContext>;
}

/** Build per-IP reconciliation inputs from each provider's answers. */
export function transposeByIp(
  ips: string[],
  providers: ProviderContexts[],
): Map<string, GeoInput[]> {
  const perIp = new Map<string, GeoInput[]>();
  for (const ip of ips) {
    const inputs: GeoInput[] = [];
    for (const p of providers) {
      const geo = p.byIp.get(ip);
      if (geo) inputs.push({ id: p.id, geo });
    }
    perIp.set(ip, inputs);
  }
  return perIp;
}

/** Normalized country key for an input: ISO code preferred, else country name. */
function countryKey(geo: GeoContext): string {
  return geo.countryCode?.trim().toUpperCase() || normalizeKey(geo.country);
}

/** IPs whose country is uncertain: fewer than 2 reporting voters, or voters
 *  disagree on the code. Disagreements are prioritized, then capped to `max`. */
export function selectUncertainIps(
  perIp: Map<string, GeoInput[]>,
  max: number,
): string[] {
  const disagree: string[] = [];
  const single: string[] = [];
  for (const [ip, inputs] of perIp) {
    let reporting = 0;
    const codes = new Set<string>();
    for (const inp of inputs) {
      const key = countryKey(inp.geo);
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

/** Run `fn` over `items` with at most `limit` in flight at once. */
async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (i < items.length) {
        const idx = i++;
        await fn(items[idx]);
      }
    },
  );
  await Promise.all(workers);
}

/** Fetch authoritative allocation country per IP via RDAP, concurrency-capped.
 *  Only IPs with a country are included; failures drop out silently. */
export async function fetchRdapCountries(
  ips: string[],
  signal: AbortSignal,
  concurrency: number,
): Promise<Map<string, GeoContext>> {
  const out = new Map<string, GeoContext>();
  if (ips.length === 0) return out;
  await mapLimit(ips, concurrency, async (ip) => {
    try {
      const { ok, data } = await getJson<RdapIpResponse>(
        `https://rdap.org/ip/${ip}`,
        signal,
      );
      if (ok && data) {
        const geo = rdapIpToGeo(data);
        if (geo.countryCode) out.set(ip, geo);
      }
    } catch {
      // drop this IP's authority boost
    }
  });
  return out;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Hard ceiling on per-request RDAP lookups (latency guard). */
export const bulkRdapMax = (): number => intEnv("BULK_RDAP_MAX", 25);
/** Max concurrent RDAP requests. */
export const bulkRdapConcurrency = (): number =>
  intEnv("BULK_RDAP_CONCURRENCY", 8);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ti/geo/bulk.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/geo/bulk.ts lib/ti/geo/bulk.test.ts
git commit -m "feat(geo): bulk transpose, uncertain-IP selection, RDAP fetch"
```

---

## Task 4: `GeoRow.resolution` + `bulkGeolocate` orchestrator

**Files:**
- Modify: `lib/ti/geo.ts`

(No new unit test: the pure pieces are covered by Tasks 1–3; this task wires fetch calls to them and is covered by the manual/E2E step in Task 6. `npm test` must still pass.)

- [ ] **Step 1: Add `resolution` to `GeoRow` and imports**

In `lib/ti/geo.ts`, extend the imports at the top:
```ts
import type { GeoContext, GeoResolution } from "./types";
import {
  bulkIpInfo,
} from "./sources/ipinfo";
import { flattenResolution, reconcileGeoInputs } from "./geo/reconcile";
import {
  bulkRdapConcurrency,
  bulkRdapMax,
  fetchRdapCountries,
  selectUncertainIps,
  transposeByIp,
} from "./geo/bulk";
```
(Keep the existing imports for `postJson`, `IP_API_FIELDS`, `ipApiToGeo`, `IpApiResponse`, `ParsedIP`. If `GeoContext` is not already imported, add it as shown.)

Extend the `GeoRow` interface:
```ts
export interface GeoRow {
  /** Canonical IP (RFC 5952 for v6). */
  ip: string;
  version: 4 | 6;
  status: "ok" | "error";
  geo?: GeoContext;
  /** Multi-provider reconciliation with per-field confidence (when available). */
  resolution?: GeoResolution;
  error?: string;
}
```

- [ ] **Step 2: Rewrite `bulkGeolocate`**

Replace the existing `bulkGeolocate` body with:
```ts
export async function bulkGeolocate(
  ips: ParsedIP[],
  signal: AbortSignal,
): Promise<GeoRow[]> {
  if (ips.length === 0) return [];
  if (ips.length > 100) {
    throw new RangeError(
      `bulkGeolocate: ip-api batch limit is 100 IPs, got ${ips.length}`,
    );
  }
  const addresses = ips.map((p) => p.ip);

  // 1. ip-api /batch (always; baseline, no key).
  const { data } = await postJson<IpApiBatchEntry[]>(
    `http://ip-api.com/batch?fields=${IP_API_FIELDS}`,
    signal,
    addresses,
  );
  const ipapiRows = mapBatchResults(ips, data ?? []);
  const byIpRow = new Map(ipapiRows.map((row) => [row.ip, row]));
  const ipApiByIp = new Map<string, GeoContext>();
  for (const row of ipapiRows) {
    if (row.status === "ok" && row.geo) ipApiByIp.set(row.ip, row.geo);
  }

  // 2. ipinfo /batch (one extra voter when IPINFO_TOKEN is set).
  const ipinfoByIp = await bulkIpInfo(addresses, signal);

  // 3. Transpose into per-IP reconciliation inputs.
  const perIp = transposeByIp(addresses, [
    { id: "ip-api", byIp: ipApiByIp },
    { id: "ipinfo", byIp: ipinfoByIp },
  ]);

  // 4. Adaptive RDAP country authority for uncertain IPs (capped + logged).
  const qualifying = selectUncertainIps(perIp, Number.POSITIVE_INFINITY);
  const cap = bulkRdapMax();
  if (qualifying.length > cap) {
    console.warn(
      `bulkGeolocate: ${qualifying.length - cap} uncertain IP(s) skipped RDAP (cap ${cap})`,
    );
  }
  const uncertain = qualifying.slice(0, cap);
  const rdapByIp = await fetchRdapCountries(
    uncertain,
    signal,
    bulkRdapConcurrency(),
  );
  for (const [ip, geo] of rdapByIp) {
    perIp.get(ip)?.push({ id: "rdap-ip", geo });
  }

  // 5. Reconcile per IP; keep the error row when nothing resolved.
  return ips.map((parsed) => {
    const base = byIpRow.get(parsed.ip)!;
    const resolution = reconcileGeoInputs(perIp.get(parsed.ip) ?? []);
    if (!resolution) return base;
    return {
      ip: base.ip,
      version: base.version,
      status: "ok" as const,
      geo: flattenResolution(resolution, base.geo),
      resolution,
    };
  });
}
```

- [ ] **Step 3: Typecheck + full test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: exit 0; all tests pass (no behavior change for single-IP; bulk pieces covered).

- [ ] **Step 4: Lint**

Run: `npx eslint lib/ti/geo.ts lib/ti/geo/bulk.ts lib/ti/sources/ipinfo.ts lib/ti/geo/reconcile.ts`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/geo.ts
git commit -m "feat(geo): bulkGeolocate reconciles ip-api + ipinfo + adaptive RDAP"
```

---

## Task 5: Bulk UI — confidence chip + reconciled country

**Files:**
- Modify: `components/BulkGeoResults.tsx`

(UI change; verified visually in Task 6. `npx tsc --noEmit` and `eslint` must pass.)

- [ ] **Step 1: Add imports**

At the top of `components/BulkGeoResults.tsx`, add:
```ts
import { ConfidenceChip } from "@/components/CheckResults/confidence";
import type { Confidence } from "@/lib/ti/types";
```

- [ ] **Step 2: Read reconciled country in `codeOf`**

Replace `codeOf`:
```ts
/** Uppercase ISO country code for a row (reconciled if available), or "?". */
function codeOf(row: GeoRow): string {
  const cc = row.resolution?.countryCode ?? row.geo?.countryCode;
  return row.status === "ok" && cc ? cc.toUpperCase() : "?";
}
```

- [ ] **Step 3: Reconciled `sameCountryOf` with confidence + provider count**

Replace `sameCountryOf` with:
```ts
const RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

/** If every located IP shares one country, describe it with the lowest
 *  confidence seen and how many providers backed the reconciliation. */
function sameCountryOf(rows: GeoRow[]): {
  ips: string[];
  country: string;
  code: string;
  confidence: Confidence;
  providerCount: number;
} | null {
  const codeOfRow = (r: GeoRow) =>
    (r.resolution?.countryCode ?? r.geo?.countryCode)?.toUpperCase();
  const located = rows.filter((r) => r.status === "ok" && codeOfRow(r));
  if (located.length < 2) return null;
  const code = codeOfRow(located[0])!;
  if (!located.every((r) => codeOfRow(r) === code)) return null;

  let confidence: Confidence = "high";
  let providerCount = 1;
  for (const r of located) {
    const c = r.resolution?.country?.confidence ?? "low";
    if (RANK[c] < RANK[confidence]) confidence = c;
    providerCount = Math.max(providerCount, r.resolution?.providerCount ?? 1);
  }
  const country =
    located[0].resolution?.country?.value ?? located[0].geo?.country ?? code;
  return { ips: located.map((r) => r.ip), country, code, confidence, providerCount };
}
```

- [ ] **Step 4: Hedge wording + reconciled basis in the callout sentence**

Replace `sameCountrySentence` with:
```ts
/** Formal plain-text sentence for the same-country result. */
function sameCountrySentence(same: {
  ips: string[];
  country: string;
  code: string;
  confidence: Confidence;
  providerCount: number;
}): string {
  const verb =
    same.confidence === "high" ? "are located in" : "are likely located in";
  const basis =
    same.providerCount >= 2
      ? `as reconciled across ${same.providerCount} geolocation providers`
      : "as reported by ip-api.com";
  return `${joinIps(same.ips)} ${verb} the same country, ${same.country} (${same.code}), ${basis}.`;
}
```

- [ ] **Step 5: Render the chip in the callout and update the displayed text**

In `SameCountryCallout`, update the displayed `<p>` to match the sentence (hedge + basis) and add a `ConfidenceChip`. Replace the `<p>...</p>` block inside the box with:
```tsx
        <p className="font-sans text-sm leading-relaxed text-foreground/90">
          {joinIps(same.ips)}{" "}
          {same.confidence === "high" ? "are located in" : "are likely located in"}{" "}
          the same country,{" "}
          <span className="font-semibold">
            {same.country} ({same.code})
          </span>
          <ConfidenceChip confidence={same.confidence} />
          {same.providerCount >= 2
            ? `, as reconciled across ${same.providerCount} geolocation providers.`
            : ", as reported by ip-api.com."}
        </p>
```
(The `Copy` button still copies `sentence` from `sameCountrySentence`, which now matches.)

- [ ] **Step 6: Add the confidence chip to the Country table cell**

In the table body, the Country `<td>` renders `{g.country}` inside a span. Add the chip right after the country name. Change:
```tsx
                          {g.country}
                        </span>
```
to:
```tsx
                          {g.country}
                          {row.resolution?.country && (
                            <ConfidenceChip
                              confidence={row.resolution.country.confidence}
                            />
                          )}
                        </span>
```

- [ ] **Step 7: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint components/BulkGeoResults.tsx`
Expected: exit 0; no errors.

- [ ] **Step 8: Commit**

```bash
git add components/BulkGeoResults.tsx
git commit -m "feat(ui): bulk geo confidence chip + reconciled same-country callout"
```

---

## Task 6: Full verification + manual E2E

**Files:** none (verification only)

- [ ] **Step 1: Full suite + lint + typecheck**

Run: `npx tsc --noEmit && npx vitest run && npx eslint .`
Expected: all green.

- [ ] **Step 2: Manual E2E (no-key path)**

Run the dev server (`npm run dev`) and submit a bulk query of mixed-country IPs, e.g. `1.1.1.1, 8.8.8.8, 9.9.9.9, 195.154.1.1`. Confirm:
- The Country column shows a confidence chip per located row.
- The copy summary uses reconciled codes (e.g. `1.1.1.1 (US), …`).
- The same-country callout appears only when all located IPs share a country, with the hedge/basis wording.
- With no `IPINFO_TOKEN`, rows still render (ip-api + adaptive RDAP); no errors in the server log beyond any RDAP truncation `console.warn`.

Capture a screenshot via `scripts/shot.mjs` per CLAUDE.md if required for the PR.

- [ ] **Step 3: Final commit (if screenshots/docs added)**

```bash
git add -A
git commit -m "test(geo): manual E2E verification of bulk reconciliation"
```

---

## Self-Review Notes

- **Spec coverage:** tiered fan-out (Task 4 steps 1–2), adaptive RDAP with cap + logging (Task 3 + Task 4 step 2), reuse of `reconcileGeo` core (Task 1), `GeoRow.resolution` + flattened compat `geo` (Task 1 `flattenResolution` + Task 4), confidence chip + reconciled copy/callout (Task 5), clean no-token degrade (Task 4 — `bulkIpInfo` returns empty map; RDAP still runs for capped uncertain set). All covered.
- **Deviation from spec testing:** spec mentioned a mocked-fetch end-to-end test; this plan instead unit-tests the pure pieces (transpose, selection, mapping, flatten, reconcile equivalence) and verifies the thin fetch-wiring via manual E2E — matching the repo's "pure unit tests + manual E2E" convention.
- **Type consistency:** `GeoInput` (Task 1) is imported by `bulk.ts` (Task 3) and produced by `transposeByIp`; `reconcileGeoInputs`/`flattenResolution` (Task 1) consumed in Task 4; `bulkIpInfo` (Task 2) consumed in Task 4; `bulkRdapMax`/`bulkRdapConcurrency`/`selectUncertainIps`/`fetchRdapCountries`/`transposeByIp` (Task 3) consumed in Task 4; `ConfidenceChip`/`Confidence` (Task 5) match the existing `components/CheckResults/confidence.tsx` export and `lib/ti/types.ts`.
