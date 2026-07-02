# Hash Filename Voting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace registry-first hash filename selection with a voted, junk-filtered winner drawn from every source's full alias list.

**Architecture:** A new pure module `lib/ti/hash/resolve-name.ts` votes over the union of filenames every source reports, filters junk (hash-as-name, bare-hex, generic placeholders), and returns the best single `fileName` plus a ranked `fileNames[]`. Each name-bearing source adapter is updated to emit all aliases it knows into `hashContext.fileNames`. `assemble.ts` wires the resolver in after `mergeFields`.

**Tech Stack:** TypeScript, Next.js 16, Vitest. `@/` path alias. No new dependencies.

## Global Constraints

- Tests are Vitest, colocated as `lib/**/*.test.ts`, pure/no-network, use the `@/` alias. Run `npm test` before declaring work done.
- Source adapters must not throw: catch and return `{ status: isTimeout(err) ? "timeout" : "error", error: errorMessage(err) }`. This plan does not change any adapter's error paths.
- `npm run lint` (eslint: next core-web-vitals + typescript) must pass.
- User-facing copy uses commas, not dashes.
- The result surface stays `fileName` + `fileNames`; do NOT add a confidence/agreement field to `HashContext` or `HashCheckResult`.

---

## File Structure

- **Create** `lib/ti/hash/resolve-name.ts` — pure voting/junk-filter module. One responsibility: turn settled sources + known hashes into `{ fileName, fileNames }`.
- **Create** `lib/ti/hash/resolve-name.test.ts` — unit tests for the resolver.
- **Modify** `lib/ti/assemble.ts` — `mergeHashContext` calls the resolver after `mergeFields`; `assembleHashResult` passes `hash` + `algorithm` through.
- **Modify** source adapters to populate `hashContext.fileNames`:
  - `lib/ti/hash/sources/hashlookup.ts`
  - `lib/ti/hash/sources/virustotal.ts` (raise existing cap 6 → 12)
  - `lib/ti/hash/sources/hybrid-analysis.ts` (single `last_file_name`)
  - `lib/ti/hash/sources/malwarebazaar.ts` (across all `data.data` entries)
  - `lib/ti/hash/sources/maltiverse.ts` (array-or-string `filename`)
  - `lib/ti/hash/sources/triage.ts` (`sample.target` + `targets[].target`; needs interface field added)
- **Modify** the matching `*.test.ts` files to assert `fileNames` is populated.

---

## Task 1: Filename resolver module

**Files:**
- Create: `lib/ti/hash/resolve-name.ts`
- Test: `lib/ti/hash/resolve-name.test.ts`

**Interfaces:**
- Consumes: `SourceResult` from `../types` (fields used: `status`, `source.id`, `hashContext.fileName`, `hashContext.fileNames`).
- Produces: `resolveFileName(results: SourceResult[], hashes: { md5?: string; sha1?: string; sha256?: string }): { fileName?: string; fileNames?: string[] }` — consumed by Task 8 (`assemble.ts`).

- [ ] **Step 1: Write the failing tests**

