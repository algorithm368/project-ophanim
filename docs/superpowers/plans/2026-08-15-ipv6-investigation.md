# IPv6 in the Full TI Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a routable IPv6 address a first-class single indicator that runs the same TI pipeline, scoring, permalink, cache, and history as IPv4.

**Architecture:** Sources declare which IP families they can answer for via a new optional `SourceMeta.families` field defaulting to `[4]`. The IP orchestrator (`lib/ti/check.ts`) partitions the registry by family, runs only the supported sources, and synthesizes `skipped` rows for the rest so they stay visible in the UI. The generic orchestrator stays family-agnostic because it is shared with the domain and hash pipelines. Scoring is untouched: IPv6 runs the identical `aggregateRisk` path.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Bun (package manager + script runner), Vitest for unit tests, ESLint.

**Spec:** `docs/superpowers/specs/2026-08-15-ipv6-investigation-design.md`

## Global Constraints

- Run `bun run test`, not `bun test`. The latter invokes Bun's own test runner, which does not understand the Vitest API.
- Tests are Vitest, colocated next to source as `lib/**/*.test.ts`, pure and unit-level with no network access. They use the `@/` path alias.
- Sources must never throw. Catch and return `{ status: isTimeout(err) ? "timeout" : "error", error: errorMessage(err) }`.
- Use the helpers in `lib/ti/http.ts` (`getJson`, `getText`, `isTimeout`, `errorMessage`), never bare `fetch`.
- User-facing copy uses commas, never em-dashes, en-dashes, or `" - "` separators.
- `SourceMeta.families` omitted means IPv4 only. Never "fix" a v4-only source by adding `6` without upstream evidence it works.
- No v6-only scoring: do not add `matchScope`, a prefix discount, or any change to `lib/ti/aggregate.ts`.
- No v6-only UI: do not add an address-structure decode card.
- Before declaring any task done, its stated test command must pass.

---

### Task 1: IPv6 CIDR containment

`cidrContains` is IPv4-only by construction and currently documents that a v6 lookup "simply misses rather than throws". Spamhaus DROP's `drop_v6.json` lists /48 blocks, so that miss becomes a silent false negative. This task adds a BigInt path.

`lib/ip.ts` has a private `expandIPv6` that produces the 8 hextets, but only the canonical string escapes via `parseIPv6`. Export a thin accessor so `cidr.ts` and `fcrdns.ts` (Task 2) can both reuse the parser instead of writing a second one.

**Files:**
- Modify: `lib/ip.ts` (add one exported function near `parseIPv6`, around line 189)
- Modify: `lib/ti/cidr.ts` (whole file)
- Test: `lib/ti/cidr.test.ts` (append to the existing `cidrContains` describe, add a new `ipv6ToBigInt` describe)

**Interfaces:**
- Consumes: `parseIPv4`, `parseIPv6` from `lib/ip.ts` (existing).
- Produces:
  - `ipv6Groups(input: string): number[] | null` from `lib/ip.ts`, the 8 hextets as numbers.
  - `ipv6ToBigInt(ip: string): bigint | null` from `lib/ti/cidr.ts`.
  - `cidrContains(cidr: string, ip: string): boolean` keeps its exact signature and all current IPv4 behavior.

- [ ] **Step 1: Write the failing tests**

Append to `lib/ti/cidr.test.ts`. Import `ipv6ToBigInt` by adding it to the existing import on line 2, so that line becomes:

```ts
import { cidrContains, ipv4ToLong, ipv6ToBigInt } from "./cidr";
```

Then append:

```ts
describe("ipv6ToBigInt", () => {
  it("converts an IPv6 address to its 128-bit integer", () => {
    expect(ipv6ToBigInt("::")).toBe(0n);
    expect(ipv6ToBigInt("::1")).toBe(1n);
    expect(ipv6ToBigInt("2001:db8::1")).toBe(
      0x2001_0db8_0000_0000_0000_0000_0000_0001n,
    );
  });

  it("accepts any spelling of the same address", () => {
    // Compressed, expanded, and mixed case must all agree.
    const expanded = ipv6ToBigInt("2001:0db8:0000:0000:0000:0000:0000:0001");
    expect(ipv6ToBigInt("2001:DB8::1")).toBe(expanded);
  });

  it("returns null for non-IPv6 input", () => {
    expect(ipv6ToBigInt("8.8.8.8")).toBeNull();
    expect(ipv6ToBigInt("not-an-ip")).toBeNull();
    // Zone IDs are rejected by the parser.
    expect(ipv6ToBigInt("fe80::1%eth0")).toBeNull();
  });
});

describe("cidrContains — IPv6", () => {
  it("matches an address inside a /48 block", () => {
    // The shape Spamhaus drop_v6.json uses.
    expect(cidrContains("2001:678:254::/48", "2001:678:254::1")).toBe(true);
    expect(cidrContains("2001:678:254::/48", "2001:678:255::1")).toBe(false);
  });

  it("respects /64 boundaries", () => {
    expect(cidrContains("2001:db8:0:1::/64", "2001:db8:0:1:ffff:ffff:ffff:ffff")).toBe(true);
    expect(cidrContains("2001:db8:0:1::/64", "2001:db8:0:2::")).toBe(false);
  });

  it("handles /128 (single host) and /0 (everything)", () => {
    expect(cidrContains("2001:db8::1/128", "2001:db8::1")).toBe(true);
    expect(cidrContains("2001:db8::1/128", "2001:db8::2")).toBe(false);
    expect(cidrContains("::/0", "2001:db8::1")).toBe(true);
  });

  it("normalizes an unaligned base to its block start", () => {
    // 2001:db8::5/64 really means the 2001:db8::/64 block.
    expect(cidrContains("2001:db8::5/64", "2001:db8::abcd")).toBe(true);
  });

  it("matches regardless of how either side is spelled", () => {
    expect(cidrContains("2001:0DB8:0000::/48", "2001:db8::1")).toBe(true);
  });

  it("returns false for a mixed-family comparison", () => {
    expect(cidrContains("2001:db8::/32", "8.8.8.8")).toBe(false);
    expect(cidrContains("1.0.0.0/8", "2001:db8::1")).toBe(false);
  });

  it("returns false for an out-of-range IPv6 prefix", () => {
    expect(cidrContains("2001:db8::/129", "2001:db8::1")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test lib/ti/cidr.test.ts`
