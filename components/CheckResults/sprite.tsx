import { memo } from "react";
import { SPRITE_SIZE, spriteLayers, spriteOutline, type SpriteSpec } from "@/lib/ti/sprite";
import { cn } from "@/lib/utils";

/**
 * A sprite as inline SVG, filled with `currentColor` so it takes the verdict's
 * colour from whatever wraps it. Each tone is one group at its own opacity, so
 * the shading stays in the verdict's hue. No image asset and no extra request;
 * crisp at any DPI because it is a few dozen rectangles on a 32 unit grid.
 *
 * A one-cell ring in the page's foreground ink goes round the silhouette, so
 * the shape holds against the tile in both themes and the verdict hue stays
 * on the creature itself. The ring can sit a cell outside the 32 grid, so the
 * view box is padded by one on every side: pick `px` as a multiple of 34 to
 * keep every cell a whole number of pixels.
 *
 * Colour never carries the meaning on its own: the flagged state adds horns,
 * which is a shape difference and survives both greyscale and colour blindness.
 */
export const Sprite = memo(function Sprite({
    spec,
    px,
    className,
    title,
}: Readonly<{
    spec: SpriteSpec;
    px: number;
    className?: string;
    title?: string;
}>) {
    return (
        <svg
            width={px}
            height={px}
            viewBox={`-1 -1 ${SPRITE_SIZE + 2} ${SPRITE_SIZE + 2}`}
            shapeRendering="crispEdges"
            fill="currentColor"
            role="img"
            aria-label={title ?? "Indicator sprite"}
            className={cn("shrink-0", className)}
        >
            {title && <title>{title}</title>}
            <g className="fill-foreground">
                {spriteOutline(spec).map((r) => (
                    <rect key={`${r.y}-${r.x}`} x={r.x} y={r.y} width={r.w} height={1} />
                ))}
            </g>
            {spriteLayers(spec).map((layer) => (
                <g key={layer.tone} fillOpacity={layer.opacity}>
                    {layer.rects.map((r) => (
                        <rect key={`${r.y}-${r.x}`} x={r.x} y={r.y} width={r.w} height={1} />
                    ))}
                </g>
            ))}
        </svg>
    );
});
