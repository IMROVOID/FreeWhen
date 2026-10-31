/**
 * The interactive map, in the browser.
 *
 * ★ `mapbox-gl` IS A DOM LIBRARY, WHICH IS WHY THIS FILE EXISTS.
 *
 * It touches `document`, `window` and WebGL at module scope. Imported from a
 * shared file it would break the native bundle, and imported from the `.native`
 * sibling it would break this one. Metro's `.web.tsx` substitution is the only
 * mechanism that removes it from the native bundle — a `Platform.OS` branch does
 * not, because the import is evaluated at load.
 *
 * ★ THE MAP FILLS ITS FRAME AND ITS FRAME HAS A HEIGHT.
 *
 * `mapbox-gl` measures its container on init. A container with `height: 100%`
 * inside a parent with no resolved height measures 0, and the library then draws
 * an empty canvas with no error — the exact silent-blank failure the previous
 * tile implementation paid for twice. The frame's height is therefore set by the
 * caller, and this file asserts the measured box before initialising.
 *
 * ★ CONTAINER IS `relative` AND THE CANVAS IS ABSOLUTE.
 *
 * MapBox appends its canvas as a child. A `flex` container would let the canvas
 * push the container taller on every resize, which produces a growing feedback
 * loop rather than a map.
 */

import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ViewStyle } from 'react-native';
import mapboxgl from 'mapbox-gl';

import type { InteractiveMapProps, MapCamera, MapCircle } from './InteractiveMap';
import { cameraKey } from './map-camera';
import { readMapboxToken, styleForTheme } from '@/src/features/map/mapbox-token';
import { map as mapTokens } from '@/src/theme/tokens';
import { linesFeatureCollection } from '@/src/features/map/projection';
/** `mapbox-gl`'s CSS is a package import, which the bundler inlines. */
import 'mapbox-gl/dist/mapbox-gl.css';

/**
 * The pin's own geometry, shared by both platform renderers.
 *
 * ★ A PLACE IS A PIN, NOT A DOT.
 *
 * Every marker used to be a circle — `borderRadius: 50%` on an 18pt square. On the
 * event map that turned three venues and a starting point into four identical
 * blobs, which is the reported "proposal locations are shown as circles". A
 * teardrop reads as a place at a glance, its point sits on the coordinate, and the
 * colour is still free to mean "whose proposal this is".
 *
 * The shape is a CSS mask rather than a background image so it needs no asset and
 * no second request, and works identically in the browser and inside the native
 * WebView (which runs this same markup).
 */
export const PIN_WIDTH = 22;
export const PIN_HEIGHT = 30;

/** The teardrop, as one inline SVG path. `24×32` viewBox, scaled by the caller. */
export const PIN_PATH =
  'M12 0C5.4 0 0 5.4 0 12c0 8.4 12 20 12 20s12-11.6 12-20c0-6.6-5.4-12-12-12zm0 16.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9z';

/**
 * The DOM element a marker is drawn on.
 *
 * Split from `paintPin` so the geometry is written once, at creation, and a
 * re-render only repaints colour and emphasis — which is what keeps a moving
 * marker from being torn down and rebuilt on every camera report.
 */
function pinElement(label: string): HTMLDivElement {
  const element = document.createElement('div');
  // The marker's name is its accessible name; a coloured shape alone is silent to
  // a screen reader.
  element.setAttribute('role', 'img');
  element.setAttribute('aria-label', label);
  element.style.width = `${PIN_WIDTH}px`;
  element.style.height = `${PIN_HEIGHT}px`;
  element.style.boxSizing = 'border-box';
  element.style.display = 'flex';
  element.style.alignItems = 'flex-start';
  element.style.justifyContent = 'center';
  return element;
}

/**
 * Paints a pin. Idempotent: it SETS each property, it never appends.
 *
 * ★ THE TRANSFORM IS COMPUTED, NEVER APPENDED TO.
 *
 * The first version did `element.style.transform + ' scale(1.35)'`, which
 * compounds: every marker effect run (any change to `markers`) grew the selected
 * pin by another 35%, and it grew without bound.
 */
