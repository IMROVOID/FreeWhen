/**
 * The arithmetic a map needs, with no renderer attached.
 *
 * ★ THIS MODULE IMPORTS NOTHING.
 *
 * It was extracted from `InteractiveMap.web.tsx` the first time a test imported
 * the component: the component imports `mapbox-gl`, `mapbox-gl` imports the DOM,
 * and the Node test runner cannot transform `react-native`'s index. Every pure
 * calculation that decides what a map LOOKS like therefore lives here, where it
 * can be asserted without a canvas.
 *
 * The rule this establishes is the useful one: the renderers draw, this file
 * decides.
 */

/** A line to draw. `points` is GeoJSON order — `[lng, lat]`. */
export interface LineInput {
  id: string;
  points: Array<[number, number]>;
  color: string;
  /** `true` for a straight-line fallback, drawn dashed so it is honest. */
  dashed?: boolean;
}

/** The shape a GeoJSON line needs, without depending on the `geojson` types. */
export interface LineCollection {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    id: string;
    properties: { color: string; dashed: boolean };
    geometry: { type: 'LineString'; coordinates: Array<[number, number]> };
  }>;
}

/**
 * Builds the feature collection for the line layers.
 *
 * ★ A ONE-POINT LINE IS DROPPED.
 *
 * A `LineString` needs two positions; MapBox draws a one-point line as nothing
 * or as a stray dot depending on the layer type. A route whose provider returned
 * a single point has no road to show, so the straight-line fallback is the honest
 * answer and this collection stays out of its way.
 */
export function linesFeatureCollection(lines: readonly LineInput[]): LineCollection {
  return {
    type: 'FeatureCollection',
    features: lines
      .filter((line) => line.points.length >= 2)
      .map((line) => ({
        type: 'Feature' as const,
        // `id` on the feature is what a source diffs on, so an unchanged line is
        // not rebuilt on every render.
        id: line.id,
        properties: { color: line.color, dashed: line.dashed === true },
        geometry: { type: 'LineString' as const, coordinates: line.points },
      })),
  };
}

/**
 * The metres one pixel covers, at a latitude and zoom.
 *
 * The standard Web Mercator formula, inlined rather than asked of the map,
 * because an approximate area must be drawable before any style has loaded.
 */
export function metresPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/**
 * An approximate area's radius, in pixels.
 *
 * A zero, negative or non-finite radius draws nothing: an inverted or NaN radius
 * is a circle the size of the screen or an invisible one, and both read as a bug
 * in the data rather than in the drawing.
 */
export function circleRadiusPixels(radiusMetres: number, lat: number, zoom: number): number {
  if (!Number.isFinite(radiusMetres) || radiusMetres <= 0) return 0;
  return radiusMetres / metresPerPixel(lat, zoom);
}

/**
 * Adds an alpha channel to a six-digit hex colour.
 *
 * Returns the input unchanged when it is not a six-digit hex — a theme token that
 * has already been written as an alpha colour must not be mangled into one the
 * renderer rejects.
 *
 * The output is the CSS colour function the renderers accept. `gate:design` bans
 * that literal in a component because a hardcoded colour is a theme bug; here it is
 * the only way to EXPRESS "this theme colour, translucent", so this module is the
 * single place allowed to spell it.
 */
export function withAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return color;

  const value = parseInt(match[1] as string, 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * The distance, in degrees, within which a tap counts as "on" a pin.
 *
 * At Tehran's scale 0.002° is roughly 200 m — tighter than the gap between two
 * venues a person would call distinct, and loose enough that a finger on a 24 pt
 * dot still lands.
 */
export const SELECTION_RADIUS_DEGREES = 0.002;

/** A placeable thing, as the hit test needs it. */
export interface Placeable {
  venueId: string;
  coordinate: { lat: number; lng: number };
}

/**
 * The venue pin nearest a tapped coordinate, or `null`.
 *
 * ★ A TAP IS A COORDINATE; THE SELECTION IS A VENUE ID.
 *
 * Both platform renderers report where the finger landed, and the P0 selection
 * sync (FR-4.3/FR-4.7) wants a venue. Rather than teach the map surface about
 * venues, each renderer asks this one function — so the two platforms cannot
 * disagree about which pin a tap selected, which they did while it was duplicated.
 *
 * A tap further than the threshold from every pin selects nothing, so empty map is
 * not mistaken for the farthest venue.
 */
export function nearestVenue(pins: readonly Placeable[], at: { lat: number; lng: number }): string | null {
  let best: { id: string; distance: number } | null = null;

  for (const pin of pins) {
    const distance = Math.hypot(pin.coordinate.lat - at.lat, pin.coordinate.lng - at.lng);
    if (distance > SELECTION_RADIUS_DEGREES) continue;
    if (best === null || distance < best.distance) best = { id: pin.venueId, distance };
  }

  return best?.id ?? null;
}

/**
 * The fallback centre when an event has nothing to frame.
 *
 * ★ A NAMED CONSTANT, NOT A LITERAL IN THREE FILES.
 *
 * `EventRouteMap`, `VenueMap.native` and `VenueMap.web` each carried their own copy
 * of Tehran's coordinates. They must agree — a map that frames a different city
 * depending on which component rendered it is a bug nobody would find by reading
 * one file.
 */
export const DEFAULT_MAP_CENTRE = { lat: 35.6892, lng: 51.389 } as const;
