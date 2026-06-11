# TI free-tier data coverage — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> or superpowers:executing-plans to implement task-by-task. Steps use checkbox
> (`- [ ]`) syntax. Phase 1 is fully specified; Phases 2–8 are task outlines —
> **re-read the target adapter and confirm each doc-derived claim against a live
> response before implementing** (the audit read docs; APIs drift).

**Goal:** Surface free-tier TI data the adapters already fetch (or can get for one
extra free call) but currently drop — prioritizing related-indicator pivots and
`hashContext` identity fields. No paid APIs, no verdict regressions (except the
one intended URLhaus-host scoring change).

**UI constraint (firm):** **no edits to shipped React components and no new
cards.** All enrichment surfaces through channels existing cards already render
dynamically — `relations[]` → Related card, `passiveDns` → Passive DNS card,
`certificates[]` → Certificates card (domain), the profile cards' *existing*
`geo`/`domainContext`/`hashContext` rows, and each source's `summary` + `details`
(the "Show raw details" disclosure). New relation kinds need only a
`RELATION_META`/`RELATION_ORDER` entry in `lib/relations.ts` (a lib file). Data
with no existing formatted slot (hash ssdeep/imphash/tlsh/detectionNames, abuse
contacts, RPKI, IP certs) goes into that source's `details` — never a component
edit. See the spec's "UI surface" section. This makes the work almost entirely
`lib/` + adapter changes with **no `.tsx` diffs**.

**Spec:** `docs/superpowers/specs/2026-06-11-ti-data-coverage-design.md`

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Tailwind v4, vitest. No new
deps. Sources implement `TiSource`; pure mappers are unit-tested in
`lib/**/*.test.ts`; context arrays merge union+dedupe (the Phase-1 path).

**Branch note:** create `feat/ti-data-coverage` off `main` before Task 1 (the
current working tree has unrelated edits to `registry.ts`/`dnsbl`/`otx` — keep
this work separate). Commit trailer:
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Task 0: Branch

- [ ] **Step 1:** `git checkout main && git checkout -b feat/ti-data-coverage`
  (stash or leave the unrelated working-tree edits; do not fold them in).

---

## Task 1 — Phase 1: Passive-DNS → `relations[]` + CNAME/AAAA/PTR emit (pure, TDD)

**Why first:** zero quota, pure reuse, directly unblocks the Related readout.
`relationsFor()` already merges context-derived + source-contributed relations
but **never reads `result.passiveDns`**, so the mnemonic resolutions never pivot.
`hosted`/`resolved` already exist in `RELATION_META`/`RELATION_ORDER`.

**Files:** modify `lib/relations.ts`, `lib/relations.test.ts`.

- [ ] **Step 1: Write the failing tests.** Append to `lib/relations.test.ts`.

Add to the `ipRelations` describe block:

```ts
it("links passive-DNS domains hosted on the IP", () => {
  const result: CheckResult = {
    ...baseIp,
    passiveDns: [
      { value: "hosted.example.com", type: "domain", recordType: "A" },
    ],
  };
  expect(ipRelations(result)).toContainEqual({
    value: "hosted.example.com",
    type: "domain",
    relation: "hosted",
  });
});
```

Add to the `domainRelations` describe block:

```ts
it("links passive-DNS IPs, CNAME, AAAA, and PTR hosts", () => {
  const result: DomainCheckResult = {
    domain: "example.com",
    checkedAt: "",
    riskScore: 0,
    verdict: "clean",
    sources: [],
    stats: { total: 0, queried: 0, flagged: 0, skipped: 0, errored: 0, rateLimited: 0 },
    context: {
      cname: ["cdn.example.net"],
      ipv6: ["2001:db8::1"],
      reverse: ["ptr.example.com"],
    },
    passiveDns: [{ value: "9.9.9.9", type: "ip", recordType: "A" }],
  };
  const rels = domainRelations(result);
  expect(rels).toContainEqual({ value: "9.9.9.9", type: "ip", relation: "resolved" });
  expect(rels).toContainEqual({ value: "cdn.example.net", type: "domain", relation: "CNAME" });
  expect(rels).toContainEqual({ value: "2001:db8::1", type: "ip", relation: "AAAA" });
  expect(rels).toContainEqual({ value: "ptr.example.com", type: "domain", relation: "rDNS" });
});
```

