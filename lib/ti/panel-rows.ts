import type { SourceMeta, SourceResult } from "./types";
import { sourceWeight } from "./weight";

/** One source on the panel, with its answer once it has one. */
export type PanelRow = { meta: SourceMeta; result?: SourceResult };

/**
 * The panel as rows while it is still answering: every source the stream's
 * `start` event named, in registry order, each with its answer if it has
 * landed.
 *
 * Registry order, not the order the answers came in, so a row never moves
 * while the lookup runs; the finished page sorts once at the end. Split the
 * way the score splits them: detectors can move the verdict, context sources
 * (geolocation and the like) carry no weight and cannot.
 *
 * An answer from a source the panel did not name (a cached panel that has
 * since gained a source, say) still gets a row, after the named ones, rather
 * than being dropped from a list that is meant to account for everyone.
 */
export function panelRows(
  metas: SourceMeta[],
  sources: SourceResult[],
): { detectors: PanelRow[]; context: PanelRow[] } {
  const byId = new Map(sources.map((s) => [s.source.id, s] as const));
  const named = new Set(metas.map((m) => m.id));
  const rows: PanelRow[] = [
    ...metas.map((meta) => ({ meta, result: byId.get(meta.id) })),
    ...sources.filter((s) => !named.has(s.source.id)).map((s) => ({ meta: s.source, result: s })),
  ];
  return {
    detectors: rows.filter((r) => sourceWeight(r.meta) > 0),
    context: rows.filter((r) => sourceWeight(r.meta) <= 0),
  };
}
