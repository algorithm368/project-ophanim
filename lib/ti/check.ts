import type { CheckResult, SourceResult } from "./types";
import { sources } from "./registry";
import { runAll } from "./orchestrate";
import { assembleIpResult } from "./assemble";

export async function checkIp(
  ip: string,
  onSettled?: (result: SourceResult) => void,
): Promise<CheckResult> {
  const results = await runAll(sources, ip, onSettled);
  return assembleIpResult(ip, results, new Date().toISOString());
}
