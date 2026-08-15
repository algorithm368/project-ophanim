# IPv6 in the full TI pipeline — design

**Date:** 2026-08-15
**Status:** Approved (pending spec review)
**Supersedes:** the "IPv6 in the full TI pipeline" non-goal in
`2026-05-29-bulk-geolocation-ipv6-design.md`

## Overview

Make IPv6 a first-class single indicator. Pasting one routable IPv6 address runs
the same pipeline an IPv4 address runs today, and produces the same result:
a risk score, a verdict, per-source rows, a permalink, cache, and history.

The guiding constraint is **strict IPv4 parity**. IPv6 gets no bespoke cards, no
bespoke scoring rules, and no v6-only result fields. A v6 result is an IP result
that happens to have colons in it. Everything below follows from that.

## Goals

- `/api/check` accepts IPv6 and returns a scored `CheckResult`.
- A lone routable IPv6 in the home input runs the full check instead of falling
  through to the bulk geo table.
- Sources declare which IP families they can answer for, so a v4-only feed is
  visibly skipped rather than silently queried with input it cannot use.
- Sources that already work for v6 upstream actually get used for v6.
- Register `spamhausDropSource` and `otxSource`, which are written and tested
  but wired into no registry, so IPv6 has more than one keyless scoring source.
  This knowingly changes IPv4 scoring too (see "Accepted IPv4 impact").

## Non-goals

- **No v6-only scoring.** No prefix-match discount, no `matchScope`, no changes
  to `aggregateRisk` or `computeFloor`. IPv6 runs the identical scoring path.
- **No v6-only UI.** No address-structure decode card (Teredo / 6to4 / NAT64 /
  EUI-64 / SLAAC-privacy). Considered and explicitly cut for parity.
- No IPv6 DNSBL support (see "Sources left at v4" for why).
- No Tor v6 exit data via onionoo.
- No change to the bulk geo path for two or more IPs.

## Source capability, verified

Every claim below was probed live against `2001:4860:4860::8888` on 2026-08-15,
not assumed from documentation. Three probes overturned what would otherwise
have been written into this spec as fact: Shodan InternetDB was assumed v4-only
and is not, the Tor bulk exit list was assumed to carry v6 entries and carries
none, and a RIPEstat `blocklist` data call was assumed to exist and does not.
That is why the matrix is evidence-based rather than inferred.

### Sources that gain `families: [4, 6]`

| Source | Evidence |
| --- | --- |
| ip-api | returns full geo for v6 |
| ipwho.is | returns full geo, `"type":"IPv6"` |
| RDAP | `rdap.org/ip/<v6>` redirects to the registry, returns `v6prefix` + length |
| RIPEstat | `network-info` returns `{prefix: "2001:4860::/32", asns: ["15169"]}` |
| PeeringDB | ASN-driven, resolves its ASN through RIPEstat `network-info` |
| Reverse DNS | PTR via `ip6.arpa` resolves (`dns.google.`) |
| Shodan InternetDB | **works for v6**, returned `ports: [53, 443]` + hostnames |
| Spamhaus DROP | **`drop_v6.json` exists**, same NDJSON shape, /48 blocks |
| OTX | `/api/v1/indicators/IPv6/<v6>/general` returns 200 |
| AbuseIPDB | documented v6 support on `/api/v2/check`, key-gated |
| ipinfo, freeipapi, ipgeolocation | documented v6 geo support, key-gated |

Thirteen sources end up `[4, 6]` and twelve stay `[4]`, over a registry of 25
once the two unwired sources are added.

### Sources left at `families: [4]`

- **Feodo, IPsum, ET Open, blocklist.de**: v4-only feeds. Feodo's JSON was
  confirmed v4-only by probe.
- **Tor**: the bulk exit list contains zero v6 entries (confirmed by probe).
- **DNSBLs**: `zen.spamhaus.org` and `dnsbl.dronebl.org` both returned nothing
  for a clean v6 nibble query, which is the expected NXDOMAIN for a clean
  address and therefore **inconclusive**. Confirming v6 support needs a
  known-listed v6 address, which we do not have. Left at v4 rather than shipped
  on a guess.
- **reverse-ip** (hackertarget): v4-only reverse IP lookup.
- **VirusTotal, GreyNoise, CriminalIP**: key-gated and unverifiable from this
  environment. Left at v4 until probed with a real key. Flagging them
  optimistically would produce error rows for every v6 lookup.

### Unrelated finding

ThreatFox now returns `{"error": "Unauthorized"}` for the previously keyless
`search_ioc` query. This is pre-existing breakage on the IPv4 path, not caused
by or fixed in this work. Recorded here so it is not lost; it needs its own fix.

## Scoring coverage, and the accepted IPv4 impact

Most v6-capable sources above are `weight: 0`, context only. Before this work
the only registered sources that both score and support v6 are Shodan
InternetDB (0.5, keyless) and AbuseIPDB (1.0, key-gated). A keyless IPv6 lookup
would therefore derive its entire verdict from one source, and most addresses
would land on `unknown`. That is honest but close to useless.

