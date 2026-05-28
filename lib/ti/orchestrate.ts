import type { SourceResult, TiSource } from "./types";

const PER_SOURCE_TIMEOUT_MS = 8000;

/** Run one source, normalizing skips, findings, and failures into a SourceResult. */
export async function runSource(
  source: TiSource,
  indicator: string,
): Promise<SourceResult> {
  const enabled = source.isEnabled();
  const started = Date.now();

  if (!enabled) {
    return {
      source: source.meta,
      enabled: false,
      status: "skipped",
      summary: source.meta.keyEnv
        ? `Set ${source.meta.keyEnv} to enable`
        : "Disabled",
      durationMs: 0,
    };
  }

  try {
    const finding = await source.check(
      indicator,
      AbortSignal.timeout(source.meta.timeoutMs ?? PER_SOURCE_TIMEOUT_MS),
    );
    const result: SourceResult = {
      source: source.meta,
      enabled: true,
      durationMs: Date.now() - started,
      ...finding,
    };
    // The raw upstream payload is never surfaced in the UI; drop it so it
    // doesn't bloat the cache entry and the streamed response.
    delete result.raw;
    return result;
  } catch (err) {
    return {
      source: source.meta,
      enabled: true,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    };
  }
}

/** Run every source in parallel, invoking onSettled as each one resolves. */
export async function runAll(
  sources: TiSource[],
  indicator: string,
  onSettled?: (result: SourceResult) => void,
): Promise<SourceResult[]> {
  return Promise.all(
    sources.map((s) =>
      runSource(s, indicator).then((r) => {
        onSettled?.(r);
        return r;
      }),
    ),
  );
}

/**
 * Merge per-source context objects into one, taking the first non-empty value
 * for each field (empty = undefined, null, "", or an empty array).
 */
export function mergeFields<T extends object>(objs: T[]): T | undefined {
  if (objs.length === 0) return undefined;

  const merged: Record<string, unknown> = {};
  for (const obj of objs) {
    for (const [key, value] of Object.entries(obj)) {
      const empty =
        value === undefined ||
        value === null ||
        value === "" ||
        (Array.isArray(value) && value.length === 0);
      if (merged[key] === undefined && !empty) {
        merged[key] = value;
      }
    }
  }
  return merged as T;
}
