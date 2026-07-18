# SOC Threat Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a SOC analyst a decision-ready "what is this file and what does it do" readout for a hash, a resolved malware family with a plain-language description, observed capabilities, MITRE ATT&CK techniques, and detection confidence, in a dedicated Threat profile card.

**Architecture:** Sources contribute new context fields (`capabilities`, `mitreTechniques`, `detectionRatio`) alongside the existing hash context. A pure AV-label parser resolves the family name even when no source set one explicitly. After the parallel `runAll`, a server-only post-step enriches the merged context with a Malpedia family description. A new `ThreatProfileCard` renders the result. Scoring/verdict are untouched; every field is context-only.

**Tech Stack:** TypeScript, Next.js 16 App Router, React 19, Vitest, Tailwind, lucide-react. Package manager/runner is Bun (`bun run test`, `bun run lint`).

## Global Constraints

- Free sources only, no paid APIs. Malpedia's public family API needs no key.
- Scoring and verdict unchanged: all new fields are context-only (source weights unchanged).
- House copy style: commas, never dashes or " - " separators. No em/en dashes.
- UI is monochrome (military-grade minimal); color appears only on verdict tone.
- HTTP goes through `lib/ti/http.ts` helpers (`getJson`, `isTimeout`, `errorMessage`), never bare `fetch`. Honor the `AbortSignal`.
- Sources catch errors and return `{ status: isTimeout(err) ? "timeout" : "error", error: errorMessage(err) }`, never throw.
- Tests are Vitest, colocated `*.test.ts`, pure/no-network (mock `../../http` where a source is exercised), use the `@/` alias. Run with `bun run test` (never `bun test`).
- `bun` is at `~/.bun/bin`; if not on PATH, prefix commands with `export PATH="$HOME/.bun/bin:$PATH";`.

---

### Task 1: Extend the `HashContext` data model

**Files:**
- Modify: `lib/ti/types.ts` (the `HashContext` interface, currently ending near line 132 with `detectionNames?`)

**Interfaces:**
- Consumes: nothing.
- Produces: `HashContext` gains `familyDescription?: string`, `familyRefs?: string[]`, `capabilities?: { label: string; mitre?: string[] }[]`, `mitreTechniques?: { id: string; name?: string; tactic?: string }[]`, `detectionRatio?: { malicious: number; total: number }`.

- [ ] **Step 1: Add the fields**

In `lib/ti/types.ts`, inside `interface HashContext`, immediately after the `detectionNames?: string[];` line, add:

```typescript
  /** Plain-language summary of the malware family (from Malpedia). */
  familyDescription?: string;
  /** Reference URLs for deeper reading on the family (capped ~5). */
  familyRefs?: string[];
  /** Sandbox-observed behaviors, each optionally tagged with MITRE technique ids. */
  capabilities?: { label: string; mitre?: string[] }[];
  /** Deduped ATT&CK techniques observed for this sample. */
  mitreTechniques?: { id: string; name?: string; tactic?: string }[];
  /** Multi-engine detection tally, for a first-class confidence number. */
  detectionRatio?: { malicious: number; total: number };
```

- [ ] **Step 2: Typecheck**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bunx tsc --noEmit`
Expected: no new errors mentioning `types.ts` or `HashContext`.

- [ ] **Step 3: Commit**

```bash
git add lib/ti/types.ts
git commit -m "feat(ti): add family/capability/mitre/detection fields to HashContext"
```

---

### Task 2: `resolveFamily` AV-label parser

**Files:**
- Create: `lib/ti/hash/family.ts`
- Test: `lib/ti/hash/family.test.ts`

**Interfaces:**
- Consumes: `HashContext` (Task 1).
- Produces: `resolveFamily(ctx: HashContext): string | undefined` — returns explicit `malwareFamily` if set, else the most likely family token parsed from `detectionNames`, else `undefined`. Also exports `parseFamilyFromDetections(names: string[]): string | undefined`.

- [ ] **Step 1: Write the failing test**

Create `lib/ti/hash/family.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { resolveFamily, parseFamilyFromDetections } from "./family";

describe("parseFamilyFromDetections", () => {
  it("extracts the family from vendor labels, ignoring platform/type/generic", () => {
    const family = parseFamilyFromDetections([
      "Trojan-Downloader.Win32.Upatre.afcl",
      "HEUR:Trojan.Win32.Generic",
    ]);
    expect(family).toBe("Upatre");
  });

  it("keeps a 5-letter capitalized family on a non-Windows platform", () => {
    expect(parseFamilyFromDetections(["Trojan.Linux.Mirai"])).toBe("Mirai");
  });

  it("prefers the family two vendors agree on", () => {
    const family = parseFamilyFromDetections([
      "Win32.Emotet.gen",
      "Trojan.Emotet",
      "HEUR:Trojan.Win32.Generic",
    ]);
    expect(family).toBe("Emotet");
  });

  it("returns undefined when only generic/type tokens are present", () => {
    expect(parseFamilyFromDetections(["HEUR:Trojan.Win32.Generic"])).toBeUndefined();
    expect(parseFamilyFromDetections([])).toBeUndefined();
  });
});