- [ ] **Step 2:** `npx vitest run lib/relations.test.ts` → FAIL (new cases).

- [ ] **Step 3: Implement in `lib/relations.ts`.**

  1. Add `PassiveDnsRecord` to the `@/lib/ti/types` import.
  2. Add the helper (place it next to `dedupe`):

```ts
/** Passive-DNS resolutions as pivots: for an IP lookup the records are domains
 *  (relation "hosted"); for a domain lookup they are IPs (relation "resolved"). */
function passiveDnsRelations(
  records: PassiveDnsRecord[] | undefined,
  cap = 12,
): RelatedIndicator[] {
  const out: RelatedIndicator[] = [];
  for (const r of (records ?? []).slice(0, cap)) {
    out.push({
      value: r.value,
      type: r.type,
      relation: r.type === "domain" ? "hosted" : "resolved",
    });
  }
  return out;
}
```

  3. In `ipRelations`, before `return dedupe(out);` add:
     `out.push(...passiveDnsRelations(result.passiveDns));`
  4. Replace the `domainRelations` body's loops with (adds AAAA, CNAME, rDNS,
     passive DNS; keeps A/NS/MX):

```ts
  for (const ip of (ctx?.resolvedIps ?? []).slice(0, 6))
    out.push({ value: ip, type: "ip", relation: "A" });
  for (const v6 of (ctx?.ipv6 ?? []).slice(0, 6))
    out.push({ value: v6, type: "ip", relation: "AAAA" });
  for (const cn of (ctx?.cname ?? []).slice(0, 4))
    out.push({ value: cn, type: "domain", relation: "CNAME" });
  for (const ns of (ctx?.nameservers ?? []).slice(0, 4))
    out.push({ value: ns, type: "domain", relation: "NS" });
  for (const mx of (ctx?.mx ?? []).slice(0, 4))
    out.push({ value: mx, type: "domain", relation: "MX" });
  for (const ptr of (ctx?.reverse ?? []).slice(0, 4))
    out.push({ value: ptr, type: "domain", relation: "rDNS" });
  out.push(...passiveDnsRelations(result.passiveDns));
```

  5. In `RELATION_META`, add after the `A` entry:

```ts
  AAAA: {
    label: "Resolves to (AAAA)",
    description: "IPv6 addresses this domain resolves to",
  },
  CNAME: {
    label: "Canonical name (CNAME)",
    description: "Canonical hostnames this domain points to",
  },
```

  6. In `RELATION_ORDER`, insert `"AAAA"` after `"A"` and `"CNAME"` after
     `"resolved"`.

- [ ] **Step 4:** `npx vitest run lib/relations.test.ts` → PASS (all old + new).
- [ ] **Step 5:** `npx tsc --noEmit && npm run lint` clean.
- [ ] **Step 6: E2E check** (dev server on :3000, do not restart it): a real IP
  with passive DNS (e.g. an IP behind shared hosting) and a CNAME'd domain now
  show "Hosted domains" / "Resolves to (passive DNS)" / "Canonical name" groups
  in the Related card. Screenshot, then `git commit`.

---

## Task 2 — Phase 2: VirusTotal quota fix + relationship collapse

**Why second:** frees VT request budget (free key = **500/day, 4/min**) *before*
adding any VT load, and delivers the pivots. Today the hash adapter fires **7
requests/lookup** (main + 4 indicator-rel + 2 url-rel) and `itw_urls` is dead
(Enterprise-only).

**Files:** `lib/ti/hash/sources/virustotal.ts` (+ test), `lib/ti/sources/virustotal.ts`,
`lib/ti/domain/sources/virustotal.ts`.

- [ ] **Verify-first:** confirm with a live free-key call that
  `GET /files/{hash}?relationships=contacted_ips,contacted_domains,contacted_urls,dropped_files,execution_parents,communicating_files`
  returns the relationship objects inline (it does on free, subject to rate
  limit), and that `itw_urls` returns empty on the free key.
