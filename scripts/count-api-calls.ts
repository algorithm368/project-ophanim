/**
 * Count the outbound calls one search makes, per source.
 *
 *   bun --env-file=.env.local scripts/count-api-calls.ts [ip] [domain] [sha256]
 *
 * Wraps fetch and node:dns, then runs every registered source on its own, one
 * at a time, so each call is attributed to the source that made it. Each
 * indicator is run twice: the first pass is a cold instance, the second shows
 * what feed caches save on a warm one. A final pass runs the sources together,
 * the way a real search does, so requests shared within a search
 * (lib/ti/request-memo.ts) are counted once.
 */
import dns from "node:dns/promises";
import { sources } from "@/lib/ti/registry";
import { domainSources } from "@/lib/ti/domain/registry";
import { hashSources } from "@/lib/ti/hash/registry";
import { runAll, runSource } from "@/lib/ti/orchestrate";
import { supportsFamily } from "@/lib/ti/check";
import { supportsAlgorithm } from "@/lib/ti/hash/check";
import type { TiSource } from "@/lib/ti/types";

let httpCalls = 0;
let dnsCalls = 0;
const hosts = new Set<string>();

const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  httpCalls++;
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  try {
    hosts.add(new URL(url).host);
  } catch {}
  return realFetch(input, init);
}) as typeof fetch;

const DNS_METHODS = ["resolve", "resolve4", "resolve6", "resolveTxt", "resolveMx", "resolveNs",
  "resolveCname", "resolveSoa", "resolveCaa", "resolveAny", "reverse", "lookup"] as const;
function wrapDns(target: Record<string, unknown>) {
  for (const m of DNS_METHODS) {
    const orig = target[m];
    if (typeof orig !== "function") continue;
    target[m] = function (this: unknown, ...args: unknown[]) {
      dnsCalls++;
      hosts.add("dns");
      return (orig as (...a: unknown[]) => unknown).apply(this, args);
    };
  }
}
wrapDns(dns as unknown as Record<string, unknown>);
wrapDns(dns.Resolver.prototype as unknown as Record<string, unknown>);

interface Row { id: string; status: string; http: number; dns: number; hosts: string }

async function measure(list: TiSource[], indicator: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (const source of list) {
    httpCalls = 0;
    dnsCalls = 0;
    hosts.clear();
    const r = await runSource(source, indicator);
    rows.push({
      id: source.meta.id,
      status: r.status,
      http: httpCalls,
      dns: dnsCalls,
      hosts: [...hosts].join(" "),
    });
  }
  return rows;
}

function report(label: string, cold: Row[], warm: Row[]) {
  console.log(`\n=== ${label}`);
  console.log("source".padEnd(22), "status".padEnd(9), "http", "dns ", "warm(h/d)", "hosts");
  for (const [i, r] of cold.entries()) {
    const w = warm[i];
    console.log(
      r.id.padEnd(22), r.status.padEnd(9), String(r.http).padStart(4), String(r.dns).padStart(4),
      `   ${w.http}/${w.dns}`.padEnd(10), r.hosts,
    );
  }
  const sum = (rows: Row[]) => rows.reduce((a, r) => [a[0] + r.http, a[1] + r.dns], [0, 0]);
  const [ch, cd] = sum(cold);
  const [wh, wd] = sum(warm);
  const ran = cold.filter((r) => r.status !== "skipped").length;
  console.log(`sources ran ${ran}/${cold.length} | cold: ${ch} http + ${cd} dns = ${ch + cd} | warm: ${wh} http + ${wd} dns = ${wh + wd}`);
}

const [ip = "8.8.8.8", domain = "example.com",
  hash = "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f"] = process.argv.slice(2);

const ipList = sources.filter((s) => supportsFamily(s, 4));
const hashList = hashSources.filter((s) => supportsAlgorithm(s, "sha256"));

for (const [label, list, ioc] of [
  [`IP ${ip}`, ipList, ip],
  [`Domain ${domain}`, domainSources, domain],
  [`Hash ${hash.slice(0, 12)}…`, hashList, hash],
] as const) {
  const cold = await measure([...list], ioc);
  const warm = await measure([...list], ioc);
  report(label, cold, warm);
  httpCalls = 0;
  dnsCalls = 0;
  await runAll([...list], ioc);
  console.log(`whole search (warm, shared): ${httpCalls} http + ${dnsCalls} dns = ${httpCalls + dnsCalls}`);
}
