"use client";

import { useState } from "react";
import { Maximize2 } from "lucide-react";
import { ImageInspector } from "@/components/ImageInspector";
import { ENGINE_NAME } from "@/lib/ti/url/active/engines";
import type { MergedIndicator } from "@/lib/ti/url/active/merge";
import type { ScanClassKind } from "@/lib/ti/url/active/scan-class";
import type { ActiveScan } from "@/lib/ti/url/active/types";
import { hostFromUrl } from "@/lib/url";

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
 * The captures the rail shows: one normally, because the scanned URLs are one
 * site answering on two ports, and one per URL when `separateSites` says the
 * pictures differ, since showing one of them would be picking a winner. None
 * for a file or a page that never answered, which have nothing to picture.
 */
export function railShots(
  merged: MergedIndicator,
  scans: ActiveScan[],
  kind: ScanClassKind | undefined,
): ActiveScan[] {
  if (kind === undefined || kind === "no-answer" || kind === "file") return [];
  const byTarget = new Map<string, ActiveScan>();
  for (const shot of shotsIn(scans)) if (!byTarget.has(shot.target)) byTarget.set(shot.target, shot);
  const all = [...byTarget.values()];
  return merged.separateSites ? all : all.slice(0, 1);
}

/** Opens a capture in the full-screen inspector, titled by where the trip
 *  ended rather than by the URL that was sent. */
function Inspector({
  shot,
  merged,
  onClose,
}: Readonly<{ shot: ActiveScan; merged: MergedIndicator; onClose: () => void }>) {
  return (
    <ImageInspector
      src={shot.verdict?.screenshot as string}
      alt={`Screenshot of ${shot.target}`}
      title={merged.detail.finalUrl ?? shot.target}
      subtitle={[`captured by ${ENGINE_NAME[shot.engine]}`, merged.detail.title]
        .filter(Boolean)
        .join(" · ")}
      href={shot.resultUrl}
      hrefLabel="Open the scanner's report"
      onClose={onClose}
    />
  );
}

/**
 * One capture as the whole rail, edge to edge, the way the passive page fills
 * its rail with the globe: the picture is the tile, and the caption fades in
 * over its foot rather than taking a row of its own under it.
 *
 * Cropped to the top of the page, which is where the logo, the title and any
 * login box are; the inspector has the rest.
 */
export function BleedCapture({
  shot,
  merged,
}: Readonly<{ shot: ActiveScan; merged: MergedIndicator }>) {
  const [inspecting, setInspecting] = useState(false);
  const host = hostFromUrl(merged.detail.finalUrl ?? shot.target) ?? shot.target;
  return (
    <figure className="absolute inset-0 m-0">
      <button
        type="button"
        onClick={() => setInspecting(true)}
        aria-label={`Inspect the screenshot of ${shot.target}`}
        title="Inspect the screenshot"
        className="group absolute inset-0 block cursor-zoom-in overflow-hidden"
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
      <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-card via-card/85 to-transparent px-4 pt-10 pb-3">
        <p className="truncate text-[13px] text-foreground">{host}</p>
        <p className="font-mono text-[10.5px] text-muted-foreground">
          {ENGINE_NAME[shot.engine]} capture, click to inspect
        </p>
      </figcaption>
      {inspecting && <Inspector shot={shot} merged={merged} onClose={() => setInspecting(false)} />}
    </figure>
  );
}

/** Corner brackets rather than a box: an evidence crop, the same mark the
 *  passive page puts around its sprite. */
function Brackets() {
  return (
    <span aria-hidden className="pointer-events-none">
      <span className="absolute -top-1 -left-1 size-3 border-t-2 border-l-2 border-current" />
      <span className="absolute -top-1 -right-1 size-3 border-t-2 border-r-2 border-current" />
      <span className="absolute -bottom-1 -left-1 size-3 border-b-2 border-l-2 border-current" />
      <span className="absolute -right-1 -bottom-1 size-3 border-r-2 border-b-2 border-current" />
    </span>
  );
}

/** One line of small print in the capture's place, for when there is no
 *  picture and the reason is itself worth saying. */
function NoPicture({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <p className="grid aspect-[16/10] w-full place-items-center rounded border border-dashed border-foreground/15 p-4 text-center font-mono text-[11px] text-muted-foreground">
      {children}
    </p>
  );
}

/**
 * What the scanner saw, in the place the passive page draws its sprite.
 *
 * The scan page has no creature: the capture is its picture, and the one piece
 * of evidence here no passive source can produce. At rail size it proves what
 * loaded and shows a wrong logo or a login box at a glance; clicking opens the
 * inspector for the misspelt footer.
 *
 * One capture normally, because the scanned URLs are one site answering on two
 * ports. Both when they are not: `separateSites` means the pictures differ, and
 * showing one of them would be picking a winner.
 *
 * Nothing at all when nothing answered. An empty frame there says what the
 * page's class already says in words, and a placeholder would suggest a picture
 * was expected and failed.
 */
export function RailCapture({
  merged,
  scans,
  kind,
  tone,
}: Readonly<{
  merged: MergedIndicator;
  scans: ActiveScan[];
  kind: ScanClassKind | undefined;
  /** The verdict's colour, carried by the brackets. */
  tone: string;
}>) {
  const [inspecting, setInspecting] = useState<ActiveScan | null>(null);

  if (kind === undefined || kind === "no-answer") return null;
  if (kind === "file") {
    return <NoPicture>No page to capture, this URL is a file.</NoPicture>;
  }

  const shots = railShots(merged, scans, kind);
  if (shots.length === 0) {
    const onlyCloudflare = scans.every((s) => s.status !== "done" || s.engine === "cloudflare");
    return (
      <NoPicture>
        {onlyCloudflare
          ? "No screenshot. Cloudflare serves its capture from an authenticated endpoint, so only a urlscan.io scan produces one here."
          : "No screenshot. The scanner returned none for this page."}
      </NoPicture>
    );
  }

  return (
    <div className="w-full space-y-4">
      {shots.map((shot) => (
        <figure key={shot.target} className="space-y-1.5">
          {/* The aspect ratio is reserved rather than inherited from the image:
              a provider screenshot arrives with no intrinsic size the browser
              knows in advance, and an unreserved box would be zero pixels tall
              until it loads and push the whole frame down when it does. 16/10
              is the shape urlscan captures at. */}
          <div className={`relative ${tone}`}>
            <Brackets />
            <button
              type="button"
              onClick={() => setInspecting(shot)}
              aria-label={`Inspect the screenshot of ${shot.target}`}
              title="Inspect the screenshot"
              className="group relative block aspect-[16/10] w-full cursor-zoom-in overflow-hidden rounded-sm border border-foreground/12 bg-muted/30"
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
          </div>
          <figcaption className="text-center font-mono text-[10px] text-muted-foreground">
            {shots.length > 1 ? `${shot.target} · ` : ""}
            {ENGINE_NAME[shot.engine]}, click to inspect
          </figcaption>
        </figure>
      ))}

      {inspecting && (
        <Inspector shot={inspecting} merged={merged} onClose={() => setInspecting(null)} />
      )}
    </div>
  );
}
