# DNS Resolver Consensus Confidence Design

## Problem

When a domain is checked, `dnsSource` (`lib/ti/domain/sources/dns.ts`) resolves
the apex A record at exactly **two** DoH resolvers (Cloudflare + Google) and
collapses the result into a single binary flag, `resolverAgreement: boolean`.

Consequences:

- Two resolvers cannot express **confidence**. One CDN edge answering a
  different (but equally valid) IP reads as a hard "Disagree," and there is no
  way to say "5 of 6 resolvers agree."
- The UI (`components/CheckResults/profile.tsx`) only surfaces the flag as a red
  "Disagree" chip when `resolverAgreement === false`; agreement is invisible.
- A timing‑out resolver is indistinguishable from a disagreeing one under the
  current all‑or‑nothing `resolversAgree`.

The user wants a dnschecker.org‑style consensus: query **many** resolvers and
express how strongly they agree on the resolved IP(s).

## Goal

Replace the binary agreement flag with a **consensus confidence** over a pool of
unfiltered DoH‑JSON resolvers. Deliverable is a `ResolverConsensus` structure
(votes, confidence ratio, consensus IP set, disagreement variants) surfaced as a
readout on the domain result page.

**Scope boundaries (decided during brainstorming):**

- **Confidence only**, not a full per‑resolver propagation table.
- **Unfiltered resolvers only** — security/filtering resolvers (Quad9, AdGuard,
  CleanBrowsing) legitimately block known‑malicious domains, which is a
  *different* signal handled separately (see Part B, its own spec). Mixing them
  would conflate blocklisting with IP instability.
- **Context‑only, no score impact.** `dnsSource` stays `weight: 0`. Resolver
  disagreement has innocent causes (GeoDNS/CDN) and must not move the 0‑100
  score.
- **JSON‑DoH transport only.** No RFC‑8484 wireformat resolvers.

Part B (multi‑resolver protective‑DNS block signal, generalizing `quad9Source`)
is a **separate spec** built after this one.

## Design

### 1. Unfiltered resolver pool — `lib/ti/dns/doh.ts`

Add an `UNFILTERED_RESOLVERS` map of JSON‑DoH endpoints that do **not** run a
malicious‑domain blocklist. Cloudflare and Google are known‑good and stay. Each
additional candidate must be **verified server‑side** before inclusion: it has
to return valid `application/dns-json` for a GET query, not hang, and not filter
known‑bad domains. Candidates to probe:

- Cloudflare — `cloudflare-dns.com/dns-query` *(in, verified today)*
- Google — `dns.google/resolve` *(in, verified today)*
- AdGuard **unfiltered** — `dns-unfiltered.adguard.com/resolve`
- dns0.eu — `dns0.eu` *(JSON support to confirm)*
- Quad9 **unsecured** — `9.9.9.10` JSON endpoint *(the secured `:5053` JSON
  endpoint is known to hang; confirm the unsecured one)*

Whatever fails verification is **dropped with a code comment** explaining why,
mirroring the existing Quad9 note already in `doh.ts`. The pool is best‑effort:
we do not promise a fixed count, only whichever endpoints reliably answer JSON.
`dohQuery` is unchanged.

Verification is a throwaway probe (scratchpad script hitting each candidate for a
known domain server‑side); results are recorded in the code comment, not
committed as a script.

### 2. Consensus logic — new pure module `lib/ti/dns/consensus.ts`

Unit‑tested, no network.

```
interface ResolverVote { resolver: string; ips: string[] | null }  // null = no response

interface ResolverConsensus {
  respondingResolvers: number;   // resolvers that returned an answer set
  totalResolvers: number;        // resolvers queried
  consensusIps: string[];        // the plurality answer set
  agreeCount: number;            // responders returning the consensus set
  confidence: number;            // agreeCount / respondingResolvers, 0..1
  bucket: "high" | "medium" | "low";
  variants: { ips: string[]; count: number }[];  // distinct sets, desc by count
}

ipConsensus(votes: ResolverVote[]): ResolverConsensus
```

Rules:

