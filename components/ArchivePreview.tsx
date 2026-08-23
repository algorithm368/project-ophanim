"use client";

import { useEffect, useState } from "react";
import { InspectorShell } from "./inspector-shell";

/**
 * How long the opaque placeholder keeps the frame covered.
 *
 * A frame's `load` event waits for every subresource, and a replayed page pulls
 * each of its images and stylesheets back through the archive one at a time, so
 * `load` lands seconds after the markup has painted. Past this point the
 * placeholder is hiding a page that is already readable, which is the slowness
 * analysts actually complained about.
 */
const REVEAL_MS = 1000;

/** When waiting stops being ordinary and the way out is worth offering. */
const SLOW_MS = 8000;

/** Covered, stepped aside for the page behind it, or overdue. */
type Stage = "covering" | "behind" | "slow";

/**
 * One archived capture, rendered in place.
 *
 * The Wayback Machine has no screenshot service: it keeps the page itself, so
 * the only way to see what a site looked like on a date is to render what was
 * archived. That is done here in a sandboxed frame with **scripts disabled**,
 * which matters more than it sounds: an archived capture of a phishing kit is
 * still a phishing kit, and an analyst opening it to look at it should not be
 * running it. What survives is the markup, the stylesheets, and the images,
 * which is exactly the part being looked at.
 *
 * A page built entirely by JavaScript therefore renders as whatever it serves
 * without scripts, so the footer says the scripts are off rather than leaving a
 * thin page to be read as the truth about that date.
 */
export function ArchivePreview({
  frameUrl,
  playbackUrl,
  title,
  subtitle,
  onClose,
}: Readonly<{
  /** The archive's `if_` URL: the page without the Wayback toolbar. */
  frameUrl: string;
  /** The ordinary playback URL, for opening at the archive itself. */
  playbackUrl: string;
  title: string;
  subtitle?: string;
  onClose: () => void;
}>) {
  const [loaded, setLoaded] = useState(false);
  const [stage, setStage] = useState<Stage>("covering");

  // Timed rather than measured, because there is nothing here to measure: the
  // frame is cross-origin and sandboxed, so this side cannot see it paint. The
  // clock is the honest approximation, and it errs toward showing the page.
  useEffect(() => {
    if (loaded) return;
    const reveal = setTimeout(() => setStage("behind"), REVEAL_MS);
    const overdue = setTimeout(() => setStage("slow"), SLOW_MS);
    return () => {
      clearTimeout(reveal);
      clearTimeout(overdue);
    };
  }, [loaded]);

  const waiting = !loaded;

  return (
    <InspectorShell
      title={title}
      subtitle={subtitle}
      label={`Archived capture of ${title}`}
      href={playbackUrl}
      hrefLabel="Open at the Wayback Machine"
      onClose={onClose}
      footer="scripts disabled · esc closes"
    >
      {/* The archive is not fast, and a blank frame reads as "nothing was
          archived", which is the opposite of what is happening. */}
      <div className="relative w-full max-w-6xl flex-1 overflow-hidden rounded-md border border-border bg-white">
        {waiting && stage === "covering" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background">
            <span className="sweep h-2.5 w-48 rounded" />
            <span className="font-mono text-[11px] text-muted-foreground">
              fetching the capture from the archive
            </span>
          </div>
        )}
        {waiting && stage !== "covering" && (
          // A thin bar instead of a cover: the rest of the capture is still
          // arriving, and saying so beats hiding what has already arrived.
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col items-center gap-2">
            <span className="sweep h-0.5 w-full" />
            {stage === "slow" && (
              <span className="pointer-events-auto rounded-md border border-border bg-background/95 px-2.5 py-1 font-mono text-[11px] text-muted-foreground shadow-sm">
                the archive is taking its time,{" "}
                <a
                  href={playbackUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 transition-colors hover:text-foreground"
                >
                  open this capture at the archive
                </a>
              </span>
            )}
          </div>
        )}
        <iframe
          // sandbox="" is the whole point: no scripts, no forms, no popups, no
          // top-level navigation, and no same-origin access to this app.
          sandbox=""
          referrerPolicy="no-referrer"
          src={frameUrl}
          onLoad={() => setLoaded(true)}
          title={`Archived capture of ${title}`}
          className="size-full"
        />
      </div>
    </InspectorShell>
  );
}
