"use client";

import { useEffect, useState } from "react";
import type { IOCType } from "@/lib/ioc";
import type { ResearchProviderMeta, ResearchResult } from "@/lib/ti/research";

/** Progressive state of the live research lane, filled in as the NDJSON stream
 *  delivers one provider at a time. */
export interface ResearchStreamState {
    /** Providers that will run (from the stream's `start` event). */
    metas: ResearchProviderMeta[];
    /** Settled results keyed by provider id. */
    results: Record<string, ResearchResult>;
    /** True until the stream completes (or there is no active indicator). */
    loading: boolean;
    /** Whether the `start` event has arrived, so the provider list is known. */
    started: boolean;
    /** A stream-level failure (not a per-provider error). */
    error: boolean;
}

interface Store {
    key: string;
    metas: ResearchProviderMeta[];
    results: Record<string, ResearchResult>;
    done: boolean;
    error: boolean;
}

const IDLE: ResearchStreamState = {
    metas: [],
    results: {},
    loading: false,
    started: false,
    error: false,
};

type StreamEvent =
    | { type: "start"; providers?: ResearchProviderMeta[] }
    | { type: "result"; result?: ResearchResult }
    | { type: "done" }
    | { type: "error"; error?: string };

/**
 * Stream the live research lane for an indicator, returning progressive state
 * so the card can show a per-provider skeleton that fills in as each resolves.
 * Pass a null indicator/kind to stay idle. The request is keyed on
 * `kind:indicator`, so it starts as soon as a check begins (concurrent with the
 * main TI fan-out) and the same key carries through to when results render —
 * no refetch on the loading→result transition.
 */
export function useResearchStream(
    indicator: string | null,
    kind: IOCType | null,
): ResearchStreamState {
    const key = indicator && kind ? `${kind}:${indicator}` : null;
    const [store, setStore] = useState<Store | null>(null);

    useEffect(() => {
        if (!key || !indicator || !kind) return;
        const ctrl = new AbortController();
        let metas: ResearchProviderMeta[] = [];
        let results: Record<string, ResearchResult> = {};
        const snapshot = (done: boolean, error: boolean) =>
            setStore({ key, metas: [...metas], results: { ...results }, done, error });

        (async () => {
            try {
                const res = await fetch(
                    `/api/research?indicator=${encodeURIComponent(indicator)}&kind=${kind}`,
                    {
                        headers: { Accept: "application/x-ndjson" },
                        signal: ctrl.signal,
                    },
                );
                if (!res.ok || !res.body) {
                    snapshot(true, true);
                    return;
                }
                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split("\n");
                    buffer = lines.pop() ?? "";
                    for (const line of lines) {
                        if (!line.trim()) continue;
                        const evt = JSON.parse(line) as StreamEvent;
                        if (evt.type === "start") {
                            metas = evt.providers ?? [];
                            snapshot(false, false);
                        } else if (evt.type === "result" && evt.result) {
                            results = { ...results, [evt.result.provider.id]: evt.result };
                            snapshot(false, false);
                        } else if (evt.type === "done") {
                            snapshot(true, false);
                        } else if (evt.type === "error") {
                            snapshot(true, true);
                        }
                    }
                }
                // Mark complete if the stream ended without an explicit done event.
                setStore((s) => (s && s.key === key && !s.done ? { ...s, done: true } : s));
            } catch {
                if (!ctrl.signal.aborted) snapshot(true, true);
            }
        })();

        return () => ctrl.abort();
    }, [key, indicator, kind]);

    if (!key) return IDLE;
    const current = store?.key === key ? store : null;
    return {
        metas: current?.metas ?? [],
        results: current?.results ?? {},
        loading: !current || !current.done,
        started: current != null,
        error: current?.error ?? false,
    };
}
