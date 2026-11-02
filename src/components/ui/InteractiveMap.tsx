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
import type { MapSurfaceHandle } from './map-imperative';

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
  /**
   * The marker's shape.
   *
   * ★ A PLACE IS A PIN; THE READER IS A DOT.
   *
   * A proposal is somewhere the group is being asked to go, so it is a teardrop
   * whose point sits on the coordinate. The viewer's own start point is not a
   * destination at all, and drawing it as another pin made it read as one more
   * option on the list. It is a circle, centred on the coordinate — the dot every
   * map application uses for "you are here". Omitted means `'pin'`, so every
   * existing call site is unchanged.
   */
  shape?: 'pin' | 'circle';
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
  /**
   * The camera's pose. NOT a controlled value.
   *
   * ★ THE MAP APPLIES THIS ONCE PER DISTINCT POSE, THEN LEAVES THE CAMERA ALONE.
   *
   * Both renderers used to push every camera change straight back in, so a pinch
   * or a tilt was reverted the moment the reported camera reached the parent: the
   * gesture settled, `onCameraChange` lifted the result, the parent re-rendered
   * with a new object, and the effect below wrote it back — undoing what the
   * fingers had just done. The reported defect is exactly that, on both axes.
   *
   * The pose is compared by VALUE (see `cameraKey`), so a re-render that rebuilds
   * an equal object does nothing, and a caller who deliberately re-frames — a new
   * bounding box, the locate-me button — still moves the map.
   */
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
  /**
   * Corner controls: the `+`/`−` pair every map surface draws.
   *
   * ★ ZOOM IS NOT A CAMERA PROP, AND THAT IS WHY THIS EXISTS.
   *
   * A zoom button written as `setZoom(camera.zoom + 1)` writes the caller's pose,
   * the renderer sees a new `cameraKey`, and `jumpTo` re-frames the map onto the
   * centre it was BUILT with — the reported "when I zoom, the map returns to the
   * pin". A control that asks the surface to zoom behaves like a pinch: the map
   * moves and the camera stays where the reader left it. The locate-me / auto-pin
   * control is deliberately NOT part of it — the event page and the proposal cards
   * are read-only views, and a control that moves the camera back to a marker is
   * the gesture-undo defect wearing a button's clothes.
   *
   * Defaults to `false`, so a surface that is decoration (a legend-sized frame)
   * stays quiet.
   */
  controls?: boolean;
  /**
   * The scrolling ancestor the map must stand down while a finger is on it.
   *
   * ★ A MAP INSIDE A SCROLL VIEW IS A DIFFERENT PROBLEM FROM A MAP ALONE, AND IT
   *   IS A PROPERTY OF THE ANCESTOR.
   *
   * On Android the map is a `WebView`, which takes no part in React Native's
   * responder negotiation — so an ancestor `ScrollView` intercepts a vertical drag
   * as soon as it passes `touchSlop`, scrolls the page, and cancels the touch the
   * map was handling. `nestedScrollEnabled={false}` is an `UIScrollView` behaviour
   * and reaches nothing there. The measured report is exactly this: "dragging the
   * map vertically on a scrollable page scrolls the page instead", while the same
   * map inside a non-scrolling overlay (the location sheet) works.
   *
   * So the surface is given the ancestor, and holds it disabled for the duration
   * of each touch — see `MAP_ANCESTOR_LOCK_KEY` for why that is the one lever that
   * works and which three gesture-based attempts were already measured and
   * rejected.
   *
   * Omit it when there is no scrolling ancestor: a map inside a fixed-height
   * overlay has nothing to lock, and passing a wrong ref would disable the page.
   */
  ancestorScroll?: React.RefObject<AncestorScrollHandle | null>;
  testID?: string;
}

/**
 * The one method the lock uses on an ancestor scroll view.
 *
 * Narrowed deliberately: `setNativeProps` is what writes `scrollEnabled` without a
 * React render, and a React `ScrollView` satisfies this shape. Declaring it this
 * way keeps the surface from depending on the whole `ScrollView` type.
 */
export interface AncestorScrollHandle {
  setNativeProps(props: { scrollEnabled: boolean }): void;
}

/**
 * The props this module's fallback accepts — identical to the real surface.
 */
export type { Coordinate };

/** The handle a map surface exposes through its ref. */
export type { MapSurfaceHandle };

/**
 * The type-system fallback. Metro always substitutes a real implementation, so
 * this body is unreachable — it exists only so `tsc` can resolve the import.
 *
 * ★ IT TAKES A `ref` IN ITS TYPE, BECAUSE BOTH REAL SURFACES DO.
 *
 * Zoom is imperative (see `map-imperative.ts`), so callers pass a ref to ask the
 * map to zoom. The fallback never runs, but a caller's `ref` has to type-check
 * against it — `tsc` resolves the bare specifier, not the platform sibling.
 */
export function InteractiveMap(
  _props: InteractiveMapProps & { ref?: React.Ref<MapSurfaceHandle | null> },
): never {
  throw new Error(
    'InteractiveMap: Metro must resolve InteractiveMap.native.tsx or InteractiveMap.web.tsx',
  );
}
