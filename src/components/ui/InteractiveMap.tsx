/**
 * The interactive map's props and the type-system fallback.
 *
 * ★ METRO SUBSTITUTES `InteractiveMap.web.tsx` OR `.native.tsx`. THIS FILE IS NEVER
 *   THE ONE THAT RUNS.
 *
 * Same rule as `src/platform/haptics.ts`: `tsc` does not resolve platform
 * suffixes, so a bare `import { InteractiveMap } from './InteractiveMap'`
 * type-checks only because a suffix-free module exists. It must therefore stay
 * PURE — types and a throw, nothing else — because any tooling that ignores
 * suffixes will evaluate it.
 *
 * ★ THE TWO IMPLEMENTATIONS ARE DIFFERENT LIBRARIES, NOT DIFFERENT BRANCHES.
 *
 * Web uses `mapbox-gl` (a DOM library). Native uses `react-native-maps` with
 * MapBox raster tiles overlaid. Neither can be imported from a shared file: the
 * web bundle dies at import time, before any `Platform.OS` branch is consulted.
 * The shared surface below is what keeps the call sites from knowing.
 */

import type { Coordinate } from '@/src/routing/types';

/** A marker on the map. */
export interface MapMarker {
  /** A stable id, so a re-render moves a marker rather than replacing it. */
  id: string;
  coordinate: Coordinate;
  /** The marker's colour. Defaults to the appearance's accent. */
  color?: string;
  /** Announced to assistive technology, and required — a dot says nothing. */
  label: string;
  /** Whether this marker is the selected one. */
  selected?: boolean;
}

/**
 * A line to draw.
 *
 * `points` is GEOJSON ORDER — `[lng, lat]`. Both renderers take that order, and
 * the server's geometry endpoint already answers in it, so the switch is never
 * made downstream.
 */
export interface MapLine {
  id: string;
  points: Array<[number, number]>;
  color: string;
  /** `true` for a straight-line fallback, drawn dashed so it is honest. */
  dashed?: boolean;
}

/** An approximate area — never a pin (FR-4.7, FR-8.16). */
export interface MapCircle {
  id: string;
  coordinate: Coordinate;
  /** The radius in METRES, sized to the fix's accuracy. */
  radiusMetres: number;
  color: string;
  label: string;
}

/** The camera, as the callers express it. */
export interface MapCamera {
  centre: Coordinate;
  zoom: number;
  /** The resting tilt, in degrees. 0 is flat. */
  pitch: number;
  bearing: number;
}

export interface InteractiveMapProps {
  /** The camera's initial pose. Later camera moves are the user's. */
  camera: MapCamera;
  markers?: MapMarker[];
  lines?: MapLine[];
  circles?: MapCircle[];
  /** The app theme, which selects the basemap style. */
  theme: 'light' | 'dark';
  /** The app's accent, for markers and lines that do not name their own. */
  accent: string;
  /**
   * Fires when the user taps the map.
   *
   * Omitted on a read-only map, which is what makes "view, not change" a
   * property of the surface rather than a review note.
   */
  onPress?: (coordinate: Coordinate) => void;
  /** Fires after every settled camera move, so the caller can track the centre. */
  onCameraChange?: (camera: MapCamera) => void;
  /**
   * Called when the basemap cannot draw at all — no token, a refused style, a
   * library that failed to initialise. The caller shows its stated state.
   */
  onUnavailable?: () => void;
  /** Whether the basemap finished its first draw. Drives the caller's spinner. */
  onReady?: () => void;
  testID?: string;
}

/** The props this module's fallback accepts — identical to the real surface. */
export type { Coordinate };

/**
 * The type-system fallback. Metro always substitutes a real implementation, so
 * this body is unreachable — it exists only so `tsc` can resolve the import.
 */
export function InteractiveMap(_props: InteractiveMapProps): never {
  throw new Error(
    'InteractiveMap: Metro must resolve InteractiveMap.native.tsx or InteractiveMap.web.tsx',
  );
}
