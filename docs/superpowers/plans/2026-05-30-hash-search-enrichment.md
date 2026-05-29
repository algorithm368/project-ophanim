# Hash Search Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the file-hash report richer — surface the connections current sources already return, promote distribution URLs, and add four new TI sources — so a hash lookup yields more, and more pivotable, information.

**Architecture:** Layered build inside the existing pipeline (`TiSource` adapters → `SourceFinding` → orchestrator → aggregate → React result page). Phase 1 extends the data model and mines data the current sources already return (zero new keys). Phase 2 ships a shared Connections card and a Distribution URLs block. Phase 3 adds four key-gated sources that slot into the finished model.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Vitest. HTTP via `lib/ti/http.ts` helpers. `@/` path alias maps to repo root.

**Spec:** `docs/superpowers/specs/2026-05-30-hash-search-enrichment-design.md`

**Conventions to honor:**
- Source adapters mirror `lib/ti/sources/feodo.ts`: catch errors and return `{ status: isTimeout(err) ? "timeout" : "error", error: errorMessage(err) }`; honor the `AbortSignal`; never use bare `fetch` (use `lib/ti/http.ts`).
- Network source adapters are NOT unit-tested (they hit the network) — matching the current codebase. Pure logic (helpers, scoring maps, relations) IS unit-tested in colocated `*.test.ts` files.
- A "not found / clean miss" returns `status: "ok"` with **no score** (absence ≠ clean).
- Run `npm test` and `npm run lint` before declaring any task done.

**Relation labels used by the hash flow** (the `relation` field is a free string — no type change needed):

| label          | target type | meaning                                  |
|----------------|-------------|------------------------------------------|
| `contacts`     | ip / domain | C2 / network indicators the sample reaches |
| `drops`        | hash        | files this sample drops                   |
| `parent`       | hash        | samples that execute/contain this one     |
| `similar`      | hash        | samples clustered by imphash              |
| `distribution` | domain      | host extracted from a distribution URL    |

> Note: the URL-host label is `distribution`, **not** `host` — the IP flow already uses `host` for Shodan-observed vhosts, and reusing it would mislabel the group.

---

## Phase 1 — Data model + mining existing sources (no new keys)

### Task 1: `hostFromUrl` helper

**Files:**
- Create: `lib/url.ts`
- Test: `lib/url.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/url.test.ts
import { describe, expect, it } from "vitest";
import { hostFromUrl } from "@/lib/url";

describe("hostFromUrl", () => {
  it("extracts a lowercased hostname from a full URL", () => {
    expect(hostFromUrl("https://Evil.Example.com/path?x=1")).toBe(
      "evil.example.com",
    );
  });

  it("keeps an IPv4 host (drops the port)", () => {
    expect(hostFromUrl("http://1.2.3.4:8080/a.exe")).toBe("1.2.3.4");
  });

  it("returns undefined for a scheme-less or garbage string", () => {
    expect(hostFromUrl("evil.example.com/x")).toBeUndefined();
    expect(hostFromUrl("not a url")).toBeUndefined();
    expect(hostFromUrl("")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/url.test.ts`
Expected: FAIL — cannot find module `@/lib/url`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/url.ts
/**
 * Extract the lowercased hostname from a URL string, or undefined when it can't
 * be parsed (no scheme, empty, garbage). Used to turn distribution URLs into a
 * pivotable domain and to render their host.
 */
export function hostFromUrl(url: string): string | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host || undefined;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/url.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/url.ts lib/url.test.ts
git commit -m "feat(hash): add hostFromUrl helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Extend `HashContext` with `distributionUrls` + `detectionNames`

**Files:**
- Modify: `lib/ti/types.ts` (the `HashContext` interface, ends ~line 91)

- [ ] **Step 1: Add the fields**

In `lib/ti/types.ts`, inside `interface HashContext`, immediately after the `tags?: string[];` line, add:

```ts
  /** URLs the sample has been served/downloaded from (distribution + in-the-wild). */
  distributionUrls?: string[];
  /** AV/engine detection labels, e.g. "Trojan.Win32.Emotet". */
  detectionNames?: string[];
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no errors — these are additive optional fields).

- [ ] **Step 3: Commit**

```bash
git add lib/ti/types.ts
git commit -m "feat(hash): add distributionUrls and detectionNames to HashContext

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: URLhaus — promote distribution URLs + host relations

**Files:**
- Modify: `lib/ti/hash/sources/urlhaus.ts`

The adapter already computes `sampleUrls` into `details` but drops them from context. Promote them to `hashContext.distributionUrls` and add their hosts as `distribution` domain relations.

- [ ] **Step 1: Update imports**

At the top of `lib/ti/hash/sources/urlhaus.ts`, change the type import to include `RelatedIndicator` and add the `hostFromUrl` import:

```ts
import type { RelatedIndicator, SourceFinding, TiSource } from "../../types";
import { errorMessage, isTimeout, postForm } from "../../http";
import { hostFromUrl } from "@/lib/url";
```

- [ ] **Step 2: Build distribution URLs + host relations**

In `check()`, replace the block that currently computes `urlCount`/`onlineUrls` (just before the `return`) so it also derives URLs and host relations. The full replacement for the section from `const family = ...` down to the `return {`:

```ts
      const family = data.signature?.trim() || undefined;
      const urlCount = toNumber(data.url_count) ?? data.urls?.length ?? 0;
      const onlineUrls =
        data.urls?.filter((u) => u.url_status === "online").length ?? 0;

      const distributionUrls = [
        ...new Set(
          (data.urls ?? [])
            .map((u) => u.url)
            .filter((v): v is string => typeof v === "string" && v.length > 0),
        ),
      ].slice(0, 8);

      const hostRelations: RelatedIndicator[] = [];
      const seenHosts = new Set<string>();
      for (const u of distributionUrls) {
        const host = hostFromUrl(u);
        if (host && !seenHosts.has(host)) {
          seenHosts.add(host);
          hostRelations.push({
            value: host,
            type: "domain",
            relation: "distribution",
          });
        }
      }

      return {
```

- [ ] **Step 3: Attach the new data to the finding**

In the returned object, add `distributionUrls` to `hashContext` and add a `relations` field. The `hashContext` block becomes:

