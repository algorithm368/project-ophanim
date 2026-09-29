"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  geoCircle,
  geoContains,
  geoGraticule10,
  geoInterpolate,
  geoNaturalEarth1,
  geoPath,
} from "d3-geo";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import world from "world-atlas/countries-110m.json";
import { Maximize2, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatKm, type Site } from "@/lib/ti/geo/distance";

/**
 * The batch on a flat world map, drawn from a bundled outline rather than map
 * tiles. Two reasons: it stays in the page's grey, and it never asks a tile
 * server for the region an analyst is looking at, which for a threat-intel tool
 * is itself a signal worth not leaking.
 */

const W = 960;
const H = 500;
const MAX_ZOOM = 12;

const projection = geoNaturalEarth1().fitExtent(
  [
    [4, 4],
    [W - 4, H - 4],
  ],
  { type: "Sphere" },
);
const path = geoPath(projection);

const topo = world as unknown as Topology<{ countries: GeometryCollection }>;
const COUNTRIES = (
  feature(topo, topo.objects.countries) as FeatureCollection<Geometry>
).features.map((f, i) => ({ key: String(f.id ?? i), f, d: path(f) ?? "" }));
const SPHERE = path({ type: "Sphere" }) ?? "";
const GRATICULE = path(geoGraticule10()) ?? "";

interface View {
  k: number;
  x: number;
  y: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Keep the map covering the frame: no panning off into empty space. */
function bounded({ k, x, y }: View): View {
  const kk = clamp(k, 1, MAX_ZOOM);
  return { k: kk, x: clamp(x, W - W * kk, 0), y: clamp(y, H - H * kk, 0) };
}

function project(site: Site): [number, number] | null {
  return projection([site.lon, site.lat]);
}

/** The view that frames every site, with room around the edges. */
function fitView(sites: Site[]): View {
  const pts = sites.map(project).filter((p): p is [number, number] => !!p);
  if (!pts.length) return { k: 1, x: 0, y: 0 };
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const pad = 70;
  const bw = Math.max(...xs) - Math.min(...xs) + pad * 2;
  const bh = Math.max(...ys) - Math.min(...ys) + pad * 2;
  const k = clamp(Math.min(W / bw, H / bh), 1, 5);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  return bounded({ k, x: W / 2 - cx * k, y: H / 2 - cy * k });
}

function zoomAt(v: View, factor: number, px: number, py: number): View {
  const k = clamp(v.k * factor, 1, MAX_ZOOM);
  const r = k / v.k;
  return bounded({ k, x: px - (px - v.x) * r, y: py - (py - v.y) * r });
}

/** Zoom and pan state, with ctrl/⌘ + wheel zoom (a bare wheel scrolls the
 *  page, since the map sits in the middle of a long readout) and drag to pan. */
function useMapView(sites: Site[]) {
  // Framed once: the readout unmounts while a new batch loads, so a new set of
  // sites always arrives with a fresh component.
  const [initial] = useState(() => fitView(sites));
  const [view, setView] = useState(initial);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; view: View; moved: boolean } | null>(
    null,
  );

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = svg!.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * W;
      const py = ((e.clientY - rect.top) / rect.height) * H;
      setView((v) => zoomAt(v, e.deltaY < 0 ? 1.25 : 0.8, px, py));
    }
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const scale = () => W / (svgRef.current?.getBoundingClientRect().width || W);

  const handlers = {
    onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
      drag.current = { x: e.clientX, y: e.clientY, view, moved: false };
    },
    onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
      const d = drag.current;
      if (!d) return;
      const dx = (e.clientX - d.x) * scale();
      const dy = (e.clientY - d.y) * scale();
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      if (!d.moved) e.currentTarget.setPointerCapture(e.pointerId);
      d.moved = true;
      setView(bounded({ k: d.view.k, x: d.view.x + dx, y: d.view.y + dy }));
    },
    onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      // Leave the flag set until the click that follows has read it.
      setTimeout(() => (drag.current = null));
    },
  };
  const wasDrag = () => Boolean(drag.current?.moved);

  return {
    view,
    svgRef,
    handlers,
    wasDrag,
    zoomBy: (f: number) => setView((v) => zoomAt(v, f, W / 2, H / 2)),
    reset: () => setView(initial),
  };
}

/** Countries holding at least one site, shaded a step darker than the rest. */
function useOccupied(sites: Site[]): Set<string> {
  return useMemo(() => {
    const out = new Set<string>();
    for (const c of COUNTRIES) {
      if (sites.some((s) => geoContains(c.f as Feature, [s.lon, s.lat]))) {
        out.add(c.key);
      }
    }
    return out;
  }, [sites]);
}

export interface MapProps {
  sites: Site[];
  /** Sites to draw at full strength; the rest fade (the table's filter). */
  visible: ReadonlySet<string>;
  anchorIp: string | null;
  hoverIp: string | null;
  distances: ReadonlyMap<string, number>;
  /** The spread's hub and radius, drawn as a ring when not measuring. */
  hub?: { site: Site; radiusKm: number };
  onAnchor: (ip: string | null) => void;
  onHover: (ip: string | null) => void;
}