- [ ] Remove `itw_urls` from `URL_RELS`.
- [ ] Collapse: replace the N separate relationship GETs with a single main GET
  carrying `?relationships=…`; read `data.data.relationships[kind].data[]`.
  Keep the best-effort, swallow-to-`[]` shape. Add `communicating_files` →
  `relation: "contacts"` (hash) / IP+domain `communicating_files`.
- [ ] Map `last_analysis_results` (per-engine verdicts) → `hashContext.detectionNames`
  (model) **and mirror the top labels into the VT source `details`** so they show
  in the existing raw-details disclosure (the hash profile card renders no
  detections row — do not add one); map `total_votes` → `details.communityVotes`.
- [ ] Unit-test the new pure mapper(s) (relationship-object → `RelatedIndicator[]`,
  per-engine → `detectionNames`). `npm test && npm run lint && npx tsc --noEmit`.
- [ ] Commit.

---

## Task 3 — Phase 3: Hash-pivot harvest (zero extra calls)

Parse pivots already present in payloads we fetch.

**Files & mappings:**
- [ ] `lib/ti/hash/sources/malwarebazaar.ts` — `vendor_intel[*].malware_config`
  (Triage) → `relations` `contacts` (C2 hosts/IPs) + `drops` (dropped hashes).
- [ ] `lib/ti/hash/sources/threatfox.ts` (and IP/domain ThreatFox) —
  `malware_samples[]` md5/sha256 → `relations` `sample`. (Add a `sample` entry
  to `RELATION_META`/`RELATION_ORDER`.)
- [ ] `lib/ti/hash/sources/triage.ts` — `sample.iocs` / `targets[].iocs`
  (domains/ips/urls) → `relations` `contacts`.
- [ ] `lib/ti/hash/sources/hybrid-analysis.ts` — `domains[]`/`hosts[]` →
  `contacts`; `extracted_files[].sha256` → `drops`; `*_parent_*` → `parent`.
- [ ] Verify-first each against a known-bad sample response; unit-test each pure
  parser; cap + dedupe. `npm test && npm run lint`. Commit per source or as one.

---

## Task 4 — Phase 4: Fill `hashContext` identity fields (zero extra calls)

> Render reality: the hash profile card already renders `firstSeen`/`lastSeen`/
> `malwareFamily`/`threatLabel`/`fileName`/`fileType`/digests — populating those
> from more sources just fills existing rows. It renders **none** of
> `ssdeep`/`imphash`/`tlsh`/`tags` — so populate the typed `hashContext` field
> (model) **and** mirror them into that source's `details` for visibility. No
> profile-card edit.

- [ ] `lib/ti/hash/sources/malwarebazaar.ts` — `ssdeep`, `imphash`, `tlsh`,
  `signature` (family → existing row), `tags`, `code_sign` → `hashContext` +
  `details`; a trusted-signer note goes in `summary`/`details`; `yara_rules[]` →
  `details`.
- [ ] VT hash — add `ssdeep`/`imphash` to `hashContext` + `details` if in attrs.
- [ ] `kaspersky-opentip.ts` / `pulsedive.ts` / `maltiverse.ts` — `FirstSeen`/
  `LastSeen`/`Signer` (→ existing first/last-seen rows), `dns_request[]`
  (→ `relations` `resolves`), `tag[]` → `details`.
- [ ] Confirm `mergeFields` first-non-empty wins keep the most-authoritative
  source. Unit-test mappers. Commit.

---

## Task 5 — Phase 5: AbuseIPDB verbose + RDAP nested entities (same-call)

- [ ] `lib/ti/sources/abuseipdb.ts` — add `&verbose` (still 1/1000-day); map the
  named report-category breakdown into `summary` (headline) + `details` (full —
  `SourceBreakdown` does not render `categories`); `hostnames[]` → `relations`
  `rDNS`; `isp`/`usageType`/`countryCode` → `geo` (existing fields) + `details`.
  Add the AbuseIPDB category-id→name table (unit-tested).
- [ ] `lib/ti/sources/rdap-ip.ts` + `lib/ti/domain/sources/rdap.ts` — parse
  nested `entities[]` (abuse/registrant vCard email/org), `events[]`
  (registration date → allocation/age), `secureDNS.delegationSigned` →
  authoritative `domainContext.dnssec` (an **existing** profile row). Abuse
  contact + allocation age have no profile slot → `details` only. Unit-test the
  entity/vCard parser. Commit.