function paintPin(element: HTMLElement, fill: string, selected: boolean): void {
  const scale = selected ? 1.25 : 1;

  element.style.transform = scale === 1 ? '' : `scale(${scale})`;
  element.style.transformOrigin = '50% 100%';
  element.style.filter = `drop-shadow(0 1px 3px ${mapTokens.markerShadow})`;

  // ★ THE SHAPE IS REBUILT ONLY WHEN IT IS MISSING.
  //
  // `innerHTML` on every repaint would defeat the idempotence above: the node the
  // browser is compositing would be replaced each time `markers` changes identity,
  // which on a map with a live camera is every settled move.
  if (element.childElementCount === 0) {
    element.innerHTML =
      `<svg width="${PIN_WIDTH}" height="${PIN_HEIGHT}" viewBox="0 0 24 32" aria-hidden="true">` +
      `<path data-pin-body d="${PIN_PATH}" /></svg>`;
  }

  const body = element.querySelector('[data-pin-body]');
  if (body instanceof SVGPathElement) {
    body.setAttribute('fill', fill);
    body.setAttribute('stroke', mapTokens.markerRing);
    body.setAttribute('stroke-width', '1.5');
  }
}

export function InteractiveMap({
  camera,
  markers = [],
  lines = [],
  circles = [],
  theme,
  accent,
  onPress,
  onCameraChange,
  onUnavailable,
  onReady,
  testID,
}: InteractiveMapProps) {
  const frameRef = useRef<ComponentRef<typeof View> | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRefs = useRef(new Map<string, mapboxgl.Marker>());
  const [isReady, setIsReady] = useState(false);

  /** The style URI this component last requested, so a re-theme is a real change. */
  const appliedStyleRef = useRef<string | null>(null);

  /** Bumped on every completed style load, so the overlays redraw after one. */
  const [styleVersion, setStyleVersion] = useState(0);

  /**
   * The camera pose this map has already been told to fly to.
   *
   * ★ THE POSE IS APPLIED ONCE PER DISTINCT VALUE, AND THAT IS THE PINCH FIX.
   *
   * Every settled move reports its camera up. While the camera was pushed back in
   * on every change, the reported value returned as a new prop and re-drove the
   * map — so a pinch or a tilt ended exactly where it started. Nothing writes the
   * camera to the map unless the CALLER changed it, which a gesture never does.
   */
  const appliedCameraRef = useRef<string>(cameraKey(camera));

  // ★ THE CALLBACKS ARE READ THROUGH A REF.
  //
  // The map is constructed once, in an effect with no dependencies. Any callback
  // closed over inside it would be the one from the first render, for the life of
  // the map — the stale-closure defect the previous picker hit with its pan
  // responder, and it reads as "tapping does nothing after the first second".
  const pressRef = useRef(onPress);
  const cameraRef = useRef(onCameraChange);
  pressRef.current = onPress;
  cameraRef.current = onCameraChange;

  const unavailableRef = useRef(onUnavailable);
  const readyRef = useRef(onReady);
  unavailableRef.current = onUnavailable;
  readyRef.current = onReady;

  // ── Construction, once ──────────────────────────────────────────────────
  useEffect(() => {
    const mapboxCredential = readMapboxToken();
    if (mapboxCredential === null) {
      unavailableRef.current?.();
      return;
    }

    const node = frameRef.current as unknown as HTMLElement | null;
    if (!node) {
      unavailableRef.current?.();
      return;
    }

    // A zero-height frame draws an empty canvas with no error. Saying so is the
    // difference between "the map is broken" and "the frame is not measured yet".
    const box = node.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) {
      unavailableRef.current?.();
      return;
    }

    // ★ MARKED ON THE ELEMENT, NOT VIA A PROP — see the note on the frame.
    node.setAttribute('data-map-surface', 'true');

    mapboxgl.accessToken = mapboxCredential;
    // Recorded here so the theme effect does not immediately re-apply the same
    // style and throw away the first draw.
    appliedStyleRef.current = styleForTheme(theme);

    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        container: node,
        style: styleForTheme(theme),
        center: [camera.centre.lng, camera.centre.lat],
        zoom: camera.zoom,
        pitch: camera.pitch,
        bearing: camera.bearing,
        // ★ MERCATOR IS PINNED, BECAUSE THE DEFAULT CHANGED UNDER THIS MAP.
        //
        // Live, the instance reported `getProjection().name === 'globe'` beside
        // `transform.projection === 'mercator'`, with `worldSize: 1048576` at zoom 11
        // (mercator would be 2048). The corrupted transform applied only part of the
        // tilt — 0.795 vertical compression where cos(50°) = 0.643 — and a point
        // 0.2° south projected to `Number.MAX_VALUE`. A city map wants mercator, and
        // saying so stops a library default from deciding the product's camera.
        projection: 'mercator',
        // Standard rests at 60; the product sits at 50 and may be tilted further.
        maxPitch: 85,
        // The product's camera is the interaction; the default chrome would put
        // MapBox's own zoom buttons over the app's own controls.
        attributionControl: false,
        // `antialias` is what makes a pitched basemap read as 3D rather than as
        // stretched pixels at the horizon.
        antialias: true,
      });
    } catch {
      // A WebGL-less browser throws here. Non-negotiable: the caller must be able
      // to show its stated state rather than an empty box.
      unavailableRef.current?.();
      return;
    }

    map.on('error', (event) => {
      // A style that cannot load leaves the canvas blank for good. Tile-level
      // 404s arrive here too and are survivable, so only a style failure is
      // fatal — the map reports `isStyleLoaded()`.
      if (!map.isStyleLoaded() && /style/i.test(String(event.error ?? ''))) {
        unavailableRef.current?.();
      }
    });

    map.on('load', () => {
      setIsReady(true);
      readyRef.current?.();
    });

    map.on('moveend', () => {
      const centre = map.getCenter();
      cameraRef.current?.({
        centre: { lat: centre.lat, lng: centre.lng },
        zoom: map.getZoom(),
        pitch: map.getPitch(),
        bearing: map.getBearing(),
      });
    });

    map.on('click', (event) => {
      pressRef.current?.({ lat: event.lngLat.lat, lng: event.lngLat.lng });
    });

    // Attribution is a licence obligation, so it is added even though the rest of
    // the chrome is not.
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left');

    mapRef.current = map;

    // ★ THE MARKER MAP IS CAPTURED, NOT REACHED THROUGH THE REF IN CLEANUP.
    //
    // `markerRefs.current` would be whatever the ref holds when unmount runs, not
    // the map this effect populated — so a marker added and removed elsewhere could
    // be leaked, and the lint rule that flagged it is right. The handle is stable
    // for the life of the marker registry.
    const markerRegistry = markerRefs.current;

    return () => {
      for (const marker of markerRegistry.values()) marker.remove();
      markerRegistry.clear();
      map.remove();
      mapRef.current = null;
      setIsReady(false);
    };
    // Deliberately empty: the map is constructed ONCE. Theme, camera, markers and
    // lines are applied by the effects below, so a re-render never tears down the
    // canvas the user is looking at.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Camera ──────────────────────────────────────────────────────────────
  //
  // ★ A GESTURE MUST NEVER BE UNDONE BY THE PROP IT REPORTED.
  //
  // The map is constructed with the camera, and every settled move reports the new
  // one upward. While that prop was applied on every change, a pinch-zoom or a
  // tilt was reverted the instant the parent re-rendered: the reported value came
  // straight back as the next camera and `jumpTo` cancelled what the fingers had
  // just done. Nothing here writes the camera unless the CALLER changed it, and a
  // gesture never changes the caller's own intent — it changes the map's.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const wanted = cameraKey(camera);
    if (appliedCameraRef.current === wanted) return;

    appliedCameraRef.current = wanted;

    // `jumpTo`, not `flyTo`: a caller that re-frames (locate-me, a new bounding
    // box) wants the map there now, and an animation would race the next draw.
    map.jumpTo({
      center: [camera.centre.lng, camera.centre.lat],
      zoom: camera.zoom,
      pitch: camera.pitch,
      bearing: camera.bearing,
    });
  }, [camera]);

  // ── Theme ───────────────────────────────────────────────────────────────
  // ★ `setStyle()` DROPS EVERY CUSTOM SOURCE AND LAYER, AND THE ROUTE WAS LOST.
  //
  // The first version called `setStyle()` on every `theme` change and relied on
  // the lines effect to redraw. It does not: that effect depends on
  // `[lines, circles, isReady]`, and `isReady` flips back to `true` without any of
  // those changing value, so React never re-ran it. Re-theming an event page
  // therefore deleted the route line and never put it back.
  //
  // Two answers together:
  //  1. a style that is ALREADY applied is not re-applied — `setStyle` is
  //     destructive, and the mount path must not pay for it;
  //  2. every completed style load bumps `styleVersion`, and the layers effect
  //     depends on that counter, so a REAL reload always redraws.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const wanted = styleForTheme(theme);
    if (appliedStyleRef.current === wanted) {
      // ★ SAME STYLE, DIFFERENT APPEARANCE — AND THAT IS THE NORMAL CASE NOW.
      //
      // Standard is ONE style with a `lightPreset`, so light and dark share a URI
      // and `setStyle` would never fire. Without this branch the theme control
      // would do nothing, which is exactly the regression a single-style switch
      // invites: the URI comparison looks right and the product silently loses
      // dark mode.
      applyLightPreset(map, theme);
      return;
    }

    appliedStyleRef.current = wanted;
    setIsReady(false);
    map.setStyle(wanted);
    // `setStyle` reloads asynchronously, so the preset is also applied once the
    // new style reports itself loaded.
    map.once('styledata', () => applyLightPreset(map, theme));
  }, [theme]);

  /**
   * Notices every completed style load.
   *
   * `styledata` also fires for ordinary tile loads, so the handler is cheap and
   * the redraw below is idempotent — it only bumps a counter.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const onStyleData = () => {
      if (!map.isStyleLoaded()) return;
      setIsReady(true);
      readyRef.current?.();
      setStyleVersion((version) => version + 1);
    };

    map.on('styledata', onStyleData);
    // The initial style can finish loading before this effect attaches.
    if (map.isStyleLoaded()) onStyleData();

    return () => {
      map.off('styledata', onStyleData);
    };
  }, []);

  // ── Lines and circles ───────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isReady) return;

    const collection = linesFeatureCollection(lines);

    const draw = () => {
      const source = map.getSource('route') as mapboxgl.GeoJSONSource | undefined;

      if (source) {
        source.setData(collection);
      } else {
        map.addSource('route', { type: 'geojson', data: collection });

        // A casing underlay makes an accent-coloured line legible on both the
        // light and the dark basemap, which a lone stroke is not.
        map.addLayer({
          id: 'route-casing',
          type: 'line',
          source: 'route',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': mapTokens.routeCasing,
            'line-opacity': mapTokens.routeCasingOpacity,
            'line-width': 7,
          },
        });

        map.addLayer({
          id: 'route-line',
          type: 'line',
          source: 'route',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': ['get', 'color'],
            'line-width': 4,
            // A `straight_line` route is drawn dashed so the picture does not
            // claim a road the provider never returned.
            'line-dasharray': ['case', ['get', 'dashed'], ['literal', [2, 2]], ['literal', [1, 0]]],
          },
        });
      }

      // ★ AN APPROXIMATE AREA IS A POLYGON, NOT A POINT WITH A RADIUS.
      //
      // The first version added a `Point` source and a `fill` layer over it. A
      // `fill` layer has no geometry for a point, so it drew nothing at all — the
      // participant areas were invisible on the web map while being drawn
      // correctly on native (which builds a 32-gon). `circleFeature` now builds
      // that same ring, in the projection the map is in.
      circles.forEach((circle, index) => {
        const id = `area-${index}`;
        if (map.getSource(id)) return;

        map.addSource(id, {
          type: 'geojson',
          data: circleFeature(circle, map.getZoom()),
        });

        map.addLayer({
          id,
          type: 'fill',
          source: id,
          paint: { 'fill-color': circle.color, 'fill-opacity': 0.18 },
        });
      });
    };

    if (map.isStyleLoaded()) draw();
    else map.once('idle', draw);
  }, [lines, circles, isReady, styleVersion]);

  // ── Markers ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const seen = new Set<string>();

    for (const marker of markers) {
      seen.add(marker.id);

      let handle = markerRefs.current.get(marker.id);

      if (!handle) {
        const element = pinElement(marker.label);
        handle = new mapboxgl.Marker({ element, anchor: 'bottom' })
          .setLngLat([marker.coordinate.lng, marker.coordinate.lat])
          .addTo(map);

        markerRefs.current.set(marker.id, handle);
      } else {
        handle.setLngLat([marker.coordinate.lng, marker.coordinate.lat]);
      }

      paintPin(handle.getElement(), marker.color ?? accent, marker.selected === true);
    }

    // A marker the payload no longer carries is removed, not left on screen.
    for (const [id, handle] of markerRefs.current) {
      if (!seen.has(id)) {
        handle.remove();
        markerRefs.current.delete(id);
      }
    }
  }, [markers, accent]);

  return (
    <View
      testID={testID}
      // `getBoundingClientRect` needs a real DOM node, which is what the cast in
      // the construction effect relies on. On web a React Native `View` IS a div.
      ref={frameRef}
      // ★ THE MAP OWNS ITS OWN GESTURES — AND THE MARKER IS SET ON THE REAL NODE.
      //
      // `mapbox-gl` handles drags at the DOM level, so it cannot win a React
      // responder negotiation — an ancestor `PanResponder` claims the drag first
      // and the map never moves. `PullToSync` reads `[data-map-surface]` to decline
      // a gesture that begins here.
      //
      // ★ IT CANNOT BE PASSED AS A JSX PROP. React Native Web silently DROPS an
      // unknown lowercase `data-*` prop on `<View>` — verified live, where
      // `document.querySelector('[data-map-surface]')` returned null while the
      // source clearly set it. The attribute has to be written to the underlying
      // DOM node, which the construction effect already holds a ref to.
      //
      // `touch-action: none` is what tells the browser the surface handles touch
      // itself, so a finger drag does not scroll the page underneath.
      style={[styles.frame as ViewStyle, { touchAction: 'none' } as ViewStyle]}
    />
  );
}

/**
 * Tells MapBox Standard which appearance to use.
 *
 * Standard carries the product's light/dark intent as a style CONFIG property
 * rather than as two style URIs, so this is where the app theme reaches it. Guarded
 * because a non-Standard style — or an older library — has no such config, and the
 * map must keep rendering either way.
 */
