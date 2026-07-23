# IP Dossier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the IP result's separate Origin + Exposed cards with one consolidated, passive **IP Dossier** that answers "what is it / what it runs / how it behaves / from whom" by surfacing already-collected data plus two cheap free additions (PeeringDB network class, cloud-provider ASN map).

**Architecture:** A pure, unit-tested builder `buildIpDossier(result)` in `lib/ti/` digs facts out of `geo` + per-source `details` + `history` + relations and returns a normalized `IpDossier` (groups → fields, absent fields/empty groups omitted). A thin client component `IpDossierCard` renders that structure. New data arrives through the normal source pipeline (PeeringDB source) or a zero-network table lookup (cloud map).

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Vitest (`lib/**/*.test.ts` only), Bun scripts, Tailwind + shadcn primitives.

## Global Constraints

- Runtime/tooling: **Bun** — run `bun run test`, `bun run lint` (never `bun test`).
- Vitest only discovers `lib/**/*.test.ts`. **All unit-tested code lives under `lib/`.** Component code (`components/**`) is verified by lint/build/screenshot, not vitest.
- Source adapters follow `lib/ti/sources/feodo.ts`: return `{ status: isTimeout(err) ? "timeout" : "error", error: errorMessage(err) }` (never throw), honor the `AbortSignal`, use `lib/ti/http.ts` helpers (`getJson`, `isTimeout`, `errorMessage`). Context-only sources set `weight: 0`.
- Design skin: monochrome; color reserved for the verdict word only. Mono font for identifiers (ASN, prefix, CVE, coordinates, ranges). **Commas as separators, not dashes** (no em/en-dash, no " - "). Absent rows self-hide.
- Free APIs only (no paid keys). PeeringDB + RIPEstat are keyless.
- The dossier header does **not** repeat verdict / risk level / `N/M sources` — `VerdictHero` above owns those.
- Reference source ids (verbatim): `greynoise`, `shodan-internetdb`, `feodo`, `threatfox`, `tor-project`, `rdap-ip`, `ripestat`, `reverse-ip`, `mnemonic-pdns`, `dnsbl`, `blocklist-de`, `ipsum`, `spamhaus-drop`, `et-open`, `otx`.

---

## File Structure

- Create `lib/ti/cloud.ts` — `cloudProvider(asn?, org?)` static ASN→provider map (pure).
- Create `lib/ti/shodan.ts` — relocated `PORT_SERVICE`, `ShodanHostInfo`, `shodanHostInfo(sources)` (pure); replaces the copies in `connections.tsx`.
- Create `lib/ti/sources/peeringdb.ts` — PeeringDB network-class context source; register in `lib/ti/registry.ts`.
- Create `lib/ti/ip-dossier.ts` — types + `buildIpDossier(result)` and pure sub-builders + helpers (`sparkline`, `assignmentType`, `findFinding`).
- Create `components/CheckResults/dossier.tsx` — `IpDossierCard` (renders `IpDossier`).
- Modify `components/CheckResults/profile.tsx` — export `GridItem`, `Rule` for reuse; remove `ProfileCard` (Task 8).
- Modify `components/CheckResults/connections.tsx` — import shodan helpers from `lib/ti/shodan`; remove `ExposedServicesCard` (Task 8).
- Modify `components/CheckResults/index.tsx` — swap Origin+Exposed sections for the dossier; update `IP_SECTIONS`.

---

### Task 1: Cloud provider ASN map

**Files:**
- Create: `lib/ti/cloud.ts`
- Test: `lib/ti/cloud.test.ts`

**Interfaces:**
- Produces: `cloudProvider(asn?: string, org?: string): { name: string } | undefined`

- [ ] **Step 1: Write the failing test**

```ts
// lib/ti/cloud.test.ts
import { describe, it, expect } from "vitest";
import { cloudProvider } from "@/lib/ti/cloud";

describe("cloudProvider", () => {
  it("maps a known cloud ASN (numeric or ASxxxx) to its provider", () => {
    expect(cloudProvider("AS16509")?.name).toBe("Amazon Web Services");
    expect(cloudProvider("13335")?.name).toBe("Cloudflare");
    expect(cloudProvider("AS14061")?.name).toBe("DigitalOcean");
  });

  it("returns undefined for a non-cloud ASN and for missing input", () => {
    expect(cloudProvider("AS49447")).toBeUndefined();
    expect(cloudProvider(undefined)).toBeUndefined();
  });

  it("falls back to an org-name match when the ASN is unknown", () => {
    expect(cloudProvider("AS99999", "AMAZON-02, US")?.name).toBe(
      "Amazon Web Services",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test cloud`
Expected: FAIL — `cloudProvider` not found / module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/ti/cloud.ts

/** Major cloud/hosting providers keyed by AS number. Extend as needed; this is
 *  a zero-network lookup on the ASN we already resolved via geo. */
const CLOUD_BY_ASN: Record<number, string> = {
  16509: "Amazon Web Services",
  14618: "Amazon Web Services",
  15169: "Google Cloud",
  396982: "Google Cloud",
  8075: "Microsoft Azure",
  13335: "Cloudflare",
  14061: "DigitalOcean",
  31898: "Oracle Cloud",
  63949: "Akamai (Linode)",
  24940: "Hetzner",
  16276: "OVHcloud",
  20473: "Vultr",
  12876: "Scaleway",
  45102: "Alibaba Cloud",
  37963: "Alibaba Cloud",
  54113: "Fastly",
  60781: "Leaseweb",
  51167: "Contabo",
};

/** Substring markers on the ASN org name, for ASNs not in the table above. */
const CLOUD_BY_ORG: [RegExp, string][] = [
  [/amazon|aws|amazon-02|amazon-aes/i, "Amazon Web Services"],
  [/google/i, "Google Cloud"],
  [/microsoft|azure/i, "Microsoft Azure"],
  [/cloudflare/i, "Cloudflare"],
  [/digitalocean/i, "DigitalOcean"],
  [/oracle/i, "Oracle Cloud"],
  [/hetzner/i, "Hetzner"],
  [/\bovh\b/i, "OVHcloud"],
  [/vultr|choopa/i, "Vultr"],
];

