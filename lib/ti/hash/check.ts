import type { HashCheckResult, SourceResult } from "../types";
import type { HashAlgorithm } from "@/lib/hash";
import { hashSources } from "./registry";
import { runAll } from "../orchestrate";
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

export async function checkHash(
  hash: string,
  algorithm: HashAlgorithm,
  onSettled?: (result: SourceResult) => void,
): Promise<HashCheckResult> {
  const results = await runAll(hashSources, hash, onSettled);
  const result = assembleHashResult(
    hash,
    algorithm,
    results,
    new Date().toISOString(),
  );
  return enrichFamily(result);
}
