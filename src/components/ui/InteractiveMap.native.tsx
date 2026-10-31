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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';

import type {
  InteractiveMapProps,
  MapCamera,
  MapCircle,
  MapLine,
  MapMarker,
} from './InteractiveMap';
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

/** The document's height fills the frame; the frame's height comes from the caller. */
const FRAME_STYLE: ViewStyle = { flex: 1, overflow: 'hidden' };

/** A message the page sends back to the app. */
type BridgeMessage =
  | { type: 'ready' }
  | { type: 'unavailable'; reason: string }
  | { type: 'press'; lat: number; lng: number }
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
}): string {
  const { accessToken, style, camera, theme, accent } = options;

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
  html, body { margin: 0; padding: 0; height: 100%; background: transparent; }
  #map { position: absolute; inset: 0; }
  .mapboxgl-ctrl-attrib { font-size: 10px; }
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
          'line-dasharray': ['case', ['get', 'dashed'], ['literal', [2, 2]], ['literal', [1, 0]]]
        }
      });

      post({ type: 'ready' });
    });

    map.on('error', function (event) {
      post({ type: 'unavailable', reason: String((event && event.error) || 'map error') });
    });

    // A tap reports a coordinate; the app decides what it means.
    map.on('click', function (event) {
      post({ type: 'press', lat: event.lngLat.lat, lng: event.lngLat.lng });
    });

    map.on('moveend', function () {
      var centre = map.getCenter();
      post({
        type: 'camera',
        lat: centre.lat, lng: centre.lng,
        zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing()
      });
    });

    window.__apply = function (payload) {
      var data = JSON.parse(payload);

      if (data.camera) {
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

      if (data.accent) {
        try { map.setPaintProperty('route-line', 'line-color', ['get', 'color']); } catch (e) {}
      }
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
  const webRef = useRef<WebViewHandle | null>(null);
  const mapboxCredential = readMapboxToken();
  const [isReady, setIsReady] = useState(false);

  const reported = useRef(false);
  useEffect(() => {
    if (mapboxCredential === null && !reported.current) {
      reported.current = true;
      onUnavailable?.();
    }
  }, [mapboxCredential, onUnavailable]);

  /**
   * The document is built ONCE per token and style.
   *
   * `camera` is deliberately not a dependency: re-building the HTML on every camera
   * change would reload the WebView and restart the map on every drag frame. Camera
   * and overlay updates travel through `__apply` instead.
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
          }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mapboxCredential, theme],
  );

  const send = useCallback((payload: unknown) => {
    const script = `window.__apply(${JSON.stringify(JSON.stringify(payload))}); true;`;
    webRef.current?.injectJavaScript(script);
  }, []);

  /** Pushes the camera and the route whenever either changes. */
  useEffect(() => {
    if (!isReady) return;

    send({
      camera,
      lines: linesFeatureCollection(lines),
      accent,
    });
  }, [isReady, camera, lines, accent, send]);

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
   * Markers are not drawn by the document yet.
   *
   * The picker needs one pin at the centre, and the route map needs pins per venue.
   * Rendering them inside the WebView means the same GeoJSON sprite logic as the
   * web surface; until that lands the frame still shows the basemap, the camera and
   * the route, which is what the product needs on a device. `markers` and `circles`
   * are accepted so the call sites do not change when they gain a renderer.
   */
  void markers;
  void circles;

  if (mapboxCredential === null) {
    return <View testID={testID} style={FRAME_STYLE} />;
  }

  return (
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
      onMessage={onMessage}
      onError={() => onUnavailable?.()}
      // A local HTML document may load the MapBox CDN; nothing else is allowed in.
      setSupportMultipleWindows={false}
    />
  );
}


export type { MapCamera, MapLine, MapCircle, MapMarker, Coordinate };