Expected: FAIL. The `ipv6ToBigInt` cases fail on an undefined import; the `cidrContains — IPv6` cases fail because the v4-only implementation returns `false` for every v6 input.

- [ ] **Step 3: Export the hextet accessor from `lib/ip.ts`**

`expandIPv6` is already defined in this file and returns exactly what is needed; it is just not exported. Add this immediately above `export function parseIPv6` (around line 188):

```ts
/** The 8 hextets of an IPv6 address as numbers, or null if malformed. Exposed
 *  for callers that need to do bit arithmetic (CIDR containment, ip6.arpa)
 *  rather than re-parse the canonical string. */
export function ipv6Groups(input: string): number[] | null {
  return expandIPv6(input);
}
```

- [ ] **Step 4: Add the BigInt path in `lib/ti/cidr.ts`**

Change the import on line 1 to pull in the new accessor:

```ts
import { ipv6Groups, parseIPv4 } from "../ip";
```

Add `ipv6ToBigInt` below `ipv4ToLong`:

```ts
/**
 * IPv6 address -> 128-bit BigInt, or null for anything that isn't a valid
 * IPv6 address. BigInt rather than number because 128 bits does not fit in a
 * JS double, and rather than string comparison because CIDR masking is bitwise.
 */
export function ipv6ToBigInt(ip: string): bigint | null {
  const groups = ipv6Groups(ip);
  if (!groups) return null;
  let value = 0n;
  for (const group of groups) {
    value = (value << 16n) | BigInt(group);
  }
  return value;
}
```

Replace the body of `cidrContains` entirely. Note the family dispatch happens before the v4 work, and the v4 arithmetic is unchanged from the original:

```ts
/**
 * Whether `ip` falls inside `cidr`, for either IP family (e.g. "1.19.0.0/16"
 * or "2001:678:254::/48"). Returns false for malformed CIDRs and for
 * mixed-family comparisons, so a v4 address checked against a v6 feed simply
 * misses rather than throwing.
 */
export function cidrContains(cidr: string, ip: string): boolean {
  const slash = cidr.indexOf("/");
  if (slash < 0) return false;
  const prefix = Number(cidr.slice(slash + 1));
  if (!Number.isInteger(prefix) || prefix < 0) return false;
  const base = cidr.slice(0, slash);

  // Either side looking like IPv6 forces the v6 path; a v4 operand then fails
  // to parse and the comparison correctly misses.
  if (base.includes(":") || ip.includes(":")) {
    if (prefix > 128) return false;
    const ipValue = ipv6ToBigInt(ip);
    const baseValue = ipv6ToBigInt(base);
    if (ipValue === null || baseValue === null) return false;
    // Masking both sides also normalizes an unaligned base to its block start.
    const mask = ((1n << BigInt(prefix)) - 1n) << BigInt(128 - prefix);
    return (ipValue & mask) === (baseValue & mask);
  }

  if (prefix > 32) return false;
  const long = ipv4ToLong(ip);
  if (long === null) return false;
  const baseLong = ipv4ToLong(base);
  if (baseLong === null) return false;

  const size = 2 ** (32 - prefix);
  const start = Math.floor(baseLong / size) * size; // normalize unaligned base
  return long >= start && long < start + size;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun run test lib/ti/cidr.test.ts`
Expected: PASS, including all pre-existing IPv4 cases.

- [ ] **Step 6: Commit**

```bash
git add lib/ip.ts lib/ti/cidr.ts lib/ti/cidr.test.ts
git commit -m "feat(cidr): IPv6 CIDR containment via BigInt masking"
```

---

### Task 2: IPv6 forward-confirmed reverse DNS

`lib/ti/dns/fcrdns.ts` has two IPv4 assumptions and one latent correctness bug. `reversePointer` builds `in-addr.arpa` from dotted octets, `verifyFcrdns` forward-resolves with record type `"A"`, and the confirmation uses raw string equality. For v6 that last one matters: a resolver may return `2001:4860:4860:0:0:0:0:8888` where the caller passed `2001:4860:4860::8888`, and raw equality would report a genuinely forward-confirmed record as unconfirmed.

`RecordType` in `lib/ti/dns/doh.ts` already includes `"AAAA"`; only the narrower `ResolveFn` alias in `fcrdns.ts` needs widening.

**Files:**
- Modify: `lib/ti/dns/fcrdns.ts` (whole file)
- Modify: `lib/ti/sources/reverse-dns.ts:20-21` (widen the inline resolve closure)
- Test: `lib/ti/dns/fcrdns.test.ts` (append)

**Interfaces:**
- Consumes: `ipv6Groups` from `lib/ip.ts` (Task 1), `parseIPv6` from `lib/ip.ts` (existing).
- Produces:
  - `reversePointer(ip: string): string`, unchanged signature, now returns an `ip6.arpa` name for v6 input.
  - `ResolveFn = (name: string, type: "PTR" | "A" | "AAAA") => Promise<string[]>`.
  - `verifyFcrdns(ip: string, resolve: ResolveFn): Promise<FcrdnsResult | null>`, unchanged signature.

- [ ] **Step 1: Write the failing tests**

Append to `lib/ti/dns/fcrdns.test.ts`:

