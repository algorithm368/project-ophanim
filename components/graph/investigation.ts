"use client";

import { useSyncExternalStore } from "react";
import type {
  CheckResult,
  DomainCheckResult,
  HashCheckResult,
  Verdict,
} from "@/lib/ti/types";
import { relationsFor, type IndicatorType } from "@/lib/relations";

export type InvestigationNode = {
  /** Lowercased key used for dedupe + edge endpoints. */
  key: string;
  /** Value to display and to re-check on click. */
  value: string;
  type: IndicatorType;
  /** True once this node has its own check result (not just discovered via a link). */
  checked: boolean;
  verdict?: Verdict;
  riskScore?: number;
};

export type InvestigationEdge = {
  source: string;
  target: string;
  relation: string;
};

export type Investigation = {
  nodes: InvestigationNode[];
  edges: InvestigationEdge[];
  /** Key of the most recently checked node, highlighted as the current focus. */
  focus: string | null;
};

const STORAGE_KEY = "ti:investigation";
const EMPTY: Investigation = { nodes: [], edges: [], focus: null };

let state: Investigation = EMPTY;
const listeners = new Set<() => void>();

function load(): Investigation {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Investigation;
    if (Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
      return { nodes: parsed.nodes, edges: parsed.edges, focus: parsed.focus ?? null };
    }
  } catch {
    /* ignore corrupt state */
  }
  return EMPTY;
}

let hydrated = false;
function ensureHydrated() {
  if (hydrated) return;
  hydrated = true;
  state = load();
}

function commit(next: Investigation) {
  state = next;
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* storage full / unavailable - keep in-memory state */
    }
  }
  for (const l of listeners) l();
}

const edgeId = (e: InvestigationEdge) => `${e.source}>${e.target}:${e.relation}`;

/**
 * Fold a completed check into the graph: upsert the focused node with its
 * verdict, add every related indicator it links to as a node, and connect them.
 * Re-checking a node that was previously only "discovered" upgrades it in place.
 */
export function addResult(
  result: CheckResult | DomainCheckResult | HashCheckResult,
) {
  ensureHydrated();
  const { value, type, related } = relationsFor(result);
  const focusKey = value.toLowerCase();

  const nodes = new Map(state.nodes.map((n) => [n.key, { ...n }]));
  const edges = new Map(state.edges.map((e) => [edgeId(e), e]));

  nodes.set(focusKey, {
    key: focusKey,
    value,
    type,
    checked: true,
    verdict: result.verdict,
    riskScore: result.riskScore,
  });

  for (const r of related) {
    const key = r.value.toLowerCase();
    if (!nodes.has(key)) {
      nodes.set(key, { key, value: r.value, type: r.type, checked: false });
    }
    if (key !== focusKey) {
      const edge = { source: focusKey, target: key, relation: r.relation };
      edges.set(edgeId(edge), edge);
    }
  }

  commit({
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    focus: focusKey,
  });
}

export function clearInvestigation() {
  commit(EMPTY);
}

function subscribe(cb: () => void) {
  ensureHydrated();
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): Investigation {
  ensureHydrated();
  return state;
}

function getServerSnapshot(): Investigation {
  return EMPTY;
}

export function useInvestigation(): Investigation {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