/** Identify the cloud/hosting provider behind an IP from its ASN (preferred) or
 *  ASN org name. Returns undefined when it is not a recognized provider. */
export function cloudProvider(
  asn?: string,
  org?: string,
): { name: string } | undefined {
  if (asn) {
    const n = Number(asn.replace(/^AS/i, "").trim());
    if (Number.isFinite(n) && CLOUD_BY_ASN[n]) {
      return { name: CLOUD_BY_ASN[n] };
    }
  }
  if (org) {
    for (const [re, name] of CLOUD_BY_ORG) {
      if (re.test(org)) return { name };
    }
  }
  return undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test cloud`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ti/cloud.ts lib/ti/cloud.test.ts
git commit -m "feat(ti): cloud-provider ASN map for IP dossier"
```

---

### Task 2: Relocate Shodan host-info helpers to lib

**Files:**
- Create: `lib/ti/shodan.ts`
- Test: `lib/ti/shodan.test.ts`
- Modify: `components/CheckResults/connections.tsx` (import from lib, delete local copies)

**Interfaces:**
- Consumes: `SourceResult` from `@/lib/ti/types`
- Produces: `PORT_SERVICE: Record<number, string>`; `type ShodanHostInfo = { ports: number[]; vulns: string[]; cpes: string[]; hostnames: string[] }`; `shodanHostInfo(sources: SourceResult[]): ShodanHostInfo`

- [ ] **Step 1: Write the failing test**

```ts
// lib/ti/shodan.test.ts
import { describe, it, expect } from "vitest";
import { shodanHostInfo, PORT_SERVICE } from "@/lib/ti/shodan";
import type { SourceResult } from "@/lib/ti/types";

const src = (details: Record<string, unknown>): SourceResult[] => [
  {
    source: { id: "shodan-internetdb", name: "Shodan", url: "", weight: 0, category: "scanner" },
    status: "ok",
    enabled: true,
    durationMs: 1,
    details,
  } as unknown as SourceResult,
];

describe("shodanHostInfo", () => {
  it("extracts ports/vulns/cpes/hostnames and ignores wrong-typed entries", () => {
    const info = shodanHostInfo(
      src({ ports: [22, "x", 443], vulns: ["CVE-2024-6387"], cpes: ["cpe:/a:openbsd:openssh"], hostnames: ["a.example"] }),
    );
    expect(info.ports).toEqual([22, 443]);
    expect(info.vulns).toEqual(["CVE-2024-6387"]);
    expect(info.cpes).toEqual(["cpe:/a:openbsd:openssh"]);
    expect(info.hostnames).toEqual(["a.example"]);
  });

  it("returns empty arrays when the source is absent", () => {
    expect(shodanHostInfo([])).toEqual({ ports: [], vulns: [], cpes: [], hostnames: [] });
  });

  it("labels common ports", () => {
    expect(PORT_SERVICE[22]).toBe("SSH");
    expect(PORT_SERVICE[443]).toBe("HTTPS");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test shodan`
Expected: FAIL — module `@/lib/ti/shodan` missing.

- [ ] **Step 3: Write the implementation**

Create `lib/ti/shodan.ts` — move `PORT_SERVICE` (the full map at `connections.tsx:286-322`, verbatim), the `ShodanHostInfo` type, and a `sources`-based `shodanHostInfo`:

```ts
// lib/ti/shodan.ts
import type { SourceResult } from "./types";

/** Well-known TCP port → service label, for readable exposure rows. */
export const PORT_SERVICE: Record<number, string> = {
  21: "FTP", 22: "SSH", 23: "Telnet", 25: "SMTP", 53: "DNS", 80: "HTTP",
  110: "POP3", 111: "RPC", 123: "NTP", 135: "MSRPC", 139: "NetBIOS",
  143: "IMAP", 161: "SNMP", 389: "LDAP", 443: "HTTPS", 445: "SMB",
  465: "SMTPS", 587: "SMTP", 993: "IMAPS", 995: "POP3S", 1433: "MSSQL",
  1521: "Oracle", 2049: "NFS", 2375: "Docker", 3306: "MySQL", 3389: "RDP",
  5432: "Postgres", 5900: "VNC", 5985: "WinRM", 6379: "Redis",
  8080: "HTTP-alt", 8443: "HTTPS-alt", 9200: "Elasticsearch",
  11211: "Memcached", 27017: "MongoDB",
};

export type ShodanHostInfo = {
  ports: number[];
  vulns: string[];
  cpes: string[];
  hostnames: string[];
};

/** Pull host-exposure details out of the Shodan InternetDB source result. */
export function shodanHostInfo(sources: SourceResult[]): ShodanHostInfo {
  const d = (sources.find((s) => s.source.id === "shodan-internetdb")?.details ??
    {}) as Record<string, unknown>;
  const strs = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const nums = (v: unknown): number[] =>
    Array.isArray(v) ? v.filter((x): x is number => typeof x === "number") : [];
  return {
    ports: nums(d.ports),
    vulns: strs(d.vulns),
    cpes: strs(d.cpes),
    hostnames: strs(d.hostnames),
  };
}
```

Then in `components/CheckResults/connections.tsx`: delete the local `PORT_SERVICE` (lines ~286-322), the `ShodanHostInfo` type (~324-329), and the `shodanHostInfo` function (~331-349). Add an import near the top imports:

```ts
import { shodanHostInfo, PORT_SERVICE } from "@/lib/ti/shodan";
```

`ExposedServicesCard` calls `shodanHostInfo(result)` today; change that call to `shodanHostInfo(result.sources)`.

- [ ] **Step 4: Run tests + lint to verify green**

Run: `bun run test shodan` → PASS.
Run: `bun run lint` → no new errors in `connections.tsx` (unused-symbol check confirms the local copies are gone).

- [ ] **Step 5: Commit**

```bash
git add lib/ti/shodan.ts lib/ti/shodan.test.ts components/CheckResults/connections.tsx
git commit -m "refactor(ti): move Shodan host-info helpers to lib for reuse"
```

---

### Task 3: PeeringDB network-class source

**Files:**
- Create: `lib/ti/sources/peeringdb.ts`
- Test: `lib/ti/sources/peeringdb.test.ts`
- Modify: `lib/ti/registry.ts` (import + register)

**Interfaces:**
- Produces: `peeringDbSource: TiSource`; on success attaches `details: { networkClass?: string; peeringName?: string; trafficLevel?: string }`.

**Notes:** PeeringDB is keyed by ASN, but sources run before geo is merged, so the adapter self-resolves the ASN first via RIPE prefix-overview (keyless), then queries PeeringDB. `weight: 0` (context only, never moves the score).

- [ ] **Step 1: Write the failing test**

```ts
// lib/ti/sources/peeringdb.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { peeringDbSource } from "@/lib/ti/sources/peeringdb";
import * as http from "@/lib/ti/http";

describe("peeringDbSource", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("resolves ASN then maps PeeringDB info_type to a network class", async () => {
    const getJson = vi.spyOn(http, "getJson");
    getJson.mockResolvedValueOnce({ data: { asns: ["13335"] } } as never); // RIPE
    getJson.mockResolvedValueOnce({
      data: [{ name: "Cloudflare", info_type: "Content", info_traffic: "100+ Tbps" }],
    } as never); // PeeringDB

    const f = await peeringDbSource.check("1.1.1.1", AbortSignal.timeout(1000));
    expect(f.status).toBe("ok");
    expect(f.details?.networkClass).toBe("Content");
    expect(f.details?.peeringName).toBe("Cloudflare");
    expect(f.details?.trafficLevel).toBe("100+ Tbps");
  });

  it("degrades to ok-with-no-details when the ASN cannot be resolved", async () => {
    vi.spyOn(http, "getJson").mockResolvedValueOnce({ data: { asns: [] } } as never);
    const f = await peeringDbSource.check("192.0.2.1", AbortSignal.timeout(1000));
    expect(f.status).toBe("ok");
    expect(f.details?.networkClass).toBeUndefined();
  });

  it("returns an error finding (not a throw) on network failure", async () => {
    vi.spyOn(http, "getJson").mockRejectedValueOnce(new Error("boom"));
    const f = await peeringDbSource.check("1.1.1.1", AbortSignal.timeout(1000));
    expect(f.status).toBe("error");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test peeringdb`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

```ts
// lib/ti/sources/peeringdb.ts
import type { SourceFinding, TiSource } from "../types";
import { errorMessage, getJson, isTimeout } from "../http";

interface RipePrefix {
  data?: { asns?: unknown };
}
interface PeeringDbNet {
  data?: { name?: string; info_type?: string; info_traffic?: string }[];
}

/** First ASN announcing the prefix that contains this IP (keyless RIPEstat). */
async function resolveAsn(ip: string, signal: AbortSignal): Promise<string | undefined> {
  const r = await getJson<RipePrefix>(
    `https://stat.ripe.net/data/prefix-overview/data.json?resource=${encodeURIComponent(ip)}`,
    { signal },
  );
  const asns = r?.data?.asns;
  if (!Array.isArray(asns) || asns.length === 0) return undefined;
  const first = asns[0];
  if (typeof first === "string" || typeof first === "number") return String(first);
  if (first && typeof (first as { asn?: unknown }).asn !== "undefined")
    return String((first as { asn: unknown }).asn);
  return undefined;
}

