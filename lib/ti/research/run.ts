import type { IOCType } from "@/lib/ioc";
import { errorMessage, isTimeout } from "../http";
import { researchProviders } from "./registry";
import type { ResearchProvider, ResearchResult } from "./types";

/** Research providers can be slower than scored sources (crt.sh especially),
 *  and they are off the scoring path, so they get a roomier timeout. */
const PROVIDER_TIMEOUT_MS = 10000;

/** Run one provider, normalizing skips and failures into a ResearchResult.
 *  Mirrors orchestrate.ts#runSource, but for the off-score research lane. */
async function runProvider(
  provider: ResearchProvider,
  indicator: string,
  kind: IOCType,
): Promise<ResearchResult> {
  const started = Date.now();
  if (!provider.isEnabled()) {
    return { provider: provider.meta, status: "skipped", durationMs: 0 };
  }
  try {
    const finding = await provider.check(
      indicator,
      kind,
      AbortSignal.timeout(provider.meta.timeoutMs ?? PROVIDER_TIMEOUT_MS),
    );
    return { provider: provider.meta, durationMs: Date.now() - started, ...finding };
  } catch (err) {
    return {
      provider: provider.meta,
      status: isTimeout(err) ? "timeout" : "error",
      error: errorMessage(err),
      durationMs: Date.now() - started,
    };
  }
}

/** Run every provider that supports `kind` in parallel. Never throws: a failing
 *  provider becomes an error result so one dead API can't sink the panel.
 *  `onSettled` fires as each provider resolves, for progressive streaming. */
export async function runResearch(
  indicator: string,
  kind: IOCType,
  providers: ResearchProvider[] = researchProviders,
  onSettled?: (result: ResearchResult) => void,
): Promise<ResearchResult[]> {
  return Promise.all(
    providers
      .filter((p) => p.supports.includes(kind))
      .map((p) =>
        runProvider(p, indicator, kind).then((r) => {
          onSettled?.(r);
          return r;
        }),
      ),
  );
}

/**
 * Provider metas that will run for an IOC kind, used by the stream's `start`
 * event so the UI can show a labeled skeleton per provider before any resolve.
 *
 * A key-gated provider without its key is left out rather than announced and
 * then skipped, which would put a labeled placeholder on screen only to remove
 * it. The UI also calls this in the browser, where the server's env is not
 * visible and every gated provider therefore reads as disabled: that errs
 * toward a lane appearing when the `start` event lands, never toward one
 * vanishing.
 */
export function researchMetasFor(
  kind: IOCType,
  providers: ResearchProvider[] = researchProviders,
) {
  return providers
    .filter((p) => p.supports.includes(kind) && p.isEnabled())
    .map((p) => p.meta);
}