function Basemap({ occupied, k }: Readonly<{ occupied: Set<string>; k: number }>) {
  return (
    <>
      <path d={SPHERE} className="fill-background" />
      <path
        d={GRATICULE}
        className="fill-none stroke-foreground/[0.06]"
        vectorEffect="non-scaling-stroke"
      />
      {COUNTRIES.map((c) => (
        <path
          key={c.key}
          d={c.d}
          className={cn(
            "stroke-background",
            occupied.has(c.key) ? "fill-foreground/25" : "fill-foreground/[0.09]",
          )}
          strokeWidth={0.6 / k}
        />
      ))}
      <path
        d={SPHERE}
        className="fill-none stroke-foreground/20"
        vectorEffect="non-scaling-stroke"
      />
    </>
  );
}

function arcOf(a: Site, b: Site): string {
  return (
    path({
      type: "LineString",
      coordinates: [
        [a.lon, a.lat],
        [b.lon, b.lat],
      ],
    }) ?? ""
  );
}

/** Lines from the anchor to every other site, with a km label on each when
 *  there are few enough to read, or on the hovered one otherwise. */
function Arcs({
  anchor,
  sites,
  hoverKey,
  distances,
  k,
}: Readonly<{
  anchor: Site;
  sites: Site[];
  hoverKey: string | null;
  distances: ReadonlyMap<string, number>;
  k: number;
}>) {
  const others = sites.filter((s) => s.key !== anchor.key);
  const labelAll = others.length <= 8;
  return (
    <g>
      {others.map((s) => (
        <path
          key={s.key}
          d={arcOf(anchor, s)}
          className={cn(
            "fill-none",
            s.key === hoverKey ? "stroke-foreground" : "stroke-foreground/35",
          )}
          strokeDasharray={s.precision === "country" ? "4 3" : undefined}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {others
        .filter((s) => labelAll || s.key === hoverKey)
        .map((s) => {
          const km = distances.get(s.ips[0]);
          const mid = projection(
            geoInterpolate([anchor.lon, anchor.lat], [s.lon, s.lat])(0.5),
          );
          if (km === undefined || !mid) return null;
          return (
            <text
              key={s.key}
              x={mid[0]}
              y={mid[1] - 4 / k}
              textAnchor="middle"
              fontSize={11 / k}
              className="fill-foreground font-mono"
              paintOrder="stroke"
              stroke="var(--background)"
              strokeWidth={3 / k}
            >
              {formatKm(km)}
            </text>
          );
        })}
    </g>
  );
}

function HubRing({ hub, k }: Readonly<{ hub: NonNullable<MapProps["hub"]>; k: number }>) {
  const ring = geoCircle()
    .center([hub.site.lon, hub.site.lat])
    .radius(hub.radiusKm / 111.195)();
  return (
    <path
      d={path(ring) ?? ""}
      className="fill-foreground/[0.04] stroke-foreground/40"
      strokeDasharray={`${3 / k} ${3 / k}`}
      strokeWidth={1 / k}
    />
  );
}

function Dot({
  site,
  k,
  faded,
  isAnchor,
  isHover,
  onEnter,
  onLeave,
  onPick,
}: Readonly<{
  site: Site;
  k: number;
  faded: boolean;
  isAnchor: boolean;
  isHover: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onPick: () => void;
}>) {
  const p = project(site);
  if (!p) return null;
  const r = (3.5 + Math.sqrt(site.ips.length) * 2) / k;
  const approx = site.precision === "country";
  const label = `${site.label}, ${site.ips.length === 1 ? site.ips[0] : `${site.ips.length} addresses`}${isAnchor ? ", anchor" : ""}`;
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={isAnchor}
      className={cn("cursor-pointer outline-none", faded && "opacity-20")}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick();
        }
      }}
    >
      {/* A generous invisible hit area: a 4px dot is not a target. */}
      <circle cx={p[0]} cy={p[1]} r={Math.max(r, 9 / k)} className="fill-transparent" />
      {(isAnchor || isHover) && (
        <circle
          cx={p[0]}
          cy={p[1]}
          r={r + 4 / k}
          className="fill-none stroke-foreground"
          strokeWidth={1.5 / k}
        />
      )}
      <circle
        cx={p[0]}
        cy={p[1]}
        r={r}
        className={cn(
          approx ? "fill-background stroke-foreground" : "fill-foreground stroke-background",
        )}
        strokeWidth={(approx ? 1.5 : 1) / k}
        strokeDasharray={approx ? `${2 / k} ${1.5 / k}` : undefined}
      />
    </g>
  );
}