function applyLightPreset(map: mapboxgl.Map, theme: 'light' | 'dark'): void {
  const preset = theme === 'dark' ? 'night' : 'day';

  /**
   * ★ THE PRESET IS APPLIED TWICE, AND THE SECOND TIME IS WHAT MATTERS.
   *
   * Standard's basemap is a style IMPORT, and `setConfigProperty` only sticks once
   * that import has loaded. Verified live: the app's dark theme was set, the call
   * ran, and `getConfigProperty('basemap', 'lightPreset')` still returned `"day"`
   * — a light map on a dark page.
   *
   * So it is attempted immediately (harmless, and correct once the import exists)
   * and again on `style.load`, which fires after the import is ready.
   */
  const write = (): void => {
    try {
      map.setConfigProperty('basemap', 'lightPreset', preset);
    } catch {
      // A style without the `basemap` import still renders; it just cannot switch
      // appearance. Losing the theme must not lose the map.
    }
  };

  write();
  map.once('style.load', write);
}

/**
 * The subset of a GeoJSON feature this file builds.
 *
 * Declared here rather than reached for as a global `GeoJSON` namespace: the
 * project's tsconfig does not include `@types/geojson`, and `mapbox-gl` exports its
 * own `GeoJSONSourceSpecification` without re-exporting the namespace.
 */
