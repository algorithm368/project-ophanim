# Bulk Geolocation + IPv6 Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the home checker geolocate many IPs at once (IPv4 + IPv6) in one batch request, and add a real IPv6 parser with RFC-correct scope detection.

**Architecture:** A new pure `parseIPv6`/`parseIP`/`extractIps` validation layer feeds a new geo-only batch endpoint (`/api/geo`) backed by ip-api's batch API. The home `Checker` routes 2+ IPs (or a single IPv6) to a new `BulkGeoResults` table; everything else keeps the existing single-indicator full-check path. Bulk does **not** run threat-intel scoring.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Vitest. ip-api.com batch endpoint (`POST http://ip-api.com/batch`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-29-bulk-geolocation-ipv6-design.md`

---

## File Structure

- `lib/ip.ts` (modify) — add `version` discriminant, `ParsedIPv6`, `ParsedIP`, `parseIPv6`, `parseIP`. Owns IP syntax + scope detection.
- `lib/ip.test.ts` (modify) — IPv6 parse/canonicalize/scope tests + `parseIP` dispatch.
- `lib/ioc.ts` (modify) — `detectIOC` recognizes IPv6; add `extractIps` (split/dedupe/drop/cap). Lives here (not `lib/ip.ts`) to avoid a circular import with `refangIOC`.
- `lib/ioc.test.ts` (modify) — IPv6 detection + `extractIps` tests.
- `lib/ti/sources/ipapi.ts` (modify) — export `IpApiResponse`, `IP_API_FIELDS`, and a shared `ipApiToGeo()` mapper; use the mapper internally.
- `lib/ti/sources/ipapi.test.ts` (create) — unit test for `ipApiToGeo`.
- `lib/ti/geo.ts` (create) — `GeoRow`, pure `mapBatchResults()`, and `bulkGeolocate()` (the only file that does the batch fetch).
- `lib/ti/geo.test.ts` (create) — `mapBatchResults` tests (no network).
- `app/api/geo/route.ts` (create) — `POST` endpoint: validate → batch → JSON.
- `components/BulkGeoResults.tsx` (create) — the results table + `flagEmoji` helper.
- `components/Checker.tsx` (modify) — route to bulk, fetch `/api/geo`, render the table, bulk loading + detection hint.

---

## Task 1: IPv6 parsing + scope detection in `lib/ip.ts`

**Files:**
- Modify: `lib/ip.ts`
- Test: `lib/ip.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `lib/ip.test.ts` (after the existing `reverseOctets` describe block):

```ts
import { parseIPv6, parseIP } from "@/lib/ip";

describe("parseIPv6", () => {
  it("canonicalizes to RFC 5952 (lowercase, zero-compressed)", () => {
    expect(parseIPv6("2001:0DB8:0000:0000:0000:0000:0000:0001")?.ip).toBe(
      "2001:db8::1",
    );
    expect(parseIPv6("FE80::1")?.ip).toBe("fe80::1");
    expect(parseIPv6("::")?.ip).toBe("::");
    expect(parseIPv6("::1")?.ip).toBe("::1");
  });

  it("compresses the leftmost-longest run of zero groups", () => {
    // Two equal-length runs -> the leftmost is compressed.
    expect(parseIPv6("2001:0:0:1:0:0:0:1")?.ip).toBe("2001:0:0:1::1");
  });

  it("parses an embedded IPv4 tail into hextets", () => {
    const r = parseIPv6("::ffff:192.168.0.1");
    expect(r?.ip).toBe("::ffff:c0a8:1");
    expect(r?.version).toBe(6);
  });

  it("reports a routable address as public", () => {
    const r = parseIPv6("2606:4700:4700::1111");
    expect(r).not.toBeNull();
    expect(r?.isPrivate).toBe(false);
    expect(r?.isReserved).toBe(false);
    expect(r?.scopeNote).toBeUndefined();
    expect(r?.version).toBe(6);
  });

  it.each([
    ["::1", /Loopback/, "reserved"],
    ["::", /Unspecified/, "reserved"],
    ["fe80::1", /Link-local/, "reserved"],
    ["ff02::1", /Multicast/, "reserved"],
    ["2001:db8::1", /Documentation/, "reserved"],
    ["::ffff:1.2.3.4", /IPv4-mapped/, "reserved"],
  ])("flags %s as %s", (ip, note, kind) => {
    const r = parseIPv6(ip);
    expect(r?.scopeNote).toMatch(note);
    expect(r?.isReserved).toBe(kind === "reserved");
  });

  it("flags fc00::/7 unique-local as private", () => {
    const r = parseIPv6("fd00::1");
    expect(r?.isPrivate).toBe(true);
    expect(r?.scopeNote).toMatch(/Unique local/);
  });

  it.each([
    ["1:2:3:4:5:6:7:8:9"],
    ["1::2::3"],
    ["gggg::1"],
    ["12345::1"],
    ["::1::"],
    ["1.2.3.4"],
    [""],
  ])("rejects malformed input %s", (input) => {
    expect(parseIPv6(input)).toBeNull();
  });
});