`spamhausDropSource` (keyless, 0.3) and `otxSource` (key-gated, 0.85) are
already implemented and unit-tested but appear in no registry, so neither has
ever run. Registering them is the cheapest available fix, and Spamhaus DROP in
particular is the only keyless v6 reputation source we have.

**Accepted IPv4 impact.** These two sources contribute to IPv4 as well, so
existing IPv4 scores will shift: DROP adds up to 55 at weight 0.3 for addresses
in a criminal netblock, and OTX up to weight 0.85 where a key is configured.
No IPv4 verdict gets *worse* information, but cached results computed under the
old source set will disagree with fresh ones. This was weighed and accepted
rather than discovered late; the alternative was shipping IPv6 with effectively
no keyless scoring.

## Architecture and file changes

### 1. `lib/ti/types.ts` — declare capability

```ts
interface SourceMeta {
  // ...
  /** IP families this source can answer for. Defaults to [4] when omitted, so
   *  every existing source keeps its current behavior without being touched. */
  families?: (4 | 6)[];
}
```

Defaulting to `[4]` means the twelve v4-only sources need no edit, and a newly
added source is v4-only until it proves otherwise. That is the safe default: the
failure mode of forgetting the flag is a missing source, not a broken one.

### 2. `lib/ti/check.ts` — gate by family

`runSource` / `runAll` in `orchestrate.ts` are shared with the domain and hash
pipelines, where "IP family" is meaningless. So the gate lives in the IP
orchestrator, not the generic orchestrator.

`checkIp` determines the family from the indicator (`parseIP(...).version`),
partitions `sources` into supported and unsupported, runs `runAll` over the
supported set, and synthesizes a skip row for each unsupported source:

```ts
{ source: meta, enabled: true, status: "skipped",
  summary: "IPv4-only source", durationMs: 0 }
```

Synthesized skips are passed to `onSettled` too, so the streaming NDJSON view
shows them exactly as it shows key-gated skips. Results are re-ordered to
registry order before assembly so display order is stable.

This mirrors the existing `isEnabled()` skip UX ("Set `X` to enable"), keeps
`stats.skipped` meaningful, and leaves `orchestrate.ts` generic.

### 3. `lib/ti/cidr.ts` — v6 containment

`cidrContains` is v4-only by construction (`ipv4ToLong`), and today documents
that a v6 lookup "simply misses rather than throws". That is now wrong for
`drop_v6.json`, whose /48 blocks are the main v6 reputation signal.

Add a BigInt path: expand both the address and the block base to a 128-bit
BigInt, mask to the prefix length, compare. Dispatch on which family parses.
Keep the v4 arithmetic path untouched so existing behavior and tests are
unaffected. Reject mixed-family comparisons as `false`.

### 4. `lib/ti/sources/spamhaus-drop.ts` — dual feed

The module holds a single `cache` and a hardcoded v4 `FEED_URL`. Change to a
per-family feed and a per-family cache entry (v4 and v6 fetched independently,
each with its own 6h TTL and in-flight dedupe), selecting by the family of the
indicator under check.

Scoring is unchanged: weight `0.3`, score `55`, no `malicious: true`. The
existing comment already explains that netblock-granularity listing must not
force a malicious verdict on an individual address. That reasoning holds
identically for a /48, which is why parity needs no new rule here.

### 5. `lib/ti/dns/fcrdns.ts` — v6 reverse and forward

Two v4 assumptions:

- `reversePointer` builds `in-addr.arpa` by reversing dotted octets. Needs the
  `ip6.arpa` nibble form for v6 (expand to 32 nibbles, reverse, dot-join).
- `verifyFcrdns` forward-resolves with record type `"A"`. Needs `"AAAA"` for v6.
  `ResolveFn`'s type widens to `"PTR" | "A" | "AAAA"`.

The confirmation compares `forward.includes(ip)`. For v6 a resolver may return
an equivalent but differently formatted string, so compare canonicalized forms
via `parseIPv6(x)?.ip` rather than raw string equality. This is a real
correctness bug for v6, not a cosmetic one: raw comparison would report
forward-confirmed records as unconfirmed.

`reverse-dns.ts` itself only needs its inline `resolve` closure widened to pass
the record type through.

### 6. `lib/ti/sources/otx.ts` — path segment

The endpoint hardcodes `/indicators/IPv4/`. Select `IPv4` or `IPv6` from the
family. Both the `general` and `malware` calls.

### 7. `app/api/check/route.ts` — accept v6

Swap `parseIPv4` for `parseIP` in `validateIp`. The existing private/reserved
422 already works, because `parseIPv6` populates `scopeNote` for loopback,
unspecified, link-local, ULA, documentation, multicast, and IPv4-mapped. Update
the 400 message from "Invalid IPv4 address" to "Invalid IP address". Return
`parsed.ip`, which is the RFC 5952 canonical form, so cache and history key off
one spelling of each address.

### 8. `components/Checker.tsx` — remove the diversion