Create `lib/ti/hash/resolve-name.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { SourceResult } from "../types";
import { resolveFileName } from "./resolve-name";

// Minimal ok-result stub carrying only what the resolver reads.
function src(
  id: string,
  hashContext: SourceResult["hashContext"],
): SourceResult {
  return {
    source: {
      id,
      name: id,
      url: "",
      category: "reputation",
      requiresKey: false,
      weight: 0,
    },
    enabled: true,
    status: "ok",
    durationMs: 1,
    hashContext,
  };
}

const NO_HASHES = {};

describe("resolveFileName", () => {
  it("drops a name equal to the hash", () => {
    const sha256 = "a".repeat(64);
    const out = resolveFileName([src("s1", { fileName: sha256 })], {
      sha256,
    });
    expect(out.fileName).toBeUndefined();
    expect(out.fileNames).toBeUndefined();
  });

  it("drops a bare-hex name with or without an extension", () => {
    const md5 = "d".repeat(32);
    const out = resolveFileName(
      [src("s1", { fileNames: ["b".repeat(64), "c".repeat(40) + ".exe"] })],
      { md5 },
    );
    expect(out.fileName).toBeUndefined();
  });

  it("drops generic placeholder names", () => {
    const out = resolveFileName(
      [src("s1", { fileNames: ["file", "sample.bin", "desktop.ini", "invoice.exe"] })],
      NO_HASHES,
    );
    expect(out.fileName).toBe("invoice.exe");
    expect(out.fileNames).toEqual(["invoice.exe"]);
  });

  it("drops pure-numeric, single-char, and extension-only names", () => {
    const out = resolveFileName(
      [src("s1", { fileNames: ["123", "a", ".exe", "real.dll"] })],
      NO_HASHES,
    );
    expect(out.fileNames).toEqual(["real.dll"]);
  });

  it("picks the name reported by the most distinct sources", () => {
    const out = resolveFileName(
      [
        src("s1", { fileNames: ["popular.exe", "rare.exe"] }),
        src("s2", { fileName: "popular.exe" }),
        src("s3", { fileName: "popular.exe" }),
      ],
      NO_HASHES,
    );
    expect(out.fileName).toBe("popular.exe");
    expect(out.fileNames).toEqual(["popular.exe", "rare.exe"]);
  });

  it("does not let one source out-vote others by repeating a name", () => {
    const out = resolveFileName(
      [
        src("s1", { fileNames: ["dup.exe", "dup.exe", "DUP.EXE"] }),
        src("hashlookup", { fileName: "other.exe" }),
        src("virustotal", { fileName: "other.exe" }),
      ],
      NO_HASHES,
    );
    // "dup.exe" has 1 distinct source, "other.exe" has 2.
    expect(out.fileName).toBe("other.exe");
  });

  it("breaks vote ties by source name-trust order", () => {
    const out = resolveFileName(
      [
        src("hashlookup", { fileName: "weak.exe" }),
        src("malwarebazaar", { fileName: "strong.exe" }),
      ],
      NO_HASHES,
    );
    expect(out.fileName).toBe("strong.exe");
  });

  it("returns undefined when every name is junk", () => {
    const sha1 = "e".repeat(40);
    const out = resolveFileName(
      [src("s1", { fileNames: ["file", sha1, "1"] })],
      { sha1 },
    );
    expect(out).toEqual({ fileName: undefined, fileNames: undefined });
  });

  it("ignores non-ok sources", () => {
    const bad: SourceResult = { ...src("s1", { fileName: "ghost.exe" }), status: "error" };
    const out = resolveFileName([bad], NO_HASHES);
    expect(out.fileName).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- resolve-name`
Expected: FAIL — `resolveFileName` is not exported / module not found.

- [ ] **Step 3: Implement the resolver**

Create `lib/ti/hash/resolve-name.ts`:

