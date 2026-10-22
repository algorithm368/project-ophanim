import type { CheckResult, SourceResult, TiSource } from "./types";
import { parseIP } from "@/lib/ip";
import { sources } from "./registry";
import { runAll } from "./orchestrate";
import { withRequestMemo } from "./request-memo";
import { assembleIpResult } from "./assemble";

/** Whether a source can answer for this IP family. Unset means IPv4 only. */
export function supportsFamily(source: TiSource, family: 4 | 6): boolean {
  return (source.meta.families ?? [4]).includes(family);
}

export async function checkIp(
  ip: string,
  onSettled?: (result: SourceResult) => void,
): Promise<CheckResult> {
  const family = parseIP(ip)?.version ?? 4;

  const supported: TiSource[] = [];
  const unsupported: TiSource[] = [];
  for (const source of sources) {
    (supportsFamily(source, family) ? supported : unsupported).push(source);
  }

  // Sources that cannot answer for this family are reported as skipped rather
  // than dropped, so they stay visible in the UI the way key-gated ones do and
  // stats.skipped keeps counting them. They cost no network request.
  const skipped: SourceResult[] = unsupported.map((source) => ({
    source: source.meta,
    enabled: true,
    status: "skipped",
    summary: `Does not support IPv${family}`,
    durationMs: 0,
  }));
  for (const result of skipped) onSettled?.(result);

  const ran = await withRequestMemo(() => runAll(supported, ip, onSettled));

  // Restore registry order so display order does not depend on which sources
  // happened to be skipped.
  const byId = new Map(
    [...ran, ...skipped].map((result) => [result.source.id, result]),
  );
  const results = sources
    .map((source) => byId.get(source.meta.id))
    .filter((result): result is SourceResult => result !== undefined);

  return assembleIpResult(ip, results, new Date().toISOString());
}
