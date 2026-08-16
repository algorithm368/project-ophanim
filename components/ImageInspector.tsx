"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { INSPECTOR_CONTROL, InspectorShell } from "./inspector-shell";

/** Zoom stops, in multiples of the fitted size. Discrete rather than continuous:
 *  an analyst comparing a login form against the real one wants to land on the
 *  same magnification twice, and a wheel gesture never does. */
const STOPS = [1, 1.5, 2, 3, 4, 6];

/**
 * A full-screen viewer for one image, with zoom and pan.
 *
 * A page screenshot is evidence, and evidence that only exists at thumbnail
 * size cannot be read: the giveaways in a phishing capture are a misspelt word
 * in the footer, a wrong favicon, a form field label. So this fits the whole
 * page by default and then magnifies, panning by drag, because that is the
 * motion of looking closely at something.
 */
export function ImageInspector({
  src,
  alt,
  title,
  subtitle,
  href,
  hrefLabel = "Open source",
  onClose,
}: Readonly<{
  src: string;
  alt: string;
  /** Usually the host or file the image is of. */
  title: string;
  subtitle?: string;
  /** Where the image came from, opened in a new tab. */
  href?: string;
  hrefLabel?: string;
  onClose: () => void;
}>) {
  const [stop, setStop] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(
    null,
  );
  const zoom = STOPS[stop];

  const zoomBy = useCallback((delta: number) => {
    setStop((s) => Math.min(STOPS.length - 1, Math.max(0, s + delta)));
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "+" || e.key === "=") zoomBy(1);
      else if (e.key === "-") zoomBy(-1);
      else if (e.key === "0") setStop(0);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [zoomBy]);

  // Panning is done on the scroll container rather than with a transform, so the
  // scrollbars stay honest about how much of the page is off screen.
  function onPointerDown(e: React.PointerEvent) {
    const box = scrollRef.current;
    if (!box || zoom === 1) return;
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      left: box.scrollLeft,
      top: box.scrollTop,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const box = scrollRef.current;
    const from = drag.current;
    if (!box || !from) return;
    box.scrollLeft = from.left - (e.clientX - from.x);
    box.scrollTop = from.top - (e.clientY - from.y);
  }

  function endDrag(e: React.PointerEvent) {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  return (
    <InspectorShell
      title={title}
      subtitle={subtitle}
      label={alt}
      href={href}
      hrefLabel={hrefLabel}
      onClose={onClose}
      footer="+ / − zoom · 0 fits · drag to pan · esc closes"
      actions={
        <>
          <button
            type="button"
            onClick={() => zoomBy(-1)}
            disabled={stop === 0}
            aria-label="Zoom out"
            className={INSPECTOR_CONTROL}
          >
            <Minus className="size-4" />
          </button>
          <span className="w-12 text-center font-mono text-[11px] tabular-nums text-muted-foreground">
            {zoom === 1 ? "fit" : `${zoom}×`}
          </span>
          <button
            type="button"
            onClick={() => zoomBy(1)}
            disabled={stop === STOPS.length - 1}
            aria-label="Zoom in"
            className={INSPECTOR_CONTROL}
          >
            <Plus className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setStop(0)}
            disabled={stop === 0}
            aria-label="Fit to screen"
            className={INSPECTOR_CONTROL}
          >
            <RotateCcw className="size-4" />
          </button>
        </>
      }
    >
      <div
        ref={scrollRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={`relative w-full max-w-6xl flex-1 overflow-auto rounded-md border border-border bg-muted/30 ${
          zoom === 1 ? "" : "cursor-grab active:cursor-grabbing"
        }`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- provider-hosted capture; next/image would need each scanner allowlisted */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          style={zoom === 1 ? undefined : { width: `${zoom * 100}%`, maxWidth: "none" }}
          className={
            zoom === 1
              ? "mx-auto max-h-full w-auto max-w-full object-contain"
              : "block h-auto select-none"
          }
        />
      </div>
    </InspectorShell>
  );
}