- **Non‑responders are non‑votes, not disagreement.** A `null` vote (timeout/
  error) is excluded from `respondingResolvers` and never lowers confidence.
- **Order‑insensitive.** Answer sets are canonicalized (sorted, joined) — reuse
  the `canon` approach already in `resolversAgree`.
- **Plurality wins.** `consensusIps` is the answer set returned by the most
  responders. Ties break deterministically (e.g. the set with the
  lexicographically smallest canon form) so output is stable/testable.
- **Buckets:** `high` = every responder returned the consensus set; `medium` =
  consensus set is a strict majority (> half of responders); `low` = otherwise
  (no majority / even split).
- **Partial overlap** (CDN rotation — sets that share some IPs but are not
  identical) is treated as a **distinct variant**, not a partial match, in this
  first cut. Overlap‑aware scoring is explicitly deferred (YAGNI).
- Empty input, single responder, and all‑null cases return a well‑defined result
  (`confidence: 1` and `bucket: "high"` when ≤1 responder — nothing to disagree
  with; `consensusIps: []` when no responders).

### 3. Wire into `dnsSource` — `lib/ti/domain/sources/dns.ts`

- Query the apex **A** record across the full `UNFILTERED_RESOLVERS` pool
  concurrently (today only CF+Google), each producing a `ResolverVote`
  (`null` on timeout/error so one slow resolver can't fail the batch).
- Feed the votes into `ipConsensus`.
- Replace `resolverAgreement: boolean` with `resolverConsensus: ResolverConsensus`
  in both `details` and `domainContext`.
- `resolvedIps` (the value the rest of the finding, PTR, and summary build on)
  becomes `consensusIps` — the agreed set, not "whatever Cloudflare said."
- DNSSEC (`dnssecStatus`) uses the same responder set that came back.
- The summary sentence uses the consensus: e.g. *"Apex resolves to
  93.184.216.34."* when agreement is high; *"Resolvers split on the A record
  (3/6)."* when low.
- **Weight stays 0.**

### 4. Types — `lib/ti/types.ts`

Add `ResolverConsensus` to the shared model; replace the `resolverAgreement?:
boolean` field on `DomainContext` (and wherever `details` is typed) with
`resolverConsensus?: ResolverConsensus`. Grep for existing `resolverAgreement`
consumers and migrate them (`dns.ts`, `parse.ts` usage, `profile.tsx`).

### 5. UI — `components/CheckResults/profile.tsx`

The DNS‑records "Resolvers" field currently renders only when
`resolverAgreement === false`. Change it to render whenever **more than one
resolver responded**, showing the confidence:

- High: `6/6 agree` — neutral tone.
- Medium: `5/6 agree` — neutral/subtle tone.
- Low: `3/6 split` — amber/red tone, with a hint naming the likely cause
  (GeoDNS, split‑horizon, or possible poisoning) and, if useful, the variant IPs.

The group‑visibility condition that references `ctx.resolverAgreement === false`
is updated to the new field.

## Testing

- **`lib/ti/dns/consensus.test.ts`** (new): all‑agree → high/confidence 1;
  strict majority → medium; three‑way split → low; non‑responders excluded from
  the denominator; CDN partial‑overlap counted as separate variants; single
  responder → high; all‑null → empty consensus; tie‑break determinism.
- **`lib/ti/domain/sources/dns.test.ts`** (update): assert the source emits
  `resolverConsensus` and that a mocked split lowers confidence while a mocked
  timeout does not.
- Update any test asserting the old `resolverAgreement` field.

Run `npm test` and `npm run lint` before declaring done. Exercise the real
pipeline against a stable domain (single‑IP, expect high) and a large CDN domain
(GeoDNS, expect a lower bucket) per the repo's verification guidance, and
screenshot the domain result page for the UI change.

## Out of scope (YAGNI)

- Per‑resolver propagation table (confidence‑only was chosen).
- Any score impact from unfiltered disagreement (context‑only).
- RFC‑8484 wireformat resolvers (JSON‑DoH only).
- Overlap‑aware partial‑credit scoring of near‑miss answer sets.
- Part B: multi‑resolver protective‑DNS block signal — separate spec.