```ts
        hashContext: {
          md5: data.md5_hash,
          sha256: data.sha256_hash,
          fileType: data.file_type,
          fileSize: toNumber(data.file_size),
          malwareFamily: family,
          firstSeen: data.firstseen ?? undefined,
          lastSeen: data.lastseen ?? undefined,
          distributionUrls: distributionUrls.length
            ? distributionUrls
            : undefined,
        },
```

And add this line alongside `details`/`raw` in the returned object:

```ts
        relations: hostRelations.length ? hostRelations : undefined,
```

- [ ] **Step 4: Lint + typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/hash/sources/urlhaus.ts
git commit -m "feat(hash): surface URLhaus distribution URLs and host pivots

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: VirusTotal hash — expand relations (dropped/parent files, contacted/ITW URLs)

**Files:**
- Modify: `lib/ti/hash/sources/virustotal.ts`

Today `fetchHashRelations` fetches only `contacted_ips` + `contacted_domains`. Generalize it to also pull `dropped_files` (→ `hash`/`drops`), `execution_parents` (→ `hash`/`parent`), and `itw_urls` + `contacted_urls` (→ `distributionUrls` + `distribution` domain relations). Each list is independently guarded; any failure yields nothing.

- [ ] **Step 1: Update imports**

Add `hostFromUrl` (the `IndicatorType`/`RelatedIndicator`/`SourceFinding`/`TiSource` type import already exists):

```ts
import type {
  IndicatorType,
  RelatedIndicator,
  SourceFinding,
  TiSource,
} from "../../types";
import { errorMessage, getJson, isTimeout } from "../../http";
import { hostFromUrl } from "@/lib/url";
```

- [ ] **Step 2: Replace `VtRelationList` + `fetchHashRelations` with the generalized version**

Replace the existing `interface VtRelationList { ... }` and the entire `fetchHashRelations` function (lines ~9–48) with:

