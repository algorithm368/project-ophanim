# Theme B — Scoring-Model Correctness (B1 + B2 + B5)

**Status:** design, awaiting review
**Date:** 2026-06-21
**Source:** `docs/analyst-review.md`, Theme B (items B1, B2, B5)
**Scope decision:** B1 + B2 + B5 only. B3 (time-decay) and B4 (context down-weighting) are explicitly out.

## Problem

The scoring engine produces verdicts an analyst cannot always defend:

1. **B1 — the hard `malicious` floor is ungated.** `aggregate.ts:53-56` raises risk to >=75 if *any* `ok` source sets `malicious===true`, with no weight or quorum check. Low-weight sources (`tor` 0.4, `dnsbl` 0.5, `blocklist-de` 0.6) can pin a "malicious" verdict alone, and `abuseipdb` asserts `malicious` at just 50% confidence (`abuseipdb.ts:86`). One stale or disputed listing reads identical to a confirmed C2. (An existing comment in `otx.test.ts` already warns about this floor.)
2. **B2 — allowlists die at the source, and EICAR is mislabeled.** `maltiverse` (whitelist -> score 0), `hybrid-analysis` (whitelisted -> 0), and `abuseipdb` (`isWhitelisted` in details) all know an indicator is explicitly allowlisted, but that signal never reaches the aggregate. The EICAR test file scores **malicious 89, labeled `Backdoor.Win32.Androm`** — it fails the first credibility check an analyst runs.
3. **B5 — magic numbers and drift.** The cutoffs (70/40/15), the blend (0.6/0.4), and the floor (75) are unnamed literals. `narrative.scoreExplanation` (`narrative.ts:542`) *independently re-derives* the dominant source and the floor instead of reading the aggregator's intermediates, so the explanation can drift from the score.

## Goals

- A single high-weight definitive listing still pins "malicious"; a single weak listing cannot.
- Two or more weak listings can reach "suspicious" but not "malicious".
- Explicit allowlist hits suppress the floor unless a high-weight detection also fires.
- EICAR (and any future known-benign hash) is forced clean with a clear marker.
- The score's intermediates are computed once and consumed by the narrative — no re-derivation.
- Every behavior is unit-tested.

## Non-goals

- Rendering the breakdown / `scoreExplanation` in the verdict card (that is **A1/A4**, Theme A). This spec only makes the data *correct and available*.
- Confidence tier (**A3**), time-decay (**B3**), Tor/VPN/hosting context down-weighting (**B4**).

## Architecture

Approach **A**: enrich `lib/ti/aggregate.ts` in place. `aggregateRisk` stays the one scoring entry point but is decomposed into small pure helpers and named constants, and returns a `breakdown`. EICAR/benign lives in a new `lib/ti/benign.ts` consulted at the assemble layer (it needs the indicator value, which `aggregateRisk` never sees). The allowlist signal is a new `allowlisted` field on `SourceFinding`.

