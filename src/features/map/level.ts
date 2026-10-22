/**
 * Choosing the rung of the ladder (Plan 08 Task 7, D19, D1).
 *
 * ★ NEITHER RENDERER IS INSTALLED, AND THE MAP MUST NOT ASSUME ONE.
 *
 * `@rnmapbox/maps` and `@maplibre/maplibre-react-native` are both native
 * modules requiring a development build — neither is in Expo Go. Rather than
 * import a package that may not exist and crash the event screen, the level
 * is resolved from configuration plus the platform, and an unavailable
 * renderer resolves DOWN the ladder instead of throwing.
 *
 * ★ THIS MODULE MUST NOT IMPORT A NATIVE MODULE.
 *
 * It is read on the web bundle and under the Node test runner. A static
 * import of either renderer here would break both at import time.
 */

import type { BBox, MapRenderLevel } from './types';
import type { Coordinate } from '@/src/routing/types';

/**
 * The configured provider.
 *
 * Read from Expo's public env at module scope, exactly like
 * `I18nManager.forceRTL` in D11A: a mapping token must be set before the
 * first map mounts, and setting it later yields a blank map with no useful
 * error. Deciding the level at import time is what makes that impossible.
 */
export function configuredProvider(): 'mapbox' | 'maplibre' | 'none' {
  const raw = readEnv('EXPO_PUBLIC_MAP_PROVIDER');
  if (raw === 'mapbox') return 'mapbox';
  if (raw === 'maplibre') return 'maplibre';
  return 'none';
}

/**
 * Resolves the rung this build can actually render.
 *
 * `platform` is injected rather than imported so the decision is testable.
 * The returned level is what the screen reports in `map_viewed.render_level`.
 */
export function resolveMapLevel(
  platform: 'native' | 'web' | 'node',
  provider: 'mapbox' | 'maplibre' | 'none' = configuredProvider(),
): MapRenderLevel {
  // Web has no development-build renderer in this product: the web export is
  // a demo surface, and a DOM map would be a second implementation of the
  // adapter. It goes straight to list-only.
  if (platform === 'web') return 4;

  if (provider === 'mapbox') return 1;
  if (provider === 'maplibre') return 2;

  // No provider configured: level 3 would be a static image we do not
  // generate, so the honest resting place is list-only.
  return 4;
}

/**
 * Whether a level is a legitimate shipping state.
 *
 * Levels 3 and 4 are NOT failures — the screen renders them with a note, not
 * an error boundary. Only a thrown component is a failure.
 */
export function isDegradedLevel(level: MapRenderLevel): boolean {
  return level === 3 || level === 4;
}

/**
 * Reads a public Expo env var without a hard dependency on `process`.
 *
 * `EXPO_PUBLIC_*` values are inlined at build time; under Node they may be
 * absent, and a missing value must read as "not configured" rather than throw.
 */
function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  return env?.[name];
}

/**
 * The bounding box of a set of coordinates, padded.
 *
 * ★ THE CAMERA FRAMES THE EVENT, NEVER ONE PARTICIPANT (FR-8.16, D19).
 *
 * The viewport is sent to the tile provider on every tile request, so a
 * camera centred on a precise fix leaks exactly what the fuzzed data was
 * protecting. Framing the whole event means the viewport reveals nothing that
 * the event's own venues and areas do not already reveal.
 *
 * Returns `null` for an empty set, so the caller can pick the single-
 * participant default rather than receiving a box at (0, 0).
 */
export function boundingBox(coordinates: Coordinate[], paddingRatio = 0): BBox | null {
  if (coordinates.length === 0) return null;

  let south = coordinates[0]!.lat;
  let north = coordinates[0]!.lat;
  let west = coordinates[0]!.lng;
  let east = coordinates[0]!.lng;

  for (const point of coordinates) {
    if (point.lat < south) south = point.lat;
    if (point.lat > north) north = point.lat;
    if (point.lng < west) west = point.lng;
    if (point.lng > east) east = point.lng;
  }

  // A degenerate box (everyone in one building) is WIDENED around its own
  // centre, so the map does not zoom to a rooftop. Widening rather than
  // clamping to a minimum span matters: clamping would shrink a box that was
  // already wider than the minimum and drop points outside the viewport.
  const centreLat = (south + north) / 2;
  const centreLng = (west + east) / 2;

  const halfLat = Math.max((north - south) / 2, MIN_SPAN_DEGREES / 2);
  const halfLng = Math.max((east - west) / 2, MIN_SPAN_DEGREES / 2);

  const latPad = halfLat * paddingRatio;
  const lngPad = halfLng * paddingRatio;

  return {
    southWest: { lat: centreLat - halfLat - latPad, lng: centreLng - halfLng - lngPad },
    northEast: { lat: centreLat + halfLat + latPad, lng: centreLng + halfLng + lngPad },
  };
}

/** The minimum span, in degrees, before padding.
 *
 * About 1.1 km of latitude — roughly a neighbourhood. Smaller than this and
 * the camera is effectively pointing at a person.
 */
export const MIN_SPAN_DEGREES = 0.01;

/**
 * The circle radius for a participant's approximate area.
 *
 * Sized to `accuracyM` so the circle never implies more precision than the
 * data has. Floored and capped so a good fix is still visible and a bad one
 * does not swallow the city.
 */
export function radiusForAccuracy(accuracyM: number): number {
  const clamped = Math.min(Math.max(accuracyM, MIN_AREA_RADIUS_M), MAX_AREA_RADIUS_M);
  return clamped;
}

/** The smallest circle drawn, in metres — a 5 m fix is still an area. */
const MIN_AREA_RADIUS_M = 250;

/** The largest circle drawn, in metres. */
const MAX_AREA_RADIUS_M = 2000;