```ts
describe("reversePointer — IPv6", () => {
  it("builds the ip6.arpa nibble name", () => {
    // 32 nibbles, reversed, dot-separated.
    expect(reversePointer("2001:db8::1")).toBe(
      "1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa",
    );
  });

  it("produces the same name for any spelling of one address", () => {
    expect(reversePointer("2001:0DB8:0000:0000:0000:0000:0000:0001")).toBe(
      reversePointer("2001:db8::1"),
    );
  });
});

describe("verifyFcrdns — IPv6", () => {
  it("queries AAAA (not A) for a v6 address", async () => {
    const seen: string[] = [];
    await verifyFcrdns("2001:4860:4860::8888", async (_name, type) => {
      seen.push(type);
      return type === "PTR" ? ["dns.google"] : ["2001:4860:4860::8888"];
    });
    expect(seen).toEqual(["PTR", "AAAA"]);
  });

  it("verified when the forward answer is the same address, spelled differently", async () => {
    // The bug this guards: raw string equality would call this unverified.
    const res = await verifyFcrdns("2001:4860:4860::8888", async (_name, type) =>
      type === "PTR"
        ? ["dns.google"]
        : ["2001:4860:4860:0000:0000:0000:0000:8888"],
    );
    expect(res).toEqual({ hostname: "dns.google", verified: true });
  });

  it("unverified when the forward answer is a different v6 address", async () => {
    const res = await verifyFcrdns("2001:db8::1", async (_name, type) =>
      type === "PTR" ? ["evil.example.com"] : ["2001:db8::2"],
    );
    expect(res).toEqual({ hostname: "evil.example.com", verified: false });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test lib/ti/dns/fcrdns.test.ts`
Expected: FAIL. `reversePointer` returns an `in-addr.arpa` name built from a string with no dots, the resolve type is `"A"` instead of `"AAAA"`, and the differently-spelled forward answer compares unequal.

- [ ] **Step 3: Rewrite `lib/ti/dns/fcrdns.ts`**

```ts
import type { FcrdnsResult } from "../types";
import { ipv6Groups, parseIPv6 } from "../../ip";

/**
 * Build the reverse-DNS PTR name for an IP: `ip6.arpa` nibble format for IPv6,
 * `in-addr.arpa` reversed octets for IPv4.
 */
export function reversePointer(ip: string): string {
  const groups = ipv6Groups(ip);
  if (groups) {
    const nibbles = groups
      .map((group) => group.toString(16).padStart(4, "0"))
      .join("");
    return `${[...nibbles].reverse().join(".")}.ip6.arpa`;
  }
  return `${ip.split(".").reverse().join(".")}.in-addr.arpa`;
}

/** A minimal name->records resolver, injected so this stays pure/testable. */
export type ResolveFn = (
  name: string,
  type: "PTR" | "A" | "AAAA",
) => Promise<string[]>;

/**
 * Forward-confirmed reverse DNS: PTR the IP, forward-resolve the hostname, and
 * confirm it points back. Returns null when the IP has no PTR.
 *
 * IPv6 answers are compared in canonical form, not as raw strings: a resolver
 * may return an uncompressed spelling of the very address we asked about, and
 * a string compare would report a confirmed record as unconfirmed.
 */
export async function verifyFcrdns(
  ip: string,
  resolve: ResolveFn,
): Promise<FcrdnsResult | null> {
  const ptr = await resolve(reversePointer(ip), "PTR");
  const hostname = ptr[0];
  if (!hostname) return null;

  const asV6 = parseIPv6(ip);
  const forward = await resolve(hostname, asV6 ? "AAAA" : "A");
  const verified = asV6
    ? forward.some((answer) => parseIPv6(answer)?.ip === asV6.ip)
    : forward.includes(ip);
  return { hostname, verified };
}
```

- [ ] **Step 4: Widen the resolve closure in `lib/ti/sources/reverse-dns.ts`**

The closure narrows the record type to `"PTR" | "A"`, which no longer satisfies `ResolveFn`. Replace lines 20-21:

```ts
      const resolve = async (name: string, type: "PTR" | "A" | "AAAA") =>
        answers(await dohQuery(RESOLVERS.cloudflare, name, type, signal));
```

The `type as RecordType` cast goes away, because `"PTR" | "A" | "AAAA"` is already assignable to `RecordType`. Remove `type RecordType` from the import on line 3 if nothing else in the file uses it.

- [ ] **Step 5: Run the tests and typecheck**

Run: `bun run test lib/ti/dns/fcrdns.test.ts && bun run typecheck`
Expected: PASS both, including the three pre-existing IPv4 fcrdns cases.

- [ ] **Step 6: Commit**

```bash
git add lib/ti/dns/fcrdns.ts lib/ti/dns/fcrdns.test.ts lib/ti/sources/reverse-dns.ts
git commit -m "feat(dns): IPv6 FCrDNS via ip6.arpa, AAAA, canonical comparison"
```

---

### Task 3: Declare and gate IP family

Add the capability flag and enforce it. The gate lives in the IP orchestrator rather than `lib/ti/orchestrate.ts`, because `runSource` and `runAll` are shared with the domain and hash pipelines where "IP family" is meaningless.

Unsupported sources become synthesized `skipped` rows rather than vanishing, so `stats.skipped` stays meaningful and the UI shows them exactly as it shows key-gated skips.

**Files:**
- Modify: `lib/ti/types.ts` (add one field to `SourceMeta`, near the `timeoutMs` field)
- Modify: `lib/ti/check.ts` (whole file)
- Test: `lib/ti/check.test.ts` (create)

**Interfaces:**
- Consumes: `parseIP` from `lib/ip.ts`, `runAll` from `lib/ti/orchestrate.ts`, `assembleIpResult` from `lib/ti/assemble.ts`, `sources` from `lib/ti/registry.ts` (all existing).
- Produces:
  - `SourceMeta.families?: (4 | 6)[]` in `lib/ti/types.ts`.
  - `supportsFamily(source: TiSource, family: 4 | 6): boolean` exported from `lib/ti/check.ts`.
  - `checkIp(ip: string, onSettled?: (r: SourceResult) => void): Promise<CheckResult>`, unchanged signature.

