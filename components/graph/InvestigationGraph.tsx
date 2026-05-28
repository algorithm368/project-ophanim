"use client";

import "@xyflow/react/dist/style.css";
import { useEffect } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import Dagre from "@dagrejs/dagre";
import { FileDigit, Globe, Network, Share2, Trash2 } from "lucide-react";
import type { Verdict } from "@/lib/ti/types";
import type { IndicatorType } from "@/lib/relations";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  clearInvestigation,
  useInvestigation,
  type InvestigationEdge,
  type InvestigationNode,
} from "./investigation";

// ── constants ────────────────────────────────────────────────────────────────

const NODE_W = 190;
const NODE_H = 44;

const VERDICT_ACCENT: Record<Verdict, string> = {
  clean: "border-emerald-500/70 text-emerald-600 dark:text-emerald-400",
  low: "border-lime-500/70 text-lime-600 dark:text-lime-400",
  suspicious: "border-amber-500/70 text-amber-600 dark:text-amber-400",
  malicious: "border-red-500/70 text-red-600 dark:text-red-400",
  unknown: "border-foreground/30 text-muted-foreground",
};

const TYPE_ICON: Record<IndicatorType, typeof Network> = {
  ip: Network,
  domain: Globe,
  hash: FileDigit,
};

// ── helpers ──────────────────────────────────────────────────────────────────

function nodeLabel(n: InvestigationNode): string {
  return n.type === "hash" ? `${n.value.slice(0, 10)}…` : n.value;
}

type IocData = InvestigationNode & Record<string, unknown>;

/** Compute a dagre layout and return React Flow nodes + edges. */
function buildLayout(
  iNodes: InvestigationNode[],
  iEdges: InvestigationEdge[],
): { nodes: Node[]; edges: Edge[] } {
  const g = new Dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "LR",
    nodesep: 70,
    ranksep: 130,
    marginx: 30,
    marginy: 30,
  });

  for (const n of iNodes) g.setNode(n.key, { width: NODE_W, height: NODE_H });
  for (const e of iEdges) g.setEdge(e.source, e.target);
  Dagre.layout(g);

  const nodes: Node[] = iNodes.map((n) => {
    const { x, y } = g.node(n.key);
    return {
      id: n.key,
      type: "ioc",
      position: { x: x - NODE_W / 2, y: y - NODE_H / 2 },
      data: n as IocData,
    };
  });

  const edges: Edge[] = iEdges.map((e) => ({
    id: `${e.source}>${e.target}:${e.relation}`,
    source: e.source,
    target: e.target,
    label: e.relation,
    type: "smoothstep",
    style: { strokeDasharray: "4 4", strokeWidth: 1.4, stroke: "currentColor", opacity: 0.35 },
    labelStyle: { fontSize: 9, fontFamily: "var(--font-jetbrains-mono, monospace)" },
    labelBgStyle: { fillOpacity: 0 },
  }));

  return { nodes, edges };
}

// ── custom node ───────────────────────────────────────────────────────────────

// Defined at module level so React Flow doesn't remount it on every render.
function IocNodeComponent({ data }: NodeProps) {
  const n = data as IocData;
  const { focus } = useInvestigation();
  const Icon = TYPE_ICON[n.type];
  const accent = n.checked
    ? VERDICT_ACCENT[n.verdict ?? "unknown"]
    : "border-foreground/25 text-muted-foreground";
  const isFocus = focus === n.key;

  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        style={{ opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0, border: 0 }}
      />
      <div
        className={cn(
          "flex w-[190px] cursor-pointer items-center gap-1.5 rounded-[11px_15px_9px_13px/13px_9px_15px_11px] border-2 bg-card px-2.5 py-1.5 font-mono text-xs shadow-sm transition-[box-shadow,background-color,transform]",
          accent,
          !n.checked && "border-dashed",
          isFocus &&
            "scale-[1.1] bg-primary/10 ring-2 ring-primary ring-offset-2 ring-offset-background shadow-lg shadow-primary/20",
        )}
      >
        <Icon className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-foreground">{nodeLabel(n)}</span>
        {n.checked && typeof n.riskScore === "number" && (
          <span className="shrink-0 rounded-full border border-current px-1 text-[10px] font-bold tabular-nums">
            {n.riskScore}
          </span>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        style={{ opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0, border: 0 }}
      />
    </>
  );
}

const NODE_TYPES = { ioc: IocNodeComponent };

// ── inner flow (needs ReactFlowProvider context) ──────────────────────────────

function GraphInner({ onPivot }: { onPivot: (value: string) => void }) {
  const { nodes: iNodes, edges: iEdges } = useInvestigation();
  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);
  const { fitView } = useReactFlow();

  // A stable key that changes only when the graph structure changes.
  const graphKey =
    iNodes.map((n) => `${n.key}:${n.checked}:${n.verdict ?? ""}`).join(",") +
    "|" +
    iEdges.length;

  useEffect(() => {
    if (iNodes.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }
    const { nodes: ln, edges: le } = buildLayout(iNodes, iEdges);
    setNodes(ln);
    setEdges(le);
    requestAnimationFrame(() => fitView({ padding: 0.25, duration: 350 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphKey]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={NODE_TYPES}
      onNodeClick={(_, node) => onPivot((node.data as IocData).value)}
      nodesConnectable={false}
      fitView
      className="[&_.react-flow__attribution]:hidden"
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={22}
        size={1.2}
        className="opacity-20"
      />
      <Controls
        showInteractive={false}
        className="[&>button]:border-foreground/20 [&>button]:bg-card [&>button]:text-foreground"
      />
    </ReactFlow>
  );
}

// ── public component ──────────────────────────────────────────────────────────

export function InvestigationGraph({
  onPivot,
}: {
  onPivot: (value: string) => void;
}) {
  const { nodes } = useInvestigation();
  if (nodes.length === 0) return null;

  return (
    <Card className="sketch-shadow mt-8 overflow-hidden rounded-[22px_34px_18px_30px/30px_18px_34px_22px] border-2 border-foreground/20">
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-hand flex items-center gap-2 text-2xl font-bold leading-none">
            <Share2 className="size-5 -rotate-6 text-primary" />
            Investigation graph
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-hand mr-1 text-sm text-muted-foreground">
              {nodes.length} node{nodes.length === 1 ? "" : "s"}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Clear investigation"
              title="Clear investigation"
              onClick={clearInvestigation}
              className="size-8 rounded-[9px_12px_7px_11px/11px_7px_12px_9px] border-2"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>

        <p className="font-hand text-base text-muted-foreground">
          Click a node to check it. Drag to rearrange. Pending nodes were
          discovered through a link but not yet checked.
        </p>

        <div className="h-[clamp(380px,55vh,560px)] w-full overflow-hidden rounded-[16px_22px_14px_20px/20px_14px_22px_16px] border-2 border-dashed border-foreground/15 bg-card/40">
          <ReactFlowProvider>
            <GraphInner onPivot={onPivot} />
          </ReactFlowProvider>
        </div>
      </CardContent>
    </Card>
  );
}
