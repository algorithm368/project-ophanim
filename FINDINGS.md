# Testing Findings — Project Ophanim

Tested 2026-05-26. All 86 unit tests pass, linter is clean.

---

## Bugs to Fix

### 1. Source status pill shows "Clean" for non-zero scores (misleading)

**File:** `components/CheckResults.tsx:2244`

`StatusPill` flags a source as "Flagged" only if `score >= 40` or `malicious: true`. Anything below 40 renders as "Clean" (green shield). This misrepresents real signals:

- URLhaus scores 24 on a domain with 1 stale malicious URL → shown as "Clean"
- DNS Blocklists scores 20 on an IP listed on s5h.net → shown as "Clean"
- Censys scores 18 → shown as "Clean"

**Fix:** Add a middle state (e.g., "Low risk", amber) for `score > 0 && score < 40`.

---

### 2. Defang hint shows the full refanged URL, not the extracted IOC

**File:** `components/Checker.tsx:486`

When a user pastes `hxxps://evil[.]com/malware.exe`, the hint reads:
> "(we'll check **https://evil.com/malware.exe**)"

But the actual lookup navigates to `/check/evil.com`. The hint is technically the refanged form (before domain extraction), not what's actually checked. This is confusing.

**Fix:** Compute and display the canonical form (domain/IP/hash) in the hint, not just `refangIOC(query)`. Something like: `parseDomain(normalized)?.domain ?? normalized`.

---

### 3. Page `<title>` has no verdict

**File:** `app/check/[ioc]/page.tsx:10`

Title is `185.220.101.1 | Project Ophanim`. No verdict in the tab title, making it hard to distinguish tabs when multiple IOCs are open.

**Fix:** `generateMetadata` currently runs server-side without the result. One option: include verdict in the title only when a cached result is available (can call `getCachedResult` in `generateMetadata`). E.g. `185.220.101.1 — Malicious | Project Ophanim`.

---

### 4. "Reputation over time" graph shows stale/conflicting scores

**File:** `components/CheckResults.tsx:2424`

For the EICAR test hash, the history graph showed: `risk 0 → risk 87 → risk 0`, while the live result card says 94/100. History entries written without VirusTotal API keys (score 0) sit alongside entries with VT (score 87+), making the graph misleading.

**Fix:** Either (a) annotate history points with "no-key run" visually, (b) filter zero-score history entries that were clearly degraded runs, or (c) add a note that scores vary based on which API keys were present at check time.

---

### 5. "Check it!" button stays enabled for unrecognized input

**File:** `components/Checker.tsx:459`

`disabled={loading || !query.trim()}` — the button is enabled whenever the input is non-empty, even if the IOC type is not detected (e.g., `notavalidindicator`). Clicking it triggers a run that immediately fails with an error message.

**Fix:** `disabled={loading || !query.trim() || !detected}` — disable when detection returns null so the hint "Not a recognized IOC yet" and the disabled button say the same thing.

---

## UX Issues to Improve

### 6. Hybrid Analysis silently errors on MD5/SHA1 hashes

When checking an MD5 hash, Hybrid Analysis shows an error card: "Hybrid Analysis lookup requires a SHA-256 hash". This reads like a service error, not an expected limitation.

**Fix:** Show this as a `skipped` state with a brief explanation in the pill (e.g., "SHA-256 only"), instead of an Error badge.

---

### 7. No "copy link" button on result pages

Results are already at a shareable permalink (`/check/<ioc>`), but there's no one-click "copy link" button. The "Copy summary" button copies text, not the URL.

**Fix:** Add a copy-URL icon button next to "Copy summary".

---

### 8. Rate-limited sources (GreyNoise, Criminal IP) always error

GreyNoise consistently returns HTTP 429 and Criminal IP returns "limit exceeded" on every check. These appear as persistent red error cards.

**Fix:** Consider showing a "quota exceeded" state separately from genuine errors, or suppress these sources in the consensus count when they are always rate-limited.

---

### 9. AlienVault OTX frequently near-timeout

OTX took 10+ seconds on one IP check, pushing against the timeout. No indication of slowness to the user while waiting.

**Fix:** Consider reducing the OTX timeout weight or surfacing per-source latency hints when it's noticeably slow.

---

## Uncommitted Files (should be committed)

Many new features are working but untracked in git. These should be committed:

```
app/check/[ioc]/opengraph-image.tsx   # OG image for result pages (returns 200 ✓)
app/opengraph-image.tsx               # Root OG image
app/icon.svg                          # App icon
components/Banner.tsx                 # Header (already imported in layout.tsx)
components/graph/                     # Investigation graph
lib/ti/history.ts                     # Reputation timeline
lib/relations.ts + tests              # Related-indicator extraction
lib/*test.ts / vitest.config.ts       # Unit test suite
scripts/                              # Screenshot helpers
```

---

## What Works Well

- IP, domain, and hash checks all work end-to-end
- Defanging correctly extracts the canonical IOC from URLs and analyst notation
- Private/reserved IP rejection shows a clear, friendly error with example alternatives
- API validation returns correct 400/422 with specific messages
- OG images for result pages return 200
- Investigation graph builds up and persists across searches in the session
- "Cached" / "Fetch fresh" flow works correctly
- Source breakdown, score explanation, and consensus widgets all render correctly
- All 86 unit tests pass, lint is clean
