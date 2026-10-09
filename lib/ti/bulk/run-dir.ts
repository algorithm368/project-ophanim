import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { invalidCsv, toCsv } from "./export";
import { invalidSummary, type BulkItem } from "./parse";
import { depthOf, type BulkRow, type InvalidInput, type RowSummary } from "./types";

export interface RunState {
  v: 1;
  id: string;
  createdAt: string;
  phase: "pass0" | "pass1" | "pass2" | "done";
  includeWeak: boolean;
  concurrency: number;
  confirmed: boolean;
  invalid: InvalidInput[];
  duplicates: number;
}

/** Outside the repo on purpose: these files hold customer IOCs and internal
 *  hostnames, and must never be one `git add .` away from a commit. */
export function defaultRoot(): string {
  return join(homedir(), ".ophanim", "bulk");
}

export function resolveRunDir(resume: string, root: string = defaultRoot()): string {
  return isAbsolute(resume) ? resume : join(root, resume);
}

const jsonl = (values: unknown[]) => values.map((v) => JSON.stringify(v)).join("\n") + (values.length ? "\n" : "");
const readJsonl = <T>(path: string): T[] =>
  existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as T) : [];

export function initRunDir(dir: string, state: RunState, items: BulkItem[]): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "state.json"), JSON.stringify(state, null, 2));
  writeFileSync(join(dir, "input.jsonl"), jsonl(items));
}

export function saveState(dir: string, state: RunState): void {
  writeFileSync(join(dir, "state.json"), JSON.stringify(state, null, 2));
}

export function appendRows(dir: string, rows: BulkRow[]): void {
  appendFileSync(join(dir, "rows.jsonl"), jsonl(rows));
}

export function loadRunDir(dir: string): { state: RunState; items: BulkItem[]; rows: Map<number, BulkRow> } {
  const state = JSON.parse(readFileSync(join(dir, "state.json"), "utf8")) as RunState;
  const items = readJsonl<BulkItem>(join(dir, "input.jsonl"));
  const rows = new Map<number, BulkRow>();
  for (const row of readJsonl<BulkRow>(join(dir, "rows.jsonl"))) rows.set(row.id, row);
  return { state, items, rows };
}

export function isHit(row: RowSummary): boolean {
  if (row.listedBy?.length) return true;
  return row.verdict !== undefined && row.verdict !== "clean" && row.verdict !== "unknown";
}

function tally<T extends string>(values: T[]): string {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].map(([k, n]) => `${k} ${n}`).join(", ");
}

export function writeOutputs(dir: string, rows: RowSummary[], state: RunState): string {
  writeFileSync(join(dir, "results.csv"), toCsv(rows));
  writeFileSync(join(dir, "hits.csv"), toCsv(rows.filter(isHit)));
  writeFileSync(join(dir, "invalid.csv"), invalidCsv(state.invalid));
  const invalid = Object.entries(invalidSummary(state.invalid)).map(([k, n]) => `${k} ${n}`).join(", ");
  const text = [
    `${rows.length} indicators, ${state.duplicates} duplicates, ${state.invalid.length} invalid`,
    `depth: ${tally(rows.map(depthOf))}`,
    `verdict: ${tally(rows.flatMap((r) => (r.verdict ? [r.verdict] : [])))}`,
    `invalid: ${invalid || "none"}`,
  ].join("\n") + "\n";
  writeFileSync(join(dir, "summary.txt"), text);
  return text;
}