- [ ] **Step 1: Write the failing test**

Create `lib/ti/check.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { supportsFamily } from "@/lib/ti/check";
import type { TiSource } from "@/lib/ti/types";

/** A source declaring the given families (omit to leave the field unset). */
function fakeSource(id: string, families?: (4 | 6)[]): TiSource {
  return {
    meta: {
      id,
      name: id,
      url: "https://example.test",
      category: "reputation",
      requiresKey: false,
      weight: 1,
      ...(families ? { families } : {}),
    },
    isEnabled: () => true,
    check: async () => ({ status: "ok" as const, score: 0 }),
  };
}

describe("supportsFamily", () => {
  it("treats an unset families field as IPv4 only", () => {
    const source = fakeSource("legacy");
    expect(supportsFamily(source, 4)).toBe(true);
    expect(supportsFamily(source, 6)).toBe(false);
  });

  it("honors an explicit dual-family declaration", () => {
    const source = fakeSource("modern", [4, 6]);
    expect(supportsFamily(source, 4)).toBe(true);
    expect(supportsFamily(source, 6)).toBe(true);
  });

  it("honors a v6-only declaration", () => {
    const source = fakeSource("v6only", [6]);
    expect(supportsFamily(source, 4)).toBe(false);
    expect(supportsFamily(source, 6)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test lib/ti/check.test.ts`
Expected: FAIL with `supportsFamily` not exported from `@/lib/ti/check`, and a TypeScript error on the unknown `families` property.

- [ ] **Step 3: Add the `families` field to `SourceMeta`**

In `lib/ti/types.ts`, inside `interface SourceMeta`, add after the `timeoutMs` field:

```ts
  /**
   * IP families this source can answer for. Omitted means IPv4 only, so every
   * existing source keeps its behavior and a newly added one is v4 until it
   * proves otherwise. The failure mode of forgetting the flag is a missing
   * source, not a broken one.
   */
  families?: (4 | 6)[];
```

- [ ] **Step 4: Rewrite `lib/ti/check.ts`**

```ts
import type { CheckResult, SourceResult, TiSource } from "./types";
import { parseIP } from "@/lib/ip";
import { sources } from "./registry";
import { runAll } from "./orchestrate";
import { assembleIpResult } from "./assemble";

/** Whether a source can answer for this IP family. Unset means IPv4 only. */
export function supportsFamily(source: TiSource, family: 4 | 6): boolean {
  return (source.meta.families ?? [4]).includes(family);
}

export async function checkIp(
  ip: string,
  onSettled?: (result: SourceResult) => void,
): Promise<CheckResult> {
  const family = parseIP(ip)?.version ?? 4;

  const supported: TiSource[] = [];
  const unsupported: TiSource[] = [];
  for (const source of sources) {
    (supportsFamily(source, family) ? supported : unsupported).push(source);
  }

  // Sources that cannot answer for this family are reported as skipped rather
  // than dropped, so they stay visible in the UI the way key-gated ones do and
  // stats.skipped keeps counting them. They cost no network request.
  const skipped: SourceResult[] = unsupported.map((source) => ({
    source: source.meta,
    enabled: true,
    status: "skipped",
    summary: `Does not support IPv${family}`,
    durationMs: 0,
  }));
  for (const result of skipped) onSettled?.(result);

  const ran = await runAll(supported, ip, onSettled);

  // Restore registry order so display order does not depend on which sources
  // happened to be skipped.
  const byId = new Map(
    [...ran, ...skipped].map((result) => [result.source.id, result]),
  );
  const results = sources
    .map((source) => byId.get(source.meta.id))
    .filter((result): result is SourceResult => result !== undefined);

  return assembleIpResult(ip, results, new Date().toISOString());
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun run test lib/ti/check.test.ts && bun run typecheck`
Expected: PASS both.

- [ ] **Step 6: Commit**

```bash
git add lib/ti/types.ts lib/ti/check.ts lib/ti/check.test.ts
git commit -m "feat(ti): declare source IP families and gate the IP pipeline"
```

---

### Task 4: Spamhaus DROP IPv6 feed

Spamhaus publishes `drop_v6.json` in the same newline-delimited JSON shape as `drop_v4.json`, listing /48 blocks. The module currently hardcodes the v4 URL and holds one module-level cache, so it needs a per-family feed and a per-family cache entry.

Scoring stays exactly as it is (weight `0.3`, score `55`, no `malicious: true`). The existing comment already explains why netblock-granularity listing must not force a malicious verdict on one address, and that reasoning holds identically for a /48.

**Files:**
- Modify: `lib/ti/sources/spamhaus-drop.ts:37-48` (feed URL and cache) and its `meta` and `check`
- Test: `lib/ti/sources/spamhaus-drop.test.ts` (append)

**Interfaces:**
- Consumes: `cidrContains` with IPv6 support (Task 1), `SourceMeta.families` (Task 3).
- Produces: `spamhausDropSource` with `families: [4, 6]`. `parseDropFeed` and `matchDrop` keep their existing signatures.

- [ ] **Step 1: Write the failing test**

Append to `lib/ti/sources/spamhaus-drop.test.ts`:

```ts
const FEED_V6 = [
  '{"cidr":"2001:678:254::/48","sblid":"SBL697648","rir":"ripencc"}',
  '{"cidr":"2001:678:6c0::/48","sblid":"SBL624855","rir":"ripencc"}',
].join("\n");

describe("matchDrop — IPv6", () => {
  const blocks = parseDropFeed(FEED_V6);

  it("parses the v6 feed with the same shape as v4", () => {
    expect(blocks).toEqual([
      { cidr: "2001:678:254::/48", sblid: "SBL697648" },
      { cidr: "2001:678:6c0::/48", sblid: "SBL624855" },
    ]);
  });

  it("returns the /48 that contains the address", () => {
    expect(matchDrop("2001:678:254:abcd::1", blocks)).toEqual({
      cidr: "2001:678:254::/48",
      sblid: "SBL697648",
    });
  });

  it("returns null when no v6 block contains the address", () => {
    expect(matchDrop("2001:4860:4860::8888", blocks)).toBeNull();
  });

  it("does not match a v4 address against v6 blocks", () => {
    expect(matchDrop("8.8.8.8", blocks)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test lib/ti/sources/spamhaus-drop.test.ts`
