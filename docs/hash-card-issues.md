# Hash File-identity card — issue list

Found by testing 10 hashes through the local API + UI on 2026-07-19 (ransomware,
stealer, proxyware, zip, benign/EICAR, no-sandbox, heuristic-only, unknown, plus
MD5/SHA-1/SHA-256 of the same file).

## Status (2026-07-19)

**Fixed:** #1 (severity follows verdict), #2 (clean files suppress behaviour
summary/tags), #3 (2xx-empty → ok not error), #4 (dropped junk `tags` row),
#5 (real sandbox counts), #6 (summary falls back to readable capabilities),
#7 (note for evidence-less flagged files). All verified in the UI + API.
**Open:** #8 (bump cache version on shape change), #9 (md5/sha256 cache drift —
inherent, low priority).

Test set (sha256 unless noted):
- WannaCry `ed01ebfb…` (ransomware, rich) / md5 `84c82835…` / — same file
- `AD1940…` (SHA-1, proxyware/honeygain, score 26)
- ACRStealer `cb336a6e…` (score 96, 0 behaviour tags)
- Arechclient2 zip `4a96a4b4…` (score 90, empty sandbox)
- `68444cab…` (`k.php.sh`, score 88, no family)
- EICAR `275a021b…` (benign test file, verdict clean 0)
- Pumpar.Generic `5fbed74e…` (score 75, zero evidence)
- cython loader `7c9a7614…` (score 82)
- `ffff…ff` (unknown / not on record)

---

## High — correctness / trust

### 1. Header severity (colour) ignores the actual verdict
The status dot + family colour (`kind`) is derived from whether a family/threat
label exists, not from the score/verdict, so the at-a-glance signal is wrong both
ways:
- **EICAR** (verdict **clean**, 0/100) renders **red / "malicious"** — it has a
  family ("eicar"), so `kind = "malicious"`.
- **`k.php.sh`** (verdict **malicious**, 88/100) renders a **grey / neutral "SH"**
  header with no danger cue — it has no family, so `kind = "known"`.

Where: `components/CheckResults/profile.tsx`, the `kind` computation
(`ctx?.malwareFamily || ctx?.threatLabel ? "malicious" : ctx ? "known" : "unknown"`).
Fix: drive `kind`/tone from `result.verdict` (or score), not family presence.

### 2. Clean-verdict files still render alarming behaviour
EICAR (score 0, clean) shows the behaviour summary "When run, it checks for a
debugger, uses timing tricks to detect analysis, disguises its process name, and
stalls to slip past analysis.", plus behaviour tags, "What this file does" (12),
MITRE (9), and Runtime behavior. VT `behaviour_summary` is aggregated across every
submission of that hash, so for a benign file it surfaces unrelated/among-noise
behaviour. Reads as dangerous despite the clean verdict.
Fix: suppress or de-emphasize the behaviour summary + behaviour/runtime sections
when `verdict === "clean"` (or gate on score), or label them "observed across
submissions, may include benign noise".

### 3. Sandbox source turns a 2xx-with-no-data into an error row
`4a96a4b4…` (zip) produced `vt-sandbox: error "HTTP 200"`. When
`behaviour_summary` returns 2xx but no usable `data.data`, the source falls into
the error branch instead of the graceful "no report" path.
Where: `lib/ti/hash/sources/virustotal-sandbox.ts:301`
(`if (!ok || !data?.data) return { status: "error", … }`).
Fix: treat `ok && !data?.data` like 404 → `{ status: "ok", summary: "No sandbox
behaviour report" }`; only `!ok` is an error.

---

## Medium — data quality

### 4. `tags` row shows nonsense community tags
EICAR's `tags` row reads "adware, backdoor, crypt, downloader, exploit, injector,
ransomware, riskware, worm, banker" — VT community/joke tags. The card already
excludes tags from the category chips (they're unreliable) but still prints them
raw in the `tags` row.
Where: `components/CheckResults/profile.tsx` `tags` `HashRow`.
Fix: drop the raw `tags` row, or filter it the same way categories are derived.

### 5. Sandbox source summary is always "12 behaviours, 12 techniques"
Every rich sample reports the same string because it uses the **capped** counts
(cap = 12), not the real totals (WannaCry actually has 45 capabilities / 27
techniques).
Where: `lib/ti/hash/sources/virustotal-sandbox.ts:333`.
Fix: report pre-cap counts (e.g. `signature_matches.length`, deduped
`mitre_attack_techniques`).

---

## Medium — coverage (the "still hard to understand" cases)

### 6. Plain-language summary only appears when VT behaviour tags exist
The new summary is built solely from `behaviorTags`. Files with 0 tags get **no
summary** — and that's a lot of them: ACRStealer (96), zip (90), `k.php.sh` (88),
Pumpar (75) all had 0 tags. Exactly the files a user needs help reading still open
on raw data.
Fix: fall back to synthesizing a sentence from family + derived categories + top
capabilities when tags are absent.

### 7. Malicious file with zero evidence = empty, unexplained card
`5fbed74e…` (Pumpar.Generic, malicious 75) has 0 capabilities / detections / dlls
/ runtime / tags. The card shows only the family + verdict with no summary and no
sections — nothing explains why it's flagged.
Fix: when evidence is empty, add a short line noting the score is a single
heuristic/low-consensus hit (tie into the score-breakdown narrative).

---

## Low — expected / rollout

### 8. Cached results miss newly-added fields until refresh/TTL
WannaCry (cached before the DLL feature) shows `importedDlls = 0`; its MD5 variant
(looked up later) shows 4. Old cache entries render incomplete sections until they
expire or are refreshed.
Fix: bump the cache key/version when the result shape changes.

### 9. Same file via different hash types = separate cache entries
WannaCry sha256 vs md5 returned score 98 vs 96 and different DLL counts — they are
cached independently and can drift. Minor; inherent to hash-keyed caching.
