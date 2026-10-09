import type { HashCheckResult, SourceMeta, SourceResult, TiSource } from "../types";
import { HASH_ALGO_LABEL, type HashAlgorithm } from "@/lib/hash";
import { hashSources } from "./registry";
import { runAll } from "../orchestrate";
import { withRequestMemo } from "../request-memo";
import { recordSpend } from "../bulk/quota";
import { assembleHashResult } from "../assemble";
import { resolveFamily } from "./family";
import { fetchFamilyDescription } from "./sources/malpedia";

/**
 * Post-aggregation family enrichment. Sources run in parallel and can't see each
 * other, so the family is resolved from the merged context here, then described
 * via Malpedia. Server-only (Malpedia is a network call); the streamed
 * per-source view uses the pure assembler and simply lacks this until the final
 * result. Degrades silently: on any miss the family name still shows.
 */
async function enrichFamily(result: HashCheckResult): Promise<HashCheckResult> {
  const ctx = result.context;
  if (!ctx) return result;
  const family = resolveFamily(ctx);
  if (!family) return result;

  let info: { description?: string; refs?: string[] } | undefined;
  try {
    info = await fetchFamilyDescription(family, AbortSignal.timeout(8000));
  } catch {
    info = undefined;
  }

  return {
    ...result,
    context: {
      ...ctx,
      malwareFamily: ctx.malwareFamily ?? family,
      familyDescription: info?.description,
      familyRefs: info?.refs,
    },
  };
}

/** Whether a source can answer for this hash algorithm. Unset means all three. */
export function supportsAlgorithm(
  source: TiSource,
  algorithm: HashAlgorithm,
): boolean {
  return (source.meta.algorithms ?? ["md5", "sha1", "sha256"]).includes(
    algorithm,
  );
}

/** Why a source sat out. One that takes a single algorithm says which, and
 *  what to paste instead, which is the more useful of the two. */
export function skipSummary(meta: SourceMeta, algorithm: HashAlgorithm): string {
  const only = meta.algorithms?.length === 1 ? HASH_ALGO_LABEL[meta.algorithms[0]] : null;
  return only
    ? `${only} only, paste a ${only} hash to query ${meta.name}`
    : `Does not support ${HASH_ALGO_LABEL[algorithm]}`;
}

export async function checkHash(
  hash: string,
  algorithm: HashAlgorithm,
  onSettled?: (result: SourceResult) => void,
): Promise<HashCheckResult> {
  const supported: TiSource[] = [];
  const unsupported: TiSource[] = [];
  for (const source of hashSources) {
    (supportsAlgorithm(source, algorithm) ? supported : unsupported).push(source);
  }

  // Same treatment checkIp() gives an IP family it cannot answer for: reported
  // as skipped with `enabled: true`, so it reads as "does not take this
  // question" rather than as a failure, and costs no request. ThreatFox used to
  // round-trip a 4xx to discover we should not have asked.
  const skipped: SourceResult[] = unsupported.map((source) => ({
    source: source.meta,
    enabled: true,
    status: "skipped",
    summary: skipSummary(source.meta, algorithm),
    durationMs: 0,
  }));
  for (const result of skipped) onSettled?.(result);

  const ran = await withRequestMemo(() => runAll(supported, hash, onSettled));

  // Restore registry order so display order does not depend on which sources
  // happened to be skipped.
  const byId = new Map(
    [...ran, ...skipped].map((result) => [result.source.id, result]),
  );
  const results = hashSources
    .map((source) => byId.get(source.meta.id))
    .filter((result): result is SourceResult => result !== undefined);

  // Bulk lookup budgets each metered key against what /check already spent
  // today. Fire and forget: the ledger must never slow or fail a lookup.
  void recordSpend(results);

  const result = assembleHashResult(
    hash,
    algorithm,
    results,
    new Date().toISOString(),
  );
  return enrichFamily(result);
}
