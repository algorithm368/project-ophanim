import type { HashCheckResult, SourceResult } from "../types";
import type { HashAlgorithm } from "@/lib/hash";
import { hashSources } from "./registry";
import { runAll } from "../orchestrate";
import { assembleHashResult } from "../assemble";

export async function checkHash(
  hash: string,
  algorithm: HashAlgorithm,
  onSettled?: (result: SourceResult) => void,
): Promise<HashCheckResult> {
  const results = await runAll(hashSources, hash, onSettled);
  return assembleHashResult(hash, algorithm, results, new Date().toISOString());
}
