"use client";

import { useState } from "react";
import { InspectorShell } from "./inspector-shell";

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
        {!loaded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background">
            <span className="sweep h-2.5 w-48 rounded" />
            <span className="font-mono text-[11px] text-muted-foreground">
              fetching the capture from the archive
            </span>
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
