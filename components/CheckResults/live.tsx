"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import type { PartialLookup } from "@/lib/ti/partial";
import { TICK_MS, typingFrom, typingStep } from "@/lib/typewriter";
import { cn } from "@/lib/utils";

/**
 * Where the page is in its lookup, for the tiles that draw it.
 *
 * The pending page and the finished page are the same tiles: while the panel
 * answers they render a result assembled from whoever has answered so far
 * (`lib/ti/provisional.ts`), and read this to know which of their parts they
 * may not show yet and which values to type in.
 */
export type Live = {
    /** Sources are still answering. The verdict family (the class, the
     *  summary, the rail's colour, every confidence level, the timeline) is
     *  withheld, and a field with no value yet is drawn as pending rather than
     *  as absent: "none published" is only true once everyone has answered. */
    pending: boolean;
    /** Values that appear are typed in. Only for a lookup that actually
     *  streamed, and never under reduced motion: a cache hit or a restored
     *  result renders whole, so the page never pretends to be loading. */
    typing: boolean;
    /** Who is on the panel and who has answered, while pending. */
    partial: PartialLookup | null;
};

/** No provider means a finished page with nothing to type, which is what every
 *  tile outside `/check` (the scan page's record, say) should get. */
const FINISHED: Live = { pending: false, typing: false, partial: null };

export const LiveContext = createContext<Live>(FINISHED);

export function useLive(): Live {
    return useContext(LiveContext);
}

const REDUCED = "(prefers-reduced-motion: reduce)";

function subscribeMotion(onChange: () => void): () => void {
    const query = window.matchMedia(REDUCED);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
}

/** The reader's motion preference, kept current. Reduced on the server, where
 *  nothing is typed anyway. */
export function useReducedMotion(): boolean {
    return useSyncExternalStore(
        subscribeMotion,
        () => window.matchMedia(REDUCED).matches,
        () => true,
    );
}

/**
 * One value on the page, typed into its slot when it arrives.
 *
 * The slot is the same element before and after its value lands, which is the
 * whole trick: a value that changes while this is mounted is typed in from the
 * prefix it shares with what was there, behind a block caret. A slot that
 * mounts already holding a value types it only while the panel is still
 * answering; one that mounts after (a tile taking its final shape at the end)
 * shows its value whole, so nothing on the page is typed twice.
 *
 * With no value yet it draws its placeholder while pending (a dotted rule, a
 * paragraph of them, or a blinking caret) and nothing once the lookup is over.
 * A screen reader is given the whole value at once; only the visible copy is
 * typed.
 */
export function Typed({
    text,
    placeholder = "6ch",
    lines,
    render,
}: Readonly<{
    /** The value, or undefined while it has not arrived. */
    text?: string;
    /** What an empty slot draws while pending: a dotted rule this wide (any
     *  CSS length), a blinking caret, or nothing. */
    placeholder?: string;
    /** Draw the empty slot as this many lines of a paragraph instead. */
    lines?: number;
    /** How the value is drawn once it is all in, when that is more than the
     *  bare string (break opportunities, say). */
    render?: (text: string) => React.ReactNode;
}>) {
    const { pending, typing } = useLive();
    const [state, setState] = useState(() => ({
        text,
        n: typing && pending && text ? 0 : (text?.length ?? 0),
    }));

    // A new value: start typing it where it parts from the old one. Adjusting
    // state while rendering, rather than in an effect, so the first frame of
    // the new value is already the right one.
    let n = state.n;
    if (state.text !== text) {
        n = typing && text ? typingFrom(state.text, text) : (text?.length ?? 0);
        setState({ text, n });
    }

    const target = text ?? "";
    const typed = !typing || n >= target.length;
    useEffect(() => {
        if (typed) return;
        const step = typingStep(target.length);
        const id = setInterval(() => {
            setState((s) =>
                s.text === target ? { text: target, n: Math.min(target.length, s.n + step) } : s,
            );
        }, TICK_MS);
        return () => clearInterval(id);
    }, [target, typed]);

    if (text === undefined) {
        if (!pending || placeholder === "none") return null;
        if (lines) return <PendingLines lines={lines} />;
        if (placeholder === "caret") return <span aria-hidden className="type-caret type-caret-blink" />;
        return <span aria-hidden className="pending-rule" style={{ width: placeholder }} />;
    }
    if (typed) return <>{render ? render(text) : text}</>;
    return (
        <>
            <span aria-hidden>
                {text.slice(0, n)}
                <span className="type-caret" />
            </span>
            <span className="sr-only">{text}</span>
        </>
    );
}

/** A paragraph that has not been written yet: ruled lines, the last one short. */
function PendingLines({ lines }: Readonly<{ lines: number }>) {
    return (
        <span aria-hidden className="block">
            {Array.from({ length: lines }, (_, i) => (
                <span key={i} className={cn("pending-line", i === lines - 1 && "w-3/5")} />
            ))}
        </span>
    );
}
