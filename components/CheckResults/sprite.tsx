import { memo } from "react";
import { SPRITE_SIZE, spriteRects, type SpriteSpec } from "@/lib/ti/sprite";
import { cn } from "@/lib/utils";

/**
 * A 1-bit sprite as inline SVG, filled with `currentColor` so it takes the
 * verdict's colour from whatever wraps it. No image asset and no extra request;
 * crisp at any DPI because it is 30-odd rectangles on a 16 unit grid.
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
            viewBox={`0 0 ${SPRITE_SIZE} ${SPRITE_SIZE}`}
            shapeRendering="crispEdges"
            fill="currentColor"
            role="img"
            aria-label={title ?? "Indicator sprite"}
            className={cn("shrink-0", className)}
        >
            {title && <title>{title}</title>}
            {spriteRects(spec).map((r) => (
                <rect key={`${r.y}-${r.x}`} x={r.x} y={r.y} width={r.w} height={1} />
            ))}
        </svg>
    );
});