/** PeeringDB (peeringdb.com): network classification for an IP's ASN. Keyless,
 *  context-only (weight 0). "info_type" is PeeringDB's own network category. */
export const peeringDbSource: TiSource = {
  meta: {
    id: "peeringdb",
    name: "PeeringDB",
    url: "https://www.peeringdb.com",
    weight: 0,
    category: "context",
  },
  isEnabled: () => true,
  async check(ip, signal): Promise<SourceFinding> {
    try {
      const asn = await resolveAsn(ip, signal);
      if (!asn) return { status: "ok", summary: "No ASN to look up" };

      const net = await getJson<PeeringDbNet>(
        `https://www.peeringdb.com/api/net?asn=${encodeURIComponent(asn)}`,
        { signal },
      );
      const rec = net?.data?.[0];
      if (!rec) return { status: "ok", summary: "Not registered in PeeringDB" };

      return {
        status: "ok",
        summary: [rec.name, rec.info_type].filter(Boolean).join(", ") || "PeeringDB record",
        details: {
          networkClass: rec.info_type || undefined,
          peeringName: rec.name || undefined,
          trafficLevel: rec.info_traffic || undefined,
        },
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

Register in `lib/ti/registry.ts`: add `import { peeringDbSource } from "./sources/peeringdb";` beside the other imports, and add `peeringDbSource,` to the `sources` array (place it near `ripeStatSource`).

Confirm the `SourceMeta.category` value used above (`"context"`) matches the union in `lib/ti/types.ts`; if the codebase uses a different label for zero-weight context sources (e.g. the one on `ipApiSource`), copy that exact string instead.

- [ ] **Step 4: Run test + lint**

Run: `bun run test peeringdb` → PASS (3 tests).
Run: `bun run lint` → clean.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/sources/peeringdb.ts lib/ti/sources/peeringdb.test.ts lib/ti/registry.ts
git commit -m "feat(ti): PeeringDB network-class source"
```

---

### Task 4: Dossier types, helpers, and HOST CLASSIFICATION group

**Files:**
- Create: `lib/ti/ip-dossier.ts`
- Test: `lib/ti/ip-dossier.test.ts`

**Interfaces:**
- Produces:
  - `type DossierField = { label: string; value: string; hint?: string; mono?: boolean }`
  - `type DossierGroup = { id: string; title: string; fields: DossierField[] }`
  - `type IpDossier = { groups: DossierGroup[]; footer: string }`
  - `sparkline(values: number[]): string`
  - `findFinding(result, id): SourceResult | undefined`
  - `buildHostClassification(result): DossierGroup | null`
- Consumes: `CheckResult`, `SourceResult` (`@/lib/ti/types`), `cloudProvider` (`@/lib/ti/cloud`).

**Field selection for HOST CLASSIFICATION (self-hiding rows):**
- Assignment type — always, from geo flags (`isProxy` → "Anonymizing proxy / VPN"; `isMobile` → "Mobile network"; `isHosting` → "Hosting / Datacenter"; else "Residential / Business endpoint"; no geo → "Unknown").
- Recognized service — from `greynoise` finding `details.riot === true`, value `details.actor` (skip if no actor).
- Cloud infrastructure — `cloudProvider(geo.asn, geo.asnOrg)?.name` (skip if none).
- Anonymization — "Tor exit node" / "Tor relay" if `tor-project` finding `categories` includes `tor-exit`/`tor-relay`; else skip (do not print "None").
- Reverse DNS (PTR) — `geo.reverse` (+ " (FCrDNS verified)" when `geo.fcrdns?.verified`).

- [ ] **Step 1: Write the failing test**

```ts
// lib/ti/ip-dossier.test.ts
import { describe, it, expect } from "vitest";
import { buildHostClassification, sparkline } from "@/lib/ti/ip-dossier";
import type { CheckResult, SourceResult } from "@/lib/ti/types";

function mkResult(over: Partial<CheckResult> = {}): CheckResult {
  return {
    ip: "1.2.3.4",
    checkedAt: "2026-07-23T00:00:00Z",
    riskScore: 0,
    verdict: "clean",
    sources: [],
    stats: { total: 0, queried: 0, flagged: 0, skipped: 0, errored: 0, rateLimited: 0 },
    ...over,
  } as CheckResult;
}
const finding = (id: string, over: Partial<SourceResult>): SourceResult =>
  ({ source: { id, name: id, url: "", weight: 0, category: "context" }, status: "ok", enabled: true, durationMs: 1, ...over }) as unknown as SourceResult;

describe("sparkline", () => {
  it("maps 0-100 values to block glyphs", () => {
    expect(sparkline([0, 100])).toBe("▁█");
    expect(sparkline([])).toBe("");
  });
});

describe("buildHostClassification", () => {
  it("labels a hosting IP, adds cloud + RIOT + reverse DNS, hides absent rows", () => {
    const g = buildHostClassification(
      mkResult({
        geo: { isHosting: true, asn: "AS13335", asnOrg: "Cloudflare", reverse: "one.one.one.one", fcrdns: { verified: true } },
        sources: [finding("greynoise", { details: { riot: true, actor: "Cloudflare Public DNS" } })],
      }),
    );
    const labels = g!.fields.map((f) => f.label);
    expect(g!.title).toBe("Host classification");
    expect(g!.fields.find((f) => f.label === "Assignment type")?.value).toBe("Hosting / Datacenter");
    expect(g!.fields.find((f) => f.label === "Cloud infrastructure")?.value).toBe("Cloudflare");
    expect(g!.fields.find((f) => f.label === "Recognized service")?.value).toBe("Cloudflare Public DNS");
    expect(g!.fields.find((f) => f.label === "Reverse DNS (PTR)")?.value).toContain("one.one.one.one");
    expect(labels).not.toContain("Anonymization");
  });

  it("marks Tor and anonymizer flags", () => {
    const g = buildHostClassification(
      mkResult({
        geo: { isProxy: true },
        sources: [finding("tor-project", { categories: ["tor", "tor-exit"] })],
      }),
    );
    expect(g!.fields.find((f) => f.label === "Assignment type")?.value).toBe("Anonymizing proxy / VPN");
    expect(g!.fields.find((f) => f.label === "Anonymization")?.value).toBe("Tor exit node");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test ip-dossier`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

```ts
// lib/ti/ip-dossier.ts
import type { CheckResult, GeoContext, SourceResult } from "./types";
import { cloudProvider } from "./cloud";

export type DossierField = { label: string; value: string; hint?: string; mono?: boolean };
export type DossierGroup = { id: string; title: string; fields: DossierField[] };
export type IpDossier = { groups: DossierGroup[]; footer: string };

/** Find a settled source result by its registry id. */
export function findFinding(result: CheckResult, id: string): SourceResult | undefined {
  return result.sources.find((s) => s.source.id === id);
}

/** Compact unicode sparkline for 0-100 series (reputation trend). */
const BLOCKS = "▁▂▃▄▅▆▇█";
export function sparkline(values: number[]): string {
  return values
    .map((v) => BLOCKS[Math.max(0, Math.min(7, Math.round((v / 100) * 7)))])
    .join("");
}

function assignmentType(geo?: GeoContext): string {
  if (!geo) return "Unknown";
  if (geo.isProxy) return "Anonymizing proxy / VPN";
  if (geo.isMobile) return "Mobile network";
  if (geo.isHosting) return "Hosting / Datacenter";
  return "Residential / Business endpoint";
}

/** Drop empty fields; return null if a group has nothing worth showing. */
function group(id: string, title: string, fields: (DossierField | null)[]): DossierGroup | null {
  const kept = fields.filter((f): f is DossierField => f !== null && f.value !== "");
  return kept.length ? { id, title, fields: kept } : null;
}

export function buildHostClassification(result: CheckResult): DossierGroup | null {
  const geo = result.geo;
  const gn = findFinding(result, "greynoise");
  const riot = gn?.details?.riot === true ? (gn?.details?.actor as string | undefined) : undefined;
  const cloud = cloudProvider(geo?.asn, geo?.asnOrg);

  const tor = findFinding(result, "tor-project");
  const anon = tor?.categories?.includes("tor-exit")
    ? "Tor exit node"
    : tor?.categories?.includes("tor-relay")
      ? "Tor relay"
      : "";

  const ptr = geo?.reverse
    ? geo.fcrdns?.verified
      ? `${geo.reverse} (FCrDNS verified)`
      : geo.reverse
    : "";

  return group("classification", "Host classification", [
    { label: "Assignment type", value: assignmentType(geo) },
    riot ? { label: "Recognized service", value: riot } : null,
    cloud ? { label: "Cloud infrastructure", value: cloud.name } : null,
    anon ? { label: "Anonymization", value: anon } : null,
    ptr ? { label: "Reverse DNS (PTR)", value: ptr, mono: true } : null,
  ]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test ip-dossier`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/ip-dossier.ts lib/ti/ip-dossier.test.ts
git commit -m "feat(ti): IP dossier types + host-classification group"
```

---

### Task 5: EXPOSED SERVICES and NETWORK PROVENANCE groups

**Files:**
- Modify: `lib/ti/ip-dossier.ts`
- Test: `lib/ti/ip-dossier.test.ts` (append)

**Interfaces:**
- Consumes: `shodanHostInfo`, `PORT_SERVICE` (`@/lib/ti/shodan`); `cpeLabel` (`@/lib/cpe`).
- Produces: `buildExposedServices(result): DossierGroup | null`; `buildNetworkProvenance(result): DossierGroup | null`.

**EXPOSED SERVICES rows:** Open ports (`"22 SSH, 80 HTTP, 443 HTTPS"` via `PORT_SERVICE`), Detected software (deduped `cpeLabel` names+versions, comma-joined), Known vulnerabilities (`"2 (CVE-…, CVE-…)"`, first 6), Infrastructure tags (shodan `details.tags`), Associated hostnames (shodan hostnames, first 4).

**NETWORK PROVENANCE rows:** Autonomous system (`AS… Org`), Network class (peeringdb `networkClass` [+ `, trafficLevel`]), Internet provider (`geo.isp`), Organization (`geo.org`, only if ≠ isp and ≠ asnOrg), Allocation (rdap `networkName` [+ `, range`]), Announced prefix (ripestat `prefix` [+ `, RPKI <status>`]), Abuse contact (rdap `abuseContact` [+ `, abuseOrg`]), Regional registry (rdap `allocationCountry` → `registry`? use `networkName` country; show `allocationCountry`).

- [ ] **Step 1: Write the failing test (append)**

```ts
import { buildExposedServices, buildNetworkProvenance } from "@/lib/ti/ip-dossier";

describe("buildExposedServices", () => {
  it("summarizes ports, software, CVEs; hides when Shodan has nothing", () => {
    const g = buildExposedServices(
      mkResult({
        sources: [finding("shodan-internetdb", {
          details: { ports: [22, 443], cpes: ["cpe:/a:openbsd:openssh:10.0"], vulns: ["CVE-2024-6387"], tags: ["cloud"], hostnames: ["h.example"] },
        })],
      }),
    );
    expect(g!.title).toBe("Exposed services");
    expect(g!.fields.find((f) => f.label === "Open ports")?.value).toBe("22 SSH, 443 HTTPS");
    expect(g!.fields.find((f) => f.label === "Known vulnerabilities")?.value).toContain("CVE-2024-6387");
    expect(g!.fields.find((f) => f.label === "Infrastructure tags")?.value).toBe("cloud");
    expect(buildExposedServices(mkResult())).toBeNull();
  });
});

describe("buildNetworkProvenance", () => {
  it("assembles ASN, class, allocation, prefix, abuse", () => {
    const g = buildNetworkProvenance(
      mkResult({
        geo: { asn: "AS49447", asnOrg: "Nice IT Services Group", isp: "Nice IT Services Group Inc." },
        sources: [
          finding("peeringdb", { details: { networkClass: "NSP", trafficLevel: "1-5Gbps" } }),
          finding("rdap-ip", { details: { networkName: "NICEIT-NL", range: "45.9.148.0 – 45.9.148.255", abuseContact: "abuse@niceit.nl", allocationCountry: "NL" } }),
          finding("ripestat", { details: { prefix: "45.9.148.0/24", rpkiStatus: "valid" } }),
        ],
      }),
    );
    expect(g!.fields.find((f) => f.label === "Autonomous system")?.value).toBe("AS49447 Nice IT Services Group");
    expect(g!.fields.find((f) => f.label === "Network class")?.value).toBe("NSP, 1-5Gbps");
    expect(g!.fields.find((f) => f.label === "Announced prefix")?.value).toBe("45.9.148.0/24, RPKI valid");
    expect(g!.fields.find((f) => f.label === "Abuse contact")?.value).toContain("abuse@niceit.nl");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run test ip-dossier`
Expected: FAIL — `buildExposedServices` / `buildNetworkProvenance` not exported.

- [ ] **Step 3: Implement (append to `lib/ti/ip-dossier.ts`)**

```ts
import { shodanHostInfo, PORT_SERVICE } from "./shodan";
import { cpeLabel } from "@/lib/cpe";

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

export function buildExposedServices(result: CheckResult): DossierGroup | null {
  const { ports, vulns, cpes, hostnames } = shodanHostInfo(result.sources);
  const shodan = findFinding(result, "shodan-internetdb");
  const tags = strArr(shodan?.details?.tags);

  const portList = [...ports]
    .sort((a, b) => a - b)
    .map((p) => (PORT_SERVICE[p] ? `${p} ${PORT_SERVICE[p]}` : String(p)))
    .join(", ");

  const techs = Array.from(
    new Map(cpes.map((c) => cpeLabel(c)).map((t) => [`${t.name} ${t.version ?? ""}`, t])).values(),
  ).map((t) => (t.version ? `${t.name} ${t.version}` : t.name));

  const cveList = vulns.slice(0, 6).join(", ");

  return group("exposed", "Exposed services", [
    portList ? { label: "Open ports", value: portList, mono: true } : null,
    techs.length ? { label: "Detected software", value: techs.join(", ") } : null,
    vulns.length ? { label: "Known vulnerabilities", value: `${vulns.length} (${cveList}${vulns.length > 6 ? ", …" : ""})`, mono: true } : null,
    tags.length ? { label: "Infrastructure tags", value: tags.join(", ") } : null,
    hostnames.length ? { label: "Associated hostnames", value: hostnames.slice(0, 4).join(", "), mono: true } : null,
  ]);
}

export function buildNetworkProvenance(result: CheckResult): DossierGroup | null {
  const geo = result.geo;
  const pdb = findFinding(result, "peeringdb")?.details;
  const rdap = findFinding(result, "rdap-ip")?.details;
  const ripe = findFinding(result, "ripestat")?.details;

  const asn = geo?.asn
    ? `${geo.asn}${geo.asnOrg ? ` ${geo.asnOrg}` : ""}`
    : "";
  const netClass = str(pdb?.networkClass)
    ? `${str(pdb?.networkClass)}${str(pdb?.trafficLevel) ? `, ${str(pdb?.trafficLevel)}` : ""}`
    : "";
  const org = geo?.org && geo.org !== geo.isp && geo.org !== geo.asnOrg ? geo.org : "";
  const allocation = str(rdap?.networkName)
    ? `${str(rdap?.networkName)}${str(rdap?.range) ? `, ${str(rdap?.range)}` : ""}`
    : "";
  const prefix = str(ripe?.prefix)
    ? `${str(ripe?.prefix)}${str(ripe?.rpkiStatus) ? `, RPKI ${str(ripe?.rpkiStatus)}` : ""}`
    : "";
  const abuse = str(rdap?.abuseContact)
    ? `${str(rdap?.abuseContact)}${str(rdap?.abuseOrg) ? `, ${str(rdap?.abuseOrg)}` : ""}`
    : "";

  return group("provenance", "Network provenance", [
    asn ? { label: "Autonomous system", value: asn, mono: true } : null,
    netClass ? { label: "Network class", value: netClass } : null,
    geo?.isp ? { label: "Internet provider", value: geo.isp } : null,
    org ? { label: "Organization", value: org } : null,
    allocation ? { label: "Allocation", value: allocation, mono: true } : null,
    prefix ? { label: "Announced prefix", value: prefix, mono: true } : null,
    abuse ? { label: "Abuse contact", value: abuse, mono: true } : null,
    str(rdap?.allocationCountry) ? { label: "Regional registry", value: str(rdap?.allocationCountry)! } : null,
  ]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test ip-dossier`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/ti/ip-dossier.ts lib/ti/ip-dossier.test.ts
git commit -m "feat(ti): dossier exposed-services + network-provenance groups"
```

---

### Task 6: THREAT ACTIVITY, RELATIONSHIPS, and assembly

**Files:**
- Modify: `lib/ti/ip-dossier.ts`
- Test: `lib/ti/ip-dossier.test.ts` (append)

**Interfaces:**
- Consumes: `relationsFor` (`@/lib/relations`).
- Produces: `buildThreatActivity(result): DossierGroup | null`; `buildRelationships(result): DossierGroup | null`; `buildIpDossier(result): IpDossier`.

**THREAT ACTIVITY rows (whole group null when none present):** Observed activity (greynoise `details.classification === "malicious"` or categories include `internet-scanner` → summary/categories), Malware association (threatfox `categories` joined, first 3), Command and control (feodo `details.malware` → `"<malware> botnet C2"` when the finding is `malicious`), Blocklist listings (which of `dnsbl`/`blocklist-de`/`ipsum`/`spamhaus-drop`/`et-open` have `malicious === true`, by name), Reputation history (only if `history.length >= 2`: `"Since <date> <sparkline> <trend>"`).

**RELATIONSHIPS rows (summary only; null when all zero):** Hosted domains (`reverse-ip` `details.domainCount` + first example), Passive DNS (`result.passiveDns?.length` resolutions), Related indicators (`relationsFor(result).related.length` linked IOCs).

- [ ] **Step 1: Write the failing test (append)**

```ts
import { buildThreatActivity, buildRelationships, buildIpDossier } from "@/lib/ti/ip-dossier";

describe("buildThreatActivity", () => {
  it("is null for a clean IP with no signals", () => {
    expect(buildThreatActivity(mkResult())).toBeNull();
  });

  it("reports scanning, C2, blocklists and reputation trend", () => {
    const g = buildThreatActivity(
      mkResult({
        history: [
          { checkedAt: "2025-11-03T00:00:00Z", riskScore: 20, verdict: "low" },
          { checkedAt: "2026-07-20T00:00:00Z", riskScore: 90, verdict: "malicious" },
        ],
        sources: [
          finding("greynoise", { malicious: true, categories: ["internet-scanner", "malicious"], summary: "malicious (active scanner)" }),
          finding("feodo", { malicious: true, details: { malware: "Emotet" } }),
          finding("ipsum", { malicious: true, source: { id: "ipsum", name: "IPsum", url: "", weight: 1, category: "reputation" } as never }),
        ],
      }),
    );
    expect(g!.title).toBe("Threat activity");
    expect(g!.fields.find((f) => f.label === "Command and control")?.value).toContain("Emotet");
    expect(g!.fields.find((f) => f.label === "Blocklist listings")?.value).toContain("IPsum");
    expect(g!.fields.find((f) => f.label === "Reputation history")?.value).toMatch(/Since 2025-11-03/);
  });
});

describe("buildRelationships", () => {
  it("summarizes hosted domains and passive DNS, null when empty", () => {
    const g = buildRelationships(
      mkResult({
        passiveDns: [{ domain: "a.example", firstSeen: "", lastSeen: "" }] as never,
        sources: [finding("reverse-ip", { details: { domainCount: 3, domains: ["admin-panel.taxwiseup.com"] } })],
      }),
    );
    expect(g!.fields.find((f) => f.label === "Hosted domains")?.value).toContain("3");
    expect(g!.fields.find((f) => f.label === "Passive DNS")?.value).toContain("1");
    expect(buildRelationships(mkResult())).toBeNull();
  });
});

describe("buildIpDossier", () => {
  it("returns ordered groups and a provenance footer", () => {
    const d = buildIpDossier(
      mkResult({ geo: { isHosting: true, asn: "AS13335", isp: "Cloudflare" }, checkedAt: "2026-07-23T14:12:00Z" }),
    );
    expect(d.groups[0].id).toBe("classification");
    expect(d.groups.map((g) => g.id)).not.toContain("threat"); // clean → hidden
    expect(d.footer).toMatch(/checked/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run test ip-dossier`
Expected: FAIL — new functions not exported.

- [ ] **Step 3: Implement (append to `lib/ti/ip-dossier.ts`)**

```ts
import { relationsFor } from "@/lib/relations";

const BLOCKLIST_IDS: [string, string][] = [
  ["dnsbl", "DNS blocklists"],
  ["blocklist-de", "blocklist.de"],
  ["ipsum", "IPsum"],
  ["spamhaus-drop", "Spamhaus DROP"],
  ["et-open", "ET Open"],
];

function isoDate(s: string): string {
  return s.slice(0, 10);
}

export function buildThreatActivity(result: CheckResult): DossierGroup | null {
  const gn = findFinding(result, "greynoise");
  const scanning =
    gn?.malicious === true || gn?.categories?.includes("internet-scanner")
      ? gn?.summary || gn?.categories?.join(", ") || "Observed scanning"
      : "";

  const tf = findFinding(result, "threatfox");
  const malware = tf?.categories?.length ? tf.categories.slice(0, 3).join(", ") : "";

  const feodo = findFinding(result, "feodo");
  const c2 =
    feodo?.malicious === true
      ? `${str(feodo.details?.malware) ?? "Botnet"} C2`
      : "";

  const listed = BLOCKLIST_IDS.filter(([id]) => findFinding(result, id)?.malicious === true).map(
    ([, name]) => name,
  );

  const history = result.history ?? [];
  const rep =
    history.length >= 2
      ? `Since ${isoDate(history[0].checkedAt)} ${sparkline(history.map((h) => h.riskScore))} ${
          history[history.length - 1].riskScore > history[0].riskScore ? "rising" : "stable/declining"
        }`
      : "";

  return group("threat", "Threat activity", [
    scanning ? { label: "Observed activity", value: scanning } : null,
    malware ? { label: "Malware association", value: malware } : null,
    c2 ? { label: "Command and control", value: c2 } : null,
    listed.length ? { label: "Blocklist listings", value: listed.join(", ") } : null,
    rep ? { label: "Reputation history", value: rep, mono: true } : null,
  ]);
}

export function buildRelationships(result: CheckResult): DossierGroup | null {
  const rev = findFinding(result, "reverse-ip")?.details;
  const domainCount = typeof rev?.domainCount === "number" ? rev.domainCount : 0;
  const example = strArr(rev?.domains)[0];
  const pdnsCount = result.passiveDns?.length ?? 0;
  const related = relationsFor(result).related.length;

  return group("relationships", "Relationships", [
    domainCount
      ? { label: "Hosted domains", value: `${domainCount} domain${domainCount === 1 ? "" : "s"}${example ? `, e.g. ${example}` : ""}` }
      : null,
    pdnsCount ? { label: "Passive DNS", value: `${pdnsCount} historical resolution${pdnsCount === 1 ? "" : "s"}` } : null,
    related ? { label: "Related indicators", value: `${related} linked IOC${related === 1 ? "" : "s"}` } : null,
  ]);
}

export function buildIpDossier(result: CheckResult): IpDossier {
  const groups = [
    buildHostClassification(result),
    buildExposedServices(result),
    buildThreatActivity(result),
    buildRelationships(result),
    buildNetworkProvenance(result),
  ].filter((g): g is DossierGroup => g !== null);

  const responded = result.sources.filter((s) => s.status === "ok").length;
  const footer = `Enriched from ${responded} source${responded === 1 ? "" : "s"}, checked ${new Date(result.checkedAt).toLocaleString()}`;

  return { groups, footer };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test ip-dossier`
Expected: PASS (all cases). Then `bun run test` (full) → still green.

- [ ] **Step 5: Commit**

```bash
git add lib/ti/ip-dossier.ts lib/ti/ip-dossier.test.ts
git commit -m "feat(ti): dossier threat-activity, relationships, assembly"
```

---

### Task 7: IpDossierCard component

**Files:**
- Create: `components/CheckResults/dossier.tsx`
- Modify: `components/CheckResults/profile.tsx` (export `GridItem`, `Rule`)

**Interfaces:**
- Consumes: `buildIpDossier` (`@/lib/ti/ip-dossier`), `flagUrl` + `joinPlace` from `./classify`/existing helpers, `SectionHeading` (`./primitives`), `VotingCard` (`./voting`), `GridItem` + `Rule` (`./profile`).
- Produces: `export function IpDossierCard({ result }: { result: CheckResult })`.

**Verify before writing:** open `components/CheckResults/profile.tsx` and add `export` to the `GridItem` and `Rule` declarations (currently local). Confirm `joinPlace` / `flagUrl` import paths used by `ProfileCard` and reuse the same ones. Confirm `GridItem`'s prop shape (`label`, `hint?`, `children`).

- [ ] **Step 1: Add exports in `profile.tsx`**

Change `function Rule() {` → `export function Rule() {` and `function GridItem({` → `export function GridItem({`.

- [ ] **Step 2: Write the component**

```tsx
// components/CheckResults/dossier.tsx
"use client";

import { Fingerprint } from "lucide-react";
import type { CheckResult } from "@/lib/ti/types";
import { buildIpDossier } from "@/lib/ti/ip-dossier";
import { flagUrl } from "./classify";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeading } from "./primitives";
import { GridItem, Rule } from "./profile";
import { VotingCard } from "./voting";

const SUBLABEL =
  "font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase";

export function IpDossierCard({ result }: { result: CheckResult }) {
  const dossier = buildIpDossier(result);
  const geo = result.geo;
  const flag = flagUrl(geo?.countryCode);
  const place = [geo?.city, geo?.region].filter(Boolean).join(", ");

  return (
    <Card className="sketch-shadow rounded-lg border border-foreground/12">
      <CardContent className="space-y-5">
        <SectionHeading icon={Fingerprint}>IP dossier</SectionHeading>

        {/* Identity line: flag, country, city. No verdict repeat (VerdictHero owns it). */}
        {geo?.country && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {flag && (
              // eslint-disable-next-line @next/next/no-img-element -- tiny flag asset
              <img src={flag} alt={geo.country} width={64} height={48} loading="lazy"
                className="mr-1 h-6 w-auto shrink-0 rounded-sm border border-foreground/20 object-cover" />
            )}
            <span className="text-base font-semibold leading-tight">{geo.country}</span>
            {geo.countryCode && (
              <span className="font-mono text-xs text-muted-foreground">{geo.countryCode}</span>
            )}
            {place && (
              <>
                <span className="text-muted-foreground/50">·</span>
                <span className="text-sm text-muted-foreground">{place}</span>
              </>
            )}
          </div>
        )}

        {dossier.groups.map((g) => (
          <div key={g.id} className="space-y-3">
            <Rule />
            <div className={SUBLABEL}>{g.title}</div>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-0.5 sm:grid-cols-2">
              {g.fields.map((f) => (
                <GridItem key={f.label} label={f.label} hint={f.hint}>
                  <span className={cn(f.mono && "font-mono text-[13px]")}>{f.value}</span>
                </GridItem>
              ))}
            </dl>
          </div>
        ))}

        <p className="font-mono text-[11px] text-muted-foreground">{dossier.footer}</p>

        {result.geoResolution && <VotingCard res={result.geoResolution} />}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Type-check / lint**

Run: `bun run lint`
Expected: no errors in `dossier.tsx` / `profile.tsx`. (Fix any prop-shape mismatch surfaced against the real `GridItem` signature.)

- [ ] **Step 4: Commit**

```bash
git add components/CheckResults/dossier.tsx components/CheckResults/profile.tsx
git commit -m "feat(ui): IpDossierCard rendering the consolidated dossier"
```

---

### Task 8: Wire dossier into the IP layout, retire old cards

**Files:**
- Modify: `components/CheckResults/index.tsx`
- Modify: `components/CheckResults/profile.tsx` (remove `ProfileCard`)
- Modify: `components/CheckResults/connections.tsx` (remove `ExposedServicesCard`)

- [ ] **Step 1: Swap the IP layout sections**

In `index.tsx`, replace the two IP sections:

```tsx
<Section id="origin"><ProfileCard result={result} /></Section>
<Section id="exposed"><ExposedServicesCard result={result} /></Section>
```

with a single dossier section:

```tsx
<Section id="dossier"><IpDossierCard result={result} /></Section>
```

Add `import { IpDossierCard } from "./dossier";`. Remove `ProfileCard` from the `./profile` import and `ExposedServicesCard` from the `./connections` import. Update `IP_SECTIONS`: replace the `origin` and `exposed` entries with a single `{ id: "dossier", label: "Dossier" }` (keep `dns`, `related`, `research`, `sources`).

- [ ] **Step 2: Delete the now-unused cards**

Remove `export function ProfileCard(...)` from `profile.tsx` and `export function ExposedServicesCard(...)` from `connections.tsx`, plus any imports that become unused (e.g. `Globe`, `Server`, `SUBLABEL`, `CVE_PREVIEW` if no longer referenced). Keep `DomainProfileCard`, `HashProfileCard`, `ConnectionsCard`, `DistributionUrlsCard`, and all exported helpers.

- [ ] **Step 3: Full verification**

Run: `bun run test` → all green.
Run: `bun run lint` → no new errors (unused-import check confirms the deletions are clean).

- [ ] **Step 4: Visual check**

Start dev server if not running, then screenshot a known-bad and a known-clean IP:

```bash
# malicious (rich) and clean (business service)
node scripts/shot.mjs   # or the ad-hoc /check/<ip> screenshot script
```

Confirm: dossier renders 4–5 grouped sections; THREAT ACTIVITY absent on the clean IP; no verdict/score duplicated from VerdictHero; commas not dashes; absent rows hidden. If UI cannot be verified, say so explicitly.

- [ ] **Step 5: Commit**

```bash
git add components/CheckResults/index.tsx components/CheckResults/profile.tsx components/CheckResults/connections.tsx
git commit -m "feat(ui): consolidate IP Origin + Exposed into the IP dossier"
```

---

## Self-Review

**Spec coverage:**
- 5 groups → Tasks 4 (classification), 5 (exposed, provenance), 6 (threat, relationships, assembly). ✓
- PeeringDB network class → Task 3; consumed in Task 5. ✓
- Cloud provider map → Task 1; consumed in Task 4. ✓
- Recognized service (RIOT), anonymization, reverse DNS → Task 4. ✓
- Reputation history sparkline (`result.history`) → Task 6. ✓
- Relationships summary (no card duplication) → Task 6; detail cards kept in Task 8. ✓
- Provenance footer, no verdict repeat → Task 6 footer + Task 7 header comment. ✓
- Replace Origin + Exposed, keep DNS/Related/Research/Sources → Task 8. ✓
- Self-hiding rows/groups → `group()` helper (Task 4), asserted in every builder test. ✓

**Placeholder scan:** No "TBD/TODO". Two explicit "verify against the real signature" notes (Task 3 `category` union, Task 7 `GridItem` props) are guardrails against drift, not deferred work — each has a concrete fallback action.

**Type consistency:** `DossierField/DossierGroup/IpDossier`, `findFinding`, `sparkline`, `buildHostClassification/buildExposedServices/buildNetworkProvenance/buildThreatActivity/buildRelationships/buildIpDossier` names are used identically across tasks. `shodanHostInfo(sources)` signature is consistent between Task 2 (definition) and Task 5 (consumption). `cloudProvider(asn, org)` consistent between Tasks 1 and 4.

**Open risks to confirm during implementation (each has a fallback in-task):**
1. `SourceMeta.category` union values — Task 3 says copy the exact context label from `ipApiSource`.
2. `GridItem` real prop shape — Task 7 Step verifies before writing.
3. RIPE `prefix-overview` `asns` element shape (string vs `{asn}`) — Task 3 `resolveAsn` handles both.
