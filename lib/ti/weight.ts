import type { SourceMeta } from "./types";

/**
 * How much a source counts, reading a meta with no weight as full weight.
 *
 * The type makes weight required, but results come back from the cache and the
 * stream as JSON, so the default is kept in one place rather than restated at
 * every call site. Undefined in, full weight out, for a lookup that found no
 * source at all.
 */
export function sourceWeight(meta: SourceMeta | undefined): number {
  return meta?.weight ?? 1;
}
