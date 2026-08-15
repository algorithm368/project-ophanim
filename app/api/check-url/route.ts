import { parseUrl } from "@/lib/url";
import { checkUrl } from "@/lib/ti/url/check";
import { urlSources } from "@/lib/ti/url/registry";
import { urlIndicatorProblem } from "@/lib/ti/url/validate";
import { domainSources } from "@/lib/ti/domain/registry";
import { sources as ipSources } from "@/lib/ti/registry";
import { getCachedUrlResult, setCachedUrlResult } from "@/lib/ti/cache";
import { makeIndicatorRoute, type Validated } from "@/lib/ti/route-handler";
import type { UrlCheckResult } from "@/lib/ti/url/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every source that can appear in the stream, across all three layers. The
 * `start` event sizes the progress bar from this, so counting only the URL
 * registry would show four sources while forty rows arrived. Layers served from
 * cache, and sources gated by key or IP family, simply never settle against it,
 * which is the same optimistic accounting the family gating already uses.
 */
const ALL_LAYER_SOURCES = [...urlSources, ...domainSources, ...ipSources];

/** Validate the URL up front, returning the canonical form or an error Response. */
function validateUrl(raw: string | null): Validated<string> {
  if (!raw) {
    return {
      error: Response.json({ error: "Missing 'url' parameter" }, { status: 400 }),
    };
  }
  const problem = urlIndicatorProblem(raw);
  if (problem) {
    return {
      error: Response.json(
        {
          error: problem.message,
          ...(problem.scope ? { scope: problem.scope } : {}),
        },
        { status: problem.status },
      ),
    };
  }
  // urlIndicatorProblem returning null means parseUrl already succeeded.
  return { value: parseUrl(raw)!.canonical };
}

export const { GET, POST } = makeIndicatorRoute<string, UrlCheckResult>({
  paramName: "url",
  label: "url",
  sources: ALL_LAYER_SOURCES,
  validate: validateUrl,
  getCached: (url) => getCachedUrlResult(url),
  setCached: (url, result) => setCachedUrlResult(url, result),
  run: (url, onSettled) => checkUrl(url, onSettled),
});
