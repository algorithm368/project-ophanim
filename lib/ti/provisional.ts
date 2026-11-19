import { parseHash } from "@/lib/hash";
import type { LookupType } from "@/lib/ioc";
import { assembleDomainResult, assembleHashResult, assembleIpResult } from "./assemble";
import type { AnyCheckResult, SourceResult } from "./types";

/**
 * The page's result while the panel is still answering: the real result,
 * assembled from whichever sources have landed so far.
 *
 * This is what lets the pending page be the finished page with gaps in it
 * rather than a separate placeholder. `assemble.ts` is the same builder the
 * server runs once everyone is in, so a field shown early is the field the
 * finished page will show, unless a later source changes it.
 *
 * Its verdict, score and confidence are *not* safe to show: they are computed
 * over a partial panel. The tiles withhold them while `LiveContext.pending` is
 * set, which is the same line `PartialLookup` draws by having no score at all.
 *
 * A hash's algorithm comes from its length. An indicator the hash parser does
 * not accept is still drawn, as SHA-256, since the route will refuse it before
 * anything here is shown for long.
 */
export function provisionalResult(
  kind: LookupType,
  indicator: string,
  sources: SourceResult[],
  checkedAt: string,
): AnyCheckResult {
  if (kind === "hash") {
    const parsed = parseHash(indicator);
    return assembleHashResult(
      parsed?.hash ?? indicator,
      parsed?.algorithm ?? "sha256",
      sources,
      checkedAt,
    );
  }
  if (kind === "domain") return assembleDomainResult(indicator, sources, checkedAt);
  return assembleIpResult(indicator, sources, checkedAt);
}
