"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A tiny, dependency-free location map. Renders a 2×2 mosaic of OpenStreetMap
 * raster tiles centered on the coordinates with a pin overlaid at the exact
 * fractional position — no map library, no API key. Tiles are public OSM; if
 * they fail to load (offline) the muted backdrop just shows through.
 *
 * The four external tile requests are deferred until the map scrolls near the
 * viewport (IntersectionObserver), so a result the user never reaches costs no
 * network and the initial paint stays light.
 */
function lonToTileX(lon: number, z: number) {
    return ((lon + 180) / 360) * 2 ** z;
}

function latToTileY(lat: number, z: number) {
    const r = (lat * Math.PI) / 180;
    return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}

export function LocationMap({
    lat,
    lon,
    caption,
    fill,
}: {
    lat: number;
    lon: number;
    caption?: string;
    /** Stretch to the parent's height on sm+ (to line up flush in a bento row)
     *  instead of staying a fixed square. */
    fill?: boolean;
}) {
    const z = 5; // country / region scale
    const n = 2 ** z;
    const xf = lonToTileX(lon, z);
    const yf = latToTileY(lat, z);
    // Top-left tile of the 2×2 mosaic, clamped so we never request out-of-range tiles.
    const tx0 = Math.min(Math.max(Math.floor(xf - 0.5), 0), n - 2);
    const ty0 = Math.min(Math.max(Math.floor(yf - 0.5), 0), n - 2);
    // Marker position as a percentage across the 2-tile-wide / 2-tile-tall mosaic.
    const left = ((xf - tx0) / 2) * 100;
    const top = ((yf - ty0) / 2) * 100;

    const tiles = [];
    for (let j = 0; j < 2; j++) {
        for (let i = 0; i < 2; i++) {
            tiles.push({ key: `${i}-${j}`, x: tx0 + i, y: ty0 + j });
        }
    }

    // Gate the tile requests on near-visibility: render the backdrop immediately,
    // fetch the OSM tiles only once the map is within 200px of the viewport.
    const ref = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        const el = ref.current;
        if (!el || visible) return;
        const io = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting)) {
                    setVisible(true);
                    io.disconnect();
                }
            },
            { rootMargin: "200px" },
        );
        io.observe(el);
        return () => io.disconnect();
    }, [visible]);

    return (
        <div
            ref={ref}
            className={cn(
                "relative mx-auto w-full max-w-[22rem] overflow-hidden rounded-lg border border-border bg-muted",
                // Square by default; when filling a bento row, drop the square
                // ratio on sm+ and take the row's height so the map's bottom
                // edge lines up flush with the detail panel beside it.
                fill ? "aspect-square sm:aspect-auto sm:h-full" : "aspect-square",
            )}
        >
            {visible && (
                <div className="absolute inset-0 grid grid-cols-2 grid-rows-2">
                    {tiles.map((t) => (
                        // eslint-disable-next-line @next/next/no-img-element -- raster map tiles; next/image gains nothing for external OSM tiles
                        <img
                            key={t.key}
                            src={`https://tile.openstreetmap.org/${z}/${t.x}/${t.y}.png`}
                            alt=""
                            aria-hidden
                            loading="lazy"
                            className="size-full object-cover opacity-95 dark:opacity-90 dark:brightness-95 dark:invert dark:hue-rotate-180"
                        />
                    ))}
                </div>
            )}
            {/* hairline inset frame so the map reads as one panel */}
            <div className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-foreground/10 ring-inset" />
            {/* the pin — its tip sits exactly on the coordinate (neutral, so color
                stays reserved for the verdict) */}
            <span
                className="absolute -translate-x-1/2 -translate-y-full"
                style={{ left: `${left}%`, top: `${top}%` }}
            >
                <MapPin className="size-7 fill-foreground text-background drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]" />
            </span>
            {caption && (
                <span className="absolute bottom-1.5 left-1.5 rounded-sm bg-background/85 px-1.5 py-0.5 font-mono text-[10px] font-medium text-foreground backdrop-blur-sm">
                    {caption}
                </span>
            )}
        </div>
    );
}
