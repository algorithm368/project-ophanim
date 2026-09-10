"use client";

import { useState } from "react";
import { Maximize2 } from "lucide-react";
import { ImageInspector } from "@/components/ImageInspector";
import { ENGINE_NAME } from "@/lib/ti/url/active/engines";
import type { MergedIndicator } from "@/lib/ti/url/active/merge";
import type { ActiveScan } from "@/lib/ti/url/active/types";

/** The scans that produced a screenshot this page can actually render.
 *
 *  Only a urlscan screenshot is a public file. Cloudflare's is an
 *  authenticated API endpoint and an `<img>` pointed at it renders broken. */
function shotsIn(scans: ActiveScan[]): ActiveScan[] {
  return scans.filter((s) =>
    s.verdict?.screenshot?.startsWith("https://urlscan.io/"),
  );
}

/**
 * What the scanner saw, at the size it can be read at.
 *
 * The capture is the one piece of evidence on this page that no passive source
 * can produce, and at thumbnail size all it can do is prove that something
 * loaded. Full width, a misspelt footer and a wrong favicon are legible without
 * opening anything; clicking still opens the inspector for the rest.
 *
 * One capture normally, because the scanned URLs are one site answering on two
 * ports. Both when they are not: `separateSites` means the pictures differ, and
 * showing one of them would be picking a winner.
 */
export function ScanCapture({
  merged,
  scans,
}: Readonly<{ merged: MergedIndicator; scans: ActiveScan[] }>) {
  const [inspecting, setInspecting] = useState<ActiveScan | null>(null);

  const all = shotsIn(scans);
  if (all.length === 0) {
    return (
      <p className="rounded border border-dashed border-foreground/15 p-4 text-xs text-foreground/45">
        No screenshot. Cloudflare serves its capture from an authenticated
        endpoint, so only a urlscan.io scan produces one here.
      </p>
    );
  }

  // One per target at most, so two engines scanning one URL do not print the
  // same page twice.
  const byTarget = new Map<string, ActiveScan>();
  for (const shot of all) if (!byTarget.has(shot.target)) byTarget.set(shot.target, shot);
  const shots = merged.separateSites
    ? [...byTarget.values()]
    : [[...byTarget.values()][0]];

  return (
    <div className="space-y-4">
      {shots.map((shot) => (
        <figure key={shot.target} className="space-y-1">
          {/* The aspect ratio is reserved rather than inherited from the image.
              A provider screenshot arrives with no intrinsic size the browser
              knows in advance, so at full width an unreserved box is zero
              pixels tall until it loads and roughly six hundred after, and
              every section below it jumps that far down. 16/10 is the shape
              urlscan captures at; a longer page is cropped, which is what
              `object-top` and the inspector are for. */}
          <button
            type="button"
            onClick={() => setInspecting(shot)}
            aria-label={`Inspect the screenshot of ${shot.target}`}
            title="Inspect the screenshot"
            className="group relative block aspect-[16/10] w-full cursor-zoom-in overflow-hidden rounded border border-foreground/12 bg-muted/30"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- provider-hosted screenshot; next/image would need urlscan allowlisted */}
            <img
              src={shot.verdict?.screenshot}
              alt={`Screenshot of ${shot.target}`}
              className="size-full object-cover object-top"
              loading="lazy"
            />
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-background opacity-0 transition group-hover:bg-foreground/30 group-hover:opacity-100 group-focus-visible:bg-foreground/30 group-focus-visible:opacity-100">
              <Maximize2 className="size-5" />
            </span>
          </button>
          <figcaption className="font-mono text-[11px] text-foreground/45">
            {shots.length > 1 ? `${shot.target} · ` : ""}
            {ENGINE_NAME[shot.engine]} · click to inspect
          </figcaption>
        </figure>
      ))}

      {inspecting && (
        <ImageInspector
          src={inspecting.verdict?.screenshot as string}
          alt={`Screenshot of ${inspecting.target}`}
          title={merged.detail.finalUrl ?? inspecting.target}
          subtitle={[
            `captured by ${ENGINE_NAME[inspecting.engine]}`,
            merged.detail.title,
          ]
            .filter(Boolean)
            .join(" · ")}
          href={inspecting.resultUrl}
          hrefLabel="Open the scanner's report"
          onClose={() => setInspecting(null)}
        />
      )}
    </div>
  );
}