Expected: FAIL on the containment cases if Task 1 is not yet merged. If Task 1 is merged these pass immediately, which is expected; the behavior change in this task is the feed selection, covered from Step 3 on.

- [ ] **Step 3: Replace the feed and cache plumbing**

In `lib/ti/sources/spamhaus-drop.ts`, replace the `FEED_URL` constant and the cache block (the `const FEED_URL`, `interface Cache`, `let cache`, `let inflight`, and `loadFeed` definitions) with:

```ts
const FEEDS: Record<4 | 6, string> = {
  4: "https://www.spamhaus.org/drop/drop_v4.json",
  6: "https://www.spamhaus.org/drop/drop_v6.json",
};
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours — DROP changes slowly

interface Cache {
  blocks: DropBlock[];
  fetchedAt: number;
}

// One cache and one in-flight promise per family: the two feeds are separate
// documents with independent lifetimes, and a v6 lookup must not be served the
// v4 blocklist.
const caches: Partial<Record<4 | 6, Cache>> = {};
const inflight: Partial<Record<4 | 6, Promise<Cache>>> = {};

async function loadFeed(family: 4 | 6, signal: AbortSignal): Promise<Cache> {
  const cached = caches[family];
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached;

  const pending = inflight[family];
  if (pending) return pending;

  const request = (async () => {
    const { ok, status, text } = await getText(FEEDS[family], signal);
    if (!ok) throw new Error(`feed unavailable (HTTP ${status})`);
    const fresh: Cache = { blocks: parseDropFeed(text), fetchedAt: Date.now() };
    caches[family] = fresh;
    return fresh;
  })();
  inflight[family] = request;

  try {
    return await request;
  } finally {
    delete inflight[family];
  }
}
```

Keep the original `TTL_MS` declaration only once; if it already sits above the removed block, do not duplicate it.

- [ ] **Step 4: Declare the family and select the feed**

In the same file, add `families: [4, 6],` to the `meta` object (after `weight: 0.3,`), and change the first line of `check` to select the family:

```ts
  async check(ip, signal): Promise<SourceFinding> {
    const family = ip.includes(":") ? 6 : 4;
    try {
      const { blocks } = await loadFeed(family, signal);
```

The rest of `check` is unchanged.

- [ ] **Step 5: Run the tests and typecheck**

Run: `bun run test lib/ti/sources/spamhaus-drop.test.ts && bun run typecheck`
Expected: PASS both.

- [ ] **Step 6: Commit**

```bash
git add lib/ti/sources/spamhaus-drop.ts lib/ti/sources/spamhaus-drop.test.ts
git commit -m "feat(spamhaus-drop): add the IPv6 DROP feed with a per-family cache"
```

---

### Task 5: OTX IPv6 indicator path

OTX namespaces its indicator API by type, and `otx.ts` hardcodes `IPv4` in both URLs. The v6 path was confirmed live: `/api/v1/indicators/IPv6/2001:4860:4860::8888/general` returns 200. The address goes into the path raw, with colons unescaped, which is what the probe exercised.

**Files:**
- Modify: `lib/ti/sources/otx.ts` (add a helper, use it in both URLs, add `families`)
- Test: `lib/ti/sources/otx.test.ts` (append)

**Interfaces:**
- Consumes: `SourceMeta.families` (Task 3).
- Produces: `otxIndicatorType(ip: string): "IPv4" | "IPv6"` exported from `lib/ti/sources/otx.ts`. `otxScore` and `otxSource` are unchanged in signature; `otxSource.meta` gains `families: [4, 6]`.

- [ ] **Step 1: Write the failing test**

Append to `lib/ti/sources/otx.test.ts`, and add `otxIndicatorType` to the existing import from `./otx` on line 2:

```ts
describe("otxIndicatorType", () => {
  it("selects the IPv4 indicator namespace for a v4 address", () => {
    expect(otxIndicatorType("8.8.8.8")).toBe("IPv4");
  });

  it("selects the IPv6 indicator namespace for a v6 address", () => {
    expect(otxIndicatorType("2001:4860:4860::8888")).toBe("IPv6");
    expect(otxIndicatorType("::1")).toBe("IPv6");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test lib/ti/sources/otx.test.ts`
Expected: FAIL with `otxIndicatorType` not exported.

- [ ] **Step 3: Add the helper and use it**

In `lib/ti/sources/otx.ts`, add above `otxScore`:

```ts
/** OTX namespaces its indicator API by type; pick the one matching the family. */
export function otxIndicatorType(ip: string): "IPv4" | "IPv6" {
  return ip.includes(":") ? "IPv6" : "IPv4";
}
```

Add `families: [4, 6],` to `meta` (after `keyEnv: "OTX_API_KEY",`).

Inside `check`, after the `const headers` line, add:

```ts
    const indicator = otxIndicatorType(ip);
```

Then change both URLs to use it:

```ts
          `https://otx.alienvault.com/api/v1/indicators/${indicator}/${ip}/general`,
