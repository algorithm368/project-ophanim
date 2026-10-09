import { estimate, estimateTotal } from "./engine";
import type { BulkRun, RowSummary } from "./types";

export const PASS1_CHUNK = 25;
export const PASS2_CHUNK = 4;

export type BulkEvent =
  | { v: 1; type: "row"; row: RowSummary }
  | { v: 1; type: "wait"; ms: number }
  | { v: 1; type: "done" }
  | { v: 1; type: "error"; error: string };

export function confirmAt(): number {
  const raw = Number(process.env.TI_BULK_CONFIRM_AT);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 50;
}

export function readRowIds(body: unknown, max: number): number[] | null {
  const ids = (body as { rowIds?: unknown } | null)?.rowIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > max) return null;
  return ids.every((n) => Number.isInteger(n) && n >= 0) ? (ids as number[]) : null;
}

export function needsConfirmation(run: BulkRun): boolean {
  return !run.confirmed && estimateTotal(estimate(run.rows)) > confirmAt();
}

export function ndjsonStream(work: (emit: (event: BulkEvent) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: BulkEvent) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        await work(emit);
      } catch (err) {
        emit({ v: 1, type: "error", error: err instanceof Error ? err.message : String(err) });
      }
      controller.close();
    },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson" } });
}
