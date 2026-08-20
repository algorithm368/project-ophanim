# Score confidence

A verdict says how bad an indicator looks. It says nothing about how much the
tool actually knows. Those are different questions, and today only the first one
reaches the analyst.

Two live IPs from the calibration run make the gap concrete. `103.83.237.2` and
`192.227.144.55` both read **malicious / 75**. In both cases the 75 is not a
score at all, it is `MALICIOUS_FLOOR`, pinned by AbuseIPDB alone. The weighted
consensus underneath is 24 and 18, which is *clean* territory. Twelve other
detectors answered and saw nothing. An analyst reading "malicious 75" has no way
to tell that from `24d004a1…` (WannaCry), which reads **malicious 98** with
twelve of twelve detectors agreeing.

This adds a confidence level to the verdict card that separates those two cases.

## Scope

Display only. `aggregateRisk()`, `verdictFor()`, `ScoreBreakdown`, the API
response shape and the cache schema are all untouched. Confidence is derived
from `result.sources`, which every cached result already carries, so it appears
on existing cache entries without a `SCHEMA_VERSION` bump.

Not in scope: changing a verdict, adjusting a score, or wiring up the unused
`SourceFinding.confidence` field.

## What confidence must not be

The first two formulations both failed the same way, and the failure is worth
recording because it is easy to walk back into.

Measuring "how many sources agree with the risk call" couples confidence to the
score. So does the weighted form `Σ(weight × score/100) / Σweight`, which is
worse than coupled: it is `weightedAvg / 100`, the identical number
`aggregateRisk()` already computes. Run against four live indicators it matched
`ScoreBreakdown.weightedAvg` to the rounding digit every time.

The consequence shows on the clean end. Every source agrees `8.8.8.8` is
harmless, which is the strongest evidence a lookup can produce, and the
level-based formula scores it **0.01** and calls it low confidence. Exactly
backwards.

**Confidence must not care whether the score is high or low.** Unanimously
clean and unanimously malicious are equally well evidenced. What varies is
whether the sources were *asked* and whether they *said the same thing*.

## The measure

```
coverage  = Σweight(sources that answered) / Σweight(sources in the pool)
agreement = max(0, 1 − weightedMAD(scores) / MAX_DISPERSION)

confidence = coverage × (0.5 + 0.5 × agreement)
```

`weightedMAD` is the weight-aware mean absolute deviation of the per-source
scores around their weighted mean. It never asks how large the scores are, only
how far apart they sit, so it reads unanimity the same at either end of the
scale. `MAX_DISPERSION` is 50, the worst case of half the weight at 0 and half
at 100.

Coverage multiplies rather than adds, so it acts as a **ceiling**: confidence
cannot exceed the evidence gathered, and agreement moves within that ceiling.
The additive form `0.5 × coverage + 0.5 × agreement` was tried first and let
agreement buy back missing coverage. `2001:4860:4860::8888` exposed it. Only 4
of 13 detectors answer for IPv6, all four report 0, so the dispersion is
literally zero and agreement is a perfect 1.00. Four detectors agreeing on
nothing is not the evidence that thirteen agreeing is. The additive form scored
it 0.64 and ranked it *above* a Tor exit node with twelve of thirteen
responding. Multiplying drops it to 0.28, last, which is right.

### Which sources are in the pool

Only scoring sources (`weight > 0`); context-only adapters cannot corroborate
anything.

From those, sources **skipped for a missing key leave the denominator**. A
missing key is a constant of the deployment, not a fact about this indicator; it
would drag every hash lookup to the same value forever and report nothing. With
no keys at all the weighted ceiling would be 28% for hashes, so the badge would
read LOW on every sample regardless of what it is. The existing "no key" segment
on the detectors row already tells the analyst about that gap.

Sources that **cannot answer for this indicator stay in the denominator**. An
IPv6 address genuinely has less threat intelligence available than an IPv4 one,
and that is a property of the indicator. Errors, timeouts and rate limits also
stay: those are evidence missing from *this* check, and re-checking may recover
them.

(Issue #29 notes that hash sources currently report an unsupported algorithm as
an `error` rather than a skip. Until that is fixed, a SHA-1 lookup understates
its coverage. The fix belongs to that issue, not this one.)

### Tiers

`high ≥ 0.85`, `medium ≥ 0.65`, `low` below. The cuts are placed on the two
natural gaps in the calibration run (0.87 → 0.76 and 0.66 → 0.59), not chosen a
priori. An earlier guess of 0.75 / 0.45 put every observed indicator in the top
two tiers.

### Known benign samples

When `scoreBreakdown.benignOverride` is set, confidence is forced to `high`.
EICAR is the case: the app decides by fiat that `44d88612…` is a test file, and
the AV engines that flag it are not a disagreement about anything the app is
still asking. Measuring dispersion there produced 0.46 and would have rendered
"CLEAN, low confidence" for the one file the tool is most certain about.

## Calibration

Sixteen live indicators, 2026-08-20, after Criminal IP was unregistered.