```ts
import type { SourceResult } from "../types";

/**
 * Source name-trust order, highest trust first. Submitted-name sources
 * (real filenames people uploaded) rank above VirusTotal's engine/submission
 * names, which rank above hashlookup's known-file corpus name. Sources not
 * listed fall to DEFAULT_RANK. Used only to break vote-count ties.
 */
const NAME_TRUST_ORDER = [
  "malwarebazaar",
  "triage",
  "hybrid-analysis",
  "maltiverse",
  "virustotal",
  "hashlookup",
];
const DEFAULT_RANK = 100;

function trustRank(sourceId: string): number {
  const i = NAME_TRUST_ORDER.indexOf(sourceId);
  return i === -1 ? DEFAULT_RANK : i;
}

/** Generic / auto-generated names that carry no identifying value. */
const DENYLIST = new Set([
  // base placeholders
  "file", "sample", "sample.bin", "unknown", "malware", "tmp", "temp",
  "a.out", "output",
  // generic binaries
  "virus", "trojan", "payload", "dropper", "dump", "bin", "data",
  "file.exe", "sample.exe", "malware.exe",
  // sandbox / scanner auto-names
  "sample.dll", "sample.doc", "target", "artifact", "run.exe", "test.exe",
  "vti-rescan",
  // OS placeholders
  "desktop.ini", "thumbs.db", "new folder", "document", "untitled",
  "download", "setup.exe", "install.exe",
]);

const HEX_RE = /^[0-9a-f]+$/;
const HASH_LENGTHS = new Set([32, 40, 64]);

/** Name with a trailing `.ext` removed (only when there is a stem before it). */
function stripExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function isJunk(name: string, hashes: Set<string>): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return true;
  // Equal to a full hash, or a hash with an extension appended.
  if (hashes.has(n)) return true;
  const base = stripExt(n);
  if (hashes.has(base)) return true;
  // Bare hex string of hash length (with or without an extension).
  if (HEX_RE.test(base) && HASH_LENGTHS.has(base.length)) return true;
  // Generic placeholder (matched against the full name and the extension-less stem).
  if (DENYLIST.has(n) || DENYLIST.has(base)) return true;
  // Pure numeric, single character, or extension-only (".exe").
  if (/^\d+$/.test(base)) return true;
  if (base.length <= 1) return true;
  if (/^\.[^.]+$/.test(n)) return true;
  return false;
}

interface Vote {
  display: string;
  sources: Set<string>;
  bestRank: number;
}

/**
 * Vote the best single filename out of everything the sources reported.
 * One vote per distinct (source, name); the winner is the name backed by the
 * most distinct sources, breaking ties by source name-trust then lexically.
 * Junk names (hash-as-name, bare hex, generic placeholders) are dropped.
 */
export function resolveFileName(
  results: SourceResult[],
  hashes: { md5?: string; sha1?: string; sha256?: string },
): { fileName?: string; fileNames?: string[] } {
  const hashSet = new Set(
    [hashes.md5, hashes.sha1, hashes.sha256]
      .filter((h): h is string => Boolean(h))
      .map((h) => h.toLowerCase()),
  );

  const votes = new Map<string, Vote>();

  for (const r of results) {
    if (r.status !== "ok" || !r.hashContext) continue;
    const ctx = r.hashContext;
    const names = ctx.fileNames?.length
      ? ctx.fileNames
      : ctx.fileName
        ? [ctx.fileName]
        : [];
    const rank = trustRank(r.source.id);
    const seen = new Set<string>();
    for (const raw of names) {
      if (typeof raw !== "string") continue;
      const name = raw.trim();
      if (!name || isJunk(name, hashSet)) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue; // one vote per (source, name)
      seen.add(key);
      const existing = votes.get(key);
      if (existing) {
        existing.sources.add(r.source.id);
        existing.bestRank = Math.min(existing.bestRank, rank);
      } else {
        votes.set(key, { display: name, sources: new Set([r.source.id]), bestRank: rank });
      }
    }
  }

  if (votes.size === 0) return { fileName: undefined, fileNames: undefined };

  const ranked = [...votes.values()].sort((a, b) => {
    if (b.sources.size !== a.sources.size) return b.sources.size - a.sources.size;
    if (a.bestRank !== b.bestRank) return a.bestRank - b.bestRank;
    return a.display.toLowerCase().localeCompare(b.display.toLowerCase());
  });

  return {
    fileName: ranked[0].display,
    fileNames: ranked.map((v) => v.display),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- resolve-name`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ti/hash/resolve-name.ts lib/ti/hash/resolve-name.test.ts
git commit -m "feat(hash): add filename voting resolver"
```

---

## Task 2: hashlookup emits fileNames

**Files:**
- Modify: `lib/ti/hash/sources/hashlookup.ts:67-73`
- Test: `lib/ti/hash/sources/hashlookup.test.ts`

**Interfaces:**
- Produces: `hashContext.fileNames?: string[]` — a single-element list when a name is present.

- [ ] **Step 1: Add a failing test**

Add to `lib/ti/hash/sources/hashlookup.test.ts` (inside the existing `describe`):

```ts
it("emits fileNames when a FileName is present", async () => {
  vi.spyOn(http, "getJson").mockResolvedValue({
    ok: true,
    status: 200,
    data: { FileName: "notepad.exe", MD5: "d".repeat(32) },
  } as never);
  const finding = await hashlookupSource.check("d".repeat(32), new AbortController().signal);
  expect(finding.hashContext?.fileNames).toEqual(["notepad.exe"]);
});
```

If the test file does not already import `http` and `vi`, add at the top:

```ts
import { vi } from "vitest";
import * as http from "../../http";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- hashlookup`
Expected: FAIL — `fileNames` is `undefined`.

- [ ] **Step 3: Add `fileNames` to the hashContext**

In `lib/ti/hash/sources/hashlookup.ts`, change the `hashContext` object (currently lines 67-73) to include `fileNames`:

```ts
      const hashContext = {
        md5: data.MD5?.toLowerCase(),
        sha1: data["SHA-1"]?.toLowerCase(),
        sha256: data["SHA-256"]?.toLowerCase(),
        fileName,
        fileNames: fileName ? [fileName] : undefined,
        fileSize,
      };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- hashlookup`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/hash/sources/hashlookup.ts lib/ti/hash/sources/hashlookup.test.ts
git commit -m "feat(hash): hashlookup emits fileNames alias list"
```

---

## Task 3: virustotal raises fileNames cap

**Files:**
- Modify: `lib/ti/hash/sources/virustotal.ts:145`
- Test: `lib/ti/hash/sources/virustotal.test.ts`