```ts
interface VtRelItem {
  id?: string;
  attributes?: { url?: string };
}
interface VtRelList {
  data?: VtRelItem[];
}

/** File/IP/domain relationship endpoints → typed RelatedIndicators. */
const INDICATOR_RELS: {
  kind: string;
  type: IndicatorType;
  relation: string;
}[] = [
  { kind: "contacted_ips", type: "ip", relation: "contacts" },
  { kind: "contacted_domains", type: "domain", relation: "contacts" },
  { kind: "dropped_files", type: "hash", relation: "drops" },
  { kind: "execution_parents", type: "hash", relation: "parent" },
];

/** URL relationship endpoints → distribution URLs (+ host relations). */
const URL_RELS = ["itw_urls", "contacted_urls"];

/**
 * Pull what the sample reaches out to / drops / came from. Each list is fetched
 * best-effort and independently; any failure (timeout, quota, premium-gated)
 * just contributes nothing. Returns relation pivots plus the raw URLs to show.
 */
async function fetchHashRelations(
  hash: string,
  signal: AbortSignal,
  headers: Record<string, string>,
): Promise<{ relations: RelatedIndicator[]; distributionUrls: string[] }> {
  const getList = async (kind: string): Promise<VtRelItem[]> => {
    try {
      const { ok, data } = await getJson<VtRelList>(
        `https://www.virustotal.com/api/v3/files/${hash}/${kind}?limit=10`,
        signal,
        headers,
      );
      return ok && Array.isArray(data?.data) ? data.data : [];
    } catch {
      return [];
    }
  };

  const [indicatorLists, urlLists] = await Promise.all([
    Promise.all(INDICATOR_RELS.map((r) => getList(r.kind))),
    Promise.all(URL_RELS.map((k) => getList(k))),
  ]);

  const relations: RelatedIndicator[] = [];
  INDICATOR_RELS.forEach((r, i) => {
    const values = [
      ...new Set(
        indicatorLists[i]
          .map((d) => d.id)
          .filter((v): v is string => typeof v === "string" && v.length > 0),
      ),
    ].slice(0, 6);
    for (const value of values)
      relations.push({ value, type: r.type, relation: r.relation });
  });

  const distributionUrls = [
    ...new Set(
      urlLists
        .flat()
        .map((d) => d.attributes?.url)
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  ].slice(0, 8);

  const seenHosts = new Set<string>();
  for (const u of distributionUrls) {
    const host = hostFromUrl(u);
    if (host && !seenHosts.has(host)) {
      seenHosts.add(host);
      relations.push({ value: host, type: "domain", relation: "distribution" });
    }
  }

  return { relations, distributionUrls };
}
```

- [ ] **Step 3: Consume the new return shape in `check()`**

The current call is `fetchHashRelations(hash, signal, headers)` destructured as `relations`. Change the `Promise.all` destructure and downstream usage. Where the code reads:

```ts
      const [main, relations] = await Promise.all([
```

change to:

```ts
      const [main, rel] = await Promise.all([
```

Then in the success `return`, set the context URL field and the relations field. Add to the `hashContext` object:

```ts
          distributionUrls: rel.distributionUrls.length
            ? rel.distributionUrls
            : undefined,
```

and change the existing relations line from `relations: relations.length ? relations : undefined,` to:

```ts
        relations: rel.relations.length ? rel.relations : undefined,
```

- [ ] **Step 4: Lint + typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/hash/sources/virustotal.ts
git commit -m "feat(hash): expand VirusTotal relations to drops/parents/URLs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: MalwareBazaar — imphash sibling ("similar") relations

**Files:**
- Modify: `lib/ti/hash/sources/malwarebazaar.ts`

When the primary lookup returns an `imphash`, do one follow-up `get_imphash` query and map a capped set of sibling SHA-256s (excluding the queried sample) to `similar` hash relations. Best-effort.

- [ ] **Step 1: Update imports**

```ts
import type { RelatedIndicator, SourceFinding, TiSource } from "../../types";
import { errorMessage, isTimeout, postForm } from "../../http";
```

- [ ] **Step 2: Add the sibling-fetch helper**

Above `export const malwareBazaarSource`, add:

```ts
/**
 * Samples sharing an import hash are frequently the same malware family/build.
 * Best-effort: a failed or empty follow-up yields no relations and never fails
 * the primary finding.
 */
async function fetchImphashSiblings(
  imphash: string,
  selfSha256: string | undefined,
  signal: AbortSignal,
  key: string,
): Promise<RelatedIndicator[]> {
  try {
    const { ok, data } = await postForm<MbResponse>(
      "https://mb-api.abuse.ch/api/v1/",
      signal,
      { query: "get_imphash", imphash, limit: "10" },
      { "Auth-Key": key },
    );
    if (!ok || data?.query_status !== "ok" || !Array.isArray(data.data))
      return [];
    const self = selfSha256?.toLowerCase();
    const shas = [
      ...new Set(
        data.data
          .map((e) => e.sha256_hash?.toLowerCase())
          .filter((v): v is string => Boolean(v) && v !== self),
      ),
    ].slice(0, 6);
    return shas.map((value) => ({
      value,
      type: "hash" as const,
      relation: "similar",
    }));
  } catch {
    return [];
  }
}
```

- [ ] **Step 3: Call it from the malicious-hit branch**

In `check()`, after `const tags = (entry.tags ?? []).filter(Boolean);` and before the `return {` that reports the hit, add:

```ts
      const siblings = entry.imphash
        ? await fetchImphashSiblings(entry.imphash, entry.sha256_hash, signal, key)
        : [];
```

Then add to that `return` object (alongside `details`/`raw`):

```ts
        relations: siblings.length ? siblings : undefined,
```

- [ ] **Step 4: Lint + typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/hash/sources/malwarebazaar.ts
git commit -m "feat(hash): add MalwareBazaar imphash 'similar sample' pivots

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Relations regression tests for the new labels

**Files:**
- Modify: `lib/relations.test.ts`

`relationsFor` already handles arbitrary relation labels, but lock in the contract for the new hash labels (dedupe across sources, focus-self exclusion) so future changes can't silently break the Connections card.

- [ ] **Step 1: Write the failing test**

Append to `lib/relations.test.ts` inside the `describe("relationsFor", ...)` block (before its closing `});`):

```ts
  it("collects new hash relation labels from multiple sources and dedupes", () => {
    const baseHash: HashCheckResult = {
      hash: "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f",
      algorithm: "sha256",
      checkedAt: "",
      riskScore: 0,
      verdict: "clean",
      sources: [],
      stats: {
        total: 0,
        queried: 0,
        flagged: 0,
        skipped: 0,
        errored: 0,
        rateLimited: 0,
      },
    };
    const mkSource = (
      id: string,
      relations: HashCheckResult["sources"][number]["relations"],
    ): SourceResult => ({
      source: {
        id,
        name: id,
        url: "",
        category: "reputation",
        requiresKey: true,
        weight: 1,
      },
      enabled: true,
      status: "ok",
      durationMs: 1,
      relations,
    });
    const result: HashCheckResult = {
      ...baseHash,
      sources: [
        mkSource("virustotal", [
          { value: "1.2.3.4", type: "ip", relation: "contacts" },
          { value: "drop1", type: "hash", relation: "drops" },
          { value: "evil.example.com", type: "domain", relation: "distribution" },
        ]),
        mkSource("urlhaus", [
          // duplicate host from another source must collapse to one node
          { value: "evil.example.com", type: "domain", relation: "distribution" },
        ]),
        mkSource("malwarebazaar", [
          { value: "sibling1", type: "hash", relation: "similar" },
        ]),
      ],
    };
    const { related } = relationsFor(result);
    expect(related).toContainEqual({
      value: "drop1",
      type: "hash",
      relation: "drops",
    });
    expect(related).toContainEqual({
      value: "sibling1",
      type: "hash",
      relation: "similar",
    });
    expect(
      related.filter((r) => r.value === "evil.example.com"),
    ).toHaveLength(1);
  });
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run lib/relations.test.ts`
Expected: PASS — including the new case. (This is a contract/regression test; `relationsFor` already supports it, so it should pass immediately. If it fails, the dedupe or source-collection logic regressed.)

- [ ] **Step 3: Commit**

```bash
git add lib/relations.test.ts
git commit -m "test(hash): lock in new relation labels through relationsFor

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Phase 1 gate — full suite green

- [ ] **Step 1: Run the whole suite + lint**

Run: `npm test && npm run lint`
Expected: all tests pass; lint clean.

- [ ] **Step 2: (no commit)** — verification only; proceed to Phase 2.

---

## Phase 2 — Shared Connections card + Distribution URLs UI (no new keys)

> UI changes have no unit-test harness in this repo (tests are pure-lib). Verify these tasks with `npm run lint`, `npx tsc --noEmit`, and a visual check via `npm run dev` / the `scripts/` Playwright shot helpers.

### Task 8: Shared `ConnectionsCard`

**Files:**
- Modify: `components/CheckResults.tsx`

- [ ] **Step 1: Add the `relationsFor` import**

Near the other `@/lib` imports at the top of `components/CheckResults.tsx`, add:

```ts
import { relationsFor } from "@/lib/relations";
```

- [ ] **Step 2: Add the component**

Add this component (e.g. just above `function ActivityCard`). It reuses the existing `relationsFor`, `Pivot`, `PivotList`, `SectionHeading`, `Field`, `Card`, and icons (all already imported):

```tsx
/** Display + ordering for relation labels surfaced in the Connections card. */
const RELATION_META: Record<string, { label: string; icon: IconType }> = {
  contacts: { label: "Contacts (C2 / network)", icon: Network },
  drops: { label: "Drops", icon: FileDigit },
  parent: { label: "Parent samples", icon: FileDigit },
  similar: { label: "Similar samples", icon: Fingerprint },
  distribution: { label: "Distribution hosts", icon: Globe },
  hosted: { label: "Hosted domains", icon: Globe },
  A: { label: "Resolves to (A)", icon: Link2 },
  NS: { label: "Nameservers", icon: Server },
  MX: { label: "Mail (MX)", icon: Mail },
  rDNS: { label: "Reverse DNS", icon: SignalHigh },
  host: { label: "Observed hostnames", icon: Globe },
};
const RELATION_ORDER = [
  "contacts",
  "drops",
  "parent",
  "similar",
  "distribution",
  "hosted",
  "A",
  "NS",
  "MX",
  "rDNS",
  "host",
];
/** A file's other digests are shown in the profile card, not as "connections". */
const DIGEST_RELATIONS = new Set(["MD5", "SHA-1", "SHA-256"]);

function ConnectionsCard({
  result,
}: {
  result: CheckResult | DomainCheckResult | HashCheckResult;
}) {
  const { related } = relationsFor(result);
  const groups = new Map<string, string[]>();
  for (const r of related) {
    if (DIGEST_RELATIONS.has(r.relation)) continue;
    const list = groups.get(r.relation) ?? [];
    list.push(r.value);
    groups.set(r.relation, list);
  }
  if (groups.size === 0) return null;

  // Known relations in priority order, then any unknown ones alphabetically.
  const keys = [
    ...RELATION_ORDER.filter((k) => groups.has(k)),
    ...[...groups.keys()]
      .filter((k) => !RELATION_ORDER.includes(k))
      .sort(),
  ];

  return (
    <Card className="sketch-shadow rounded-[20px_28px_16px_24px/24px_16px_28px_20px] border-2 border-foreground/15">
      <CardContent className="space-y-4">
        <SectionHeading icon={Link2}>What it connects to</SectionHeading>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          {keys.map((key) => {
            const meta = RELATION_META[key] ?? { label: key, icon: Link2 };
            return (
              <Field key={key} icon={meta.icon} label={meta.label} wrap>
                <PivotList values={groups.get(key) ?? []} max={6} />
              </Field>
            );
          })}
        </dl>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Render it in all three result components**

In `HashResults`, add `<ConnectionsCard result={result} />` after `<HistoryCard result={result} />` and before `<ScoreChart ... />`:

```tsx
            <HistoryCard result={result} />
            <ConnectionsCard result={result} />
            <ScoreChart result={result} subject="this file" />
```

Make the identical insertion (same two lines of context) in `DomainResults` (`subject="this domain"`) and in `Results` (`subject="this IP"`).

- [ ] **Step 4: Lint + typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Visual check**

Run: `npm run dev`, then check a hash known to VirusTotal (with key set) and an IP with reverse DNS. Confirm a "What it connects to" card appears with grouped, clickable pivots, and that clicking a pivot launches a fresh check. If you cannot run the UI, say so explicitly.

- [ ] **Step 6: Commit**

```bash
git add components/CheckResults.tsx
git commit -m "feat(ui): shared Connections card on all result pages

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Distribution URLs block (hash report) + new source out-links

**Files:**
- Modify: `components/CheckResults.tsx`

- [ ] **Step 1: Import `hostFromUrl`**

Add near the other `@/lib` imports:

```ts
import { hostFromUrl } from "@/lib/url";
```

- [ ] **Step 2: Add the URL row + card components**

Add above `function ActivityCard` (after `ConnectionsCard`):

```tsx
function DistributionUrlRow({ url }: { url: string }) {
  const [copied, copy] = useCopied();
  const host = hostFromUrl(url);
  return (
    <li className="flex items-center gap-2 rounded-[10px_14px_8px_12px/12px_8px_14px_10px] border border-foreground/10 bg-muted/40 p-2 text-xs">
      <code className="min-w-0 flex-1 truncate font-mono text-[12px]" title={url}>
        {url}
      </code>
      {host && <Pivot value={host} label={`check ${host}`} />}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title="Open in a new tab (may be a live malware URL)"
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        <ExternalLink className="size-3.5" />
      </a>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        aria-label="Copy URL"
        className="size-6 shrink-0 p-0 text-muted-foreground hover:text-foreground"
        onClick={() => copy(url)}
      >
        {copied ? (
          <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </Button>
    </li>
  );
}

function DistributionUrlsCard({ result }: { result: HashCheckResult }) {
  const urls = result.context?.distributionUrls ?? [];
  if (urls.length === 0) return null;
  const shown = urls.slice(0, 8);
  const extra = urls.length - shown.length;
  return (
    <Card className="sketch-shadow rounded-[20px_28px_16px_24px/24px_16px_28px_20px] border-2 border-foreground/15">
      <CardContent className="space-y-3">
        <SectionHeading icon={Link2}>Where it&apos;s been served</SectionHeading>
        <p className="text-xs text-muted-foreground">
          URLs that distributed this file. Use the pivot to check the host — open
          links cautiously; they may still be live.
        </p>
        <ul className="space-y-1.5">
          {shown.map((u) => (
            <DistributionUrlRow key={u} url={u} />
          ))}
        </ul>
        {extra > 0 && (
          <p className="text-xs text-muted-foreground">+{extra} more</p>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Render it in `HashResults`**

Insert after `<ConnectionsCard result={result} />`:

```tsx
            <ConnectionsCard result={result} />
            <DistributionUrlsCard result={result} />
            <ScoreChart result={result} subject="this file" />
```

- [ ] **Step 4: Add out-links for the new sources**

In the `HASH_LOOKUP_URL` map, add four entries (keys match the source `id`s defined in Phase 3):

```ts
    maltiverse: (h) => `https://maltiverse.com/sample/${h}`,
    triage: (h) => `https://tria.ge/s?q=${h}`,
    pulsedive: (h) => `https://pulsedive.com/indicator/?ioc=${h}`,
    "kaspersky-opentip": (h) => `https://opentip.kaspersky.com/${h}/results`,
```

- [ ] **Step 5: Lint + typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Visual check**

Run: `npm run dev` and check a hash known to URLhaus (a malware-download sample) — confirm the "Where it's been served" card lists URLs with copy / open / check-host. If you cannot run the UI, say so explicitly.

- [ ] **Step 7: Commit**

```bash
git add components/CheckResults.tsx
git commit -m "feat(ui): distribution URLs block + new source out-links

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 3 — New key-gated sources

> Each adapter follows the `feodo.ts` contract and is registered so it always appears (as `skipped` until its key is set). Provider response shapes are best-effort from the API docs — **Step "verify live" is mandatory**: run one real lookup with the key set and reconcile field names before committing. Adapters are not unit-tested; the discrete score-mapping helpers (Kaspersky, Pulsedive) are.

### Task 10: Pulsedive source (with tested `riskToScore`)

**Files:**
- Create: `lib/ti/hash/sources/pulsedive.ts`
- Test: `lib/ti/hash/sources/pulsedive.test.ts`
- Modify: `lib/ti/hash/registry.ts`, `.env.example`

- [ ] **Step 1: Write the failing test for the score map**

```ts
// lib/ti/hash/sources/pulsedive.test.ts
import { describe, expect, it } from "vitest";
import { riskToScore } from "@/lib/ti/hash/sources/pulsedive";

describe("riskToScore", () => {
  it("maps Pulsedive risk levels to 0-100", () => {
    expect(riskToScore("critical")).toBe(90);
    expect(riskToScore("high")).toBe(75);
    expect(riskToScore("medium")).toBe(45);
    expect(riskToScore("low")).toBe(20);
    expect(riskToScore("none")).toBe(0);
    expect(riskToScore("unknown")).toBeUndefined();
    expect(riskToScore(undefined)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/ti/hash/sources/pulsedive.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the adapter**

```ts
// lib/ti/hash/sources/pulsedive.ts
import type { RelatedIndicator, SourceFinding, TiSource } from "../../types";
import { errorMessage, getJson, isTimeout } from "../../http";

interface PdProperty {
  indicator?: string;
  type?: string; // ip | domain | url | sha256 | ...
}
interface PdResponse {
  iid?: number;
  indicator?: string;
  risk?: string; // none | low | medium | high | critical | unknown
  threats?: { name?: string }[] | null;
  properties?: { dns?: unknown };
  // Pulsedive returns linked indicators under different keys per plan; the
  // adapter reads any that are present (verify live before committing).
  links?: PdProperty[] | null;
  error?: string;
}

/** Pulsedive risk band → 0-100 contribution. Returns undefined when unknown. */
export function riskToScore(risk: string | undefined): number | undefined {
  switch (risk) {
    case "critical":
      return 90;
    case "high":
      return 75;
    case "medium":
      return 45;
    case "low":
      return 20;
    case "none":
      return 0;
    default:
      return undefined;
  }
}

function linkType(t: string | undefined): RelatedIndicator["type"] | undefined {
  if (t === "ip") return "ip";
  if (t === "domain") return "domain";
  if (t === "sha256" || t === "md5" || t === "sha1") return "hash";
  return undefined;
}

/** Pulsedive — indicator risk + linked indicators (free API key). */
export const pulsediveSource: TiSource = {
  meta: {
    id: "pulsedive",
    name: "Pulsedive",
    url: "https://pulsedive.com",
    category: "reputation",
    requiresKey: true,
    weight: 0.6,
    keyEnv: "PULSEDIVE_API_KEY",
    timeoutMs: 12000,
  },
  isEnabled: () => Boolean(process.env.PULSEDIVE_API_KEY),
  async check(hash, signal): Promise<SourceFinding> {
    const key = process.env.PULSEDIVE_API_KEY;
    if (!key) return { status: "skipped" };
    try {
      const url = `https://pulsedive.com/api/explore.php?q=ioc%3D${encodeURIComponent(
        hash,
      )}&limit=1&pretty=1&key=${encodeURIComponent(key)}`;
      const { ok, status, data } = await getJson<{
        results?: PdResponse[];
        error?: string;
      }>(url, signal);

      const hit = data?.results?.[0];
      if (!ok) {
        return { status: "error", error: data?.error ?? `HTTP ${status}` };
      }
      if (!hit) {
        return { status: "ok", summary: "Not indexed by Pulsedive" };
      }

      const score = riskToScore(hit.risk);
      const threats = (hit.threats ?? [])
        .map((t) => t.name)
        .filter((v): v is string => Boolean(v));
      const relations: RelatedIndicator[] = (hit.links ?? [])
        .map((l) => {
          const type = linkType(l.type);
          return type && l.indicator
            ? { value: l.indicator, type, relation: "contacts" }
            : null;
        })
        .filter((r): r is RelatedIndicator => r !== null)
        .slice(0, 8);

      return {
        status: "ok",
        malicious: hit.risk === "high" || hit.risk === "critical",
        score,
        categories: threats.slice(0, 10),
        summary: `Pulsedive risk: ${hit.risk ?? "unknown"}${
          threats.length ? ` (${threats.slice(0, 3).join(", ")})` : ""
        }`,
        hashContext: threats.length ? { detectionNames: threats } : undefined,
        relations: relations.length ? relations : undefined,
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

- [ ] **Step 4: Run the score-map test (passes)**

Run: `npx vitest run lib/ti/hash/sources/pulsedive.test.ts`
Expected: PASS.

- [ ] **Step 5: Register + document the key**

In `lib/ti/hash/registry.ts`, add the import and include `pulsediveSource` in the `hashSources` array:

```ts
import { pulsediveSource } from "./sources/pulsedive";
```

Add to `.env.example` under the key-gated section:

```bash
# Pulsedive — indicator risk + linked indicators (hash). https://pulsedive.com
PULSEDIVE_API_KEY=
```

- [ ] **Step 6: Verify live (mandatory)**

With `PULSEDIVE_API_KEY` set in `.env.local`, run a real lookup (e.g. `npm run dev` and check a known-bad SHA-256, or a quick node script). Confirm the response field names in `PdResponse` match the live JSON; fix the parsing if they differ. Confirm the source card renders and links out.

- [ ] **Step 7: Lint + full suite**

Run: `npm run lint && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/ti/hash/sources/pulsedive.ts lib/ti/hash/sources/pulsedive.test.ts lib/ti/hash/registry.ts .env.example
git commit -m "feat(hash): add Pulsedive source

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: Kaspersky OpenTIP source (with tested `zoneToScore`)

**Files:**
- Create: `lib/ti/hash/sources/kaspersky-opentip.ts`
- Test: `lib/ti/hash/sources/kaspersky-opentip.test.ts`
- Modify: `lib/ti/hash/registry.ts`, `.env.example`

- [ ] **Step 1: Write the failing test for the zone map**

```ts
// lib/ti/hash/sources/kaspersky-opentip.test.ts
import { describe, expect, it } from "vitest";
import { zoneToScore } from "@/lib/ti/hash/sources/kaspersky-opentip";

describe("zoneToScore", () => {
  it("maps Kaspersky zones to score + malicious", () => {
    expect(zoneToScore("Red")).toEqual({ score: 90, malicious: true });
    expect(zoneToScore("Yellow")).toEqual({ score: 45, malicious: false });
    expect(zoneToScore("Green")).toEqual({ score: 0, malicious: false });
    // Grey = unknown: no score, not clean.
    expect(zoneToScore("Grey")).toEqual({ score: undefined, malicious: false });
    expect(zoneToScore(undefined)).toEqual({
      score: undefined,
      malicious: false,
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/ti/hash/sources/kaspersky-opentip.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the adapter**

```ts
// lib/ti/hash/sources/kaspersky-opentip.ts
import type { SourceFinding, TiSource } from "../../types";
import { errorMessage, getJson, isTimeout } from "../../http";

interface KasperskyResponse {
  Zone?: string; // Red | Yellow | Green | Grey
  FileGeneralInfo?: {
    FileStatus?: string;
    Type?: string;
    Size?: number;
    Md5?: string;
    Sha1?: string;
    Sha256?: string;
  };
  DetectionsInfo?: { DetectionName?: string }[] | null;
}

/** Kaspersky OpenTIP zone → score + malicious flag. Grey/unknown = no score. */
export function zoneToScore(zone: string | undefined): {
  score: number | undefined;
  malicious: boolean;
} {
  switch (zone) {
    case "Red":
      return { score: 90, malicious: true };
    case "Yellow":
      return { score: 45, malicious: false };
    case "Green":
      return { score: 0, malicious: false };
    default:
      return { score: undefined, malicious: false };
  }
}

/** Kaspersky OpenTIP — authoritative hash reputation zone (free API key). */
export const kasperskyOpenTipSource: TiSource = {
  meta: {
    id: "kaspersky-opentip",
    name: "Kaspersky OpenTIP",
    url: "https://opentip.kaspersky.com",
    category: "reputation",
    requiresKey: true,
    weight: 0.9,
    keyEnv: "KASPERSKY_OPENTIP_API_KEY",
    timeoutMs: 12000,
  },
  isEnabled: () => Boolean(process.env.KASPERSKY_OPENTIP_API_KEY),
  async check(hash, signal): Promise<SourceFinding> {
    const key = process.env.KASPERSKY_OPENTIP_API_KEY;
    if (!key) return { status: "skipped" };
    try {
      const { ok, status, data } = await getJson<KasperskyResponse>(
        `https://opentip.kaspersky.com/api/v1/search/hash?request=${encodeURIComponent(
          hash,
        )}`,
        signal,
        { "x-api-key": key },
      );

      if (status === 404) {
        return { status: "ok", summary: "Not found in Kaspersky OpenTIP" };
      }
      if (!ok || !data) {
        return { status: "error", error: `HTTP ${status}` };
      }

      const { score, malicious } = zoneToScore(data.Zone);
      const detections = (data.DetectionsInfo ?? [])
        .map((d) => d.DetectionName)
        .filter((v): v is string => Boolean(v));
      const info = data.FileGeneralInfo;

      return {
        status: "ok",
        malicious,
        score,
        categories: detections.slice(0, 10),
        summary: `Kaspersky zone: ${data.Zone ?? "Unknown"}${
          detections.length ? ` — ${detections[0]}` : ""
        }`,
        hashContext: {
          md5: info?.Md5?.toLowerCase(),
          sha1: info?.Sha1?.toLowerCase(),
          sha256: info?.Sha256?.toLowerCase(),
          fileType: info?.Type,
          fileSize: info?.Size,
          detectionNames: detections.length ? detections : undefined,
        },
        details: {
          zone: data.Zone,
          fileStatus: info?.FileStatus,
          detections,
        },
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

- [ ] **Step 4: Run the zone-map test (passes)**

Run: `npx vitest run lib/ti/hash/sources/kaspersky-opentip.test.ts`
Expected: PASS.

- [ ] **Step 5: Register + document the key**

In `lib/ti/hash/registry.ts`, add:

```ts
import { kasperskyOpenTipSource } from "./sources/kaspersky-opentip";
```

and include `kasperskyOpenTipSource` in the array. Add to `.env.example`:

```bash
# Kaspersky OpenTIP — hash reputation zone + detections. https://opentip.kaspersky.com
KASPERSKY_OPENTIP_API_KEY=
```

- [ ] **Step 6: Verify live (mandatory)**

With the key set, run a real lookup against a known-bad and a clean SHA-256. Confirm `Zone`/`FileGeneralInfo`/`DetectionsInfo` field names match the live response; fix parsing if needed.

- [ ] **Step 7: Lint + full suite**

Run: `npm run lint && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/ti/hash/sources/kaspersky-opentip.ts lib/ti/hash/sources/kaspersky-opentip.test.ts lib/ti/hash/registry.ts .env.example
git commit -m "feat(hash): add Kaspersky OpenTIP source

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 12: Maltiverse source

**Files:**
- Create: `lib/ti/hash/sources/maltiverse.ts`
- Modify: `lib/ti/hash/registry.ts`, `.env.example`

Maltiverse is keyed by SHA-256; `skip` MD5/SHA-1 (the Hybrid-Analysis pattern) rather than reporting a false clean.

- [ ] **Step 1: Write the adapter**

```ts
// lib/ti/hash/sources/maltiverse.ts
import type { RelatedIndicator, SourceFinding, TiSource } from "../../types";
import { errorMessage, getJson, isTimeout } from "../../http";
import { hostFromUrl } from "@/lib/url";

interface MaltiverseSample {
  classification?: string; // malicious | suspicious | neutral | whitelist
  filename?: string | string[];
  filetype?: string;
  size?: number;
  // Detection labels and related indicators vary by record; read defensively.
  antivirus?: { name?: string; description?: string }[] | null;
  blacklist?: { description?: string }[] | null;
  contacted_host?: { hostname?: string; ip_addr?: string }[] | null;
  download_url?: { url?: string }[] | null;
}

/** classification → score; undefined when neutral/unknown (absence ≠ clean). */
function classificationScore(c: string | undefined): {
  score: number | undefined;
  malicious: boolean;
} {
  if (c === "malicious") return { score: 85, malicious: true };
  if (c === "suspicious") return { score: 50, malicious: false };
  if (c === "whitelist") return { score: 0, malicious: false };
  return { score: undefined, malicious: false };
}

/** Maltiverse — sample classification + related indicators (free bearer key). */
export const maltiverseSource: TiSource = {
  meta: {
    id: "maltiverse",
    name: "Maltiverse",
    url: "https://maltiverse.com",
    category: "reputation",
    requiresKey: true,
    weight: 0.7,
    keyEnv: "MALTIVERSE_API_KEY",
    timeoutMs: 12000,
  },
  isEnabled: () => Boolean(process.env.MALTIVERSE_API_KEY),
  async check(hash, signal): Promise<SourceFinding> {
    const key = process.env.MALTIVERSE_API_KEY;
    if (!key) return { status: "skipped" };

    // Maltiverse sample lookups are keyed by SHA-256 only.
    if (hash.length !== 64) {
      return {
        status: "skipped",
        summary: "SHA-256 only — paste a SHA-256 hash to query Maltiverse",
      };
    }

    try {
      const { ok, status, data } = await getJson<MaltiverseSample>(
        `https://api.maltiverse.com/sample/${hash}`,
        signal,
        { Authorization: `Bearer ${key}` },
      );

      if (status === 404) {
        return { status: "ok", summary: "Not indexed by Maltiverse" };
      }
      if (!ok || !data) {
        return { status: "error", error: `HTTP ${status}` };
      }

      const { score, malicious } = classificationScore(data.classification);
      const detectionNames = (data.antivirus ?? [])
        .map((a) => a.description || a.name)
        .filter((v): v is string => Boolean(v));

      const relations: RelatedIndicator[] = [];
      const seen = new Set<string>();
      for (const h of data.contacted_host ?? []) {
        const v = h.hostname || h.ip_addr;
        if (v && !seen.has(v)) {
          seen.add(v);
          relations.push({
            value: v,
            type: h.hostname ? "domain" : "ip",
            relation: "contacts",
          });
        }
      }
      const distributionUrls = [
        ...new Set(
          (data.download_url ?? [])
            .map((d) => d.url)
            .filter((v): v is string => Boolean(v)),
        ),
      ].slice(0, 8);
      for (const u of distributionUrls) {
        const host = hostFromUrl(u);
        if (host && !seen.has(host)) {
          seen.add(host);
          relations.push({ value: host, type: "domain", relation: "distribution" });
        }
      }

      const name = Array.isArray(data.filename)
        ? data.filename[0]
        : data.filename;

      return {
        status: "ok",
        malicious,
        score,
        categories: detectionNames.slice(0, 10),
        summary: `Maltiverse classification: ${data.classification ?? "unknown"}`,
        hashContext: {
          sha256: hash,
          fileName: name,
          fileType: data.filetype,
          fileSize: data.size,
          detectionNames: detectionNames.length ? detectionNames : undefined,
          distributionUrls: distributionUrls.length ? distributionUrls : undefined,
        },
        relations: relations.slice(0, 10).length ? relations.slice(0, 10) : undefined,
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

- [ ] **Step 2: Register + document the key**

In `lib/ti/hash/registry.ts`:

```ts
import { maltiverseSource } from "./sources/maltiverse";
```

Include `maltiverseSource` in the array. Add to `.env.example`:

```bash
# Maltiverse — sample classification + related indicators (SHA-256). https://maltiverse.com
MALTIVERSE_API_KEY=
```

- [ ] **Step 3: Verify live (mandatory)**

With `MALTIVERSE_API_KEY` set, run a real SHA-256 lookup. Reconcile the `MaltiverseSample` field names (`classification`, `antivirus`, `contacted_host`, `download_url`) against the live JSON and fix parsing if they differ.

- [ ] **Step 4: Lint + full suite**

Run: `npm run lint && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/hash/sources/maltiverse.ts lib/ti/hash/registry.ts .env.example
git commit -m "feat(hash): add Maltiverse source

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 13: Hatching Triage source

**Files:**
- Create: `lib/ti/hash/sources/triage.ts`
- Modify: `lib/ti/hash/registry.ts`, `.env.example`

Triage requires two calls: search by hash → get the sample id → fetch its overview. Both honor the same signal.

- [ ] **Step 1: Write the adapter**

```ts
// lib/ti/hash/sources/triage.ts
import type { RelatedIndicator, SourceFinding, TiSource } from "../../types";
import { errorMessage, getJson, isTimeout } from "../../http";

interface TriageSearch {
  data?: { id?: string; status?: string }[];
}
interface TriageOverview {
  sample?: { id?: string; target?: string; size?: number };
  analysis?: { score?: number; family?: string[] };
  targets?: {
    score?: number;
    family?: string[];
    tags?: string[];
    signatures?: { name?: string }[];
  }[];
  // Extracted network IOCs vary in shape; read defensively.
  extracted?: {
    config?: { c2?: string[]; domains?: string[]; hosts?: string[] };
  }[];
}

const API = "https://tria.ge/api/v0";

/** Hatching Triage — sandbox family/score + network IOCs (free research key). */
export const triageSource: TiSource = {
  meta: {
    id: "triage",
    name: "Hatching Triage",
    url: "https://tria.ge",
    category: "scanner",
    requiresKey: true,
    weight: 0.8,
    keyEnv: "TRIAGE_API_KEY",
    timeoutMs: 15000,
  },
  isEnabled: () => Boolean(process.env.TRIAGE_API_KEY),
  async check(hash, signal): Promise<SourceFinding> {
    const key = process.env.TRIAGE_API_KEY;
    if (!key) return { status: "skipped" };
    const auth = { Authorization: `Bearer ${key}` };
    try {
      const search = await getJson<TriageSearch>(
        `${API}/search?query=${encodeURIComponent(hash)}`,
        signal,
        auth,
      );
      const sampleId = search.data?.data?.[0]?.id;
      if (!search.ok) {
        return { status: "error", error: `HTTP ${search.status}` };
      }
      if (!sampleId) {
        return { status: "ok", summary: "No Triage report for this file" };
      }

      const ov = await getJson<TriageOverview>(
        `${API}/samples/${sampleId}/overview.json`,
        signal,
        auth,
      );
      if (!ov.ok || !ov.data) {
        return { status: "error", error: `HTTP ${ov.status}` };
      }
      const data = ov.data;

      const rawScore =
        data.analysis?.score ??
        data.targets?.reduce((m, t) => Math.max(m, t.score ?? 0), 0) ??
        0;
      // Triage scores are 0-10; scale to 0-100.
      const score = Math.min(100, Math.round(rawScore * 10));

      const families = [
        ...new Set([
          ...(data.analysis?.family ?? []),
          ...(data.targets ?? []).flatMap((t) => t.family ?? []),
        ]),
      ];
      const signatures = [
        ...new Set(
          (data.targets ?? []).flatMap((t) =>
            (t.signatures ?? []).map((s) => s.name).filter(Boolean),
          ),
        ),
      ] as string[];

      const relations: RelatedIndicator[] = [];
      const seen = new Set<string>();
      for (const e of data.extracted ?? []) {
        const cfg = e.config ?? {};
        for (const d of [...(cfg.c2 ?? []), ...(cfg.domains ?? [])]) {
          const host = d.replace(/^https?:\/\//, "").split("/")[0];
          if (host && !seen.has(host)) {
            seen.add(host);
            relations.push({ value: host, type: "domain", relation: "contacts" });
          }
        }
        for (const h of cfg.hosts ?? []) {
          if (h && !seen.has(h)) {
            seen.add(h);
            relations.push({ value: h, type: "ip", relation: "contacts" });
          }
        }
      }

      return {
        status: "ok",
        malicious: score >= 80,
        score,
        categories: [...families, ...signatures.slice(0, 6)].slice(0, 12),
        summary: `Triage score ${rawScore}/10${
          families.length ? ` (${families.join(", ")})` : ""
        }`,
        hashContext: {
          malwareFamily: families[0],
          fileName: data.sample?.target,
          fileSize: data.sample?.size,
        },
        relations: relations.slice(0, 10).length
          ? relations.slice(0, 10)
          : undefined,
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

- [ ] **Step 2: Register + document the key**

In `lib/ti/hash/registry.ts`:

```ts
import { triageSource } from "./sources/triage";
```

Include `triageSource` in the array. Add to `.env.example`:

```bash
# Hatching Triage — sandbox family/score + network IOCs (hash). https://tria.ge
TRIAGE_API_KEY=
```

- [ ] **Step 3: Verify live (mandatory)**

With `TRIAGE_API_KEY` set, run a real lookup. The search-response nesting (`data.data[]` vs `data[]`) and the overview `extracted[].config` shape vary — reconcile against the live JSON and fix parsing. Confirm the two-call flow respects the timeout.

- [ ] **Step 4: Lint + full suite**

Run: `npm run lint && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/hash/sources/triage.ts lib/ti/hash/registry.ts .env.example
git commit -m "feat(hash): add Hatching Triage source

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 14: Final verification + registry order

**Files:**
- Modify: `lib/ti/hash/registry.ts` (ordering only)

- [ ] **Step 1: Set display order**

Ensure `hashSources` lists the authoritative / "what is it" sources first, e.g.:

```ts
export const hashSources: TiSource[] = [
  malwareBazaarSource,
  virusTotalHashSource,
  kasperskyOpenTipSource,
  metadefenderHashSource,
  triageSource,
  maltiverseSource,
  threatFoxHashSource,
  urlhausHashSource,
  pulsediveSource,
  hybridAnalysisSource,
  cymruMhrSource,
  hashlookupSource,
  otxHashSource,
];
```

- [ ] **Step 2: Full suite + lint + build**

Run: `npm test && npm run lint && npm run build`
Expected: all pass; build succeeds.

- [ ] **Step 3: End-to-end check**

With keys set, run `npm run dev` and check (a) a known-bad SHA-256 (e.g. a well-known Emotet sample) and (b) a clean/unknown hash. Confirm: new sources populate, the Connections card groups contacts/drops/parent/similar/distribution, distribution URLs render, and pivots launch fresh checks. Re-check an IP and a domain to confirm the shared Connections card behaves there too. If you cannot run the UI, say so explicitly.

- [ ] **Step 4: Commit**

```bash
git add lib/ti/hash/registry.ts
git commit -m "chore(hash): finalize source display order

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes / deviations from the spec

- **Distribution URLs union:** `mergeContext` uses `mergeFields` (first-non-empty per field), so `distributionUrls` shows the first source's set rather than the union of all sources. Hosts are still unioned via `relations` (collected across all sources in `relations.ts`), so no distribution *host* is lost as a pivot. Unioning the raw URL list across sources is a deliberate non-goal for v1 (keeps the uniform context-merge model).
- **Open links:** distribution URLs include a deliberate external "open" link per the approved design, with `rel="noopener noreferrer"` and a caution tooltip. The safe default action is the "check host" pivot.
- **Provider field names:** the Phase 3 adapters encode best-effort response shapes from the API docs; each task's "verify live" step is mandatory before its commit to reconcile field names with the real responses.

## Self-review notes

- **Spec coverage:** model fields (Task 2) ✓; mine VT (4) / URLhaus (3) / MalwareBazaar (5) ✓; `hostFromUrl` (1) ✓; new relation labels + tests (6) ✓; shared Connections card (8) ✓; distribution URLs + out-links (9) ✓; four new sources (10–13) ✓; scoring unchanged, helpers tested ✓; verification (7, 14) ✓.
- **Relation-label collision** (`distribution` vs IP `host`) resolved in the model and the card.
- **Type consistency:** `fetchHashRelations` returns `{ relations, distributionUrls }` and is consumed as `rel.*` in Task 4; `riskToScore`/`zoneToScore`/`classificationScore` names match between adapter and test; source `id`s (`pulsedive`, `kaspersky-opentip`, `maltiverse`, `triage`) match the `HASH_LOOKUP_URL` keys in Task 9.