interface MapGeoJsonFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: {
    type: 'Polygon';
    coordinates: Array<Array<[number, number]>>;
  };
}

/**
 * An approximate area as a GeoJSON polygon.
 *
 * ★ SAME SHAPE AS THE NATIVE RENDERER'S, SO THE TWO CANNOT DISAGREE.
 *
 * `InteractiveMap.native.tsx` builds a 32-segment ring with the equirectangular
 * approximation. Rendering a point here and a polygon there meant one platform
 * showed the fuzzed area and the other showed nothing.
 *
 * The radius is metres, converted with the same `radiusDegrees` step on both axes —
 * exact enough for a circle whose whole purpose is to say "somewhere in here".
 */
function circleFeature(circle: MapCircle, zoom: number): MapGeoJsonFeature {
  const segments = 32;
  const earthRadiusM = 6_371_000;
  const { lat, lng } = circle.coordinate;

  // A zoom argument is accepted for symmetry with the pixel-sized helpers, but the
  // polygon is in DEGREES: it must stay correct when the camera moves, which a
  // pixel radius would not.
  void zoom;

  const coordinates: Array<[number, number]> = [];

  for (let index = 0; index < segments; index += 1) {
    const bearing = (index / segments) * 2 * Math.PI;
    const dLat = (circle.radiusMetres / earthRadiusM) * Math.cos(bearing);
    const dLng =
      (circle.radiusMetres / (earthRadiusM * Math.cos((lat * Math.PI) / 180))) *
      Math.sin(bearing);

    coordinates.push([lng + (dLng * 180) / Math.PI, lat + (dLat * 180) / Math.PI]);
  }

  // GeoJSON polygons must close: the first position repeats as the last.
  coordinates.push(coordinates[0] as [number, number]);

  return {
    type: 'Feature',
    properties: { color: circle.color },
    geometry: {
      type: 'Polygon',
      coordinates: [coordinates],
    },
  };
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
});


/** Re-exported so the caller can build a camera without importing the types file. */
export type { MapCamera };
