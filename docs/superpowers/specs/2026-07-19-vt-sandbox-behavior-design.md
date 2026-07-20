# VirusTotal sandbox behavior in the File identity card

**Date:** 2026-07-19
**Status:** Approved, ready for implementation

## Goal

Surface *what a file does when it runs* — concrete sandbox-observed behavior from
VirusTotal — inside the hash result's **File identity** card. The user wants both
the readable action list (already rendered) and a new grouped readout of the real
runtime artifacts (processes/commands, files, registry, network).

## Feasibility (verified)

VT's `GET /files/{id}/behaviour_summary` returns **HTTP 200 on the free/public
key** (probed 2026-07-19 against WannaCry: 152 MITRE techniques, behavior tags,
`signature_matches`, `command_executions`, `files_dropped`, `registry_keys_set`,
`dns_lookups`, `ip_traffic`, `verdicts`). So the feature works within the "free
APIs only" constraint. It is a **second** VT request per fresh hash lookup (the
main `virustotal` source uses one); the free key allows 4/min and the route cache
makes repeat lookups free.

## Architecture

A new **context-only source** `virustotal-sandbox` under
`lib/ti/hash/sources/virustotal-sandbox.ts`, registered in
`lib/ti/hash/registry.ts` after `virustotal`.

- `meta`: `id: "virustotal-sandbox"`, `name: "VirusTotal Sandbox"`,
  `category: "context"`, `weight: 0` (never moves the score — the main VT source
  already scores detections), `requiresKey: true`, `keyEnv: "VIRUSTOTAL_API_KEY"`.
- `isEnabled()` gates on `VIRUSTOTAL_API_KEY`.
- `check()` does one `getJson` to `.../files/${hash}/behaviour_summary`, mirroring
  `feodo.ts` error handling: 404 → `{ status: "ok" }` (file has no sandbox report,
  not an error); non-ok → error; catch → `isTimeout ? "timeout" : "error"`.
- Emits **only** `hashContext` (plus `raw`, dropped by `runSource`). Isolating this
  in its own adapter keeps the main VT source at one request and lets a behaviour
  404 / rate-limit fail without touching the detection result.

## Data mapping (from `behaviour_summary`)

| VT field | app field | card section |
|---|---|---|
| `signature_matches[].name` (+ ATT&CK id from matching `mitre_attack_techniques.refs`) | `capabilities: {label, mitre?}[]` | "What this file does" (existing) |
| `mitre_attack_techniques` deduped by `id`, ranked by `severity`, cap 12; `name` = `signature_description` | `mitreTechniques: {id, name?}[]` | "MITRE ATT&CK" (existing) |
| `command_executions` + `processes_created` | `sandboxBehavior.commands` | Runtime behavior (new) |
| `files_dropped[].path` + `files_written` | `sandboxBehavior.files` | Runtime behavior (new) |
| `registry_keys_set[].key` (+ ` → value` when short/meaningful) | `sandboxBehavior.registry` | Runtime behavior (new) |
| `dns_lookups[].hostname`, `ip_traffic[].destination_ip:port`, url patterns | `sandboxBehavior.network` | Runtime behavior (new) |

Severity rank order: `CRITICAL > HIGH > MEDIUM > LOW > INFO > UNKNOWN`. Each
`sandboxBehavior` group is deduped and capped (~8) inside the adapter; strings are
defanged-safe (no execution risk — display only).

## Type change (`lib/ti/types.ts`)

Add to `HashContext`:

```ts
/** Sandbox-observed runtime artifacts, grouped for a readable "what it did" readout. */
sandboxBehavior?: {
  /** Which sandbox produced the summary, if singular. */
  sandboxName?: string;
  /** Processes spawned and command lines executed. */
  commands?: string[];
  /** Files dropped or written to disk. */
  files?: string[];
  /** Registry keys created/set (persistence, config). */
  registry?: string[];
  /** Network contacted during detonation (dns / ip:port / url). */
  network?: string[];
};
```

No `assemble.ts` change needed: `sandboxBehavior` is a non-empty object, so
`mergeFields` (first-non-empty per key) carries it through `mergeHashContext`'s
`...merged` spread. Only `virustotal-sandbox` emits it, so there is no cross-source
conflict. `capabilities` / `mitreTechniques` already union across sources.

## UI (`components/CheckResults/profile.tsx`)

Add a **Runtime behavior** block inside the File identity card, below the existing
evidence section (capabilities / detection labels / MITRE / refs). Render only when
`ctx?.sandboxBehavior` has at least one non-empty group. Layout: a `<SubLabel>` per
non-empty group (Processes & commands, Files, Registry, Network), each a capped list
(~4-6 rows) with a `+N more` tail, matching the existing monochrome style. A small
"VirusTotal sandbox" provenance tag on the block header. Copy uses commas, not
dashes.

## Testing

- `lib/ti/hash/sources/virustotal-sandbox.test.ts`: pure unit tests over a fixture
  `behaviour_summary` payload — asserts capability/mitre extraction, severity
  ranking + cap, `sandboxBehavior` grouping/dedup/cap, and graceful 404/error/no-key
  paths. No network (mock `getJson` or pass a canned response like sibling tests).
- Run `bun run test` and `bun run lint` before done. Verify UI in `bun run dev`
  against a data-rich hash (WannaCry sha256
  `ed01ebfbc9eb5bbea545af4d01bf5f1071661840480439c6e5babe8e080e41aa`).

## Out of scope (YAGNI)

- No new `SourceCategory` value ("context" is reused).
- No score contribution (weight 0).
- No process-tree visualization, memory dumps, TLS/JA3, or sigma rules.
- Network stays capped small — the Connections card already renders VT relationship
  pivots; this is complementary sandbox-observed context, not a replacement.
