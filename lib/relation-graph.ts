import type { IndicatorType, RelatedIndicator } from "@/lib/ti/types";
import { RELATION_ORDER } from "@/lib/relations";

export interface GraphNode {
  id: string; // lowercased value
  value: string;
  type: IndicatorType;
  isFocus: boolean;
  /** Edge label to the focus; undefined for the focus node itself. */
  relation?: string;
}

export interface GraphEdge {
  from: string; // focus id
  to: string; // neighbour id
  relation: string;
}

export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface PositionedNode extends GraphNode {
  x: number;
  y: number;
}

/** Backstop so a pathological fan-out can't explode the SVG; the list view still
 *  shows everything. relationsFor already slices most relation groups. */
const MAX_NEIGHBORS = 48;

/** Star graph: focus at the hub, one deduped neighbour per related value, sorted
 *  by RELATION_ORDER (then value) so same-relation nodes are adjacent. */
export function buildGraphModel(
  focus: { value: string; type: IndicatorType },
  related: RelatedIndicator[],
): GraphModel {
  const focusId = focus.value.toLowerCase();
  const orderIndex = (rel: string) => {
    const i = RELATION_ORDER.indexOf(rel);
    return i === -1 ? RELATION_ORDER.length : i;
  };
  const sorted = [...related].sort(
    (a, b) =>
      orderIndex(a.relation) - orderIndex(b.relation) ||
      a.value.localeCompare(b.value),
  );

  const seen = new Set<string>([focusId]);
  const neighbours: GraphNode[] = [];
  for (const r of sorted) {
    const id = r.value.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    neighbours.push({
      id,
      value: r.value,
      type: r.type,
      isFocus: false,
      relation: r.relation,
    });
    if (neighbours.length >= MAX_NEIGHBORS) break;
  }

  const focusNode: GraphNode = {
    id: focusId,
    value: focus.value,
    type: focus.type,
    isFocus: true,
  };
  const edges: GraphEdge[] = neighbours.map((n) => ({
    from: focusId,
    to: n.id,
    relation: n.relation as string,
  }));
  return { nodes: [focusNode, ...neighbours], edges };
}

/** Focus at center; neighbours on a ring at a fixed radius, evenly spaced by
 *  index (deterministic — no Math.random). First neighbour sits at the top. */
export function radialLayout(
  model: GraphModel,
  size: { width: number; height: number },
): PositionedNode[] {
  const cx = size.width / 2;
  const cy = size.height / 2;
  const radius = Math.min(size.width, size.height) * 0.38;

  const focus = model.nodes.find((n) => n.isFocus);
  const neighbours = model.nodes.filter((n) => !n.isFocus);
  const out: PositionedNode[] = [];
  if (focus) out.push({ ...focus, x: cx, y: cy });

  const n = Math.max(1, neighbours.length);
  neighbours.forEach((node, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
    out.push({
      ...node,
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  });
  return out;
}
