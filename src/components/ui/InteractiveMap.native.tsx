/**
 * The interactive map, on iOS and Android.
 *
 * ★ THIS IS A WEBVIEW RUNNING THE SAME `mapbox-gl` MAP AS THE BROWSER.
 *
 * The previous implementation used `react-native-maps` with `mapType="none"` and
 * MapBox raster tiles, on the theory that a blank Google shell would host our own
 * tiles. Two device-verified facts killed that:
 *
 *  1. `MapViewManager.setGoogleRenderer` calls `MapsInitializer.initialize(...)`
 *     unconditionally when a `MapView` is created, so the app crashed with
 *     "API key not found" on every map screen until a Google key was supplied;
 *  2. even with the key, `MapUrlTile` attaches MapBox tiles as a
 *     `GoogleMap.TileOverlay` — `((GoogleMap) map).addTileOverlay(...)`. When
 *     Google's SDK fails authorisation there is no `GoogleMap`, so MapBox tiles
 *     can NEVER draw. The map was Google's, with MapBox painted on top.
 *
 * On Android the map was therefore Google's map, blank, which is the opposite of
 * what the product requires.
 *
 * ★ ONE RENDERER, TWO PLATFORMS.
 *
 * A `WebView` running the same `mapbox-gl` bundle the browser uses removes Google
 * entirely and makes native and web the SAME map, so they cannot drift again. The
 * cost is a bridge: gestures happen inside the WebView, and the page talks to the
 * app through `postMessage`.
 *
 * ★ THE HTML IS SELF-CONTAINED, AND ITS TOKEN IS ESCAPED.
 *
 * The document is generated here rather than fetched, so the map renders offline
 * of any app route. The token and the style are injected into a JS string literal,
 * which means they are `JSON.stringify`-escaped — a raw interpolation would let a
 * quote in a token break the document, or worse, execute.
 */

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { View, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';

import type {
  InteractiveMapProps,
  MapCamera,
  MapCircle,
  MapLine,
  MapMarker,
} from './InteractiveMap';
import { MAP_GESTURE_ALLOWANCE } from './map-gesture';
import type { MapSurfaceHandle } from './map-imperative';
import { cameraKey } from './map-camera';
import { readMapboxToken, styleForTheme } from '@/src/features/map/mapbox-token';
import { map as mapTokens } from '@/src/theme/tokens';
import { linesFeatureCollection } from '@/src/features/map/projection';
import type { Coordinate } from '@/src/routing/types';

/** What the WebView ref exposes — only the one method this surface needs. */
interface WebViewHandle {
  injectJavaScript(script: string): void;
}

/** The `mapbox-gl` build the document loads. Pinned, so a release cannot shift. */
const MAPBOX_GL_VERSION = '3.34.1';

/** The pin's geometry — the same numbers `InteractiveMap.web.tsx` draws with. */
const PIN_WIDTH = 22;
const PIN_HEIGHT = 30;

/** The origin dot's diameter — the web surface's `DOT_SIZE`. */
const DOT_SIZE = 16;

/** The teardrop path. `24×32` viewBox, so both platforms draw one shape. */
const PIN_PATH =
  'M12 0C5.4 0 0 5.4 0 12c0 8.4 12 20 12 20s12-11.6 12-20c0-6.6-5.4-12-12-12zm0 16.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9z';

/** The document's height fills the frame; the frame's height comes from the caller. */
const FRAME_STYLE: ViewStyle = { flex: 1, overflow: 'hidden' };

/** A message the page sends back to the app. */
type BridgeMessage =
  | { type: 'ready' }
  | { type: 'unavailable'; reason: string }
  | { type: 'press'; lat: number; lng: number }
  | { type: 'gesture'; active: boolean }
  | { type: 'camera'; lat: number; lng: number; zoom: number; pitch: number; bearing: number };

/**
 * Builds the document.
 *
 * `JSON.stringify` on every interpolated value is the escaping boundary: the values
 * come from the environment and from the caller, and the output is source code.
 */
export function buildMapDocument(options: {
  accessToken: string;
  style: string;
  camera: MapCamera;
  theme: 'light' | 'dark';
  accent: string;
  controls: boolean;
}): string {
  const { accessToken, style, camera, theme, accent, controls } = options;

  void accent;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<title>map</title>
<link href="https://api.mapbox.com/mapbox-gl-js/v${MAPBOX_GL_VERSION}/mapbox-gl.css" rel="stylesheet" />
<script src="https://api.mapbox.com/mapbox-gl-js/v${MAPBOX_GL_VERSION}/mapbox-gl.js"></script>
<style>
  /* ★ THE DOCUMENT OWNS ITS GESTURES, SO A DRAG NEVER REACHES THE FORM UNDER IT.
     \`touch-action: none\` stops the browser claiming a finger drag as a scroll;
     \`overscroll-behavior: none\` stops a drag that reaches the document's edge from
     chaining up to the React Native ScrollView holding this WebView. Without both,
     a vertical drag on the map in \`New Proposal\` scrolled the FORM — the reported
     defect — while the horizontal drag worked, because that ScrollView is vertical
     only. */
  html, body {
    margin: 0; padding: 0; height: 100%;
    background: transparent;
    touch-action: none;
    overscroll-behavior: none;
    overflow: hidden;
  }
  #map { position: absolute; inset: 0; touch-action: none; }
  .mapboxgl-ctrl-attrib { font-size: 10px; }
  /* A place is a pin, not a dot — the same teardrop the web surface draws. */
  .pin { display: flex; align-items: flex-start; justify-content: center; }
  .pin svg { display: block; }
  /* The viewer's own position: a dot, not a destination. */
  .dot { border-radius: 50%; border: 2px solid ${mapTokens.originRing}; }
  /* ★ THE CORNER CONTROLS, AND THE DOCUMENT OWNS THEIR LOOK.
     They are drawn here rather than as React Native views above the WebView for
     the same reason the pins are: one document, two platforms, nothing to drift.
     \`touch-action: none\` on the buttons keeps the press out of the page's gesture
     budget; \`pointer-events\` keeps the strip they sit in from blocking the map. */
  .zoom { position: absolute; bottom: ${mapTokens.controlInset}px; right: ${mapTokens.controlInset}px; display: flex; flex-direction: column; gap: ${mapTokens.controlGap}px; z-index: 5; }
  .zoom button {
    width: ${mapTokens.controlSize}px; height: ${mapTokens.controlSize}px; border: 0; border-radius: ${mapTokens.controlSize / 2}px; padding: 0;
    font: 600 20px/1 -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
    touch-action: none; -webkit-tap-highlight-color: transparent;
    background: ${mapTokens.controlFill}; color: ${mapTokens.controlInk};
    box-shadow: 0 1px 3px ${mapTokens.markerShadow};
  }
  .zoom button:active { opacity: 0.75; }
</style>
</head>
<body>
<div id="map"></div>
<script>
(function () {
  function post(message) {
    var payload = JSON.stringify(message);
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(payload);
  }

  var PIN_WIDTH = ${PIN_WIDTH};
  var PIN_HEIGHT = ${PIN_HEIGHT};
  var PIN_PATH = ${JSON.stringify(PIN_PATH)};
  var MARKER_RING = ${JSON.stringify(mapTokens.markerRing)};
  var MARKER_SHADOW = ${JSON.stringify(mapTokens.markerShadow)};
  var ORIGIN_RING = ${JSON.stringify(mapTokens.originRing)};
  var DOT_SIZE = ${DOT_SIZE};
  var CONTROLS = ${controls ? 'true' : 'false'};

  var markersById = {};

  function pinElement(label) {
    var element = document.createElement('div');
    element.className = 'pin';
    element.setAttribute('role', 'img');
    element.setAttribute('aria-label', label || '');
    element.style.width = PIN_WIDTH + 'px';
    element.style.height = PIN_HEIGHT + 'px';
    element.style.transformOrigin = '50% 100%';
    return element;
  }

  /**
   * ★ THE ORIGIN DOT. Centred on its coordinate, not anchored by a tip.
   *
   * A pin's anchor is 'bottom' because its point is the coordinate. A dot has no
   * point, so the SAME anchor would draw the reader's own position half a pin
   * north of where they are; \`applyMarkers\` therefore anchors a circle at centre.
   */
  function dotElement(label) {
    var element = document.createElement('div');
    element.className = 'dot';
    element.setAttribute('role', 'img');
    element.setAttribute('aria-label', label || '');
    element.style.width = DOT_SIZE + 'px';
    element.style.height = DOT_SIZE + 'px';
    element.style.boxSizing = 'border-box';
    element.style.borderColor = ORIGIN_RING;
    element.style.filter = 'drop-shadow(0 1px 3px ' + MARKER_SHADOW + ')';
    return element;
  }

  /**
   * Paints a pin. Idempotent — it SETS each property and never appends.
   *
   * The transform is computed, not concatenated: an earlier version did
   * \`style.transform + ' scale(1.35)'\`, which compounded on every marker refresh
   * until the selected pin grew without bound.
   */
  function paintPin(element, fill, selected) {
    element.style.transform = selected ? 'scale(1.25)' : '';
    element.style.filter = 'drop-shadow(0 1px 3px ' + MARKER_SHADOW + ')';

    if (element.childElementCount === 0) {
      element.innerHTML =
        '<svg width="' + PIN_WIDTH + '" height="' + PIN_HEIGHT + '" viewBox="0 0 24 32" aria-hidden="true">' +
        '<path data-pin-body d="' + PIN_PATH + '" /></svg>';
    }

    var body = element.querySelector('[data-pin-body]');
    if (body) {
      body.setAttribute('fill', fill);
      body.setAttribute('stroke', MARKER_RING);
      body.setAttribute('stroke-width', '1.5');
    }
  }

  /**
   * \`list\` is the WHOLE marker set, and the id is the identity.
   *
   * This surface used to accept \`markers\` and draw NOTHING — the file voided the
   * prop with a comment saying a renderer would come later. So the picker's pin,
   * the proposal's pin and the event's per-proposal pins were all invisible on a
   * device while the browser drew every one of them.
   *
   * Present and missing-from-registry means removed; a new id means added. That is
   * all a diff needs, and it keeps the app from having to send one.
   */
  function applyMarkers(map, list, accent) {
    var seen = {};

    for (var i = 0; i < list.length; i += 1) {
      var marker = list[i];
      seen[marker.id] = true;

      var handle = markersById[marker.id];
      var isCircle = marker.shape === 'circle';

      if (!handle) {
        var element = isCircle ? dotElement(marker.label) : pinElement(marker.label);
        handle = new mapboxgl.Marker({ element: element, anchor: isCircle ? 'center' : 'bottom' })
          .setLngLat([marker.coordinate.lng, marker.coordinate.lat])
          .addTo(map);
        handle.__isCircle = isCircle;
        markersById[marker.id] = handle;
      } else if (handle.__isCircle !== isCircle) {
        // ★ A MARKER THAT CHANGED SHAPE IS REBUILT, NOT REPAINTED.
        //
        // The anchor is fixed at construction, so repainting a pin into a dot would
        // leave it anchored by the tip it no longer has. Ids are stable per fact —
        // 'origin' is always the origin — so this happens at most once per marker.
        handle.remove();
        var replacement = isCircle ? dotElement(marker.label) : pinElement(marker.label);
        handle = new mapboxgl.Marker({ element: replacement, anchor: isCircle ? 'center' : 'bottom' })
          .setLngLat([marker.coordinate.lng, marker.coordinate.lat])
          .addTo(map);
        handle.__isCircle = isCircle;
        markersById[marker.id] = handle;
      } else {
        handle.setLngLat([marker.coordinate.lng, marker.coordinate.lat]);
      }

      if (isCircle) {
        handle.getElement().style.backgroundColor = marker.color || accent;
      } else {
        paintPin(handle.getElement(), marker.color || accent, marker.selected === true);
      }
    }

    for (var id in markersById) {
      if (markersById.hasOwnProperty(id) && !seen[id]) {
        markersById[id].remove();
        delete markersById[id];
      }
    }
  }

  /**
   * Approximate areas as polygons, matching the web renderer's 32-gon.
   *
   * Also previously accepted and undrawn. The ring is in DEGREES so it stays
   * correct while the camera moves, and a pixel radius would not.
   */
  function applyAreas(map, list) {
    var wanted = list.length;
    if (map.__areaCount === wanted) return;

    for (var index = 0; index < wanted; index += 1) {
      var id = 'area-' + index;
      if (map.getSource(id)) continue;

      var circle = list[index];
      var segments = 32;
      var earthRadiusM = 6371000;
      var lat = circle.coordinate.lat;
      var lng = circle.coordinate.lng;
      var ring = [];

      for (var step = 0; step < segments; step += 1) {
        var bearing = (step / segments) * 2 * Math.PI;
        var dLat = (circle.radiusMetres / earthRadiusM) * Math.cos(bearing);
        var dLng =
          (circle.radiusMetres / (earthRadiusM * Math.cos((lat * Math.PI) / 180))) *
          Math.sin(bearing);
        ring.push([lng + (dLng * 180) / Math.PI, lat + (dLat * 180) / Math.PI]);
      }

      // GeoJSON polygons must close: the first position repeats as the last.
      ring.push(ring[0]);

      map.addSource(id, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: { color: circle.color },
          geometry: { type: 'Polygon', coordinates: [ring] }
        }
      });

      map.addLayer({
        id: id, type: 'fill', source: id,
        paint: { 'fill-color': circle.color, 'fill-opacity': 0.18 }
      });
    }

    map.__areaCount = wanted;
  }

  try {
    mapboxgl.accessToken = ${JSON.stringify(accessToken)};

    var map = new mapboxgl.Map({
      container: 'map',
      style: ${JSON.stringify(style)},
      center: [${camera.centre.lng}, ${camera.centre.lat}],
      zoom: ${camera.zoom},
      pitch: ${camera.pitch},
      bearing: ${camera.bearing},
      // ★ MERCATOR, PINNED. The globe projection corrupts a pitched transform at
      // city zoom — measured live as a 0.795 vertical compression where a 50° tilt
      // demands 0.643 — and the same pin is in the web surface.
      projection: 'mercator',
      maxPitch: 85,
      antialias: true,
      attributionControl: false
    });

    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left');

    map.on('load', function () {
      try {
        map.setConfigProperty('basemap', 'lightPreset', ${JSON.stringify(theme === 'dark' ? 'night' : 'day')});
      } catch (e) { /* a style without the basemap import still renders */ }

      map.addSource('route', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      // A casing underlay keeps an accent line legible on both appearances.
      map.addLayer({
        id: 'route-casing', type: 'line', source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': ${JSON.stringify(mapTokens.routeCasing)}, 'line-opacity': ${mapTokens.routeCasingOpacity}, 'line-width': 7 }
      });

      map.addLayer({
        id: 'route-line', type: 'line', source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 4,
          // ★ A \`case\` MUST YIELD LITERALS.
          //
          // A bare array as a branch is read as an expression, not as a dash
          // pattern, and MapBox refuses the style — so this layer never compiled and
          // every line came out solid. \`['literal', …]\` wraps the pattern as data.
          'line-dasharray': ['case', ['get', 'dashed'], ['literal', [2, 2]], ['literal', [1, 0]]]
        }
      });

      post({ type: 'ready' });
      window.__ready = true;
    });

    map.on('error', function (event) {
      post({ type: 'unavailable', reason: String((event && event.error) || 'map error') });
    });

    // A tap reports a coordinate; the app decides what it means.
    map.on('click', function (event) {
      post({ type: 'press', lat: event.lngLat.lat, lng: event.lngLat.lng });
    });

    /**
     * ★ A FINGER DOWN IN THE MAP IS REPORTED UP, SO THE APP CAN CLAIM IT.
     *
     * \`scrollEnabled={false}\` stops the WebView scrolling ITSELF, and
     * \`touch-action: none\` stops this document claiming the finger as a scroll —
     * neither of which reaches React Native, because a WebView does not participate
     * in RN's responder negotiation. So an ancestor \`ScrollView\` was free to take a
     * vertical drag that began on the map and scroll the page instead (the reported
     * defect; horizontal drags were fine because that ScrollView is vertical only).
     *
     * The app's wrapper becomes the responder while a finger is down in here, and
     * an ancestor that has lost the negotiation does not scroll. This is that
     * signal, posted for the whole duration of the touch rather than once per
     * gesture, so a long pan keeps the claim.
     */
    document.addEventListener('touchstart', function () {
      post({ type: 'gesture', active: true });
    }, { passive: true });

    document.addEventListener('touchend', function () {
      post({ type: 'gesture', active: false });
    }, { passive: true });

    document.addEventListener('touchcancel', function () {
      post({ type: 'gesture', active: false });
    }, { passive: true });

    /**
     * ★ THE CORNER CONTROLS ASK THE MAP TO ZOOM; THEY DO NOT WRITE A POSE.
     *
     * \`zoomTo\` keeps the CENTRE the reader left the map at. A control written as a
     * camera change would re-frame the map onto the pose this document was built
     * with — the reported "when I zoom, it returns to the pin".
     */
    if (CONTROLS) {
      var zoomIn = document.createElement('button');
      zoomIn.setAttribute('type', 'button');
      zoomIn.setAttribute('aria-label', 'zoom in');
      zoomIn.textContent = '+';
      zoomIn.addEventListener('click', function () { map.zoomTo(map.getZoom() + 1, { duration: 160 }); });

      var zoomOut = document.createElement('button');
      zoomOut.setAttribute('type', 'button');
      zoomOut.setAttribute('aria-label', 'zoom out');
      zoomOut.textContent = '\\u2212';
      zoomOut.addEventListener('click', function () { map.zoomTo(map.getZoom() - 1, { duration: 160 }); });

      var zoomBox = document.createElement('div');
      zoomBox.className = 'zoom';
      zoomBox.setAttribute('data-map-controls', '');
      zoomBox.appendChild(zoomIn);
      zoomBox.appendChild(zoomOut);
      document.body.appendChild(zoomBox);
    }


    map.on('moveend', function () {
      var centre = map.getCenter();
      post({
        type: 'camera',
        lat: centre.lat, lng: centre.lng,
        zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing()
      });
    });

    /**
     * ★ THE CAMERA IS REPORTED UP, NEVER PUSHED BACK DOWN.
     *
     * A pinch or a tilt produces a new camera; \`moveend\` reports it; the app lifts
     * it into state. While this function applied every camera it received, that
     * state returned as the next payload and \`jumpTo\` cancelled the gesture's own
     * result — the reported "it snaps back to the same zoom / the original angle".
     *
     * \`cameraKey\` is the discriminator. The key is seeded from the pose this
     * document was BUILT with, so the first post-ready payload is a no-op, and a
     * caller that deliberately re-frames (locate-me, a new bounding box) sends a
     * different key and does move the map.
     */
    window.__cameraKey = ${JSON.stringify(cameraKey(camera))};

    window.__apply = function (payload) {
      var data = JSON.parse(payload);

      if (data.camera && data.cameraKey && data.cameraKey !== window.__cameraKey) {
        window.__cameraKey = data.cameraKey;
        map.jumpTo({
          center: [data.camera.centre.lng, data.camera.centre.lat],
          zoom: data.camera.zoom,
          pitch: data.camera.pitch,
          bearing: data.camera.bearing
        });
      }

      if (data.lines && map.getSource('route')) {
        map.getSource('route').setData(data.lines);
      }

      var drawOverlays = function () {
        applyMarkers(map, data.markers || [], data.accent);
        applyAreas(map, data.circles || []);
      };

      // The style carries the layers, so a payload that lands before the first
      // draw would add sources to a map that is about to replace them.
      if (window.__ready) drawOverlays();
      else map.once('idle', drawOverlays);
    };

    /**
     * ★ THE IMPERATIVE ZOOM THE CORNER CONTROL ASKS FOR.
     *
     * \`zoomTo\` keeps the CENTRE the reader left the map at — a camera prop would
     * re-frame onto the pose the document was built with, which is the reported
     * "when I zoom, it returns to the pin".
     */
    window.__zoom = function (delta) {
      map.zoomTo(map.getZoom() + delta, { duration: 160 });
    };

    window.__recentre = function () {
      map.jumpTo({ center: [${camera.centre.lng}, ${camera.centre.lat}] });
    };
  } catch (error) {
    post({ type: 'unavailable', reason: String(error && error.message || error) });
  }
})();
</script>
</body>
</html>`;
}

export function InteractiveMap({
  ref,
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
  controls = false,
  testID,
}: InteractiveMapProps & { ref?: React.Ref<MapSurfaceHandle | null> }) {
  const webRef = useRef<WebViewHandle | null>(null);
  const mapboxCredential = readMapboxToken();
  const [isReady, setIsReady] = useState(false);

  /**
   * ★ THE NATIVE INTERCEPTOR, AND WHY IT IS A GESTURE AND NOT A `PanResponder`.
   *
   * The page's `ScrollView` is a NATIVE scroll view, and it claims a vertical drag
   * with its own recogniser the moment the finger travels. React Native's
   * `PanResponder` — which the previous version raised on a bridge report — competes
   * for the same touch ASYNCHRONOUSLY, so by the time the report arrived the scroll
   * view had already won: most drags scrolled the page, and the ones that did not
   * moved the map for about a centimetre before the WebView's own recogniser gave
   * the finger up. That is exactly what was reported.
   *
   * `react-native-gesture-handler`'s dispatcher resolves the claim NATIVELY, on the
   * ancestor, before the scroll view's recogniser is consulted — the same mechanism
   * a bottom sheet uses to survive a drag over a list. While this gesture is active
   * the touches go to the gesture and NOT to the WebView, which is why the
   * allowance is the first movement rather than zero: below it the WebView keeps
   * the touch and the map pans itself, and above it the claim is already the map's.
   *
   * `runOnJS(false)` and no callbacks: nothing has to be handed to JavaScript, so
   * the whole decision stays on the UI thread.
   */
  const claimGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(MAP_GESTURE_ALLOWANCE)
        // The map's own one- and two-finger gestures are the map's.
        .maxPointers(2)
        // ★ IT MUST WIN THE NEGOTIATION, SO IT ACTIVATES RATHER THAN COOPERATES.
        .shouldCancelWhenOutside(false)
        .runOnJS(false),
    [],
  );

  /**
   * The document is built once per token, theme and control set.
   *
   * `camera` is deliberately not a dependency: re-building the HTML on every camera
   * change would reload the WebView and restart the map on every drag frame. Camera
   * and overlay updates travel through `__apply` instead.
   *
   * `controls` IS a dependency — it is a document feature, and a map that gains its
   * zoom buttons has to be rebuilt to draw them.
   */
  const html = useMemo(
    () =>
      mapboxCredential === null
        ? ''
        : buildMapDocument({
            accessToken: mapboxCredential,
            style: styleForTheme(theme),
            camera,
            theme,
            accent,
            controls,
          }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mapboxCredential, theme, controls],
  );

  const send = useCallback((payload: unknown) => {
    const script = `window.__apply(${JSON.stringify(JSON.stringify(payload))}); true;`;
    webRef.current?.injectJavaScript(script);
  }, []);

  /** Pushes the camera, the overlays and the markers whenever any of them changes. */
  useEffect(() => {
    if (!isReady) return;

    send({
      camera,
      cameraKey: cameraKey(camera),
      lines: linesFeatureCollection(lines),
      markers,
      circles,
      accent,
    });
  }, [isReady, camera, lines, markers, circles, accent, send]);

  /**
   * The imperative handle — the same two commands the web surface exposes.
   *
   * A zoom control must behave like a pinch: `zoomTo` in the document, never a new
   * camera prop. Through `__apply` a pose would arrive with a new `cameraKey` and
   * `jumpTo` would re-frame the map onto the centre it was built with.
   */
  useImperativeHandle(
    ref,
    () => ({
      zoomBy: (delta: number) => {
        const script = `window.__zoom && window.__zoom(${delta}); true;`;
        webRef.current?.injectJavaScript(script);
      },
      recentre: () => {
        const script = `window.__recentre && window.__recentre(); true;`;
        webRef.current?.injectJavaScript(script);
      },
    }),
    [],
  );

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let message: BridgeMessage;
      try {
        message = JSON.parse(event.nativeEvent.data) as BridgeMessage;
      } catch {
        return;
      }

      switch (message.type) {
        case 'ready':
          setIsReady(true);
          onReady?.();
          break;
        case 'unavailable':
          onUnavailable?.();
          break;
        case 'press':
          onPress?.({ lat: message.lat, lng: message.lng });
          break;
        case 'gesture':
          // The document reports its touches for diagnostics only now; the CLAIM is
          // native (`claimGesture`), because a bridge report is asynchronous and a
          // scroll view is not.
          break;
        case 'camera':
          onCameraChange?.({
            centre: { lat: message.lat, lng: message.lng },
            zoom: message.zoom,
            pitch: message.pitch,
            bearing: message.bearing,
          });
          break;
      }
    },
    [onReady, onUnavailable, onPress, onCameraChange],
  );

  /**
   * ★ MARKERS ARE DRAWN HERE NOW, AND THAT WAS THE REPORTED MISSING PIN.
   *
   * This block used to void both props with a comment saying a renderer would come
   * later, so the browser drew every pin and a device drew none: the selection in
   * `Set your Location`, the place in `New Proposal`, and every proposal on the
   * event map were all invisible. The document renders them through `applyMarkers`
   * (`__apply`), from the same marker payload the web surface consumes.
   */

  if (mapboxCredential === null) {
    return <View testID={testID} style={FRAME_STYLE} />;
  }

  return (
    // ★ THE INTERCEPTOR IS NATIVE, AND IT IS WHY A VERTICAL DRAG PANS THE MAP.
    //
    // A WebView is an opaque native view: it never hands a touch back to React
    // Native, so an ancestor ScrollView wins a vertical drag that began on the map.
    // A native gesture on this wrapper is resolved by the gesture-handler dispatcher
    // BEFORE the scroll view's recogniser is consulted, so the page never gets the
    // drag. See `claimGesture` and `map-gesture.ts` for the reasoning in full.
    <GestureDetector gesture={claimGesture}>
      <View style={FRAME_STYLE} testID={testID ? `${testID}-frame` : undefined}>
        <WebView
          ref={webRef as never}
          testID={testID}
          style={FRAME_STYLE}
          source={{ html, baseUrl: 'https://freewhen.rovoid.tech' }}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          // The map handles its own gestures; the WebView must not scroll the page.
          scrollEnabled={false}
          // ★ AND IT MUST NOT FORWARD A DRAG TO A PARENT SCROLL VIEW EITHER.
          //
          // Without this the WebView asks its ancestors to scroll instead of
          // panning, which is the same defect one layer down.
          nestedScrollEnabled={false}
          onMessage={onMessage}
          onError={() => onUnavailable?.()}
          // A local HTML document may load the MapBox CDN; nothing else is allowed in.
          setSupportMultipleWindows={false}
        />
      </View>
    </GestureDetector>
  );
}


export type { MapCamera, MapLine, MapCircle, MapMarker, Coordinate };