**Interfaces:**
- Produces: `hashContext.fileNames` capped at 12 (was 6).

- [ ] **Step 1: Change the cap**

In `lib/ti/hash/sources/virustotal.ts` line 145, change:

```ts
          fileNames: names.slice(0, 6),
```

to:

```ts
          fileNames: names.slice(0, 12),
```

- [ ] **Step 2: Run the VirusTotal tests**

Run: `npm test -- virustotal`
Expected: PASS (no existing test asserts the cap of 6; if one does, update its expectation to 12).

- [ ] **Step 3: Commit**

```bash
git add lib/ti/hash/sources/virustotal.ts
git commit -m "feat(hash): widen VirusTotal fileNames cap to 12"
```

---

## Task 4: hybrid-analysis emits fileNames

**Files:**
- Modify: `lib/ti/hash/sources/hybrid-analysis.ts:136-142`
- Test: `lib/ti/hash/sources/hybrid-analysis.test.ts`

**Interfaces:**
- Produces: `hashContext.fileNames` — single-element list from `last_file_name` (the overview payload exposes no other name field).

- [ ] **Step 1: Add a failing test**

Add to `lib/ti/hash/sources/hybrid-analysis.test.ts` a case asserting `fileNames`. Mirror the existing mock style in that file; the essential assertion is:

```ts
it("emits fileNames from last_file_name", async () => {
  vi.spyOn(http, "getJson").mockResolvedValue({
    ok: true,
    status: 200,
    data: { verdict: "malicious", last_file_name: "dropper.exe", sha256: "f".repeat(64) },
  } as never);
  const finding = await hybridAnalysisSource.check("f".repeat(64), new AbortController().signal);
  expect(finding.hashContext?.fileNames).toEqual(["dropper.exe"]);
});
```