function Tip({
  site,
  view,
  anchorIp,
  distances,
}: Readonly<{
  site: Site;
  view: View;
  anchorIp: string | null;
  distances: ReadonlyMap<string, number>;
}>) {
  const p = project(site);
  if (!p) return null;
  const left = ((view.x + p[0] * view.k) / W) * 100;
  const top = ((view.y + p[1] * view.k) / H) * 100;
  const km = distances.get(site.ips[0]);
  const shown = site.ips.slice(0, 6);
  return (
    <div
      className="pointer-events-none absolute z-10 w-max max-w-64 rounded-md border border-foreground/20 bg-popover px-2.5 py-2 text-xs shadow-md"
      style={{
        left: `${left}%`,
        top: `${top}%`,
        transform: `translate(${left > 70 ? "-100%" : "0"}, ${top > 60 ? "calc(-100% - 12px)" : "12px"})`,
      }}
    >
      <div className="font-medium text-foreground">{site.label}</div>
      {site.precision === "country" && (
        <div className="text-muted-foreground">Country level only, position approximate</div>
      )}
      <ul className="mt-1 font-mono text-[11px] text-foreground/80">
        {shown.map((ip) => (
          <li key={ip}>{ip}</li>
        ))}
        {site.ips.length > shown.length && (
          <li className="text-muted-foreground">+{site.ips.length - shown.length} more</li>
        )}
      </ul>
      {anchorIp && km !== undefined && !site.ips.includes(anchorIp) && (
        <div className="mt-1 text-muted-foreground">
          {formatKm(km)} from {anchorIp}
        </div>
      )}
    </div>
  );
}

const CONTROL =
  "flex size-7 items-center justify-center rounded-md border border-foreground/20 bg-background/90 text-muted-foreground hover:text-foreground disabled:opacity-40";

export function WorldMap({
  sites,
  visible,
  anchorIp,
  hoverIp,
  distances,
  hub,
  onAnchor,
  onHover,
}: Readonly<MapProps>) {
  const { view, svgRef, handlers, wasDrag, zoomBy, reset } = useMapView(sites);
  const occupied = useOccupied(sites);
  const [tipKey, setTipKey] = useState<string | null>(null);

  const siteOfIp = (ip: string | null) =>
    ip ? sites.find((s) => s.ips.includes(ip)) : undefined;
  const anchor = siteOfIp(anchorIp);
  const hovered = siteOfIp(hoverIp) ?? sites.find((s) => s.key === tipKey);
  // Draw the highlighted sites last, so they sit on top of their neighbours.
  const ordered = [...sites].sort(
    (a, b) =>
      Number(a === anchor || a === hovered) - Number(b === anchor || b === hovered),
  );

  return (
    <div className="relative overflow-hidden rounded-md border-2 border-foreground/20 bg-muted/30">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`World map of ${sites.length} located ${sites.length === 1 ? "place" : "places"}`}
        className="block h-auto w-full cursor-grab touch-none select-none active:cursor-grabbing"
        {...handlers}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <Basemap occupied={occupied} k={view.k} />
          {!anchor && hub && hub.site.ips.length > 0 && <HubRing hub={hub} k={view.k} />}
          {anchor && (
            <Arcs
              anchor={anchor}
              sites={sites}
              hoverKey={hovered?.key ?? null}
              distances={distances}
              k={view.k}
            />
          )}
          {ordered.map((s) => (
            <Dot
              key={s.key}
              site={s}
              k={view.k}
              faded={!s.ips.some((ip) => visible.has(ip))}
              isAnchor={s === anchor}
              isHover={s === hovered}
              onEnter={() => {
                setTipKey(s.key);
                onHover(s.ips[0]);
              }}
              onLeave={() => {
                setTipKey(null);
                onHover(null);
              }}
              onPick={() => {
                if (wasDrag()) return;
                onAnchor(s === anchor ? null : s.ips[0]);
              }}
            />
          ))}
        </g>
      </svg>

      {hovered && (
        <Tip site={hovered} view={view} anchorIp={anchorIp} distances={distances} />
      )}

      <div className="absolute top-2 right-2 flex flex-col gap-1">
        <button type="button" aria-label="Zoom in" className={CONTROL} onClick={() => zoomBy(1.5)} disabled={view.k >= MAX_ZOOM}>
          <Plus className="size-3.5" />
        </button>
        <button type="button" aria-label="Zoom out" className={CONTROL} onClick={() => zoomBy(1 / 1.5)} disabled={view.k <= 1}>
          <Minus className="size-3.5" />
        </button>
        <button type="button" aria-label="Fit to addresses" className={CONTROL} onClick={reset}>
          <Maximize2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

/** The key under the map: what the marks mean and how to drive it. */
export function MapLegend({ measuring }: Readonly<{ measuring: boolean }>) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-full bg-foreground" /> city
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-full border border-dashed border-foreground" /> country
        level only
      </span>
      {measuring ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-full border-[1.5px] border-foreground p-px">
            <span className="block size-full rounded-full bg-foreground" />
          </span>
          anchor
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-full border border-dashed border-foreground/60 bg-foreground/5" />
          500 km around the densest place
        </span>
      )}
      <span className="ml-auto hidden sm:inline">
        click a dot to measure from it, drag to pan, ctrl + scroll to zoom
      </span>
    </div>
  );
}
