"use client";

import { useContext, useState } from "react";
import { FileDigit, Globe, Link2, Network, type LucideIcon } from "lucide-react";
import type { IndicatorType, RelatedIndicator, Verdict } from "@/lib/ti/types";
import { RELATION_META } from "@/lib/relations";
import {
    buildGraphModel,
    radialLayout,
    type PositionedNode,
} from "@/lib/relation-graph";
import { cn } from "@/lib/utils";
import { VERDICT_STYLE } from "./verdict";
import { PivotContext } from "./primitives";

const VIEW = { width: 480, height: 360 };
const FOCUS_R = 26;
const NODE_R = 17;

const TYPE_ICON: Record<IndicatorType, LucideIcon> = {
    ip: Network,
    domain: Globe,
    hash: FileDigit,
};
const TYPE_CLASS: Record<IndicatorType, string> = {
    ip: "fill-sky-500/15 stroke-sky-500/60 text-sky-600 dark:text-sky-400",
    domain:
        "fill-emerald-500/15 stroke-emerald-500/60 text-emerald-600 dark:text-emerald-400",
    hash: "fill-violet-500/15 stroke-violet-500/60 text-violet-600 dark:text-violet-400",
};

function short(value: string): string {
    return value.length > 22 ? `${value.slice(0, 21)}…` : value;
}

export function RelationGraph({
    focus,
    related,
    verdict,
}: {
    focus: { value: string; type: IndicatorType };
    related: RelatedIndicator[];
    verdict: Verdict;
}) {
    const pivot = useContext(PivotContext);
    const [hover, setHover] = useState<string | null>(null);

    const model = buildGraphModel(focus, related);
    const positioned = radialLayout(model, VIEW);
    const byId = new Map(positioned.map((n) => [n.id, n]));
    const focusNode = byId.get(focus.value.toLowerCase());

    return (
        <svg
            viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
            role="img"
            aria-label={`Relationship graph for ${focus.value}`}
            className="w-full select-none"
        >
            {/* radar grid */}
            <g className="stroke-foreground/[0.08]" fill="none">
                <circle cx={VIEW.width / 2} cy={VIEW.height / 2} r={VIEW.height * 0.19} />
                <circle cx={VIEW.width / 2} cy={VIEW.height / 2} r={VIEW.height * 0.38} />
                <line x1={VIEW.width / 2} y1={0} x2={VIEW.width / 2} y2={VIEW.height} />
                <line x1={0} y1={VIEW.height / 2} x2={VIEW.width} y2={VIEW.height / 2} />
            </g>

            {/* edges */}
            {model.edges.map((e) => {
                const a = byId.get(e.from);
                const b = byId.get(e.to);
                if (!a || !b) return null;
                const active = hover === e.to;
                return (
                    <g
                        key={e.to}
                        className={cn(
                            "transition-opacity",
                            hover && !active && "opacity-20",
                        )}
                    >
                        <line
                            x1={a.x}
                            y1={a.y}
                            x2={b.x}
                            y2={b.y}
                            strokeWidth={active ? 2 : 1.25}
                            className={active ? "stroke-primary" : "stroke-foreground/25"}
                        />
                        {(active || model.edges.length <= 6) && (
                            <text
                                x={(a.x + b.x) / 2}
                                y={(a.y + b.y) / 2 - 3}
                                textAnchor="middle"
                                className="fill-muted-foreground font-mono text-[8px] uppercase tracking-wider"
                            >
                                {RELATION_META[e.relation]?.label ?? e.relation}
                            </text>
                        )}
                    </g>
                );
            })}

            {/* neighbour nodes */}
            {positioned
                .filter((n) => !n.isFocus)
                .map((n) => (
                    <NeighbourNode
                        key={n.id}
                        node={n}
                        dim={hover !== null && hover !== n.id}
                        onHover={setHover}
                        onPivot={pivot ? () => pivot(n.value) : undefined}
                    />
                ))}

            {/* focus node (not interactive) */}
            {focusNode && <FocusNode node={focusNode} verdict={verdict} />}
        </svg>
    );
}

function NeighbourNode({
    node,
    dim,
    onHover,
    onPivot,
}: {
    node: PositionedNode;
    dim: boolean;
    onHover: (id: string | null) => void;
    onPivot?: () => void;
}) {
    const Icon = TYPE_ICON[node.type] ?? Link2;
    return (
        <g
            role="button"
            tabIndex={0}
            aria-label={`Check ${node.value}${node.relation ? ` (${node.relation})` : ""}`}
            className={cn(
                "cursor-pointer outline-none transition-opacity",
                dim && "opacity-30",
            )}
            onMouseEnter={() => onHover(node.id)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(node.id)}
            onBlur={() => onHover(null)}
            onClick={onPivot}
            onKeyDown={(e) => {
                if (onPivot && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    onPivot();
                }
            }}
        >
            <circle
                cx={node.x}
                cy={node.y}
                r={NODE_R}
                strokeWidth={1.5}
                className={TYPE_CLASS[node.type] ?? "fill-muted stroke-foreground/40"}
            />
            <Icon
                x={node.x - 7}
                y={node.y - 7}
                width={14}
                height={14}
                className={TYPE_CLASS[node.type]}
            />
            <text
                x={node.x}
                y={node.y + NODE_R + 11}
                textAnchor="middle"
                className="fill-foreground/80 font-mono text-[9px]"
            >
                {short(node.value)}
            </text>
        </g>
    );
}

function FocusNode({
    node,
    verdict,
}: {
    node: PositionedNode;
    verdict: Verdict;
}) {
    const Icon = TYPE_ICON[node.type] ?? Link2;
    const style = VERDICT_STYLE[verdict];
    return (
        <g>
            <circle
                cx={node.x}
                cy={node.y}
                r={FOCUS_R}
                strokeWidth={3}
                className={cn("fill-background", style.ring)}
            />
            <Icon
                x={node.x - 10}
                y={node.y - 10}
                width={20}
                height={20}
                className={style.text}
            />
            <text
                x={node.x}
                y={node.y + FOCUS_R + 12}
                textAnchor="middle"
                className={cn("font-mono text-[10px] font-semibold", style.text)}
            >
                {short(node.value)}
            </text>
        </g>
    );
}