```

```ts
          `https://otx.alienvault.com/api/v1/indicators/${indicator}/${ip}/malware`,
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `bun run test lib/ti/sources/otx.test.ts && bun run typecheck`
Expected: PASS both, including the pre-existing `otxScore` and no-hard-malicious-flag cases.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/sources/otx.ts lib/ti/sources/otx.test.ts
git commit -m "feat(otx): select the IPv6 indicator namespace by address family"
```

---

### Task 6: Register the unwired sources and declare families across the registry

`spamhausDropSource` and `otxSource` are fully implemented and unit-tested but appear in no registry, so neither has ever run, for IPv4 either. Registering them is what gives IPv6 a keyless scoring source beyond Shodan InternetDB.

**This deliberately changes IPv4 results**, since both sources now contribute there too. That was weighed and accepted in the spec; do not treat a shifted IPv4 score in an existing test as a regression to be reverted, but do report any test that breaks.

The eleven other v6-capable sources get their `families` flag here too. Every family assignment below was verified live against `2001:4860:4860::8888`; do not add `6` to anything not on this list.

**Files:**
- Modify: `lib/ti/registry.ts` (imports and the `sources` array)
- Modify (add `families: [4, 6],` to `meta`): `lib/ti/sources/ipapi.ts`, `ipwhois.ts`, `rdap-ip.ts`, `ipinfo.ts`, `ipgeolocation.ts`, `freeipapi.ts`, `reverse-dns.ts`, `ripestat.ts`, `peeringdb.ts`, `shodan-internetdb.ts`, `abuseipdb.ts`
- Test: `lib/ti/registry.test.ts` (create)

**Interfaces:**
- Consumes: `SourceMeta.families` (Task 3), `spamhausDropSource` with `families` (Task 4), `otxSource` with `families` (Task 5).
- Produces: `sources: TiSource[]` grows from 23 to 25 entries; thirteen of them declare `families: [4, 6]`.

- [ ] **Step 1: Write the failing test**

Create `lib/ti/registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sources } from "@/lib/ti/registry";

