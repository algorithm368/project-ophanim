# Hash Filename Voting Design

## Problem

When a file hash is looked up, the "real name" of the file is derived from
`HashContext.fileName` / `fileNames`. Today `assemble.ts` merges per-source
context with `mergeFields`, which takes the **first non-empty value in registry
order**. Consequences:

- The displayed `fileName` is "whichever enabled source is listed first," not
  the most trustworthy or most-agreed name.
- `fileNames[]` is never unioned across sources; only VirusTotal populates it,
  so the analyst sees one source's list at most.
- No junk-filtering: a source can report the hash itself, a bare-hex name, or a
  generic placeholder (`file`, `sample.bin`) and it wins purely by ordering.

## Goal

Replace registry-first name selection with a **voted, junk-filtered winner**
drawn from every source's full alias list. Deliverable stays a single best
`fileName` plus a deduped `fileNames[]`; no confidence/agreement structure is
exposed on the result surface (voting happens internally only).

## Design

### 1. Sources emit all aliases into `hashContext.fileNames`

Today only VirusTotal fills `fileNames[]`; the rest set a single `fileName`.
Update each name-bearing adapter to also populate `fileNames` with **every**
name in its payload (trimmed, deduped), keeping `fileName` as its own top pick:

- **malwarebazaar** — `file_name` across all returned entries
- **hybrid-analysis** — `last_file_name` + `submit_name` across result entries
- **triage** — `sample.target` + each `targets[].target`
- **maltiverse** — all reported names
- **hashlookup** — `[FileName]`
- **virustotal** — already does this; raise cap 6 → ~12

Sources that report no name are unchanged.

### 2. New pure module `lib/ti/hash/resolve-name.ts`

```
resolveFileName(
  results: SourceResult[],
  hashes: { md5?: string; sha1?: string; sha256?: string },
): { fileName?: string; fileNames?: string[] }
```

- **Collect votes:** each `ok` source contributes its `fileNames` (falling back
  to `[fileName]` when it only set the single field); one vote per distinct
  `(sourceId, name)` pair. A source cannot out-vote itself by repeating a name.
- **Junk filter — drop a name when it is:**
  - equal to the md5/sha1/sha256, or a hash + extension
  - a bare hex string of length 32/40/64 (± a file extension)
  - a generic placeholder from a small denylist: `file`, `sample`,
    `sample.bin`, `unknown`, `malware`, `tmp`, `temp`, `a.out`, `output`,
    empty/whitespace
  - comparison is case-insensitive; the denylist matches the full name (with or
    without extension), not substrings
- **Rank survivors:**
  1. count of **distinct sources** reporting the name (descending)
  2. source **name-trust order** (submitted-name sources — MalwareBazaar,
     triage, Hybrid-Analysis — rank above VirusTotal submission names, which
     rank above hashlookup); a source not in the ordering gets a default middle
     rank
  3. lexical order of the name, for deterministic output
- Winner → `fileName`; the deduped list of surviving names (ranked) →
  `fileNames`. If no name survives, both are `undefined`.

The module is pure (no network) and defensive against `undefined` fields.

### 3. `assemble.ts` wiring

`mergeHashContext` keeps using `mergeFields` for every field, then overwrites
`fileName` / `fileNames` with the output of `resolveFileName(results, hashes)`.
The hash values passed in come from the merged context (`md5`/`sha1`/`sha256`),
falling back to the looked-up hash for the matching algorithm.

### 4. Tests

New `lib/ti/hash/resolve-name.test.ts`:

- name equal to the hash is filtered out
- bare-hex name (with and without extension) is filtered out
- generic placeholder is filtered out
- a name reported by 3 sources beats a name reported by 1
- authority tie-break: equal vote count resolves to the higher-trust source
- all-junk input → `{ fileName: undefined, fileNames: undefined }`

Update the existing source tests whose `fileNames` now populate
(malwarebazaar, hybrid-analysis, triage, maltiverse, hashlookup).

## Non-goals

- No confidence/agreement field on `HashContext` or `HashCheckResult`.
- No new TI sources; only sources already queried are touched.
- No change to scoring/verdict logic — names do not affect risk.

## Verification

- `npm test` and `npm run lint` pass.
- Exercise the real pipeline end-to-end with a no-key known-bad hash (e.g. via
  hashlookup / MalwareBazaar) and confirm the resolved `fileName` is a real
  submitted name, not the hash or a generic placeholder.