Ensure `HYBRID_ANALYSIS_API_KEY` is set for the test as the existing tests do (check the file's setup; if the key gate skips the source, set `process.env.HYBRID_ANALYSIS_API_KEY` in the test or its `beforeEach`, matching the existing pattern in that file).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- hybrid-analysis`
Expected: FAIL — `fileNames` is `undefined`.

- [ ] **Step 3: Add `fileNames`**

In `lib/ti/hash/sources/hybrid-analysis.ts`, extend the `hashContext` (lines 136-142). First compute the name above the return, then reference it:

```ts
      const lastFileName = data.last_file_name ?? undefined;

      return {
        status: "ok",
        malicious: verdict === "malicious",
        allowlisted: Boolean(data.whitelisted) || verdict === "whitelisted",
        score,
        categories: family ? [family] : [],
        lastSeen: data.analysis_start_time ?? undefined,
        summary: `Sandbox verdict: ${verdict}${family ? ` (${family})` : ""}${
          threatScore !== undefined ? `, threat score ${threatScore}/100` : ""
        }`,
        hashContext: {
          sha256: data.sha256?.toLowerCase(),
          fileName: lastFileName,
          fileNames: lastFileName ? [lastFileName] : undefined,
          fileType,
          fileSize: data.size ?? undefined,
          malwareFamily: family,
        },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- hybrid-analysis`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/hash/sources/hybrid-analysis.ts lib/ti/hash/sources/hybrid-analysis.test.ts
git commit -m "feat(hash): hybrid-analysis emits fileNames alias list"
```

---

## Task 5: malwarebazaar emits fileNames across entries

**Files:**
- Modify: `lib/ti/hash/sources/malwarebazaar.ts:201-246`
- Test: `lib/ti/hash/sources/malwarebazaar.test.ts`

**Interfaces:**
- Produces: `hashContext.fileNames` — deduped `file_name` values across all `data.data` entries.

- [ ] **Step 1: Add a failing test**

Add to `lib/ti/hash/sources/malwarebazaar.test.ts`, matching the file's existing mock/key setup, a case whose mocked `data.data` has two entries with different `file_name`s and assert:

```ts
expect(finding.hashContext?.fileNames).toEqual(["first.exe", "second.exe"]);
```

(Use the existing test's response-builder helper if present; otherwise mock `postForm` to return `{ ok: true, status: 200, data: { query_status: "ok", data: [ { file_name: "first.exe", ...}, { file_name: "second.exe", ... } ] } }`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- malwarebazaar`
Expected: FAIL — `fileNames` is `undefined`.

- [ ] **Step 3: Collect names across entries**

In `lib/ti/hash/sources/malwarebazaar.ts`, after `const entry = data.data[0];` and its null-guard (line 201-207), add:

```ts
      const fileNames = [
        ...new Set(
          data.data
            .map((e) => e.file_name)
            .filter((n): n is string => Boolean(n && n.trim())),
        ),
      ];
```

Then in the returned `hashContext` (line ~235), add the field next to `fileName`:

```ts
          fileName: entry.file_name,
          fileNames: fileNames.length ? fileNames : undefined,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- malwarebazaar`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/hash/sources/malwarebazaar.ts lib/ti/hash/sources/malwarebazaar.test.ts
git commit -m "feat(hash): malwarebazaar emits fileNames across entries"
```

---

## Task 6: maltiverse emits fileNames

**Files:**
- Modify: `lib/ti/hash/sources/maltiverse.ts:103-124`
- Test: `lib/ti/hash/sources/maltiverse.test.ts`

**Interfaces:**
- Produces: `hashContext.fileNames` — every entry of the array-or-string `filename` field, deduped.

- [ ] **Step 1: Add a failing test**

Add to `lib/ti/hash/sources/maltiverse.test.ts`, matching its existing mock style, a case where `data.filename` is `["a.exe", "b.exe"]` and assert:

```ts
expect(finding.hashContext?.fileNames).toEqual(["a.exe", "b.exe"]);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- maltiverse`
Expected: FAIL — `fileNames` is `undefined`.

- [ ] **Step 3: Build the alias list**

In `lib/ti/hash/sources/maltiverse.ts`, replace the single-name extraction (lines 103-105):

```ts
      const name = Array.isArray(data.filename)
        ? data.filename[0]
        : data.filename;
```

with an all-names list plus the primary:

```ts
      const rawNames = Array.isArray(data.filename)
        ? data.filename
        : data.filename
          ? [data.filename]
          : [];
      const fileNames = [
        ...new Set(rawNames.filter((n): n is string => Boolean(n && n.trim()))),
      ];
      const name = fileNames[0];
```

Then in the returned `hashContext` (line ~119), add the field next to `fileName`:

```ts
          fileName: name,
          fileNames: fileNames.length ? fileNames : undefined,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- maltiverse`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/hash/sources/maltiverse.ts lib/ti/hash/sources/maltiverse.test.ts
git commit -m "feat(hash): maltiverse emits fileNames alias list"
```

---

## Task 7: triage emits fileNames from sample + targets

**Files:**
- Modify: `lib/ti/hash/sources/triage.ts:12-20` (interface) and `:164-168` (return)
- Test: `lib/ti/hash/sources/triage.test.ts`

**Interfaces:**
- Produces: `hashContext.fileNames` — `sample.target` plus each `targets[].target`, deduped.

- [ ] **Step 1: Add a failing test**

Add to `lib/ti/hash/sources/triage.test.ts`, matching its existing overview-mock style, a case where the overview has `sample.target = "invoice.doc"` and `targets = [{ target: "invoice.doc" }, { target: "stage2.exe" }]`, and assert:

```ts
expect(finding.hashContext?.fileNames).toEqual(["invoice.doc", "stage2.exe"]);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- triage`
Expected: FAIL — `fileNames` is `undefined` (and `targets[].target` is not yet typed).

- [ ] **Step 3: Add the `target` field to the interface and collect names**

In `lib/ti/hash/sources/triage.ts`, add `target?: string;` to the `targets` object type (inside `interface TriageOverview`, lines 12-20):

```ts
  targets?: {
    target?: string;
    score?: number;
    family?: string[];
    tags?: string[];
    signatures?: { name?: string }[];
    iocs?: { domains?: string[]; ips?: string[]; urls?: string[] };
  }[];
```

Then, before the `return` (near line 156), build the alias list:

```ts
      const fileNames = [
        ...new Set(
          [
            data.sample?.target,
            ...(data.targets ?? []).map((t) => t.target),
          ].filter((n): n is string => Boolean(n && n.trim())),
        ),
      ];
```

And in the returned `hashContext` (lines 164-168), add the field:

```ts
        hashContext: {
          malwareFamily: families[0],
          fileName: data.sample?.target,
          fileNames: fileNames.length ? fileNames : undefined,
          fileSize: data.sample?.size,
        },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- triage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/hash/sources/triage.ts lib/ti/hash/sources/triage.test.ts
git commit -m "feat(hash): triage emits fileNames from sample and targets"
```

---

## Task 8: Wire the resolver into assemble

**Files:**
- Modify: `lib/ti/assemble.ts:89-119`
- Test: covered by an end-to-end assemble assertion below (no separate test file exists for assemble; add one).

**Interfaces:**
- Consumes: `resolveFileName` from `./hash/resolve-name` (Task 1).
- Produces: `HashCheckResult.context.fileName` / `.fileNames` now voted rather than registry-first.

- [ ] **Step 1: Add a failing test**

Create `lib/ti/hash/assemble-name.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { SourceResult } from "../types";
import { assembleHashResult } from "../assemble";

function src(id: string, fileName: string, fileNames?: string[]): SourceResult {
  return {
    source: { id, name: id, url: "", category: "reputation", requiresKey: false, weight: 0 },
    enabled: true,
    status: "ok",
    durationMs: 1,
    hashContext: { fileNames: fileNames ?? [fileName], fileName },
  };
}

describe("assembleHashResult filename voting", () => {
  it("picks the voted winner, not the registry-first name", () => {
    const results: SourceResult[] = [
      src("hashlookup", "junkfirst.exe"),
      src("malwarebazaar", "real.exe"),
      src("virustotal", "real.exe"),
    ];
    const out = assembleHashResult("a".repeat(64), "sha256", results, "2026-07-02T00:00:00Z");
    expect(out.context?.fileName).toBe("real.exe");
  });

  it("drops the hash itself as a filename", () => {
    const sha256 = "b".repeat(64);
    const results: SourceResult[] = [src("hashlookup", sha256)];
    const out = assembleHashResult(sha256, "sha256", results, "2026-07-02T00:00:00Z");
    expect(out.context?.fileName).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- assemble-name`
Expected: FAIL — `fileName` is `"junkfirst.exe"` (registry-first) and the hash is not dropped.

- [ ] **Step 3: Wire the resolver**

In `lib/ti/assemble.ts`, add the import near the other local imports (after line 14):

```ts
import { resolveFileName } from "./hash/resolve-name";
```

Replace `mergeHashContext` (lines 89-95) with a version that takes the looked-up hash + algorithm and overlays the voted name:

```ts
function mergeHashContext(
  results: SourceResult[],
  hash: string,
  algorithm: HashAlgorithm,
): HashContext | undefined {
  const merged = mergeFields(
    results
      .filter((r) => r.status === "ok" && r.hashContext)
      .map((r) => r.hashContext as HashContext),
  );
  if (!merged) return undefined;
  const hashes = {
    md5: merged.md5 ?? (algorithm === "md5" ? hash : undefined),
    sha1: merged.sha1 ?? (algorithm === "sha1" ? hash : undefined),
    sha256: merged.sha256 ?? (algorithm === "sha256" ? hash : undefined),
  };
  const resolved = resolveFileName(results, hashes);
  return {
    ...merged,
    fileName: resolved.fileName,
    fileNames: resolved.fileNames,
  };
}
```

Then update the single call site in `assembleHashResult` (line 113):

```ts
    context: mergeHashContext(results, hash, algorithm),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- assemble-name`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/assemble.ts lib/ti/hash/assemble-name.test.ts
git commit -m "feat(hash): resolve voted filename in assembly"
```

---

## Task 9: Full verification

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: PASS (all suites, including the new resolver, source, and assemble tests).

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: End-to-end pipeline smoke check**

With the dev server already running (the user runs `next dev` on :3000 — do not start your own), exercise a known malware hash through a no-key source path and confirm the resolved `fileName` is a real submitted name rather than the hash or a generic placeholder. If you cannot verify the live UI, say so explicitly.

- [ ] **Step 4: Final commit (if any lint/format fixups were needed)**

```bash
git add -A
git commit -m "chore(hash): lint fixups for filename voting"
```

---

## Self-Review Notes

- **Spec coverage:** sources-emit-aliases → Tasks 2-7; resolver module (voting + junk filter + trust tie-break) → Task 1; assemble wiring → Task 8; tests → every task + Task 9. Denylist matches the spec's expanded list verbatim in Task 1.
- **Spec deviation (intentional):** the spec listed Hybrid-Analysis as `last_file_name + submit_name`; the overview payload only exposes `last_file_name`, so Task 4 emits a single name. Maltiverse's trust rank (unspecified in the spec) is slotted into the submitted-name tier after Hybrid-Analysis in Task 1's `NAME_TRUST_ORDER`.
- **Type consistency:** `resolveFileName(results, hashes)` signature is identical in Task 1 (definition), Task 1 tests, and Task 8 (call site). `fileNames?: string[]` matches the existing `HashContext` field in `lib/ti/types.ts` (no type change needed).
