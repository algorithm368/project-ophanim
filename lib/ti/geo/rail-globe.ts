import { geoCircle, geoGraticule10, geoOrthographic, geoPath } from "d3-geo";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import world from "world-atlas/countries-110m.json";
import { COUNTRY_CENTRES } from "./country-centres";
import type { RailPlace } from "./rail-place";

/**
 * The rail's globe, as SVG path data.
 *
 * This is the heavy half of the rail map (the atlas and d3), and it is only
 * ever loaded with a dynamic import, so a result page's own bundle does not
 * carry it. Drawn in the browser rather than on the server so the map costs a
 * lookup nothing, and from a bundled outline rather than map tiles so it never
 * tells a tile server which region an analyst is looking at.
 *
 * The 110m outline is the whole world at this size. Its one gap is the
 * countries too small to be in it, Singapore among them, which a country-only
 * result still needs placed: `COUNTRY_CENTRES` holds every centre, from the
 * 50m outline, for that.
 */

/** The drawing's box. The globe sits a little above centre, so the caption
 *  under it in the tile does not cover its southern edge. */
export const GLOBE_W = 320;
export const GLOBE_H = 380;
const CX = GLOBE_W / 2;
const CY = GLOBE_H / 2 - 16;
const RADIUS = 148;

const topo = world as unknown as Topology<{ countries: GeometryCollection }>;
const COUNTRIES = (feature(topo, topo.objects.countries) as FeatureCollection<Geometry>).features;

export interface GlobeDrawing {
  sphere: string;
  graticule: string;
  land: string;
  /** The country, shaded, when the place is only a country and the outline
   *  has it. */
  country: string | null;
  /** A ring round the place: tight for a point, wider for a country. */
  ring: string;
  /** The point itself, in the drawing's box. Null for a country-only place. */
  point: [number, number] | null;
  /** Where the globe is turned to: the point, or the country's centre. */
  lat: number;
  lon: number;
}

/** Null when the place is a country code the atlas does not know. */
export function drawGlobe(place: RailPlace): GlobeDrawing | null {
  const at = centreOf(place);
  if (!at) return null;
  const projection = geoOrthographic()
    .rotate([-at.lon, -at.lat])
    .scale(RADIUS)
    .translate([CX, CY])
    .clipAngle(90);
  const path = geoPath(projection).digits(1);
  const draw = (g: Parameters<typeof path>[0]) => path(g) ?? "";
  // Several features in the outline have no id at all, so a country without
  // one must not match them.
  const shape = at.id ? COUNTRIES.find((f) => f.id === at.id) : undefined;

  return {
    sphere: draw({ type: "Sphere" }),
    graticule: draw(geoGraticule10()),
    land: COUNTRIES.map(draw).join(""),
    country: shape ? draw(shape as Feature) : null,
    ring: draw(geoCircle().center([at.lon, at.lat]).radius(at.exact ? 4 : 5)()),
    point: at.exact ? projection([at.lon, at.lat]) : null,
    lat: at.lat,
    lon: at.lon,
  };
}

function centreOf(
  place: RailPlace,
): { lat: number; lon: number; exact: boolean; id?: string } | null {
  if (place.lat !== undefined && place.lon !== undefined) {
    return { lat: place.lat, lon: place.lon, exact: true };
  }
  const centre = place.countryCode ? COUNTRY_CENTRES[place.countryCode.toUpperCase()] : undefined;
  if (!centre) return null;
  const [lon, lat, id] = centre;
  return { lat, lon, exact: false, id };
}