describe("IP source registry", () => {
  it("has no duplicate source ids", () => {
    const ids = sources.map((s) => s.meta.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("registers the sources that were implemented but left unwired", () => {
    // Both shipped with adapters and tests but no registry entry, so neither
    // ever ran. This guards against that happening again.
    const ids = sources.map((s) => s.meta.id);
    expect(ids).toContain("spamhaus-drop");
    expect(ids).toContain("otx");
  });

  it("declares a family set that always includes IPv4", () => {
    for (const source of sources) {
      expect(source.meta.families ?? [4]).toContain(4);
    }
  });

  it("marks exactly the verified sources as IPv6-capable", () => {
    const v6 = sources
      .filter((s) => (s.meta.families ?? [4]).includes(6))
      .map((s) => s.meta.id)
      .sort();
    expect(v6).toEqual(
      [
        "abuseipdb",
        "freeipapi",
        "ip-api",
        "ipgeolocation",
        "ipinfo",
        "ipwhois",
        "otx",
        "peeringdb",
        "rdap-ip",
        "reverse-dns",
        "ripestat",
        "shodan-internetdb",
        "spamhaus-drop",
      ].sort(),
    );
  });
});
```

Note: the expected ids must match each source's actual `meta.id`. Before running, confirm each id with:

```bash
grep -h "id: \"" lib/ti/sources/*.ts | sort
```

If any id above differs (for example `ip-api` versus `ipapi`), correct the test to the real value rather than renaming the source.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test lib/ti/registry.test.ts`
Expected: FAIL. `spamhaus-drop` and `otx` are missing from the registry, and the IPv6-capable list is short.

- [ ] **Step 3: Register the two sources**

In `lib/ti/registry.ts`, add the imports alongside the others:

```ts
import { spamhausDropSource } from "./sources/spamhaus-drop";
import { otxSource } from "./sources/otx";
```

Add them to the `sources` array, following the existing grouping: `spamhausDropSource` after `ipsumSource` (with the other blocklists), and `otxSource` after `virusTotalSource` (with the other key-gated reputation sources).

- [ ] **Step 4: Declare families on the eleven remaining sources**

Add `families: [4, 6],` to the `meta` object of each file listed under **Files** above. Place it immediately after the `weight:` line in each, for consistency. Do not change any other meta field, and do not touch the twelve v4-only sources (`reverse-ip`, `dnsbl`, `blocklist-de`, `ipsum`, `feodo`, `et-open`, `tor`, `virustotal`, `pdns`, `greynoise`, `threatfox`, `criminalip`).

- [ ] **Step 5: Run the full suite**

Run: `bun run test && bun run typecheck && bun run lint`
Expected: PASS. If a pre-existing test fails because DROP or OTX now contributes to an IPv4 fixture, that is the accepted IPv4 impact: update the fixture's expected value to the new correct one and note it in the commit body. Do not unregister the source to make a test pass.

- [ ] **Step 6: Commit**

```bash
git add lib/ti/registry.ts lib/ti/registry.test.ts lib/ti/sources/
git commit -m "feat(registry): wire up Spamhaus DROP and OTX, declare IP families

Both sources shipped with adapters and unit tests but no registry entry,
so neither had ever run. Registering them gives IPv6 a keyless scoring
source and also changes IPv4 scores, which is accepted per the spec."
```

---

### Task 7: Accept IPv6 at the API boundary

`validateIp` parses with `parseIPv4`, so every IPv6 gets a 400. Swapping in `parseIP` is sufficient: `parseIPv6` already populates `scopeNote` for loopback, unspecified, link-local, ULA, documentation, multicast, and IPv4-mapped, so the existing 422 for non-routable addresses covers v6 unchanged.

Returning `parsed.ip` (already the code's behavior) now matters more: it is the RFC 5952 canonical form, so `2001:DB8::1` and `2001:db8::0:1` collapse to one cache and history key.

**Files:**
- Modify: `app/api/check/route.ts:14-38` (`validateIp` and its import)
- Test: `lib/ti/route-validate.test.ts` (create)

**Interfaces:**
- Consumes: `parseIP` from `lib/ip.ts` (existing), `Validated<string>` from `lib/ti/route-handler.ts` (existing).
- Produces: `validateIp(raw: string | null): Validated<string>` exported from `app/api/check/route.ts` so it can be unit-tested.

- [ ] **Step 1: Write the failing test**

Create `lib/ti/route-validate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateIp } from "@/app/api/check/route";

/** The validated IP, or the HTTP status of the rejection. `Validated<V>` is
 *  `{ value: V } | { error: Response }`, so narrow on which key is present. */
function outcome(raw: string | null) {
  const result = validateIp(raw);
  return "value" in result
    ? { ok: true as const, value: result.value }
    : { ok: false as const, status: result.error.status };
}

describe("validateIp", () => {
  it("accepts a routable IPv4", () => {
    expect(outcome("8.8.8.8")).toEqual({ ok: true, value: "8.8.8.8" });
  });

  it("accepts a routable IPv6 and canonicalizes it", () => {
    // Uppercase and an uncompressed zero run must collapse to one cache key,
    // or the same address typed two ways becomes two cache entries.
    expect(outcome("2001:4860:4860:0:0:0:0:8888")).toEqual({
      ok: true,
      value: "2001:4860:4860::8888",
    });
    expect(outcome("2606:4700:4700:0000:0000:0000:0000:1111")).toEqual({
      ok: true,
      value: "2606:4700:4700::1111",
    });
  });

  it("rejects a non-routable IPv6 with 422", () => {
    expect(outcome("::1").status).toBe(422); // loopback
    expect(outcome("fe80::1").status).toBe(422); // link-local
    expect(outcome("fd00::1").status).toBe(422); // unique local
    expect(outcome("2001:db8::1").status).toBe(422); // documentation
  });

  it("rejects malformed IPv6 with 400", () => {
    expect(outcome("2001:db8:::1").status).toBe(400); // triple colon
    expect(outcome("fe80::1%eth0").status).toBe(400); // zone id
    expect(outcome("gggg::1").status).toBe(400);
  });

  it("rejects a missing parameter with 400", () => {
    expect(outcome(null).status).toBe(400);
  });
});
```

Do not use a `2001:db8::` address as a "valid" case: that range is documentation scope (RFC 3849) and is correctly rejected 422, which is why the canonicalization assertions use Google and Cloudflare resolver addresses instead.

If importing `@/app/api/check/route` fails under Vitest (the module also evaluates `makeIndicatorRoute` at import time), extract `validateIp` into `lib/ti/validate-ip.ts`, import it from both the route and the test, and leave the route's other exports untouched. Prefer testing it in place; only extract if the import genuinely fails.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test lib/ti/route-validate.test.ts`
Expected: FAIL. `validateIp` is not exported, and once exported the IPv6 cases return 400 instead of being accepted.

- [ ] **Step 3: Accept both families**

In `app/api/check/route.ts`, change the import on line 1:

```ts
import { parseIP } from "@/lib/ip";
```

Export `validateIp` and swap the parser and the message:

```ts
/** Validate the IP up front, returning the clean IP or an error Response. */
export function validateIp(raw: string | null): Validated<string> {
  if (!raw) {
    return {
      error: Response.json({ error: "Missing 'ip' parameter" }, { status: 400 }),
    };
  }
  const parsed = parseIP(raw);
  if (!parsed) {
    return {
      error: Response.json({ error: "Invalid IP address" }, { status: 400 }),
    };
  }
```

The `isPrivate || isReserved` branch and the `return { value: parsed.ip }` are unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test lib/ti/route-validate.test.ts && bun run typecheck`
Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add app/api/check/route.ts lib/ti/route-validate.test.ts
git commit -m "feat(api): accept IPv6 on /api/check, canonicalized for cache keys"
```

---

### Task 8: Route IPv6 through the checker UI

Three IPv4 assumptions in `components/Checker.tsx`. `validateInput` rejects v6 client-side so it never reaches the API at all; `canonicalFor` falls back to raw input so the permalink and cache key vary by spelling; `bulkTargets` diverts a lone v6 to the geo table.

**Files:**
- Modify: `components/Checker.tsx:27` (import), `:136-142` (`validateInput`), `:169` (`canonicalFor`), `:190-200` (`bulkTargets`)

**Interfaces:**
- Consumes: `parseIP` from `lib/ip.ts` (existing), `/api/check` accepting v6 (Task 7).
- Produces: no new exports. `bulkTargets(value: string): ParsedIP[] | null` keeps its signature.

- [ ] **Step 1: Swap the parser in the import**

Line 27 becomes:

```ts
import { parseIP, type ParsedIP } from "@/lib/ip";
```

- [ ] **Step 2: Accept IPv6 in client-side validation**

In `validateInput`, replace the `mode === "ip"` branch:

```ts
  if (mode === "ip") {
    const parsed = parseIP(value);
    if (!parsed) {
      return `"${value}" isn't a valid IP address. Try something like 8.8.8.8.`;
    }
    if (parsed.isPrivate || parsed.isReserved) {
      return `${parsed.scopeNote}. This address can't be checked against threat-intel feeds.`;
    }
  } else if (mode === "domain") {
```

- [ ] **Step 3: Canonicalize IPv6 for the permalink and cache key**

Line 169 becomes:

```ts
  if (detected === "ip") return parseIP(value)?.ip ?? value;
```

Also update the docstring above `canonicalFor`, which says "the parsed IPv4":

```ts
/**
 * The exact value the lookup runs on: the refanged input reduced to its
 * canonical IOC, the parsed IP (RFC 5952 form for v6), the apex domain (so a
 * pasted URL becomes just its host), or the normalized hash. Falls back to the
 * input until a type is recognized. Used both for the "we'll check …" hint and
 * the permalink.
 */
```

- [ ] **Step 4: Stop diverting a lone IPv6 to the geo table**

Replace `bulkTargets` and its docstring:

```ts
/** The IPs a value would bulk-geolocate, or null if it isn't a bulk case. */
function bulkTargets(value: string): ParsedIP[] | null {
  const ips = extractIps(value);
  return ips.length >= 2 ? ips : null;
}
```

- [ ] **Step 5: Verify nothing else expects the old behavior**

Run: `grep -n "parseIPv4\|IPv4-only\|IPv4 only" components/Checker.tsx`
Expected: no matches. If any remain, they are stale and must be updated to match the changes above.

Run: `bun run typecheck && bun run lint && bun run test`
Expected: PASS all three.

- [ ] **Step 6: Commit**

```bash
git add components/Checker.tsx
git commit -m "feat(ui): run the full check for a single IPv6 indicator"
```

---

### Task 9: End-to-end verification against live sources

Every source exercised here is keyless, so the real pipeline can be driven without credentials. This task adds no code; it confirms the feature works and records what was observed.

**Files:**
- No source changes expected. If a defect is found, fix it in the file that owns it and note the fix in the commit body.

**Interfaces:**
- Consumes: everything from Tasks 1 through 8.

- [ ] **Step 1: Start the dev server**

The user runs their own `next dev` on port 3000 behind ngrok. Do not kill or restart it, and do not run a broad `pkill`. Check first:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
```

If that returns 200, use the running server. If it returns nothing, start one on a different port with `bun run dev -- -p 3100` and use `:3100` below.

- [ ] **Step 2: Check a known-listed IPv6**

Derive a live address from the first /48 in the DROP v6 feed, so the test does
not depend on a listing that may have been withdrawn:

```bash
TARGET=$(curl -s https://www.spamhaus.org/drop/drop_v6.json | head -1 | python3 -c "
import ipaddress, json, sys
net = ipaddress.ip_network(json.loads(sys.stdin.readline())['cidr'])
print(net.network_address + 1)
")
echo "testing $TARGET"
curl -s "http://localhost:3000/api/check?ip=$TARGET" | python3 -m json.tool | head -40
```

Expected: HTTP 200, `verdict` not `unknown`, `riskScore` above 0, and the
`spamhaus-drop` source row reporting `Within Spamhaus DROP netblock <cidr>`.

If `riskScore` is 0 while the `spamhaus-drop` row shows a hit, the bug is in
scoring, not in this task's feed work; check that Task 6 actually registered the
source and that `aggregateRisk` was not modified.

- [ ] **Step 3: Check a known-clean IPv6**

```bash
curl -s "http://localhost:3000/api/check?ip=2001:4860:4860::8888" \
  | python3 -m json.tool | head -60
```

Expected: HTTP 200. Confirm each of these appears: geo from ip-api or ipwho.is, an RDAP allocation, the RIPEstat prefix `2001:4860::/32`, PeeringDB network type, PTR `dns.google`, and Shodan InternetDB ports including 53 and 443. Confirm the v4-only sources appear as `skipped` with summary `Does not support IPv6`, and that `stats.skipped` counts them.

- [ ] **Step 4: Confirm the non-routable and malformed paths**

```bash
curl -s -o /dev/null -w "422 expected: %{http_code}\n" "http://localhost:3000/api/check?ip=fe80::1"
curl -s -o /dev/null -w "400 expected: %{http_code}\n" "http://localhost:3000/api/check?ip=2001:db8:::1"
curl -s -o /dev/null -w "200 expected: %{http_code}\n" "http://localhost:3000/api/check?ip=8.8.8.8"
```

- [ ] **Step 5: Confirm the permalink round-trip**

This is the highest-risk item in the spec, because colons in a path segment are legal but commonly percent-encoded, and unit tests would not catch a mismatch.

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/check/2001:4860:4860::8888"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/check/2001%3A4860%3A4860%3A%3A8888"
```

Expected: 200 for both, and the page renders the cached verdict rather than an error. Then load the encoded URL in a browser and confirm the result paints on first load and that browser Back and Forward still re-sync the view.

- [ ] **Step 6: Confirm the UI path**

Run `bun run dev` if not already running, open the app, paste `2001:4860:4860::8888` into the checker, and confirm it runs the full check with a verdict rather than rendering the bulk geo table. Then paste two IPv6 addresses separated by a space and confirm that still renders the bulk geo table. If the UI cannot be verified in this environment, say so explicitly rather than assuming it works.

- [ ] **Step 7: Full verification sweep**

Run: `bun run typecheck && bun run lint && bun run test && bun run build`
Expected: PASS all four. This is the same order CI uses, because the first three localize a failure better than a build log does.

- [ ] **Step 8: Commit any fixes and update the spec status**

If Steps 2 through 7 required no code changes, mark the spec approved:

```bash
sed -i 's/^\*\*Status:\*\* Approved (pending spec review)$/**Status:** Implemented/' \
  docs/superpowers/specs/2026-08-15-ipv6-investigation-design.md
git add docs/superpowers/specs/2026-08-15-ipv6-investigation-design.md
git commit -m "docs: mark the IPv6 pipeline spec implemented"
```

---

## Notes for the implementer

- **Task order matters.** Task 4 depends on Task 1 (v6 CIDR), Task 6 depends on Tasks 3, 4, and 5 (the `families` field and both sources being v6-ready), and Task 8 depends on Task 7 (the API accepting v6). Tasks 1, 2, 3, and 5 are independent of each other.
- **The ThreatFox source is already broken** and is not in scope. Its keyless `search_ioc` query now returns `{"error": "Unauthorized"}`. If you see a ThreatFox error row during Task 9, that is pre-existing on IPv4 and should not be fixed here. It needs its own change.
- **IPv6 verdicts will read `unknown` more often than IPv4 ones**, because only Shodan InternetDB and Spamhaus DROP score for v6 without an API key. That is real feed coverage, not a bug, and it must not be papered over by inventing confidence the data does not support.
- **DNSBL v6 support is deliberately unresolved.** Both `zen.spamhaus.org` and `dnsbl.dronebl.org` returned nothing for a clean v6 nibble query, which is the expected NXDOMAIN either way. Confirming support needs a known-listed v6 address. Do not add `families: [4, 6]` to `dnsbl.ts` on the strength of a clean-address probe.