| indicator | verdict | coverage | agreement | confidence | tier |
| --- | --- | --- | --- | --- | --- |
| cloudflare.com | clean 0 | 1.00 | 1.00 | 1.00 | high |
| 8.8.8.8 | clean 6 | 1.00 | 0.96 | 0.98 | high |
| google.com | clean 7 | 1.00 | 0.95 | 0.98 | high |
| `24d004a1…` WannaCry | malicious 98 | 1.00 | 0.91 | 0.95 | high |
| 13.107.42.14 | clean 6 | 0.91 | 0.96 | 0.89 | high |
| 208.67.222.222 | clean 7 | 0.91 | 0.92 | 0.87 | high |
| 1.1.1.1 | clean 12 | 0.91 | 0.92 | 0.87 | high |
| 103.83.237.2 | malicious 75 | 1.00 | 0.51 | 0.76 | medium |
| 192.227.144.55 | malicious 75 | 1.00 | 0.48 | 0.74 | medium |
| 92.63.197.55 | malicious 75 | 1.00 | 0.45 | 0.73 | medium |
| 45.95.147.236 | malicious 75 | 0.91 | 0.55 | 0.71 | medium |
| `e3b0c442…` empty file | malicious 75 | 0.91 | 0.45 | 0.66 | medium |
| 71.6.146.185 Shodan scanner | malicious 75 | 0.91 | 0.30 | 0.59 | low |
| 185.220.101.1 Tor exit | malicious 75 | 0.91 | 0.24 | 0.56 | low |
| `44d88612…` EICAR | clean 0 | 0.75 | 0.46 | forced | high |
| 2001:4860:4860::8888 | clean 0 | 0.28 | 1.00 | 0.28 | low |

WannaCry at 0.95 and `8.8.8.8` at 0.98 are the result that matters: opposite
verdicts, comparable confidence, because in both cases the detectors said the
same thing as each other. The four floor-pinned malicious IPs cluster at
0.71 to 0.76, clear of the top group. The genuinely contested indicators, a Tor
exit and Shodan's own scanner, fall to low, which is what an analyst would say
about them unprompted.

`e3b0c442…` is the SHA-256 of a zero-byte file and should not be malicious at
all. Confidence marks it shaky but does not correct it; that is issue #28.

## Design

### `lib/ti/confidence.ts`

Pure, no React, no network.

```ts
export interface ScoreConfidence {
  level: Confidence;   // the existing "high" | "medium" | "low"
  score: number;       // 0-1
  coverage: number;    // 0-1
  agreement: number;   // 0-1
  reason: string;      // one line, for the tooltip
}

export function scoreConfidence(result: {
  sources: SourceResult[];
  scoreBreakdown?: ScoreBreakdown;
}): ScoreConfidence | null;
```

Returns `null` when the pool is empty, so a result with no scoring source at all
renders nothing rather than an unearned tier.

The input is structural rather than `ResultLike` so the module depends on
`types.ts` alone. `ResultLike` satisfies it, and so do all four result types.

### UI

`ConsensusLine` in `components/CheckResults/verdict.tsx` gains a leading
segment. No new row, no new colour, the same grey mono the row already uses:

```
▂▄▆ HIGH CONFIDENCE · 13/13 detectors · 1 flagged · 12 clean
```

The `reason` string becomes the `title`, in the same house style as
`geoConfidenceReason()`: clauses joined by commas.

`CONF_ABBR`, `CONF_ICON` and `ConfidenceLevel` are currently private to
`components/CheckResults/voting.tsx`, where they serve the geo vote table.
They move to `components/CheckResults/confidence.tsx`, which is the file that
already owns the confidence vocabulary, and are exported. `voting.tsx` already
imports from `confidence.tsx`, so no cycle appears.

Because `ConsensusLine` takes `ResultLike`, this reaches IP, domain, hash and
URL results in one change.

### Tests

`lib/ti/confidence.test.ts`, pure, no network:

- weighted coverage, a heavy source dropping out costs more than a light one
- no-key skips leave the denominator, unsupported skips do not
- unanimous clean and unanimous malicious both reach `high`, the regression
  test for the level-coupled formula
- one loud source against a quiet majority lands `medium`
- thin coverage with perfect agreement lands `low`, the IPv6 shape
- `benignOverride` forces `high`
- empty pool returns `null`
- tier boundaries at exactly 0.85 and 0.65

## Follow-ups, not in this change

- Confidence shifts between checks when a source times out on one run and
  answers on the next. Correct by definition, but it means a re-check can move
  the tier with nothing about the indicator having changed. Worth watching
  before deciding whether it needs damping.
- Agreement counts a narrow blocklist's zero as a dissenting vote. Feodo
  answers "is this a botnet C2", Tor answers "is this a relay", and neither is
  disagreeing with AbuseIPDB about a web-app-attack bot; they are answering a
  question nobody asked. Those zeros inflate the dispersion, which is most of
  why the floor-pinned IPs sit at 0.45 to 0.55 agreement. `SourceCategory`
  already distinguishes `reputation` from `blocklist`, so weighting the dissent
  by category is the tractable fix. Issue #30.
- Issue #28, the empty-file verdict.
- Issue #29, unsupported hash algorithms reported as errors.
