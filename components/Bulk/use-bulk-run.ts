"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readNdjson } from "@/lib/ndjson";
import type { BulkEvent } from "@/lib/ti/bulk/api";
import type { QuotaRemaining } from "@/lib/ti/bulk/quota";
import type { BulkRun, MeteredId, RowSummary } from "@/lib/ti/bulk/types";

// The same chunk sizes the routes accept (`PASS1_CHUNK` / `PASS2_CHUNK` in
// lib/ti/bulk/api.ts). Not imported, because that module pulls the engine in.
const PASS1_CHUNK = 25;
const PASS2_CHUNK = 4;

export interface RunView {
  run: BulkRun;
  estimate: Partial<Record<MeteredId, number>>;
  needsConfirmation: boolean;
  quota: QuotaRemaining[] | null;
}

export type Phase = "idle" | "pass1" | "confirm" | "pass2" | "waiting" | "done" | "error";

/** -1 means the server wants confirmation first. */
async function stream(url: string, body: unknown, onRow: (row: RowSummary) => void): Promise<number | undefined> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (res.status === 409) return -1;
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  let wait: number | undefined;
  for await (const event of readNdjson<BulkEvent>(res.body)) {
    if (event.type === "row") onRow(event.row);
    if (event.type === "wait") wait = event.ms;
    if (event.type === "error") throw new Error(event.error);
  }
  return wait;
}

/** Drives a run from the browser. The run record in Redis is the truth: every
 *  step re-reads it, so a reload picks up where the last chunk ended. */
export function useBulkRun(runId: string | null) {
  const [view, setView] = useState<RunView | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const confirmed = useRef(false);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/bulk/${runId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const next = (await res.json()) as RunView;
    setView(next);
    return next;
  }, [runId]);

  const patchRow = useCallback((row: RowSummary) => {
    setView((v) => (v ? { ...v, run: { ...v.run, rows: v.run.rows.map((r) => (r.id === row.id ? row : r)) } } : v));
  }, []);

  const runPass1 = useCallback(async (v: RunView) => {
    const pending = v.run.rows.filter((r) => r.state === "pending").map((r) => r.id);
    for (let i = 0; i < pending.length; i += PASS1_CHUNK) {
      await stream(`/api/bulk/${runId}/pass1`, { rowIds: pending.slice(i, i + PASS1_CHUNK) }, patchRow);
    }
  }, [runId, patchRow]);

  const runPass2 = useCallback(async (): Promise<"done" | "confirm"> => {
    for (;;) {
      const queue = (await refresh()).run.rows.filter((r) => r.state === "pass1").map((r) => r.id);
      if (queue.length === 0) return "done";
      const wait = await stream(`/api/bulk/${runId}/pass2`, { rowIds: queue.slice(0, PASS2_CHUNK), confirmed: confirmed.current }, patchRow);
      if (wait === -1) return "confirm";
      if (wait !== undefined) {
        setPhase("waiting");
        await new Promise((r) => setTimeout(r, wait));
        setPhase("pass2");
      }
    }
  }, [runId, refresh, patchRow]);

  const drive = useCallback(async () => {
    const first = await refresh();
    setPhase("pass1");
    await runPass1(first);
    const v = await refresh();
    if (v.needsConfirmation && !confirmed.current) return setPhase("confirm");
    setPhase("pass2");
    setPhase(await runPass2());
  }, [refresh, runPass1, runPass2]);

  const fail = useCallback((err: unknown) => {
    setError(err instanceof Error ? err.message : String(err));
    setPhase("error");
  }, []);

  const go = useCallback(() => {
    drive().catch(fail);
  }, [drive, fail]);

  useEffect(() => {
    if (!runId) return;
    // Nothing is set until the first read of the run comes back.
    (async () => drive())().catch(fail);
  }, [runId, drive, fail]);

  const accept = useCallback(() => {
    confirmed.current = true;
    go();
  }, [go]);
  const skip = useCallback(() => setPhase("done"), []);

  return { view, phase, error, accept, skip };
}