---

## Task 6 — Phase 6: Certificates, DNS records, URLhaus blocklist scoring

- [ ] VT **domain** — `last_https_certificate` → `certificates[]` (renders in the
  domain Certificates card); SAN dNSNames → `subdomains[]` + domain relations.
  `last_dns_records` → `domainContext` (existing A/AAAA/MX/NS/SOA/CAA rows) +
  resolved-IP relations. **VT IP** certs have no card (no IP Certificates panel,
  and we add none) → keep them in `details` only.
- [ ] `lib/ti/domain/sources/certspotter.ts` — emit cross-apex SAN domains as
  `relations` (`shared cert SAN`); keep the single un-paginated call.
- [ ] `lib/ti/domain/sources/urlhaus.ts` — host `blacklists{spamhaus_dbl, surbl}`
  → **score/malicious** (the one intended scoring change) + categories. Re-check
  `aggregateRisk` behavior with a unit test; verify no clean-domain regression.
- [ ] Commit.

---

## Task 7 — Phase 7: +1-call enrichments (gated, best-effort)

Each adds latency/quota → land last, behind `Promise.all` swallow-to-`[]`.

- [ ] OTX IP+domain — parallel `GET …/malware` → contacting sample hashes
  (`relations` `communicating`). OTX hash — `GET …/file/{hash}/analysis` →
  identity + ssdeep + contacted IOCs.
- [ ] `lib/ti/hash/sources/hashlookup.ts` — on a hit, `GET /lookup/parents` +
  `/lookup/children` → parent/child file relations.
- [ ] `lib/ti/sources/ripestat.ts` — after network-info, `GET
  /data/rpki-validation` → `details.rpkiStatus` + an `rpki-invalid` soft tag.
- [ ] (Optional) Criminal IP — switch `/report/summary` → full `/report` (same 1
  credit) for ports/CVEs/`connected_domains`; **never call both**.
- [ ] Unit-test parsers; verify timeouts/quotas degrade gracefully. Commit.

---

## Task 8 — Phase 8: Maintenance migrations (correctness, not new data)

- [ ] `lib/ti/sources/ipinfo.ts` — migrate legacy `/{ip}/json` → free
  `api.ipinfo.io/lite/{ip}` (legacy being sunset); accept loss of free
  city-geo (covered by ip-api).
- [ ] `lib/ti/sources/ipgeolocation.ts` — migrate v1 flat → nested v2/v3 endpoint
  so `geo.isp`/`asnOrg` stop coming back empty. Update tests.
- [ ] Commit.

---

## Verification (whole effort)

- `npm test` + `npm run lint` green after every task; new unit test for every
  pure mapper added.
- Isolated `next build` (same-FS copy, hardlinked `node_modules`) — never touch
  the running :3000 dev server.
- **`git diff --stat` must show no `components/**/*.tsx` changes** — this effort
  ships zero component edits and zero new cards. The only `.tsx`-adjacent file
  touched is `lib/relations.ts` (a lib file: new `RELATION_META` entries).
- Before/after screenshots (light + dark) for a known-bad IP / domain / hash
  showing the existing Related / Passive DNS / Certificates cards now *fuller* —
  same components, more rows.
- Watch VT quota: after Task 2 a hash lookup should make **1** VT request, not 7.

## Self-review (coverage check)

- Spec → tasks: every "Recommended sequence" step (1–8) maps to a task here.
- Phase 1 is exact (code + tests grounded in the current `lib/relations.ts`);
  Phases 2–8 are outlines that each begin with a verify-first step because they
  depend on live API responses the audit read from docs.
- Free-only honored throughout; the single scoring change (URLhaus blocklist) is
  called out and regression-tested; `itw_urls` removal noted as a quota fix.
- **No-edit-UI honored:** every datum routes to an existing render channel or the
  per-source `details` disclosure; no shipped component is edited and no card is
  added (verified by `git diff --stat`). Items needing new formatted UI (hash
  detection/ssdeep rows, IP cert panel, IP abuse-contact row) are deferred to a
  separately-approved UI phase and live in `details` until then.