Rejected: a separate `lib/ti/scoring/` module (more ceremony than ~120 lines warrant; fragments the established home) and synthetic pseudo-sources (conflates source results with policy overrides; makes EICAR's hard forced-clean awkward).

## Design

### 1. Types and constants (B5 foundation)

`lib/ti/types.ts`:
- Add `allowlisted?: boolean` to `SourceFinding` — "an authoritative allowlist explicitly vouches for this indicator."
- Add `ScoreBreakdown`:
  ```ts
  export interface ScoreBreakdown {
    effectiveMax: number;        // strongest weighted single signal
    weightedAvg: number;         // weighted consensus
    dominantSourceId?: string;   // source behind effectiveMax
    floorApplied: boolean;
    flooredBy?: string;          // source id whose listing set the floor
    floorValue?: number;         // the floor that was applied (e.g. 75 or 50)
    borderline: boolean;         // riskScore within BORDERLINE_BAND of a cutoff
    allowlistSuppressed: boolean;// a floor was withheld due to an allowlist hit
    benignOverride?: string;     // e.g. "eicar-test-file" (assemble layer)
  }
  ```
- Add `scoreBreakdown?: ScoreBreakdown` to `CheckResult`, `DomainCheckResult`, `HashCheckResult`.

`lib/ti/aggregate.ts` named constants (replacing literals):
```ts
export const MALICIOUS_AT = 70;
export const SUSPICIOUS_AT = 40;
export const LOW_AT = 15;
export const MAX_SIGNAL_WEIGHT = 0.6;   // weight of effectiveMax in the blend
export const CONSENSUS_WEIGHT = 0.4;    // weight of weightedAvg in the blend
export const MALICIOUS_FLOOR = 75;      // high-weight definitive listing
export const QUORUM_FLOOR = 50;         // 2+ weak listings agreeing (suspicious)
export const FLOOR_MIN_WEIGHT = 0.7;    // "high weight" threshold for the floor
export const BORDERLINE_BAND = 5;       // +/- distance to a cutoff to flag borderline
```
`verdictFor` and the blend in `aggregateRisk` are rewritten to use these names (behavior identical for the non-floor path).

### 2. `aggregateRisk` returns a breakdown (B1 + B5)

Signature change: `aggregateRisk(results) -> { riskScore, verdict, breakdown: ScoreBreakdown }`.

Logic:
1. Filter `scored` (status ok, numeric score, weight > 0) as today. If empty, return `riskScore 0`, `verdict "unknown"`, and a zeroed breakdown.
2. Compute `weightSum`, `weightedAvg`, `effectiveMax`, and the `dominant` source (capture `dominantSourceId`). Base `risk = round(MAX_SIGNAL_WEIGHT * effectiveMax + CONSENSUS_WEIGHT * weightedAvg)`.
3. **Floor gate** (helper `gateFloor`): consider malicious sources = `ok && weight > 0 && malicious === true`.
   - `maxMalW` = max weight among them; `count` = how many.
   - `allowlisted` present = any `ok` source with `allowlisted === true`.
   - **Two-tier floor:**
     - `maxMalW >= FLOOR_MIN_WEIGHT` -> candidate floor `MALICIOUS_FLOOR (75)`, `flooredBy` = that source's id.
     - else if `count >= 2` -> candidate floor `QUORUM_FLOOR (50)`, `flooredBy` = strongest of them.
     - else -> no floor.
   - **Allowlist suppression (B2):** if a candidate floor exists *but* there is an allowlist hit *and* `maxMalW < FLOOR_MIN_WEIGHT` (i.e. no high-weight detection), withhold the floor and set `allowlistSuppressed = true`. A high-weight detection (>=0.7) always beats the allowlist.
   - Apply: `risk = max(risk, floorValue)` when a floor survives; record `floorApplied`, `flooredBy`, `floorValue`.
4. Clamp to 0..100. Compute `verdict = verdictFor(risk, true)`.
5. **Borderline (B5):** `borderline = true` when `min(|risk - cut|)` over the cutoffs {70,40,15} `<= BORDERLINE_BAND`.
6. Return `{ riskScore, verdict, breakdown }`.

`computeStats` is unchanged.

### 3. Assemble-layer wiring + EICAR override (B2 hard half)

`lib/ti/benign.ts` (new):
```ts
// EICAR standard anti-malware test file — benign by definition.
export const KNOWN_BENIGN_HASHES = new Set<string>([
  "44d88612fea8a8f36de82e1278abb02f",                                 // md5
  "3395856ce81f2b7382dee72602f798b642f14140",                         // sha1
  "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f", // sha256
]);
export function isKnownBenignHash(hash: string): string | undefined {
  return KNOWN_BENIGN_HASHES.has(hash.toLowerCase()) ? "eicar-test-file" : undefined;
}
```

`lib/ti/assemble.ts`:
- All three assemblers destructure `breakdown` from `aggregateRisk` and set `scoreBreakdown` on the returned result.
- `assembleHashResult` additionally: after aggregation, if `isKnownBenignHash(hash)` returns a marker, override to `riskScore: 0`, `verdict: "clean"`, and `scoreBreakdown: { ...breakdown, benignOverride: marker, floorApplied: false }`. Source rows are untouched — the analyst still sees the AV detections, but the aggregate verdict is correct.
- `assembleDomainResult` keeps its existing NXDOMAIN -> unknown adjustment, layered after the breakdown is attached.

### 4. Source-level signals

- `abuseipdb.ts`: in `summarizeAbuse`, change `malicious: score >= 50` to `malicious: score >= 75` (a half-confidence report scores normally but is not a "definitive" listing). In `check()`, set `allowlisted: Boolean(d.isWhitelisted)` on the finding. Weight stays 1.
- `maltiverse.ts`: `classificationScore` also returns `allowlisted: c === "whitelist"`; `check()` sets `allowlisted` on the finding.
- `hybrid-analysis.ts`: `check()` sets `allowlisted: Boolean(data.whitelisted) || verdict === "whitelisted"`.

### 5. `narrative.scoreExplanation` reads the breakdown (B5 drift fix)

Rewrite `scoreExplanation(result)` to read `result.scoreBreakdown` instead of re-deriving:
- If `benignOverride` is set: return one line, e.g. *"Forced clean: this is the EICAR standard anti-malware test file, a benign artifact, despite vendor detections."*
- Otherwise: resolve `dominantSourceId` to the source name (look up in `result.sources`), state the weighted blend across N scoring sources (same wording as today).
- If `floorApplied`: name `flooredBy` and the `floorValue` (e.g. *"... held at 75 by a definitive AbuseIPDB listing"* / *"... raised to 50 by two agreeing blocklists"*).
- If `allowlistSuppressed`: add *"an allowlist vouches for this indicator, so a weak listing did not raise the floor."*
- If `borderline`: add *"this score sits near a verdict boundary, treat the label as borderline."*

`scoreExplanation` is **not** wired into any component here (that is A1). Its existing zero consumers stay zero; this only makes it correct for when A1 lands.

### 6. Tests

- `lib/ti/aggregate.test.ts` (new or extended):
  - single high-weight malicious (e.g. feodo w1, score 95) -> floor 75, `flooredBy`, `floorApplied`.
  - single low-weight malicious (tor w0.4) -> no floor, verdict from blend.
  - two low-weight malicious (tor 0.4 + dnsbl 0.5) -> floor 50, verdict suspicious.
  - allowlist hit + only low-weight malicious -> floor suppressed, `allowlistSuppressed`.
  - allowlist hit + high-weight malicious -> floor 75 (detection wins).
  - borderline: a blend landing at 72 -> `borderline true`; one at 60 -> false.
  - breakdown fields populated (`effectiveMax`, `weightedAvg`, `dominantSourceId`).
  - empty scored set -> unknown + zeroed breakdown.
- `lib/ti/benign.test.ts` (new): EICAR md5/sha1/sha256 (and uppercase) -> marker; arbitrary hash -> undefined. Plus an `assembleHashResult` case proving EICAR -> clean/0 with detections present.
- `lib/ti/sources/abuseipdb.test.ts`: `summarizeAbuse` malicious flips at 75 not 50; `allowlisted` propagated from `isWhitelisted`.
- `lib/ti/hash/sources/maltiverse.test.ts`: `classificationScore("whitelist").allowlisted === true`.
- `lib/ti/narrative.test.ts`: `scoreExplanation` reads breakdown (dominant name, floor line, suppression line, borderline line, benign line); no re-derivation drift.

## Risks and mitigations

- **Return-shape change** of `aggregateRisk` touches 3 `assemble.ts` call sites and any test constructing its result — all updated in this change; `tsc`/lint catches stragglers.
- **Behavior changes** are intended and asserted: EICAR clean (was 89), weak-only listings no longer pinned to 75, abuseipdb at 50-74% no longer trips the floor. A VT/Feodo-confirmed bad indicator still pins.
- **`scoreBreakdown` on the wire**: it ships in the API JSON and the cache. Additive/optional, so older cached entries (no `scoreBreakdown`) still deserialize; consumers treat it as optional.

## Verification

1. `npm test` and `npm run lint` pass.
2. Live (no-key) sanity with `npm run dev`:
   - EICAR `44d88612fea8a8f36de82e1278abb02f` -> clean / 0, benign marker, detections still listed.
   - A low-weight-only listed IP -> not pinned to 75.
   - A VT/Feodo-confirmed bad IP -> still pinned (floor 75).
