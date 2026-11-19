"use client";

import { useEffect, useId, useState } from "react";
import type { GlobeDrawing } from "@/lib/ti/geo/rail-globe";
import type { RailPlace } from "@/lib/ti/geo/rail-place";
import { Typed } from "./live";

/**
 * Where the subject is, as a whole globe filling the rail, in the verdict's
 * colour.
 *
 * This file is only the frame. The atlas and d3 live in `rail-globe.ts` and come
 * in through a dynamic import once the page is up, so the result page's own
 * bundle does not grow, and the browser caches the chunk for every result
 * after the first. The caption renders at once; the globe follows.
 */

// The drawing's box, repeated rather than imported so this file does not pull
// rail-globe.ts into the page's bundle.
const W = 320;
const H = 380;

export function RailMap({ place }: Readonly<{ place: RailPlace }>) {
    const [drawing, setDrawing] = useState<GlobeDrawing | null>(null);
    const { lat, lon, countryCode } = place;
    useEffect(() => {
        let live = true;
        import("@/lib/ti/geo/rail-globe")
            .then((m) => {
                if (live) setDrawing(m.drawGlobe({ lat, lon, countryCode }));
            })
            .catch(() => {
                // A chunk that fails to load leaves the caption to stand alone.
            });
        return () => {
            live = false;
        };
    }, [lat, lon, countryCode]);
    const exact = lat !== undefined && lon !== undefined;

    return (
        <figure className="absolute inset-0 m-0">
            {drawing && <Globe d={drawing} exact={exact} />}
            <figcaption className="absolute inset-x-0 bottom-0 bg-linear-to-t from-card via-card/85 to-transparent px-4 pt-8 pb-3">
                {place.label && (
                    <p className="text-[13px] text-foreground">
                        <Typed text={place.label} />
                    </p>
                )}
                <p className="font-mono text-[10.5px] text-muted-foreground">
                    <Typed text={exact ? degrees(lat, lon) : "country only, no coordinates"} />
                </p>
            </figcaption>
        </figure>
    );
}

function Globe({ d, exact }: Readonly<{ d: GlobeDrawing; exact: boolean }>) {
    // useId can return characters a url(#...) reference does not survive.
    const clip = `globe${useId().replaceAll(/[^\w-]/g, "")}`;
    // A country-only place is an estimate, so everything that marks it is
    // dashed: the crosshair and the ring say "about here", not "here".
    const dash = exact ? undefined : "2 3";
    const [x, y] = d.point ?? [W / 2, H / 2 - 16];
    return (
        <svg
            viewBox={`0 0 ${W} ${H}`}
            // Fit, not fill: the whole globe is the picture, so a rail taller
            // than the drawing letterboxes it rather than cropping its sides.
            preserveAspectRatio="xMidYMid meet"
            className="absolute inset-0 size-full"
            role="img"
            aria-label={`Globe centred on ${degrees(d.lat, d.lon)}`}
        >
            <clipPath id={clip}>
                <path d={d.sphere} />
            </clipPath>
            <path d={d.sphere} className="fill-foreground/[0.04]" />
            <path d={d.graticule} className="fill-none stroke-foreground/[0.07]" />
            <path d={d.land} className="fill-foreground/[0.12] stroke-card" strokeWidth={0.5} />
            {d.country && (
                <path d={d.country} className="fill-current/60 stroke-current" strokeWidth={0.6} />
            )}
            <g
                className="stroke-current"
                strokeWidth={0.6}
                opacity={0.45}
                strokeDasharray={dash}
                clipPath={`url(#${clip})`}
            >
                <line x1={0} x2={W} y1={y} y2={y} />
                <line x1={x} x2={x} y1={0} y2={H} />
            </g>
            <path
                d={d.ring}
                className={exact ? "fill-current/15 stroke-current" : "fill-none stroke-current"}
                strokeWidth={1}
                strokeDasharray={exact ? undefined : "3 2"}
            />
            {d.point && <circle cx={x} cy={y} r={3.6} className="fill-current" />}
            <path d={d.sphere} className="fill-none stroke-foreground/30" strokeWidth={0.8} />
        </svg>
    );
}

function degrees(lat = 0, lon = 0): string {
    const ns = lat >= 0 ? "N" : "S";
    const ew = lon >= 0 ? "E" : "W";
    return `${Math.abs(lat).toFixed(2)}${ns} ${Math.abs(lon).toFixed(2)}${ew}`;
}