describe("resolveFamily", () => {
  it("uses an explicit malwareFamily verbatim", () => {
    expect(resolveFamily({ malwareFamily: "Emotet" })).toBe("Emotet");
  });

  it("falls back to parsing detectionNames", () => {
    expect(
      resolveFamily({ detectionNames: ["Trojan-Downloader.Win32.Upatre.afcl"] }),
    ).toBe("Upatre");
  });

  it("returns undefined with neither signal", () => {
    expect(resolveFamily({})).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun run test family`
Expected: FAIL, cannot find module `./family`.

- [ ] **Step 3: Write the implementation**

Create `lib/ti/hash/family.ts`:

```typescript
import type { HashContext } from "../types";

/**
 * Tokens that are never a malware family: AV vendor scan-type prefixes,
 * platforms, and generic/heuristic markers. Matched case-insensitively against
 * whole label segments.
 */
const STOPWORDS = new Set([
  // scan-type / generic
  "trojan", "trojandownloader", "downloader", "dropper", "droppr", "backdoor",
  "worm", "virus", "ransom", "ransomware", "adware", "pua", "pup", "riskware",
  "risktool", "hacktool", "spyware", "keylogger", "banker", "bank", "rootkit",
  "bootkit", "exploit", "exp", "agent", "heur", "heuristic", "gen", "generic",
  "genericml", "malware", "malgent", "packed", "packer", "obfuscated", "injector",
  "inject", "cryptor", "crypt", "behaveslike", "application", "program", "tool",
  "suspicious", "unwanted", "variant", "ml", "ai", "cloud", "static", "common",
  "trojanspy", "trojandropper", "trojanransom", "not", "a", "of",
  // platforms
  "win32", "win64", "win", "w32", "w64", "x86", "x64", "msil", "android", "linux",
  "unix", "osx", "macos", "mac", "ios", "js", "jsc", "vbs", "vba", "html", "php",
  "python", "perl", "ps1", "powershell", "elf", "apk", "dos", "script", "o97m",
  "x97m", "w97m", "multi", "boot",
]);

/** Split a detection label into candidate segments on the usual separators. */
function segments(label: string): string[] {
  return label.split(/[.\-:_/\s]+/).filter(Boolean);
}

/**
 * Parse the most likely family name out of a set of AV detection labels.
 * Heuristic: a family token appears capitalized in at least one label (e.g.
 * "Upatre", "Mirai", "Emotet"), is not a stopword, and is >=3 chars. Variants
 * ("afcl", "gen") are lowercase and fall out; platform/type/generic tokens are
 * stopwords. The token seen most often wins, ties break toward the longer then
 * earlier token. Returns the original casing of the winning token.
 */
export function parseFamilyFromDetections(names: string[]): string | undefined {
  const stats = new Map<
    string,
    { original: string; count: number; capitalized: boolean; order: number }
  >();
  let order = 0;
  for (const name of names) {
    if (!name) continue;
    for (const seg of segments(name)) {
      const key = seg.toLowerCase();
      if (STOPWORDS.has(key) || key.length < 3) continue;
      const capitalized = /^[A-Z]/.test(seg);
      const prev = stats.get(key);
      if (prev) {
        prev.count += 1;
        prev.capitalized = prev.capitalized || capitalized;
      } else {
        stats.set(key, { original: seg, count: 1, capitalized, order: order++ });
      }
    }
  }

  const entries = [...stats.values()];
  const pick = (pool: typeof entries) =>
    pool.sort(
      (a, b) =>
        b.count - a.count ||
        b.original.length - a.original.length ||
        a.order - b.order,
    )[0]?.original;

  // Prefer tokens that showed up capitalized; fall back to any longer token.
  return (
    pick(entries.filter((e) => e.capitalized)) ??
    pick(entries.filter((e) => e.original.length >= 5))
  );
}

/**
 * The family for a hash: an explicit family set by a source wins; otherwise
 * parse it out of the unioned detection labels.
 */
export function resolveFamily(ctx: HashContext): string | undefined {
  if (ctx.malwareFamily && ctx.malwareFamily.trim()) return ctx.malwareFamily.trim();
  return parseFamilyFromDetections(ctx.detectionNames ?? []);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun run test family`
Expected: PASS (all cases in `family.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add lib/ti/hash/family.ts lib/ti/hash/family.test.ts
git commit -m "feat(ti): resolve malware family from AV detection labels"
```

---

### Task 3: Triage capabilities + MITRE extraction

**Files:**
- Modify: `lib/ti/hash/sources/triage.ts` (the `TriageOverview.targets[].signatures` type near line 18, and the `hashContext` object in `check` near line 158)
- Test: `lib/ti/hash/sources/triage.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `HashContext` (Task 1).
- Produces: `extractTriageCapabilities(data: TriageOverview): { label: string; mitre?: string[] }[]` and `extractTriageMitre(data: TriageOverview): { id: string }[]`, both exported. `triageSource.check` now emits `capabilities` and `mitreTechniques` on its `hashContext`.

- [ ] **Step 1: Write the failing test**

Append to `lib/ti/hash/sources/triage.test.ts`:

```typescript
import { extractTriageCapabilities, extractTriageMitre } from "./triage";

describe("extractTriageCapabilities / extractTriageMitre", () => {
  const data = {
    targets: [
      {
        signatures: [
          { name: "Downloads executable", ttp: ["T1105"] },
          { name: "Modifies run key", ttp: ["T1547"] },
          { name: "Downloads executable", ttp: ["T1105"] }, // dup
        ],
      },
      { signatures: [{ name: "Contacts C2", ttp: ["T1071", "T1105"] }] },
    ],
  };

  it("dedupes capabilities by label and carries their ttp", () => {
    expect(extractTriageCapabilities(data)).toEqual([
      { label: "Downloads executable", mitre: ["T1105"] },
      { label: "Modifies run key", mitre: ["T1547"] },
      { label: "Contacts C2", mitre: ["T1071", "T1105"] },
    ]);
  });

  it("dedupes MITRE ids across all signatures, uppercased", () => {
    expect(extractTriageMitre(data)).toEqual([
      { id: "T1105" },
      { id: "T1547" },
      { id: "T1071" },
    ]);
  });

  it("returns empty arrays when no signatures carry behavior", () => {
    expect(extractTriageCapabilities({ targets: [{}] })).toEqual([]);
    expect(extractTriageMitre({})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun run test triage`
Expected: FAIL, `extractTriageCapabilities` is not exported.

- [ ] **Step 3: Extend the interface and add the helpers**

In `lib/ti/hash/sources/triage.ts`, change the `signatures` field on the `targets` type from:

```typescript
    signatures?: { name?: string }[];
```

to:

```typescript
    signatures?: { name?: string; ttp?: string[]; tags?: string[] }[];
```

Then, directly above `const API = "https://tria.ge/api/v0";`, add:

```typescript
/**
 * Sandbox-observed behaviors for this sample: each unique signature name is a
 * capability, tagged with its MITRE technique ids (`ttp`) when present. Deduped
 * by name; first occurrence wins.
 */
export function extractTriageCapabilities(
  data: TriageOverview,
): { label: string; mitre?: string[] }[] {
  const seen = new Set<string>();
  const out: { label: string; mitre?: string[] }[] = [];
  for (const t of data.targets ?? []) {
    for (const s of t.signatures ?? []) {
      if (!s.name) continue;
      const key = s.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ label: s.name, mitre: s.ttp?.length ? s.ttp : undefined });
    }
  }
  return out;
}

/** Deduped MITRE technique ids across every signature, uppercased. */
export function extractTriageMitre(data: TriageOverview): { id: string }[] {
  const seen = new Set<string>();
  const out: { id: string }[] = [];
  for (const t of data.targets ?? []) {
    for (const s of t.signatures ?? []) {
      for (const id of s.ttp ?? []) {
        const up = id.toUpperCase();
        if (seen.has(up)) continue;
        seen.add(up);
        out.push({ id: up });
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Emit the new fields from `check`**

In `triage.ts`, inside the returned object's `hashContext`, after the `fileSize: data.sample?.size,` line, add:

```typescript
          capabilities: extractTriageCapabilities(data).length
            ? extractTriageCapabilities(data)
            : undefined,
          mitreTechniques: extractTriageMitre(data).length
            ? extractTriageMitre(data)
            : undefined,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun run test triage`
Expected: PASS (existing relations tests plus the new behavior tests).

- [ ] **Step 6: Commit**

```bash
git add lib/ti/hash/sources/triage.ts lib/ti/hash/sources/triage.test.ts
git commit -m "feat(ti): emit Triage capabilities and MITRE techniques"
```

---

### Task 4: Hybrid Analysis capabilities + MITRE (best-effort from overview)

**Files:**
- Modify: `lib/ti/hash/sources/hybrid-analysis.ts` (the `HaOverview` interface near line 4, and the `hashContext` in `check` near line 150)
- Test: `lib/ti/hash/sources/hybrid-analysis.test.ts` (append a describe block)

**Caveat (read before implementing):** the v2 `/overview` endpoint this source already calls does not reliably include MITRE/behavior data (that lives in the full report). We add these fields *defensively*, reading them only if the overview happens to include them, with no extra request. When absent, nothing is emitted and the feature degrades. Triage (Task 3) is the primary behavior source.

**Interfaces:**
- Consumes: `HashContext` (Task 1).
- Produces: `haCapabilities(data: HaOverview): { label: string; mitre?: string[] }[]` and `haMitre(data: HaOverview): { id: string; name?: string; tactic?: string }[]`, both exported. `hybridAnalysisSource.check` emits `capabilities`/`mitreTechniques` when the overview carries them.

- [ ] **Step 1: Write the failing test**

Append to `lib/ti/hash/sources/hybrid-analysis.test.ts`:

```typescript
import { haCapabilities, haMitre } from "./hybrid-analysis";

describe("haCapabilities / haMitre", () => {
  const data = {
    signatures: [
      { name: "Contacts a randomly generated domain", attck_id: ["T1568"] },
      { name: "Writes to startup", attck_id: ["T1547"] },
    ],
    mitre_attcks: [
      { technique: "Application Layer Protocol", attck_id: "T1071", tactic: "Command and Control" },
      { technique: "Ingress Tool Transfer", attck_id: "T1105", tactic: "Command and Control" },
    ],
  };

  it("maps behavioral signatures to capabilities with their technique ids", () => {
    expect(haCapabilities(data)).toEqual([
      { label: "Contacts a randomly generated domain", mitre: ["T1568"] },
      { label: "Writes to startup", mitre: ["T1547"] },
    ]);
  });

  it("maps mitre_attcks entries to techniques with names and tactics", () => {
    expect(haMitre(data)).toEqual([
      { id: "T1071", name: "Application Layer Protocol", tactic: "Command and Control" },
      { id: "T1105", name: "Ingress Tool Transfer", tactic: "Command and Control" },
    ]);
  });

  it("returns empty arrays when the overview omits behavior data", () => {
    expect(haCapabilities({})).toEqual([]);
    expect(haMitre({})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun run test hybrid-analysis`
Expected: FAIL, `haCapabilities` is not exported.

- [ ] **Step 3: Extend the interface**

In `hybrid-analysis.ts`, inside `interface HaOverview`, after the `related_children_hashes?: string[] | null;` line, add:

```typescript
  /** Behavioral signatures (present only on some overview responses). */
  signatures?: { name?: string; attck_id?: string[] | null }[] | null;
  /** MITRE ATT&CK mappings (present only on some overview responses). */
  mitre_attcks?:
    | { technique?: string; attck_id?: string; tactic?: string }[]
    | null;
```

- [ ] **Step 4: Add the helpers**

In `hybrid-analysis.ts`, directly above `export const hybridAnalysisSource: TiSource = {`, add:

```typescript
/** Behavioral signatures as capabilities, tagged with their technique ids. */
export function haCapabilities(
  data: HaOverview,
): { label: string; mitre?: string[] }[] {
  const out: { label: string; mitre?: string[] }[] = [];
  const seen = new Set<string>();
  for (const s of data.signatures ?? []) {
    if (!s?.name) continue;
    const key = s.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const mitre = (s.attck_id ?? []).map((id) => id.toUpperCase());
    out.push({ label: s.name, mitre: mitre.length ? mitre : undefined });
  }
  return out;
}

/** MITRE ATT&CK entries as deduped techniques with names and tactics. */
export function haMitre(
  data: HaOverview,
): { id: string; name?: string; tactic?: string }[] {
  const out: { id: string; name?: string; tactic?: string }[] = [];
  const seen = new Set<string>();
  for (const m of data.mitre_attcks ?? []) {
    if (!m?.attck_id) continue;
    const id = m.attck_id.toUpperCase();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: m.technique || undefined, tactic: m.tactic || undefined });
  }
  return out;
}
```

- [ ] **Step 5: Emit the new fields from `check`**

In `hybrid-analysis.ts`, inside the returned object's `hashContext`, after the `malwareFamily: family,` line, add:

```typescript
          capabilities: haCapabilities(data).length ? haCapabilities(data) : undefined,
          mitreTechniques: haMitre(data).length ? haMitre(data) : undefined,
```

- [ ] **Step 6: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun run test hybrid-analysis`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/ti/hash/sources/hybrid-analysis.ts lib/ti/hash/sources/hybrid-analysis.test.ts
git commit -m "feat(ti): best-effort Hybrid Analysis capabilities and MITRE"
```

---

### Task 5: VirusTotal detection ratio

**Files:**
- Modify: `lib/ti/hash/sources/virustotal.ts` (the `hashContext` in `check` near line 155)
- Test: `lib/ti/hash/sources/virustotal.test.ts` (append a test)

**Interfaces:**
- Consumes: `HashContext` (Task 1). Uses existing `malicious`/`total` computed in `check`.
- Produces: `virusTotalHashSource.check` sets `hashContext.detectionRatio = { malicious, total }` when the file is found.

- [ ] **Step 1: Write the failing test**

Append to `lib/ti/hash/sources/virustotal.test.ts` (mirror the file's existing http-mock pattern; if the file already imports `vi` and `http`, reuse them rather than re-importing):

```typescript
import { describe, expect, it, vi } from "vitest";
import { virusTotalHashSource } from "./virustotal";
import * as http from "../../http";

describe("virusTotalHashSource detectionRatio", () => {
  it("promotes the engine tally into hashContext.detectionRatio", async () => {
    vi.spyOn(process, "env", "get").mockReturnValue({
      ...process.env,
      VIRUSTOTAL_API_KEY: "test",
    });
    vi.spyOn(http, "getJson").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        data: {
          attributes: {
            last_analysis_stats: { harmless: 20, malicious: 48, suspicious: 3, undetected: 0, timeout: 0 },
            md5: "abc",
          },
        },
      },
    } as never);

    const finding = await virusTotalHashSource.check(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      new AbortController().signal,
    );

    expect(finding.hashContext?.detectionRatio).toEqual({ malicious: 48, total: 71 });
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun run test virustotal`
Expected: FAIL, `detectionRatio` is `undefined`.

- [ ] **Step 3: Emit the field**

In `virustotal.ts`, inside the returned object's `hashContext`, after the `detectionNames: detections.length ? detections : undefined,` line, add:

```typescript
          detectionRatio: { malicious, total },
```

(`malicious` and `total` are already computed above in the same function.)

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun run test virustotal`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/hash/sources/virustotal.ts lib/ti/hash/sources/virustotal.test.ts
git commit -m "feat(ti): expose VirusTotal detection ratio on hash context"
```

---

### Task 6: Union capabilities + MITRE in `mergeHashContext`

**Files:**
- Modify: `lib/ti/assemble.ts` (the `mergeHashContext` function, ~line 96)
- Test: `lib/ti/assemble.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `HashContext` (Task 1), `SourceResult` (existing).
- Produces: `assembleHashResult`'s merged context unions `capabilities` (deduped by lowercased label) and `mitreTechniques` (deduped by uppercased id) across all sources, instead of first-non-empty. Scalars (`familyDescription`, `detectionRatio`, etc.) stay first-non-empty.

- [ ] **Step 1: Write the failing test**

Append to `lib/ti/assemble.test.ts`:

```typescript
import { assembleHashResult } from "./assemble";
import type { SourceResult } from "./types";

describe("assembleHashResult context union", () => {
  const ok = (hashContext: Record<string, unknown>): SourceResult =>
    ({ source: { id: "x", name: "X", url: "", category: "scanner", weight: 0 }, status: "ok", hashContext }) as never;

  it("unions capabilities and mitre techniques across sources, deduped", () => {
    const results = [
      ok({ capabilities: [{ label: "Downloads executable", mitre: ["T1105"] }], mitreTechniques: [{ id: "T1105" }] }),
      ok({ capabilities: [{ label: "downloads executable" }, { label: "Writes run key" }], mitreTechniques: [{ id: "T1105" }, { id: "T1547" }] }),
    ];
    const result = assembleHashResult("d41d8cd98f00b204e9800998ecf8427e", "md5", results, "2026-07-18T00:00:00Z");
    expect(result.context?.capabilities).toEqual([
      { label: "Downloads executable", mitre: ["T1105"] },
      { label: "Writes run key" },
    ]);
    expect(result.context?.mitreTechniques).toEqual([{ id: "T1105" }, { id: "T1547" }]);
  });
});
```

Note: the `source` shape above is illustrative; if `assemble.test.ts` already has a `SourceResult` factory or fixture, use that instead of the inline `ok` helper so the object matches the real type exactly.

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun run test assemble`
Expected: FAIL, `capabilities` is the first source's array only (first-non-empty), not the union.

- [ ] **Step 3: Implement the union**

In `lib/ti/assemble.ts`, replace the body of `mergeHashContext` (from `const merged = mergeFields(` through its `return { ...merged, ... };`) with:

```typescript
  const contexts = results
    .filter((r) => r.status === "ok" && r.hashContext)
    .map((r) => r.hashContext as HashContext);
  const merged = mergeFields(contexts);
  if (!merged) return undefined;

  const dedupeBy = <T>(items: T[], key: (item: T) => string): T[] => {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const item of items) {
      const k = key(item);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(item);
    }
    return out;
  };

  const capabilities = dedupeBy(
    contexts.flatMap((c) => c.capabilities ?? []),
    (c) => c.label.toLowerCase(),
  );
  const mitreTechniques = dedupeBy(
    contexts.flatMap((c) => c.mitreTechniques ?? []),
    (t) => t.id.toUpperCase(),
  );

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
    capabilities: capabilities.length ? capabilities : undefined,
    mitreTechniques: mitreTechniques.length ? mitreTechniques : undefined,
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun run test assemble`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/assemble.ts lib/ti/assemble.test.ts
git commit -m "feat(ti): union capabilities and mitre across sources in merge"
```

---

### Task 7: Malpedia family enrichment

**Files:**
- Create: `lib/ti/hash/sources/malpedia.ts`
- Test: `lib/ti/hash/sources/malpedia.test.ts`
- Modify: `lib/ti/hash/check.ts` (wire enrichment after `assembleHashResult`)

**Interfaces:**
- Consumes: `resolveFamily` (Task 2), `HashContext` (Task 1), `HashCheckResult` (existing), `getJson` (http).
- Produces: `familyToMalpediaIds(family: string): string[]` and `fetchFamilyDescription(family: string, signal: AbortSignal): Promise<{ description?: string; refs?: string[] } | undefined>`, both exported from `malpedia.ts`. `checkHash` returns a result whose `context` carries `malwareFamily` (resolved), `familyDescription`, and `familyRefs` when Malpedia has the family.

- [ ] **Step 1: Write the failing test**

Create `lib/ti/hash/sources/malpedia.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { familyToMalpediaIds, fetchFamilyDescription } from "./malpedia";
import * as http from "../../http";

describe("familyToMalpediaIds", () => {
  it("slugifies and prefixes with platforms, win first", () => {
    expect(familyToMalpediaIds("Upatre")).toEqual([
      "win.upatre", "elf.upatre", "osx.upatre", "apk.upatre", "js.upatre",
    ]);
  });
  it("strips non-alphanumerics from the slug", () => {
    expect(familyToMalpediaIds("Cobalt Strike")[0]).toBe("win.cobaltstrike");
  });
});

describe("fetchFamilyDescription", () => {
  it("returns the description and capped refs on the first hit", async () => {
    const spy = vi.spyOn(http, "getJson").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        description: "Upatre is a downloader that retrieves a second-stage payload.",
        urls: ["https://a.example", "https://b.example", "https://c.example", "https://d.example", "https://e.example", "https://f.example"],
      },
    } as never);

    const info = await fetchFamilyDescription("Upatre", new AbortController().signal);
    expect(info?.description).toContain("downloader");
    expect(info?.refs).toHaveLength(5);
    expect(spy).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it("falls through platforms on 404 and gives up after the last miss", async () => {
    vi.spyOn(http, "getJson").mockResolvedValue({ ok: false, status: 404, data: undefined } as never);
    const info = await fetchFamilyDescription("Nope", new AbortController().signal);
    expect(info).toBeUndefined();
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun run test malpedia`
Expected: FAIL, cannot find module `./malpedia`.

- [ ] **Step 3: Implement the Malpedia helper**

Create `lib/ti/hash/sources/malpedia.ts`:

```typescript
import { getJson } from "../../http";

interface MalpediaFamily {
  description?: string;
  urls?: string[];
}

const BASE = "https://malpedia.caad.fkie.fraunhofer.de/api/get/family";
const PLATFORMS = ["win", "elf", "osx", "apk", "js"];

/**
 * Candidate Malpedia family ids for a family name, most likely first. Malpedia
 * keys families as `<platform>.<slug>`; most malware is Windows, so `win.`
 * leads. The slug is the name lowercased with non-alphanumerics stripped.
 */
export function familyToMalpediaIds(family: string): string[] {
  const slug = family.toLowerCase().replace(/[^a-z0-9]/g, "");
  return PLATFORMS.map((p) => `${p}.${slug}`);
}

/**
 * Fetch a family description from Malpedia (public API, no key). Tries the
 * platform-prefixed ids in order, stopping at the first hit; returns the
 * description plus up to five reference URLs. Any miss/timeout yields undefined,
 * so the caller degrades to showing just the family name.
 */
export async function fetchFamilyDescription(
  family: string,
  signal: AbortSignal,
): Promise<{ description?: string; refs?: string[] } | undefined> {
  for (const id of familyToMalpediaIds(family)) {
    const { ok, data } = await getJson<MalpediaFamily>(`${BASE}/${id}`, signal);
    if (ok && data && (data.description || data.urls?.length)) {
      return {
        description: data.description?.trim() || undefined,
        refs: data.urls?.length ? data.urls.slice(0, 5) : undefined,
      };
    }
  }
  return undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun run test malpedia`
Expected: PASS.

- [ ] **Step 5: Wire enrichment into `checkHash`**

Replace the entire body of `lib/ti/hash/check.ts` with:

```typescript
import type { HashCheckResult, SourceResult } from "../types";
import type { HashAlgorithm } from "@/lib/hash";
import { hashSources } from "./registry";
import { runAll } from "../orchestrate";
import { assembleHashResult } from "../assemble";
import { resolveFamily } from "./family";
import { fetchFamilyDescription } from "./sources/malpedia";

/**
 * Post-aggregation family enrichment. Sources run in parallel and can't see each
 * other, so the family is resolved from the merged context here, then described
 * via Malpedia. Server-only (Malpedia is a network call); the streamed
 * per-source view uses the pure assembler and simply lacks this until the final
 * result. Degrades silently: on any miss the family name still shows.
 */
async function enrichFamily(result: HashCheckResult): Promise<HashCheckResult> {
  const ctx = result.context;
  if (!ctx) return result;
  const family = resolveFamily(ctx);
  if (!family) return result;

  let info: { description?: string; refs?: string[] } | undefined;
  try {
    info = await fetchFamilyDescription(family, AbortSignal.timeout(8000));
  } catch {
    info = undefined;
  }

  return {
    ...result,
    context: {
      ...ctx,
      malwareFamily: ctx.malwareFamily ?? family,
      familyDescription: info?.description,
      familyRefs: info?.refs,
    },
  };
}

export async function checkHash(
  hash: string,
  algorithm: HashAlgorithm,
  onSettled?: (result: SourceResult) => void,
): Promise<HashCheckResult> {
  const results = await runAll(hashSources, hash, onSettled);
  const result = assembleHashResult(
    hash,
    algorithm,
    results,
    new Date().toISOString(),
  );
  return enrichFamily(result);
}
```

- [ ] **Step 6: Verify the whole suite and typecheck still pass**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun run test && bunx tsc --noEmit`
Expected: all tests PASS; no type errors.

- [ ] **Step 7: Commit**

```bash
git add lib/ti/hash/sources/malpedia.ts lib/ti/hash/sources/malpedia.test.ts lib/ti/hash/check.ts
git commit -m "feat(ti): enrich resolved family with a Malpedia description"
```

---

### Task 8: The `ThreatProfileCard` and page wiring

**Files:**
- Create: `components/CheckResults/threat-profile.tsx`
- Modify: `components/CheckResults/index.tsx` (import + `<Section>` + `HASH_SECTIONS`)
- Modify: `components/CheckResults/section-nav.tsx` (add the `threat` icon)

**Interfaces:**
- Consumes: `HashCheckResult` with the enriched `context` (Tasks 1, 6, 7), `hashTone` (`./classify`), `SectionHeading` (`./primitives`).
- Produces: `ThreatProfileCard({ result }: { result: HashCheckResult })`, rendered between the File identity (`origin`) and Related indicators (`related`) sections; returns `null` when there is no family, no capabilities, and no detection ratio.

- [ ] **Step 1: Create the component**

Create `components/CheckResults/threat-profile.tsx`:

```tsx
"use client";

import { Bug, ExternalLink } from "lucide-react";
import { type HashCheckResult } from "@/lib/ti/types";
import { hashTone } from "./classify";
import { SectionHeading } from "./primitives";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

/** `N / M engines` confidence chip, mirroring the algorithm chip on the File
 *  identity card. Shown only when VirusTotal supplied a detection ratio. */
function EnginesChip({ malicious, total }: { malicious: number; total: number }) {
    return (
        <code className="rounded-sm border border-foreground/15 bg-muted/60 px-2.5 py-1 font-mono text-xs font-semibold tracking-tight">
            {malicious} / {total} engines
        </code>
    );
}

/** Host of a reference URL, minus a leading www, for a compact link label. */
function refLabel(href: string): string {
    try {
        return new URL(href).hostname.replace(/^www\./, "");
    } catch {
        return href;
    }
}

/** Small uppercase group label, matching the identity card's field-group heads. */
function GroupLabel({ children }: { children: React.ReactNode }) {
    return (
        <div className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {children}
        </div>
    );
}

export function ThreatProfileCard({ result }: { result: HashCheckResult }) {
    const ctx = result.context;
    const family = ctx?.malwareFamily;
    const capabilities = ctx?.capabilities ?? [];
    const techniques = ctx?.mitreTechniques ?? [];
    const ratio = ctx?.detectionRatio;

    // Nothing to say about an unknown hash, show only File identity.
    if (!family && capabilities.length === 0 && !ratio) return null;

    const tone = hashTone(ctx);
    const dotClass = tone.includes("red")
        ? "bg-red-500 dark:bg-red-400"
        : "bg-foreground/40";

    return (
        <Card className="sketch-shadow rounded-lg border border-foreground/12">
            <CardContent className="space-y-5">
                <SectionHeading
                    icon={Bug}
                    action={
                        ratio ? (
                            <EnginesChip malicious={ratio.malicious} total={ratio.total} />
                        ) : undefined
                    }
                >
                    Threat profile
                </SectionHeading>

                {family && (
                    <div className="space-y-1.5">
                        <GroupLabel>Family</GroupLabel>
                        <div className="flex items-center gap-2.5">
                            <span className={cn("size-2.5 shrink-0 rounded-full", dotClass)} />
                            <span className={cn("text-base font-bold tracking-tight", tone)}>
                                {family}
                            </span>
                        </div>
                        {ctx?.familyDescription && (
                            <p className="text-sm leading-relaxed text-foreground/85">
                                {ctx.familyDescription}
                            </p>
                        )}
                        {ctx?.familyRefs && ctx.familyRefs.length > 0 && (
                            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-0.5">
                                {ctx.familyRefs.map((href) => (
                                    <a
                                        key={href}
                                        href={href}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-1 text-[13px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                                    >
                                        {refLabel(href)}
                                        <ExternalLink className="size-3" />
                                    </a>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                <div className="space-y-1.5">
                    <GroupLabel>What this file does</GroupLabel>
                    {capabilities.length > 0 ? (
                        <ul className="space-y-1.5">
                            {capabilities.map((c) => (
                                <li key={c.label} className="flex flex-col gap-0.5">
                                    <span className="text-sm text-foreground">{c.label}</span>
                                    {c.mitre && c.mitre.length > 0 && (
                                        <span className="font-mono text-[11px] text-muted-foreground">
                                            {c.mitre.join(", ")}
                                        </span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-sm text-muted-foreground">
                            No sandbox report is available for this sample, so its
                            behavior hasn&apos;t been observed directly. The family
                            description is the best guide.
                        </p>
                    )}
                </div>

                {techniques.length > 0 && (
                    <div className="space-y-1.5">
                        <GroupLabel>MITRE ATT&amp;CK</GroupLabel>
                        <div className="flex flex-wrap gap-1.5">
                            {techniques.map((t) => (
                                <span
                                    key={t.id}
                                    title={t.tactic}
                                    className="inline-flex items-center rounded-md border border-foreground/15 bg-background px-2 py-0.5 font-mono text-[12px] text-foreground/80"
                                >
                                    {t.id}
                                    {t.name ? ` ${t.name}` : ""}
                                </span>
                            ))}
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
```

- [ ] **Step 2: Add the section icon**

In `components/CheckResults/section-nav.tsx`, add `Bug` to the `lucide-react` import list (keep the list alphabetized: it goes just before `Circle`), and add a `threat` entry to the `ICONS` map, right after the `origin: Globe,` line:

```typescript
    threat: Bug,
```

- [ ] **Step 3: Wire the card into the hash layout**

In `components/CheckResults/index.tsx`:

3a. Add the import alongside the other card imports (after the `./profile` import block):

```typescript
import { ThreatProfileCard } from "./threat-profile";
```

3b. Add a nav entry to `HASH_SECTIONS`, between `origin` and `related`:

```typescript
    { id: "origin", label: "Origin" },
    { id: "threat", label: "Threat" },
    { id: "related", label: "Related" },
```

3c. Add the section in the hash result JSX, between the `origin` and `related` sections:

```tsx
            <Section id="origin">
                <HashProfileCard result={result} />
            </Section>
            <Section id="threat">
                <ThreatProfileCard result={result} />
            </Section>
            <Section id="related">
                <ConnectionsCard result={result} />
            </Section>
```

- [ ] **Step 4: Lint, typecheck, and build the file**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bunx eslint components/CheckResults/threat-profile.tsx components/CheckResults/index.tsx components/CheckResults/section-nav.tsx && bunx tsc --noEmit`
Expected: eslint exits 0; no type errors.

- [ ] **Step 5: Visual verification in the browser**

The user runs their own `next dev` on `:3000` (do not start another server). Confirm it's up, then screenshot the Threat profile card for a family-only hash (the reference Upatre hash from the spec) and a sandbox-covered hash.

Copy `scripts/shot.mjs` as a template into `scripts/_threatshot.mjs` targeting `Threat profile` (wait text) and the two hashes:
- `34b138e724d2ed98d178e03b9c9a13c92485e274b8c5961282fa0d29dd894ad2` (family resolves, empty behavior state)
- a known sandbox-covered SHA-256 (capabilities + MITRE populated), e.g. an Emotet sample hash you have on hand.

Run: `export PATH="$HOME/.bun/bin:$PATH"; SHOT_DIR=/tmp/claude/shots node scripts/_threatshot.mjs`
Expected: the card shows Family (name + description + refs), a capabilities list or the empty-state line, and MITRE chips when present. Delete `scripts/_threatshot.mjs` afterward. If Malpedia/keys are unavailable so the card can't be exercised live, say so explicitly rather than claiming it works.

- [ ] **Step 6: Full suite green, then commit**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun run test && bun run lint`
Expected: tests PASS; lint has no new errors for the changed files (the pre-existing vendored-file lint noise is unrelated).

```bash
git add components/CheckResults/threat-profile.tsx components/CheckResults/index.tsx components/CheckResults/section-nav.tsx
git commit -m "feat(ui): add SOC Threat profile card to the hash result page"
```

---

## Self-Review

**Spec coverage:**
- §1 data model (HashContext fields) → Task 1; `RelatedIndicator` tier/sources already built (noted in spec's implementation note), no task needed.
- §2 family resolution → Task 2.
- §3 Malpedia enrichment (post-step in check.ts) → Task 7.
- §4 sandbox behavior (Triage, Hybrid) → Tasks 3, 4 (Hybrid is best-effort from overview; caveat documented).
- §5 detection confidence → Task 5.
- §6 merge union → Task 6.
- §7 trustworthy related indicators → already built (out of scope here, per spec implementation note).
- §8 UI (dedicated ThreatProfileCard + wiring) → Task 8.
- Testing section → each task's tests cover the listed cases (family parser, triage/hybrid extraction, Malpedia mock, mergeHashContext union, VT detectionRatio).

**Placeholder scan:** none — every code and test step contains complete code.

**Type consistency:** `capabilities: { label, mitre? }[]` and `mitreTechniques: { id, name?, tactic? }[]` are consistent across Tasks 1, 3, 4, 6, 8. `detectionRatio: { malicious, total }` consistent across Tasks 1, 5, 8. `resolveFamily` (Task 2) is consumed only in Task 7. `fetchFamilyDescription(family, signal)` return shape `{ description?, refs? }` matches its consumer in Task 7.

**Known deviation from a literal spec reading:** Hybrid Analysis MITRE/capabilities are read best-effort from the existing overview response (Task 4 caveat), not via an added report request, to preserve the source's deliberate single-request design. Triage is the primary behavior source.
