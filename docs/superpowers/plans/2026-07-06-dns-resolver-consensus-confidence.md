# DNS Resolver Consensus Confidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the binary two-resolver `resolverAgreement` flag with a multi-resolver **consensus confidence** over a pool of unfiltered DoH-JSON resolvers, surfaced as a context-only readout on the domain result page.

**Architecture:** A new pure module `lib/ti/dns/consensus.ts` tallies per-resolver A-record answer sets into a `ResolverConsensus` (votes, confidence ratio, plurality IP set, disagreement variants). `dnsSource` queries the A record across an expanded `UNFILTERED_RESOLVERS` pool and emits the consensus in `details`/`domainContext`. The profile UI renders the confidence. `dnsSource` stays `weight: 0` — no score impact.

**Tech Stack:** TypeScript, Next.js 16, Vitest (colocated `*.test.ts`, `@/` alias, no network). DNS-over-HTTPS JSON (`application/dns-json`) via the helpers in `lib/ti/http.ts` and `lib/ti/dns/doh.ts`.

## Global Constraints

- **Free APIs only** — all resolvers must be no-cost public DoH endpoints.
- **`dnsSource` weight stays `0`** — consensus is context-only and must never move the 0-100 risk score.
- **Unfiltered resolvers only** in the consensus pool — no security/filtering resolvers (they block malicious domains, which is a separate signal / separate spec).
- **JSON-DoH transport only** — no RFC-8484 wireformat resolvers.
- **HTTP via helpers** — use `dohQuery` / `getJson`, never bare `fetch`; honor the `AbortSignal`.
- **User-facing copy uses commas, not dashes** — no em/en-dash or " - " separators in strings shown to users.
- Run `npm test` and `npm run lint` before declaring the feature done.

---

### Task 1: `ResolverConsensus` type + `ipConsensus` pure module

**Files:**
- Modify: `lib/ti/types.ts` (add `ResolverConsensus` interface near `DomainContext`, ~line 46)
- Create: `lib/ti/dns/consensus.ts`
- Test: `lib/ti/dns/consensus.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `interface ResolverConsensus { respondingResolvers: number; totalResolvers: number; consensusIps: string[]; agreeCount: number; confidence: number; bucket: "high" | "medium" | "low"; variants: { ips: string[]; count: number }[] }` (exported from `lib/ti/types.ts`)
  - `interface ResolverVote { resolver: string; ips: string[] | null }` (exported from `lib/ti/dns/consensus.ts`; `ips: null` means the resolver did not respond)
  - `ipConsensus(votes: ResolverVote[]): ResolverConsensus` (exported from `lib/ti/dns/consensus.ts`)

- [ ] **Step 1: Add the `ResolverConsensus` type to the shared model**

In `lib/ti/types.ts`, add this interface immediately above `export interface DomainContext {` (around line 46):

```ts
/**
 * Consensus over the unfiltered DoH resolver pool for a domain's A record.
 * Context-only: describes how strongly resolvers agree on the resolved IP set,
 * never a malicious verdict. A resolver that times out is a non-vote (excluded
 * from `respondingResolvers`), not a disagreement.
 */
export interface ResolverConsensus {
  /** Resolvers that returned an answer set (empty set counts; timeout does not). */
  respondingResolvers: number;
  /** Resolvers queried. */
  totalResolvers: number;
  /** The A-record IP set returned by the plurality of responders. */
  consensusIps: string[];
  /** How many responders returned the consensus set. */
  agreeCount: number;
  /** agreeCount / respondingResolvers, 0..1. */
  confidence: number;
  /** high = all responders agree, medium = strict majority, low = otherwise. */
  bucket: "high" | "medium" | "low";
  /** Distinct answer sets with counts, most common first. */
  variants: { ips: string[]; count: number }[];
}
```

- [ ] **Step 2: Write the failing test**

Create `lib/ti/dns/consensus.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ipConsensus, type ResolverVote } from "@/lib/ti/dns/consensus";

const vote = (resolver: string, ips: string[] | null): ResolverVote => ({
  resolver,
  ips,
});