`bulkTargets` currently returns a single IPv6 as a bulk target, with a comment
explaining the pipeline is v4-only. Delete that branch and the comment; bulk now
means two or more IPs, full stop.

Two further v4 assumptions in the same file must change with it, or IPv6 never
reaches the API at all:

- `validateInput` calls `parseIPv4` and rejects v6 client-side with "isn't a
  valid IPv4 address". Needs `parseIP`, and the message generalized to "IP
  address".
- `canonicalFor` calls `parseIPv4` and falls back to the raw input on failure,
  so a v6 would key the cache and the permalink off whatever the user typed
  (`2001:DB8::1` and `2001:db8::0:1` would be distinct entries). Needs
  `parseIP` so both collapse to the RFC 5952 canonical form the route returns.

### 9. `lib/ti/registry.ts` — register the two unwired sources, and flag families

Add `spamhausDropSource` and `otxSource` to the registry. Placement follows the
existing grouping: DROP alongside the other blocklists (after `ipsum`), OTX
alongside the other key-gated reputation sources (after `virusTotal`).

Add `families: [4, 6]` to the thirteen metas listed in the matrix. No other
ordering change.

Because both sources are already unit-tested against their own adapters, the
registration itself needs only a registry-level assertion that every registered
source has a unique `id` and that the expected count is present, which guards
against a future source being written and silently left unwired the same way.

## Data flow

Unchanged from IPv4, which is the point:

```
input -> refangIOC -> detectIOC ("ip") -> /api/check?ip=<v6>
      -> validateIp (parseIP, canonical RFC 5952, 422 on non-routable)
      -> checkIp: partition registry by family
                  runAll(supported) + synthesized skips
      -> assembleIpResult -> aggregateRisk (identical path)
      -> cache write, history append -> CheckResult
```

## Error handling

- Malformed v6, or v6 with a zone ID (`fe80::1%eth0`, rejected by
  `expandIPv6`): 400.
- Non-routable v6: 422 with the existing `scopeNote`, same as private v4.
- A v6-capable source that fails upstream: existing `error` / `timeout` handling
  in `runSource`, unchanged.
- A v4-only source: `skipped`, never queried, zero network cost.
- All sources skipped or errored: `aggregateRisk` already returns `unknown` when
  nothing scored, so a v6 with no usable sources degrades honestly.

## Testing

Unit (Vitest, colocated, no network):

- `lib/ti/cidr.test.ts`: v6 containment, /48 and /64 and /128 boundaries,
  unaligned bases, mixed-family returns false, existing v4 cases still pass.
- `lib/ti/dns/fcrdns.test.ts`: `ip6.arpa` nibble pointer for compressed and
  expanded input, AAAA forward path, canonical comparison confirming a match
  written in a different but equivalent form.
- `lib/ti/check.test.ts`: family partitioning produces skip rows for v4-only
  sources, in registry order, with `onSettled` fired for them; a v4 indicator
  still runs every source.
- `lib/ti/sources/spamhaus-drop.test.ts`: v6 feed parsing and per-family cache
  selection.
- `lib/ti/registry.test.ts`: every registered source has a unique `id`, and
  DROP and OTX are present. Guards against the "written but never wired" bug
  this work uncovered.
- Route validation: v6 accepted and canonicalized, ULA/link-local/documentation
  rejected 422, zone ID rejected 400.

Manual, end to end (every source involved is keyless):

1. A `drop_v6.json` address, expecting a Spamhaus DROP hit and a nonzero score.
2. `2001:4860:4860::8888`, expecting clean with geo, RDAP, RIPEstat prefix,
   PeeringDB, PTR `dns.google`, and InternetDB ports.
3. Permalink round-trip for both, confirming colons survive
   `/check/<ioc>` encoding and decoding through `iocFromPath`, and that the
   cached permalink renders on first paint.
4. `bun run test`, `bun run lint`, `bun run typecheck`.

## Risks

- **Permalink encoding.** Colons in a path segment are legal per RFC 3986 but
  are commonly percent-encoded. `iocFromPath` already decodes, and cache keys
  are plain concatenation with no splitting, so this should hold. It is
  explicitly on the manual test list because it is the most likely place for
  this to break in a way unit tests would miss.
- **Optimistic capability flags.** Mitigated by leaving every unverifiable
  key-gated source at v4.
- **DNSBL uncertainty.** Deliberately unresolved rather than guessed.
- **IPv4 scores shift** once DROP and OTX are registered, so a cached IPv4
  result can disagree with a fresh one until its TTL expires. Accepted
  deliberately (see "Accepted IPv4 impact"). If the disagreement matters, the
  mitigation is a cache flush at deploy, not a code change.
- **Thin v6 scoring even after wiring.** A keyless IPv6 lookup scores off
  Shodan InternetDB plus Spamhaus DROP, two sources. IPv6 verdicts will read
  `unknown` more often than IPv4 ones. This reflects real feed coverage and
  should not be papered over by inventing confidence the data does not support.