describe("parseIP", () => {
  it("dispatches to v4 then v6", () => {
    expect(parseIP("8.8.8.8")?.version).toBe(4);
    expect(parseIP("2606:4700:4700::1111")?.version).toBe(6);
    expect(parseIP("not-an-ip")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- lib/ip.test.ts`
Expected: FAIL — `parseIPv6`/`parseIP` are not exported.

- [ ] **Step 3: Implement IPv6 parsing in `lib/ip.ts`**

Add `version: 4` to the existing `ParsedIPv4` interface and to the object returned by `parseIPv4`.

Change the interface:

```ts
export interface ParsedIPv4 {
  ip: string;
  version: 4;
  octets: [number, number, number, number];
  isPrivate: boolean;
  isReserved: boolean;
  /** Why the address can't be meaningfully checked against TI feeds. */
  scopeNote?: string;
}
```

Change the `return` at the end of `parseIPv4` to include `version: 4`:

```ts
  return {
    ip: octets.join("."),
    version: 4,
    octets,
    isPrivate,
    isReserved,
    scopeNote,
  };
```

Then append the IPv6 implementation to the end of `lib/ip.ts`:

```ts
export interface ParsedIPv6 {
  /** Canonical RFC 5952 form (lowercase, zero-compressed). */
  ip: string;
  version: 6;
  isPrivate: boolean;
  isReserved: boolean;
  /** Why the address can't be meaningfully checked against TI feeds. */
  scopeNote?: string;
}

export type ParsedIP = ParsedIPv4 | ParsedIPv6;

/** Expand an IPv6 string to its 8 hextet numbers, or null if malformed. */
function expandIPv6(input: string): number[] | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  // Reject zone IDs (fe80::1%eth0) — not meaningful for geolocation.
  if (s.includes("%")) return null;

  // Fold an embedded IPv4 tail (::ffff:1.2.3.4) into two hextets.
  if (s.includes(".")) {
    const lastColon = s.lastIndexOf(":");
    if (lastColon < 0) return null;
    const v4 = parseIPv4(s.slice(lastColon + 1));
    if (!v4) return null;
    const [a, b, c, d] = v4.octets;
    s =
      s.slice(0, lastColon + 1) +
      ((a << 8) | b).toString(16) +
      ":" +
      ((c << 8) | d).toString(16);
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;

  const parseGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    for (const g of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };

  if (halves.length === 2) {
    const head = parseGroups(halves[0]);
    const tail = parseGroups(halves[1]);
    if (!head || !tail) return null;
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null; // "::" must stand for at least one zero group
    return [...head, ...Array(missing).fill(0), ...tail];
  }

  const groups = parseGroups(s);
  if (!groups || groups.length !== 8) return null;
  return groups;
}

/** Compress the 8 hextets to canonical RFC 5952 text. */
function canonicalizeIPv6(groups: number[]): string {
  const hex = groups.map((g) => g.toString(16));
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let i = 0; i < 8; i++) {
    if (groups[i] === 0) {
      if (curStart < 0) curStart = i;
      curLen = i - curStart + 1;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }
  if (bestLen < 2) return hex.join(":");
  const head = hex.slice(0, bestStart).join(":");
  const tail = hex.slice(bestStart + bestLen).join(":");
  return `${head}::${tail}`;
}

/** Classify an IPv6 address's scope from its hextets. */
function ipv6Scope(groups: number[]): {
  isPrivate: boolean;
  isReserved: boolean;
  scopeNote?: string;
} {
  const g0 = groups[0];
  const headZero = groups.slice(0, 7).every((g) => g === 0);
  if (headZero && groups[7] === 1)
    return { isPrivate: false, isReserved: true, scopeNote: "Loopback (RFC 4291)" };
  if (groups.every((g) => g === 0))
    return {
      isPrivate: false,
      isReserved: true,
      scopeNote: "Unspecified address (RFC 4291)",
    };
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff)
    return { isPrivate: false, isReserved: true, scopeNote: "IPv4-mapped (RFC 4291)" };
  if ((g0 & 0xffc0) === 0xfe80)
    return { isPrivate: false, isReserved: true, scopeNote: "Link-local (RFC 4291)" };
  if ((g0 & 0xfe00) === 0xfc00)
    return { isPrivate: true, isReserved: false, scopeNote: "Unique local (RFC 4193)" };
  if (g0 === 0x2001 && groups[1] === 0x0db8)
    return { isPrivate: false, isReserved: true, scopeNote: "Documentation (RFC 3849)" };
  if ((g0 & 0xff00) === 0xff00)
    return { isPrivate: false, isReserved: true, scopeNote: "Multicast (RFC 4291)" };
  return { isPrivate: false, isReserved: false };
}

/** Parse and validate an IPv6 address, canonicalized with scope detection. */
export function parseIPv6(input: string): ParsedIPv6 | null {
  const groups = expandIPv6(input);
  if (!groups) return null;
  return {
    ip: canonicalizeIPv6(groups),
    version: 6,
    ...ipv6Scope(groups),
  };
}

/** Parse an IP of either family: IPv4 first, then IPv6. */
export function parseIP(input: string): ParsedIP | null {
  return parseIPv4(input) ?? parseIPv6(input);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- lib/ip.test.ts`
Expected: PASS (all `parseIPv4`, `parseIPv6`, `parseIP`, `reverseOctets` tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ip.ts lib/ip.test.ts
git commit -m "feat(ip): add IPv6 parsing, canonicalization, and scope detection"
```

---

## Task 2: IPv6 detection + `extractIps` in `lib/ioc.ts`

**Files:**
- Modify: `lib/ioc.ts`
- Test: `lib/ioc.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `lib/ioc.test.ts`:

```ts
import { extractIps } from "@/lib/ioc";

describe("detectIOC (IPv6)", () => {
  it.each([
    ["2606:4700:4700::1111"],
    ["fe80::1"],
    ["::1"],
  ])("detects %s as ip", (input) => {
    expect(detectIOC(input)).toBe("ip");
  });
});

describe("extractIps", () => {
  it("splits on whitespace, commas, and semicolons", () => {
    const ips = extractIps("8.8.8.8, 1.1.1.1; 9.9.9.9\n2606:4700:4700::1111");
    expect(ips.map((p) => p.ip)).toEqual([
      "8.8.8.8",
      "1.1.1.1",
      "9.9.9.9",
      "2606:4700:4700::1111",
    ]);
  });

  it("dedupes by canonical form (v4 exact, v6 across spellings)", () => {
    const ips = extractIps(
      "1.1.1.1 1.1.1.1 2606:4700:4700::1111 2606:4700:4700:0:0:0:0:1111",
    );
    expect(ips.map((p) => p.ip)).toEqual(["1.1.1.1", "2606:4700:4700::1111"]);
  });

  it("drops private, reserved, and non-IP tokens", () => {
    const ips = extractIps("10.0.0.1 192.168.1.1 ::1 google.com hello 1.1.1.1");
    expect(ips.map((p) => p.ip)).toEqual(["1.1.1.1"]);
  });

  it("refangs defanged tokens", () => {
    expect(extractIps("8.8.8[.]8 1.1.1.1").map((p) => p.ip)).toEqual([
      "8.8.8.8",
      "1.1.1.1",
    ]);
  });

  it("caps the number of IPs", () => {
    const many = Array.from({ length: 150 }, (_, i) => `1.1.${(i >> 8) & 255}.${i & 255}`).join(" ");
    expect(extractIps(many).length).toBe(100);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- lib/ioc.test.ts`
Expected: FAIL — `extractIps` is not exported; IPv6 detection returns null.

- [ ] **Step 3: Update `lib/ioc.ts`**

Change the import line to pull in `parseIP` and `ParsedIP`:

```ts
import { parseIPv4, parseIP, type ParsedIP } from "@/lib/ip";
```

In `detectIOC`, replace the IPv4 check with `parseIP` so IPv6 is recognized:

```ts
  if (parseHash(value)) return "hash";
  if (parseIP(value)) return "ip";
  if (parseDomain(value)) return "domain";
```

Append `extractIps` to the end of the file:

```ts
/**
 * Pull every distinct, routable IP (v4 or v6) out of a free-form blob — the
 * input the bulk-geolocation path receives. Tokens split on whitespace,
 * commas, and semicolons; each is refanged then parsed. Private/reserved/
 * non-IP tokens are dropped, results are deduped by canonical form, and the
 * count is capped (ip-api's batch limit). Order of first appearance is kept.
 */
export function extractIps(input: string, cap = 100): ParsedIP[] {
  const out: ParsedIP[] = [];
  const seen = new Set<string>();
  for (const token of input.split(/[\s,;]+/)) {
    if (!token) continue;
    const parsed = parseIP(refangIOC(token));
    if (!parsed || parsed.isPrivate || parsed.isReserved) continue;
    if (seen.has(parsed.ip)) continue;
    seen.add(parsed.ip);
    out.push(parsed);
    if (out.length >= cap) break;
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- lib/ioc.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ioc.ts lib/ioc.test.ts
git commit -m "feat(ioc): detect IPv6 and add extractIps for bulk input"
```

---

## Task 3: Share the ip-api geo mapper in `lib/ti/sources/ipapi.ts`

**Files:**
- Modify: `lib/ti/sources/ipapi.ts`
- Test: `lib/ti/sources/ipapi.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/ti/sources/ipapi.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ipApiToGeo, type IpApiResponse } from "./ipapi";

describe("ipApiToGeo", () => {
  it("maps an ip-api success payload to GeoContext", () => {
    const data: IpApiResponse = {
      status: "success",
      country: "United States",
      countryCode: "US",
      regionName: "California",
      city: "Mountain View",
      lat: 37.4,
      lon: -122.07,
      isp: "Google LLC",
      org: "Google Public DNS",
      as: "AS15169 Google LLC",
      asname: "GOOGLE",
      reverse: "dns.google",
      hosting: true,
      proxy: false,
      mobile: false,
    };
    expect(ipApiToGeo(data)).toEqual({
      country: "United States",
      countryCode: "US",
      region: "California",
      city: "Mountain View",
      lat: 37.4,
      lon: -122.07,
      asn: "AS15169 Google LLC",
      asnOrg: "GOOGLE",
      isp: "Google LLC",
      org: "Google Public DNS",
      reverse: "dns.google",
      isHosting: true,
      isProxy: false,
      isMobile: false,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- lib/ti/sources/ipapi.test.ts`
Expected: FAIL — `ipApiToGeo`/`IpApiResponse` are not exported.

- [ ] **Step 3: Refactor `lib/ti/sources/ipapi.ts`**

Export the interface, the field list, and a shared mapper; use the mapper inside `check`. Replace the file's top section and the `geo:` block so the file reads:

```ts
import type { GeoContext, SourceFinding, TiSource } from "../types";
import { errorMessage, getJson, isTimeout } from "../http";

export interface IpApiResponse {
  status: "success" | "fail";
  message?: string;
  country?: string;
  countryCode?: string;
  regionName?: string;
  city?: string;
  lat?: number;
  lon?: number;
  isp?: string;
  org?: string;
  as?: string;
  asname?: string;
  reverse?: string;
  mobile?: boolean;
  proxy?: boolean;
  hosting?: boolean;
}

/** ip-api field selector, shared by the single source and the bulk batch call. */
export const IP_API_FIELDS =
  "status,message,country,countryCode,regionName,city,lat,lon,isp,org,as,asname,reverse,mobile,proxy,hosting,query";

/** Map an ip-api success payload to the normalized GeoContext. */
export function ipApiToGeo(data: IpApiResponse): GeoContext {
  return {
    country: data.country,
    countryCode: data.countryCode,
    region: data.regionName,
    city: data.city,
    lat: data.lat,
    lon: data.lon,
    asn: data.as,
    asnOrg: data.asname,
    isp: data.isp,
    org: data.org,
    reverse: data.reverse,
    isHosting: data.hosting,
    isProxy: data.proxy,
    isMobile: data.mobile,
  };
}

/** ip-api.com: free geolocation/ASN context (no key). Context only, no risk score. */
export const ipApiSource: TiSource = {
  meta: {
    id: "ip-api",
    name: "ip-api.com",
    url: "https://ip-api.com",
    category: "context",
    requiresKey: false,
    weight: 0,
  },
  isEnabled: () => true,
  async check(ip, signal): Promise<SourceFinding> {
    try {
      const { data } = await getJson<IpApiResponse>(
        `http://ip-api.com/json/${ip}?fields=${IP_API_FIELDS}`,
        signal,
      );
      if (!data || data.status !== "success") {
        return {
          status: "error",
          error: data?.message ?? "Lookup failed",
        };
      }

      const flags: string[] = [];
      if (data.proxy) flags.push("proxy/VPN/Tor");
      if (data.hosting) flags.push("hosting/datacenter");
      if (data.mobile) flags.push("mobile");

      return {
        status: "ok",
        summary: [data.city, data.regionName, data.country]
          .filter(Boolean)
          .join(", ")
          .concat(data.as ? ` (${data.as})` : ""),
        categories: flags,
        details: {
          isp: data.isp,
          org: data.org,
          asn: data.as,
          reverseDns: data.reverse,
          flags: flags.length ? flags : ["none"],
        },
        geo: ipApiToGeo(data),
        raw: data,
      };
    } catch (err) {
      return {
        status: isTimeout(err) ? "timeout" : "error",
        error: errorMessage(err),
      };
    }
  },
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- lib/ti/sources/ipapi.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/sources/ipapi.ts lib/ti/sources/ipapi.test.ts
git commit -m "refactor(ipapi): export shared ipApiToGeo mapper and field list"
```

---

## Task 4: Bulk geolocation in `lib/ti/geo.ts`

**Files:**
- Create: `lib/ti/geo.ts`
- Test: `lib/ti/geo.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/ti/geo.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mapBatchResults, type IpApiBatchEntry } from "./geo";
import { parseIP, type ParsedIP } from "@/lib/ip";

const ip = (s: string): ParsedIP => {
  const p = parseIP(s);
  if (!p) throw new Error(`bad test ip: ${s}`);
  return p;
};

describe("mapBatchResults", () => {
  it("maps success and fail entries by position", () => {
    const ips = [ip("8.8.8.8"), ip("2606:4700:4700::1111")];
    const entries: IpApiBatchEntry[] = [
      {
        status: "success",
        country: "United States",
        countryCode: "US",
        city: "Mountain View",
        query: "8.8.8.8",
      },
      { status: "fail", message: "reserved range", query: "2606:4700:4700::1111" },
    ];

    const rows = mapBatchResults(ips, entries);
    expect(rows).toEqual([
      {
        ip: "8.8.8.8",
        version: 4,
        status: "ok",
        geo: expect.objectContaining({ country: "United States", city: "Mountain View" }),
      },
      {
        ip: "2606:4700:4700::1111",
        version: 6,
        status: "error",
        error: "reserved range",
      },
    ]);
  });

  it("treats a missing entry as an error row", () => {
    const rows = mapBatchResults([ip("1.1.1.1")], []);
    expect(rows[0]).toMatchObject({ ip: "1.1.1.1", version: 4, status: "error" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- lib/ti/geo.test.ts`
Expected: FAIL — `lib/ti/geo.ts` does not exist.

- [ ] **Step 3: Implement `lib/ti/geo.ts`**

```ts
import type { GeoContext } from "./types";
import type { ParsedIP } from "@/lib/ip";
import { postJson } from "./http";
import { IP_API_FIELDS, ipApiToGeo, type IpApiResponse } from "./sources/ipapi";

/** One row in a bulk-geolocation response. */
export interface GeoRow {
  /** Canonical IP (RFC 5952 for v6). */
  ip: string;
  version: 4 | 6;
  status: "ok" | "error";
  geo?: GeoContext;
  error?: string;
}

/** A single entry in an ip-api `/batch` response (single payload + echoed query). */
export interface IpApiBatchEntry extends IpApiResponse {
  query?: string;
}

/**
 * Zip the requested IPs against the batch response. ip-api preserves request
 * order, so positions line up; a non-success entry (or a missing one) becomes
 * an error row that still renders.
 */
export function mapBatchResults(
  ips: ParsedIP[],
  entries: IpApiBatchEntry[],
): GeoRow[] {
  return ips.map((parsed, i) => {
    const entry = entries[i];
    if (!entry || entry.status !== "success") {
      return {
        ip: parsed.ip,
        version: parsed.version,
        status: "error",
        error: entry?.message ?? "Lookup failed",
      };
    }
    return {
      ip: parsed.ip,
      version: parsed.version,
      status: "ok",
      geo: ipApiToGeo(entry),
    };
  });
}

/**
 * Geolocate up to 100 IPs in a single ip-api batch request. Geo-only — no
 * threat-intel scoring. The caller is responsible for validating/deduping
 * (see extractIps).
 */
export async function bulkGeolocate(
  ips: ParsedIP[],
  signal: AbortSignal,
): Promise<GeoRow[]> {
  if (ips.length === 0) return [];
  const { data } = await postJson<IpApiBatchEntry[]>(
    `http://ip-api.com/batch?fields=${IP_API_FIELDS}`,
    signal,
    ips.map((p) => p.ip),
  );
  return mapBatchResults(ips, data ?? []);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- lib/ti/geo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/geo.ts lib/ti/geo.test.ts
git commit -m "feat(geo): add bulk geolocation via ip-api batch endpoint"
```

---

## Task 5: Bulk geo API route `app/api/geo/route.ts`

**Files:**
- Create: `app/api/geo/route.ts`

- [ ] **Step 1: Implement the route**

```ts
import { extractIps } from "@/lib/ioc";
import { bulkGeolocate } from "@/lib/ti/geo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Bulk geolocation: POST { ips: string } (free-form list) or { ips: string[] }.
 * Returns { results: GeoRow[] }. Geo-only — no threat-intel scoring, cache, or
 * history. Invalid/private/reserved/duplicate entries are dropped by extractIps.
 */
export async function POST(request: Request) {
  let raw: string | null = null;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const val = body.ips;
    raw =
      typeof val === "string"
        ? val
        : Array.isArray(val)
          ? val.join("\n")
          : null;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!raw) {
    return Response.json({ error: "Missing 'ips' parameter" }, { status: 400 });
  }

  const ips = extractIps(raw);
  if (ips.length === 0) {
    return Response.json(
      { error: "No valid, routable IP addresses found." },
      { status: 400 },
    );
  }

  try {
    const results = await bulkGeolocate(ips, AbortSignal.timeout(8000));
    return Response.json({ results });
  } catch (err) {
    console.error("[ti] geo lookup failed:", err);
    return Response.json(
      { error: "The geolocation lookup failed. Please try again." },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 2: Verify it builds and type-checks**

Run: `npm run lint`
Expected: PASS (no errors).

- [ ] **Step 3: Smoke-test the endpoint (no key needed — ip-api is free)**

Run (in one terminal): `npm run dev`
Run (in another):

```bash
curl -s -X POST http://localhost:3000/api/geo \
  -H 'Content-Type: application/json' \
  -d '{"ips":"8.8.8.8, 1.1.1.1, 2606:4700:4700::1111, 10.0.0.1, garbage"}' | head -c 600
```

Expected: JSON `{"results":[ ... ]}` with 3 rows (8.8.8.8, 1.1.1.1, 2606:4700:4700::1111); `10.0.0.1` and `garbage` are absent.

- [ ] **Step 4: Commit**

```bash
git add app/api/geo/route.ts
git commit -m "feat(api): add /api/geo bulk geolocation endpoint"
```

---

## Task 6: Results table `components/BulkGeoResults.tsx`

**Files:**
- Create: `components/BulkGeoResults.tsx`

- [ ] **Step 1: Implement the component**

```tsx
"use client";

import { Globe } from "lucide-react";
import type { GeoRow } from "@/lib/ti/geo";
import { Card, CardContent } from "@/components/ui/card";

/** 2-letter country code -> regional-indicator flag emoji ("US" -> 🇺🇸). */
function flagEmoji(cc?: string): string {
  if (!cc || cc.length !== 2 || !/^[a-zA-Z]{2}$/.test(cc)) return "";
  const base = "A".charCodeAt(0);
  return String.fromCodePoint(
    ...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - base),
  );
}

function placeOf(row: GeoRow): string {
  const g = row.geo;
  if (!g) return "—";
  return [g.city, g.region].filter(Boolean).join(", ") || "—";
}

function flagsOf(row: GeoRow): string[] {
  const g = row.geo;
  if (!g) return [];
  const out: string[] = [];
  if (g.isProxy) out.push("proxy/VPN");
  if (g.isHosting) out.push("hosting");
  if (g.isMobile) out.push("mobile");
  return out;
}

export default function BulkGeoResults({ rows }: { rows: GeoRow[] }) {
  return (
    <Card className="sketch-shadow mt-8 overflow-hidden rounded-[22px_34px_18px_30px/30px_18px_34px_22px] border-2 border-foreground/20 bg-card/50">
      <CardContent className="space-y-4">
        <div className="font-hand flex items-center gap-2 text-2xl font-bold">
          <Globe className="size-5 text-primary" />
          Geolocation — {rows.length} {rows.length === 1 ? "address" : "addresses"}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="font-hand border-b-2 border-dashed border-foreground/20 text-left text-muted-foreground">
                <th className="px-2 py-1.5 font-semibold">IP</th>
                <th className="px-2 py-1.5 font-semibold">Ver</th>
                <th className="px-2 py-1.5 font-semibold">Country</th>
                <th className="px-2 py-1.5 font-semibold">City / Region</th>
                <th className="px-2 py-1.5 font-semibold">ASN</th>
                <th className="px-2 py-1.5 font-semibold">ISP / Org</th>
                <th className="px-2 py-1.5 font-semibold">Flags</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const g = row.geo;
                const flags = flagsOf(row);
                return (
                  <tr
                    key={row.ip}
                    className="border-b border-foreground/10 align-top last:border-0"
                  >
                    <td className="px-2 py-2 font-mono break-all">{row.ip}</td>
                    <td className="px-2 py-2 text-muted-foreground">
                      v{row.version}
                    </td>
                    <td className="px-2 py-2">
                      {row.status === "error" ? (
                        <span className="text-orange-500">no data</span>
                      ) : g?.country ? (
                        <span>
                          <span className="mr-1">{flagEmoji(g.countryCode)}</span>
                          {g.country}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-2 py-2">{placeOf(row)}</td>
                    <td className="px-2 py-2 font-mono text-xs text-muted-foreground">
                      {g?.asn ?? "—"}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {g?.isp ?? g?.org ?? "—"}
                    </td>
                    <td className="px-2 py-2">
                      {flags.length ? (
                        <span className="flex flex-wrap gap-1">
                          {flags.map((f) => (
                            <span
                              key={f}
                              className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400"
                            >
                              {f}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/BulkGeoResults.tsx
git commit -m "feat(ui): add BulkGeoResults table"
```

---

## Task 7: Wire bulk routing into `components/Checker.tsx`

**Files:**
- Modify: `components/Checker.tsx`

- [ ] **Step 1: Add imports**

Edit the existing imports near the top of the file. Change the `@/lib/ioc` line to add `extractIps`, change the `@/lib/ip` line to add `ParsedIP` (merge — don't add a second import from the same module), and add the `GeoRow` import:

```ts
import { parseIPv4, type ParsedIP } from "@/lib/ip";
// ...
import { detectIOC, refangIOC, extractIps } from "@/lib/ioc";
import type { GeoRow } from "@/lib/ti/geo";
```

(The existing lines are `import { parseIPv4 } from "@/lib/ip";` and `import { detectIOC, refangIOC } from "@/lib/ioc";` — edit them in place. `parseIPv4` is still used by `validateInput`/`canonicalFor`, so keep it.)

Add the lazy import next to `loadCheckResults` (top-level, after `const loadCheckResults = ...`):

```ts
const loadBulkGeo = () => import("./BulkGeoResults");
const BulkGeoResults = dynamic(loadBulkGeo, { ssr: false });
```

- [ ] **Step 2: Add a bulk-routing helper**

Add this top-level helper near `canonicalFor` (above the `Checker` component):

```ts
/**
 * The IPs a value would bulk-geolocate, or null if it isn't a bulk case.
 * Bulk applies to 2+ routable IPs, or a single IPv6 (the full TI pipeline is
 * IPv4-only, so a lone v6 goes to the geo table instead).
 */
function bulkTargets(value: string): ParsedIP[] | null {
  const ips = extractIps(value);
  if (ips.length >= 2) return ips;
  if (ips.length === 1 && ips[0].version === 6) return ips;
  return null;
}
```

- [ ] **Step 3: Add bulk state**

Inside `Checker`, next to the other `useState` hooks (after the `result` state), add:

```ts
  const [bulkRows, setBulkRows] = useState<GeoRow[] | null>(null);
  const [bulkPending, setBulkPending] = useState(0);
  const [isBulk, setIsBulk] = useState(false);
```

- [ ] **Step 4: Add the bulk-detection preview for the hint**

After the existing `const detected = detectIOC(query);` line, add:

```ts
  const bulkPreview = bulkTargets(refangIOC(query));
```

- [ ] **Step 5: Add a `runBulk` function and branch `runCheck` to it**

Add this function inside `Checker`, directly above `runCheck`:

```ts
  async function runBulk(value: string, ips: ParsedIP[]) {
    setLoading(true);
    setIsBulk(true);
    setBulkPending(ips.length);
    setBulkRows(null);
    setProgress(null);
    setError(null);
    setResult(null);
    void loadBulkGeo();

    try {
      const res = await fetch("/api/geo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ips: value }),
      });
      if (!res.ok) {
        let message = `The lookup failed (HTTP ${res.status}). Please try again.`;
        try {
          const data = (await res.json()) as { error?: string };
          if (data?.error) message = data.error;
        } catch {
          /* keep default */
        }
        setError({ kind: "request", message });
        return;
      }
      const data = (await res.json()) as { results: GeoRow[] };
      setBulkRows(data.results);
    } catch {
      setError({
        kind: "request",
        message:
          "Couldn't reach the server. Check your connection and try again.",
      });
    } finally {
      setLoading(false);
    }
  }
```

In `runCheck`, right after the existing guard `if (!value || loading) return;`, insert the bulk branch:

```ts
    const bulk = bulkTargets(value);
    if (bulk) {
      void runBulk(value, bulk);
      return;
    }
```

Also, in `runCheck`, clear bulk state when a single check starts. After the existing `setResult(null);` line (inside `runCheck`, in the block that resets state before fetching), add:

```ts
    setBulkRows(null);
    setIsBulk(false);
```

- [ ] **Step 6: Update the submit button's disabled condition**

Find the submit `Button` and change its `disabled` prop from:

```tsx
            disabled={loading || !query.trim() || !detected}
```

to:

```tsx
            disabled={loading || !query.trim() || (!detected && !bulkPreview)}
```

- [ ] **Step 7: Update the detection hint**

In the hint block, replace the `detected ? (...) : (...)` ternary so a bulk preview takes priority. Replace this existing branch:

```tsx
          ) : detected ? (
            <span className="inline-flex flex-wrap items-center gap-1.5 text-primary">
              <DetectedIcon className="size-4" />
              Detected {detected === "ip" ? "an" : "a"} {MODE_META[detected].label}
              {canonical !== trimmed && (
                <span className="text-muted-foreground">
                  (we&apos;ll check{" "}
                  <span className="font-mono text-foreground">{canonical}</span>)
                </span>
              )}
            </span>
          ) : (
```

with:

```tsx
          ) : bulkPreview ? (
            <span className="inline-flex flex-wrap items-center gap-1.5 text-primary">
              <Network className="size-4" />
              {bulkPreview.length === 1
                ? "Detected an IPv6 address"
                : `Detected ${bulkPreview.length} IP addresses`}{" "}
              <span className="text-muted-foreground">— bulk geolocation</span>
            </span>
          ) : detected ? (
            <span className="inline-flex flex-wrap items-center gap-1.5 text-primary">
              <DetectedIcon className="size-4" />
              Detected {detected === "ip" ? "an" : "a"} {MODE_META[detected].label}
              {canonical !== trimmed && (
                <span className="text-muted-foreground">
                  (we&apos;ll check{" "}
                  <span className="font-mono text-foreground">{canonical}</span>)
                </span>
              )}
            </span>
          ) : (
```

- [ ] **Step 8: Render the bulk loading + results**

Replace the existing render tail (the `loading` / empty / result blocks) so bulk takes priority. Find:

```tsx
      {loading && (
        <SearchProgress progress={progress} indicator={pending} mode={mode} />
      )}

      {!loading && !error && !result && <EmptyState mode={mode} />}

      {!loading && result && (
        <CheckResults result={result} onRefresh={refresh} onPivot={pivot} />
      )}
```

with:

```tsx
      {loading && isBulk && <BulkProgress count={bulkPending} />}

      {loading && !isBulk && (
        <SearchProgress progress={progress} indicator={pending} mode={mode} />
      )}

      {!loading && !error && !result && !bulkRows && <EmptyState mode={mode} />}

      {!loading && bulkRows && <BulkGeoResults rows={bulkRows} />}

      {!loading && result && (
        <CheckResults result={result} onRefresh={refresh} onPivot={pivot} />
      )}
```

- [ ] **Step 9: Add the `BulkProgress` component**

Add this function component at the bottom of the file (next to `EmptyState`/`SearchProgress`):

```tsx
function BulkProgress({ count }: { count: number }) {
  return (
    <Card className="sketch-shadow mt-8 overflow-hidden rounded-[22px_34px_18px_30px/30px_18px_34px_22px] border-2 border-foreground/20 bg-gradient-to-br from-primary/8 to-transparent">
      <CardContent className="flex items-center gap-3 py-8">
        <Loader2 className="size-6 animate-spin text-primary" />
        <div className="font-hand text-2xl font-bold">
          Looking up {count} {count === 1 ? "address" : "addresses"}…
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 10: Verify lint + full test suite**

Run: `npm run lint && npm test`
Expected: both PASS.

- [ ] **Step 11: Manual UI check**

Run: `npm run dev`, open `http://localhost:3000`, and verify:
- Pasting `8.8.8.8, 1.1.1.1, 2606:4700:4700::1111` shows the hint "Detected 3 IP addresses — bulk geolocation", and submitting renders the table with 3 rows (country flags, ASN, ISP).
- A single `8.8.8.8` still runs the full TI check (unchanged).
- A single `2606:4700:4700::1111` renders a one-row geo table.
- A single `google.com` still runs the full domain check.

If you cannot verify the UI in a browser, say so explicitly.

- [ ] **Step 12: Commit**

```bash
git add components/Checker.tsx
git commit -m "feat(ui): route bulk IP input to geolocation table"
```

---

## Final verification

- [ ] Run `npm test` — all suites pass.
- [ ] Run `npm run lint` — no errors.
- [ ] Run `npm run build` — production build succeeds.
- [ ] Confirm the four manual cases in Task 7 Step 11.