describe("ipConsensus", () => {
  it("reports high confidence when every responder agrees", () => {
    const c = ipConsensus([
      vote("cloudflare", ["1.2.3.4"]),
      vote("google", ["1.2.3.4"]),
      vote("adguard", ["1.2.3.4"]),
    ]);
    expect(c.consensusIps).toEqual(["1.2.3.4"]);
    expect(c.agreeCount).toBe(3);
    expect(c.respondingResolvers).toBe(3);
    expect(c.confidence).toBe(1);
    expect(c.bucket).toBe("high");
  });

  it("is order-insensitive when comparing answer sets", () => {
    const c = ipConsensus([
      vote("cloudflare", ["1.1.1.1", "2.2.2.2"]),
      vote("google", ["2.2.2.2", "1.1.1.1"]),
    ]);
    expect(c.bucket).toBe("high");
    expect(c.agreeCount).toBe(2);
  });

  it("reports medium for a strict majority", () => {
    const c = ipConsensus([
      vote("cloudflare", ["1.2.3.4"]),
      vote("google", ["1.2.3.4"]),
      vote("adguard", ["1.2.3.4"]),
      vote("dns0", ["9.9.9.9"]),
    ]);
    expect(c.consensusIps).toEqual(["1.2.3.4"]);
    expect(c.agreeCount).toBe(3);
    expect(c.bucket).toBe("medium");
  });

  it("reports low for a three-way split with no majority", () => {
    const c = ipConsensus([
      vote("cloudflare", ["1.1.1.1"]),
      vote("google", ["2.2.2.2"]),
      vote("adguard", ["3.3.3.3"]),
    ]);
    expect(c.bucket).toBe("low");
    expect(c.agreeCount).toBe(1);
    expect(c.variants).toHaveLength(3);
  });

  it("excludes non-responders from the denominator, not lowering confidence", () => {
    const c = ipConsensus([
      vote("cloudflare", ["1.2.3.4"]),
      vote("google", ["1.2.3.4"]),
      vote("adguard", null),
    ]);
    expect(c.respondingResolvers).toBe(2);
    expect(c.totalResolvers).toBe(3);
    expect(c.confidence).toBe(1);
    expect(c.bucket).toBe("high");
  });

  it("treats partial CDN overlap as separate variants", () => {
    const c = ipConsensus([
      vote("cloudflare", ["1.1.1.1", "2.2.2.2"]),
      vote("google", ["2.2.2.2", "3.3.3.3"]),
    ]);
    expect(c.variants).toHaveLength(2);
    expect(c.bucket).toBe("low");
  });

  it("treats a single responder as high confidence", () => {
    const c = ipConsensus([vote("cloudflare", ["1.2.3.4"])]);
    expect(c.bucket).toBe("high");
    expect(c.confidence).toBe(1);
    expect(c.consensusIps).toEqual(["1.2.3.4"]);
  });

  it("returns an empty consensus when nobody responds", () => {
    const c = ipConsensus([vote("cloudflare", null), vote("google", null)]);
    expect(c.respondingResolvers).toBe(0);
    expect(c.consensusIps).toEqual([]);
    expect(c.confidence).toBe(1);
    expect(c.bucket).toBe("high");
  });

  it("breaks ties deterministically by smallest canonical set", () => {
    const c = ipConsensus([
      vote("a", ["9.9.9.9"]),
      vote("b", ["1.1.1.1"]),
    ]);
    // Tie (1 each): the lexicographically smallest canon ("1.1.1.1") wins.
    expect(c.consensusIps).toEqual(["1.1.1.1"]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/ti/dns/consensus.test.ts`
Expected: FAIL — cannot resolve `@/lib/ti/dns/consensus` (module not created yet).

- [ ] **Step 4: Write the implementation**

Create `lib/ti/dns/consensus.ts`:

```ts
import type { ResolverConsensus } from "../types";

export interface ResolverVote {
  resolver: string;
  /** A-record IP set, or null when the resolver did not respond. */
  ips: string[] | null;
}

/** Canonical, order-insensitive form of an answer set. */
const canon = (ips: string[]): string => [...ips].sort().join(",");

/**
 * Fold per-resolver A-record answer sets into a consensus. Non-responders
 * (ips === null) are dropped before tallying. The plurality answer set wins;
 * ties break by smallest canonical form so output is deterministic.
 */
export function ipConsensus(votes: ResolverVote[]): ResolverConsensus {
  const totalResolvers = votes.length;
  const responders = votes.filter(
    (v): v is { resolver: string; ips: string[] } => v.ips !== null,
  );
  const respondingResolvers = responders.length;

  if (respondingResolvers === 0) {
    return {
      respondingResolvers: 0,
      totalResolvers,
      consensusIps: [],
      agreeCount: 0,
      confidence: 1,
      bucket: "high",
      variants: [],
    };
  }

  const byCanon = new Map<string, { ips: string[]; count: number }>();
  for (const r of responders) {
    const key = canon(r.ips);
    const existing = byCanon.get(key);
    if (existing) existing.count += 1;
    else byCanon.set(key, { ips: r.ips, count: 1 });
  }

  // Most common first; ties broken by smallest canonical key for determinism.
  const variants = [...byCanon.entries()]
    .sort((a, b) => b[1].count - a[1].count || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([, v]) => v);

  const winner = variants[0];
  const agreeCount = winner.count;
  const confidence = agreeCount / respondingResolvers;

  let bucket: "high" | "medium" | "low";
  if (agreeCount === respondingResolvers) bucket = "high";
  else if (agreeCount > respondingResolvers / 2) bucket = "medium";
  else bucket = "low";

  return {
    respondingResolvers,
    totalResolvers,
    consensusIps: winner.ips,
    agreeCount,
    confidence,
    bucket,
    variants,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/ti/dns/consensus.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/ti/types.ts lib/ti/dns/consensus.ts lib/ti/dns/consensus.test.ts
git commit -m "feat(dns): add resolver consensus model and ipConsensus resolver

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Expand the unfiltered DoH resolver pool

**Files:**
- Modify: `lib/ti/dns/doh.ts` (add `UNFILTERED_RESOLVERS`, ~line 31)
- Test: `lib/ti/dns/doh.test.ts` (create if absent)

**Interfaces:**
- Consumes: nothing.
- Produces: `UNFILTERED_RESOLVERS: Record<string, string>` exported from `lib/ti/dns/doh.ts`, containing at minimum `cloudflare` and `google`, plus any candidate that passes the server-side probe below. `RESOLVERS` stays exported unchanged for back-compat.

- [ ] **Step 1: Probe candidate resolvers server-side (verification, not committed)**

Write a throwaway probe to the scratchpad and run it. It confirms each candidate returns valid `application/dns-json` for an A query and does not hang. Keep only endpoints that return a JSON body with a numeric `Status`.

Write `/tmp/claude-1000/-home-siriwat-dev-debian-Documents-project-ophanim/1961c9dd-8c5b-4f00-b458-1b886e2afda3/scratchpad/probe-resolvers.mjs`:

```js
const CANDIDATES = {
  cloudflare: "https://cloudflare-dns.com/dns-query",
  google: "https://dns.google/resolve",
  adguard: "https://dns-unfiltered.adguard.com/resolve",
  dns0: "https://dns0.eu",
  quad9unsecured: "https://9.9.9.10:5053/dns-query",
};

for (const [id, url] of Object.entries(CANDIDATES)) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 4000);
  try {
    const res = await fetch(`${url}?name=example.com&type=A`, {
      headers: { Accept: "application/dns-json" },
      signal: ac.signal,
    });
    const body = await res.json();
    const ok = typeof body?.Status === "number";
    console.log(`${id}: ${res.status} json=${ok} answers=${(body?.Answer ?? []).length}`);
  } catch (e) {
    console.log(`${id}: FAIL ${e.name} ${e.message}`);
  } finally {
    clearTimeout(t);
  }
}
```

Run: `node /tmp/claude-1000/-home-siriwat-dev-debian-Documents-project-ophanim/1961c9dd-8c5b-4f00-b458-1b886e2afda3/scratchpad/probe-resolvers.mjs`
Expected: `cloudflare` and `google` print `json=true`. Record which candidates print `json=true` with a non-empty `answers` count — those are eligible for the pool. Anything printing `FAIL` or `json=false` is dropped.

- [ ] **Step 2: Add `UNFILTERED_RESOLVERS` to `doh.ts`**

In `lib/ti/dns/doh.ts`, add below the existing `RESOLVERS` export (after line 34). Include only the probe-verified endpoints; the block below shows the two known-good plus placeholders for verified candidates — **delete any line whose endpoint failed the probe and leave a one-line comment saying why**, mirroring the existing Quad9 note in this file:

```ts
/**
 * Unfiltered JSON-DoH resolvers for A-record consensus. These do NOT run a
 * malicious-domain blocklist, so disagreement here means GeoDNS / CDN rotation
 * / split-horizon / poisoning, not "a security resolver refused to answer."
 * Membership is verified server-side (must return valid application/dns-json
 * and not hang); endpoints that fail verification are dropped with a note.
 */
export const UNFILTERED_RESOLVERS: Record<string, string> = {
  cloudflare: "https://cloudflare-dns.com/dns-query",
  google: "https://dns.google/resolve",
  // adguard: verified <date> — keep only if probe printed json=true
  adguard: "https://dns-unfiltered.adguard.com/resolve",
  // dns0 / quad9unsecured: dropped — probe returned <FAIL reason> (no JSON).
};
```

- [ ] **Step 3: Write the failing test**

Create (or append to) `lib/ti/dns/doh.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { UNFILTERED_RESOLVERS } from "@/lib/ti/dns/doh";

describe("UNFILTERED_RESOLVERS", () => {
  it("includes the two known-good anchors", () => {
    expect(UNFILTERED_RESOLVERS.cloudflare).toContain("cloudflare-dns.com");
    expect(UNFILTERED_RESOLVERS.google).toContain("dns.google");
  });

  it("lists at least two https endpoints and no bare-http", () => {
    const urls = Object.values(UNFILTERED_RESOLVERS);
    expect(urls.length).toBeGreaterThanOrEqual(2);
    for (const url of urls) expect(url.startsWith("https://")).toBe(true);
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ti/dns/doh.test.ts`
Expected: PASS (2 tests). If it fails on count, a probe over-pruned the pool; re-check Step 1.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/dns/doh.ts lib/ti/dns/doh.test.ts
git commit -m "feat(dns): add verified unfiltered DoH resolver pool

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Wire consensus into `dnsSource`

**Files:**
- Modify: `lib/ti/domain/sources/dns.ts`
- Modify: `lib/ti/types.ts` (remove the old `resolverAgreement?: boolean` field on `DomainContext`, ~line 77)
- Modify: `lib/ti/domain/sources/dns.test.ts`
- Modify (conditional): `lib/ti/dns/parse.ts` + `lib/ti/dns/parse.test.ts` (remove `resolversAgree` only if it becomes unused)

**Interfaces:**
- Consumes: `UNFILTERED_RESOLVERS` (Task 2), `ipConsensus`, `ResolverVote` (Task 1), `ResolverConsensus` (Task 1).
- Produces: `dnsSource.check` now emits `resolverConsensus: ResolverConsensus` (replacing `resolverAgreement: boolean`) in both `details` and `domainContext`; `resolvedIps` in the finding is the consensus IP set.

- [ ] **Step 1: Replace the `resolverAgreement` field on `DomainContext`**

In `lib/ti/types.ts`, replace the field at ~line 77:

```ts
  /** false when DoH resolvers returned differing A answer sets. */
  resolverAgreement?: boolean;
```

with:

```ts
  /** Consensus over the unfiltered DoH resolver pool for the A record. */
  resolverConsensus?: ResolverConsensus;
```

- [ ] **Step 2: Update the failing test first**

In `lib/ti/domain/sources/dns.test.ts`, find the existing case(s) asserting `resolverAgreement` and change them to assert the new consensus shape. Add a split-vs-timeout case. The DoH calls are mocked in this file already; follow its existing mocking style. Representative assertions to add/replace:

```ts
it("emits a high-confidence consensus when resolvers agree", async () => {
  // ...existing mock wiring so every resolver's A query returns ["93.184.216.34"]...
  const finding = await dnsSource.check("example.com", new AbortController().signal);
  expect(finding.domainContext?.resolverConsensus?.bucket).toBe("high");
  expect(finding.domainContext?.resolvedIps).toEqual(["93.184.216.34"]);
});

it("does not lower confidence when a resolver times out", async () => {
  // ...mock one resolver's A query to reject/timeout, the rest to agree on one IP...
  const finding = await dnsSource.check("example.com", new AbortController().signal);
  const c = finding.domainContext?.resolverConsensus;
  expect(c?.bucket).toBe("high");
  expect(c?.respondingResolvers).toBeLessThan(c?.totalResolvers ?? 0);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run lib/ti/domain/sources/dns.test.ts`
Expected: FAIL — `resolverConsensus` is undefined (source not wired yet).

- [ ] **Step 4: Wire the source**

In `lib/ti/domain/sources/dns.ts`:

Update imports at the top:

```ts
import { RESOLVERS, UNFILTERED_RESOLVERS, answers, dohQuery, type DohResponse } from "../../dns/doh";
import { ipConsensus, type ResolverVote } from "../../dns/consensus";
import {
  decodeCaa,
  dnssecStatus,
  extractDmarc,
  extractSpf,
  normalizeMxHosts,
} from "../../dns/parse";
```

(Note `resolversAgree` is no longer imported.)

Replace the batched `Promise.all` block and the A-record derivation (current lines ~44-73). The A record is now queried at every unfiltered resolver (DO bit set) via a per-resolver try/catch so one slow resolver yields a `null` vote instead of failing the batch; the other record sets stay on Cloudflare:

```ts
const [aByResolver, aaaa, mx, ns, txt, soa, cname, caa, dmarcTxt] =
  await Promise.all([
    Promise.all(
      Object.entries(UNFILTERED_RESOLVERS).map(async ([id, url]) => {
        try {
          return { id, res: await dohQuery(url, domain, "A", signal, true) };
        } catch {
          return { id, res: null as DohResponse | null };
        }
      }),
    ),
    dohQuery(CF, domain, "AAAA", signal),
    dohQuery(CF, domain, "MX", signal),
    dohQuery(CF, domain, "NS", signal),
    dohQuery(CF, domain, "TXT", signal),
    dohQuery(CF, domain, "SOA", signal),
    dohQuery(CF, domain, "CNAME", signal),
    dohQuery(CF, domain, "CAA", signal),
    dohQuery(CF, `_dmarc.${domain}`, "TXT", signal),
  ]);

// Consensus over the unfiltered pool. A null response is a non-vote.
const votes: ResolverVote[] = aByResolver.map(({ id, res }) => ({
  resolver: id,
  ips: res === null ? null : answers(res),
}));
const consensus = ipConsensus(votes);
const resolvedIps = consensus.consensusIps;

// Pull the two anchor responses back out for NXDOMAIN + DNSSEC.
const aCf = aByResolver.find((r) => r.id === "cloudflare")?.res ?? null;
const aGoogle = aByResolver.find((r) => r.id === "google")?.res ?? null;
```

Delete the now-removed lines that computed `const aSets`, `resolverAgreement`, and the old `const resolvedIps = answers(aCf);`. Keep the `dnssec` line but source it from the anchors:

```ts
const dnssec = dnssecStatus([aCf, aGoogle] as (DohResponse | null)[]);
```

In the summary block, replace the `disagree` line (current ~line 90) with a consensus-driven, comma-style sentence:

```ts
const disagree =
  consensus.bucket === "low"
    ? ` Resolvers split on the A record, ${consensus.agreeCount} of ${consensus.respondingResolvers} agree.`
    : "";
```

In the returned finding, replace `resolverAgreement` with `resolverConsensus` in **both** `details` and `domainContext`:

```ts
        details: {
          resolvesTo: resolvedIps,
          ipv6,
          mx: mxHosts,
          nameservers: nsHosts,
          reverse,
          spf,
          dmarc,
          caa: caaRecords,
          dnssec,
          resolverConsensus: consensus,
          nxdomain,
        },
        domainContext: {
          resolvedIps,
          ipv6,
          nxdomain,
          mx: mxHosts,
          nameservers: nsHosts,
          reverse,
          txt: txtRecords,
          spf,
          dmarc,
          caa: caaRecords,
          soa: answers(soa)[0],
          cname: answers(cname),
          dnssec,
          resolverConsensus: consensus,
        },
```

Update the `raw` object to reflect the anchor responses (drop the removed `aCf`/`aGoogle` locals if they were listed; keep whatever is still in scope):

```ts
        raw: { aCf, aGoogle, aaaa, mx, ns, txt, soa, cname, caa, dmarcTxt },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/ti/domain/sources/dns.test.ts`
Expected: PASS.

- [ ] **Step 6: Remove `resolversAgree` if now unused**

Run: `grep -rn "resolversAgree" lib/ components/ app/`
If the only hits are its definition in `lib/ti/dns/parse.ts` and its own test, delete the `resolversAgree` function from `parse.ts` and its test block from `parse.test.ts`. If anything else still imports it, leave it in place.

- [ ] **Step 7: Full test + lint sweep**

Run: `npm test`
Expected: all suites PASS.
Run: `npm run lint`
Expected: no **new** errors in `lib/ti/dns/`, `lib/ti/domain/sources/dns.ts`, or `lib/ti/types.ts` (pre-existing errors in `.ds-sync/` and `ds-bundle/` are unrelated and out of scope).

- [ ] **Step 8: Commit**

```bash
git add lib/ti/types.ts lib/ti/domain/sources/dns.ts lib/ti/domain/sources/dns.test.ts lib/ti/dns/parse.ts lib/ti/dns/parse.test.ts
git commit -m "feat(dns): resolve A record across unfiltered pool, emit consensus

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Surface consensus confidence in the profile UI

**Files:**
- Modify: `components/CheckResults/profile.tsx` (DNS-records group, lines ~333-392)

**Interfaces:**
- Consumes: `ctx.resolverConsensus: ResolverConsensus` (from Task 3, via `domainContext`).
- Produces: no new exports; renders the consensus in the existing "DNS records" group.

- [ ] **Step 1: Update the group-visibility condition**

In `components/CheckResults/profile.tsx`, the DNS-records `<Group>` open condition (line ~333-338) currently ends with `ctx.resolverAgreement === false`. Replace that clause with a check that the pool answered with more than one resolver:

```tsx
                        {(ips.length > 0 ||
                            ns.length > 0 ||
                            (ctx.reverse?.length ?? 0) > 0 ||
                            (ctx.caa?.length ?? 0) > 0 ||
                            (ctx.dnssec !== undefined && ctx.dnssec !== "unknown") ||
                            (ctx.resolverConsensus?.respondingResolvers ?? 0) > 1) && (
```

- [ ] **Step 2: Replace the Resolvers field**

Replace the block at lines ~382-390 (`{ctx.resolverAgreement === false && ( ... )}`) with a confidence readout shown whenever more than one resolver responded:

```tsx
                                {ctx.resolverConsensus &&
                                    ctx.resolverConsensus.respondingResolvers > 1 && (
                                        <Field
                                            label="Resolvers"
                                            hint="Unfiltered DoH resolvers queried for the A record, and how many agree on the resolved IP. A low count suggests GeoDNS, split-horizon, or possible poisoning."
                                            tone={
                                                ctx.resolverConsensus.bucket === "low"
                                                    ? "text-red-600 dark:text-red-400"
                                                    : undefined
                                            }
                                        >
                                            {ctx.resolverConsensus.agreeCount}/
                                            {ctx.resolverConsensus.respondingResolvers}
                                            {ctx.resolverConsensus.bucket === "low"
                                                ? " split"
                                                : " agree"}
                                        </Field>
                                    )}
```

- [ ] **Step 3: Typecheck / lint the component**

Run: `npm run lint`
Expected: no new errors in `components/CheckResults/profile.tsx` (the field references only `ResolverConsensus` properties defined in Task 1).

- [ ] **Step 4: Visual verification**

Run `npm run dev` is already owned by the user (do not start a second server). Against the running dev server, check a stable single-IP domain (expect "N/N agree", neutral) and a large CDN domain such as a GeoDNS host (expect a lower count or "split"). Use `node scripts/shot.mjs` if screenshots are wanted. If UI cannot be verified in this environment, say so explicitly.

- [ ] **Step 5: Commit**

```bash
git add components/CheckResults/profile.tsx
git commit -m "feat(ui): show DNS resolver consensus confidence

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Unfiltered resolver pool + server-side verification → Task 2 (probe + `UNFILTERED_RESOLVERS`, drop-with-comment rule). ✅
- `ResolverConsensus` structure (respondingResolvers, totalResolvers, consensusIps, agreeCount, confidence, bucket, variants) → Task 1. ✅
- Non-responder = non-vote; order-insensitive; plurality; deterministic tie-break; buckets high/medium/low; partial overlap = separate variant; empty/single-responder cases → Task 1 tests + impl. ✅
- Wire into `dnsSource`, `resolvedIps` becomes `consensusIps`, DNSSEC uses responder set, weight stays 0, replace field in details + domainContext → Task 3. ✅
- Types migration (`resolverAgreement` → `resolverConsensus`) → Task 3 Step 1. ✅
- UI readout replacing the binary "Disagree" chip → Task 4. ✅
- Context-only / no score impact — `dnsSource` weight untouched (never edited in any task); consensus never added to any weighted finding. ✅
- Out of scope (propagation table, score impact, wireformat, overlap partial-credit, Part B) — none introduced. ✅

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows full code; the only intentional gap is the probe-driven pool membership in Task 2, which the task resolves procedurally (run probe, keep verified, drop with comment).

**Type consistency:** `ResolverConsensus` (fields), `ResolverVote` (`{ resolver, ips: string[] | null }`), and `ipConsensus` signature are defined in Task 1 and consumed with the same names/shapes in Tasks 3 and 4. `UNFILTERED_RESOLVERS` (Task 2) is consumed in Task 3 with the same name. `bucket` literals (`"high" | "medium" | "low"`) match across type, impl, tests, and UI.
