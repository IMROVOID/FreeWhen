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
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';

import type {
  InteractiveMapProps,
  MapCamera,
  MapCircle,
  MapLine,
  MapMarker,
} from './InteractiveMap';
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
    /* A long press must not start a text selection or an iOS callout mid-drag. */
    -webkit-user-select: none; user-select: none;
    -webkit-touch-callout: none;
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
        // ★ A MARKER WITH NO COLOUR AT ALL IS A CONTRACT BREACH, AND IT IS REPORTED.
        //
        // A pin painted with \`undefined\` keeps its SVG default — WHITE — which looks
        // exactly like a deliberate design and reads as "the colour is broken on a
        // device". It is not diagnosable from a screenshot, so the payload that
        // produced it goes back over the bridge instead.
        if (!marker.color && !accent) {
          post({ type: 'unavailable', reason: 'marker-no-colour: ' + marker.id });
        }

        paintPin(handle.getElement(), marker.color || accent || MARKER_RING, marker.selected === true);
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

      /**
       * ★ THE CASING IS GONE, AND THE LINE IS WIDER, BECAUSE THE HALO WAS DARKENING IT.
       *
       * A 4px coloured stroke sat inside a 7px BLACK casing at 25% opacity. Between
       * them the visible line was a thin colour threaded through a dark halo, which
       * on the night basemap read as one dark olive line rather than as the
       * proposer's colour — the report was "the line is too dark, make it wider and
       * lighter". The casing existed to separate an accent line from a PALE basemap;
       * on the dark style it does the opposite, and the line has its own contrast.
       *
       * So one stroke, wider, at full opacity. The colour is the destination's, which
       * is already chosen to read on both appearances.
       */
      map.addLayer({
        id: 'route-line', type: 'line', source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 6,
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

    /**
     * ★ A TAP IS REPORTED FROM THE TOUCH ITSELF, NOT FROM A SYNTHESISED \`click\`.
     *
     * \`map.on('click')\` was the only source of a press, and a \`click\` is a SYNTHESISED
     * event: the browser only produces one if it is satisfied the touch sequence was
     * not a gesture. Inside a native WebView that assumption fails — the touch is
     * delivered by Chromium's gesture pipeline rather than by a real pointer device,
     * and \`touch-action: none\` on the surface tells the compositor this is not a
     * tappable area. The result, measured on an emulator: the pin never moved, and
     * nothing in the log said why, because no handler had run at all.
     *
     * So the press comes from \`touchend\` on the canvas, where the coordinate is exact
     * and the event is guaranteed to exist. A drag is excluded by distance and by
     * duration — the same rule a click uses — so panning still never moves the pin.
     */
    var TAP_MAX_MOVE_PX = 10;
    var TAP_MAX_MS = 600;
    var tapStart = null;

    function reportPress(point) {
      post({ type: 'press', lat: point.lat, lng: point.lng });
    }

    map.on('touchend', function (event) {
      if (!tapStart) return;

      var touch = event.changedTouches && event.changedTouches[0];
      var started = tapStart;
      tapStart = null;

      if (!touch) return;
      if (Date.now() - started.at > TAP_MAX_MS) return;
      if (Math.abs(touch.clientX - started.x) > TAP_MAX_MOVE_PX) return;
      if (Math.abs(touch.clientY - started.y) > TAP_MAX_MOVE_PX) return;

      reportPress(map.unproject([touch.clientX, touch.clientY]));
    });

    map.on('touchstart', function (event) {
      var touch = event.touches && event.touches[0];
      if (!touch) return;

      tapStart = { x: touch.clientX, y: touch.clientY, at: Date.now() };
    });

    map.on('touchcancel', function () {
      tapStart = null;
    });

    // A desktop build still reaches this surface, and a mouse produces a real click.
    map.on('click', function (event) {
      reportPress({ lat: event.lngLat.lat, lng: event.lngLat.lng });
    });

    /**
     * ★ THE DOCUMENT CONSUMES ITS OWN MOVEMENT, AND THAT IS WHAT KEEPS THE PAGE STILL.
     *
     * \`scrollEnabled={false}\` stops the WebView scrolling ITSELF, and
     * \`touch-action: none\` stops this document claiming the finger as a scroll —
     * neither of which reaches React Native, because a WebView does not participate
     * in RN's responder negotiation. So an ancestor \`ScrollView\` was free to take a
     * vertical drag that began on the map and scroll the page instead (the reported
     * defect; horizontal drags were fine because that ScrollView is vertical only).
     *
     * ★ ONLY \`touchmove\` IS CANCELLED, AND CANCELLING \`touchstart\` WAS BREAKING TAPS.
     *
     * A browser synthesises \`click\` from a touch sequence UNLESS that sequence is
     * cancelled — and cancelling \`touchstart\` cancels the whole sequence. So every tap
     * on the map stopped producing a \`click\`, \`mapbox-gl\`'s \`click\` handler never ran,
     * \`onPress\` never fired, and the picker's pin never moved to where the reader
     * tapped. The map still panned, because panning is driven by \`touchmove\`.
     *
     * Cancelling \`touchmove\` is what actually keeps the page still, and it leaves the
     * tap intact: the movement that would scroll is refused, the gesture that ends
     * without movement still becomes a click. Both are non-passive — a passive listener
     * cannot \`preventDefault\` at all, which is why the earlier version lost every time.
     *
     * The report is kept: it is the only signal that a touch reached the document, and
     * it is what tells "the touch never arrived" apart from "the map refused it".
     */
    function consumeTouch(event) {
      // The map, its markers and its own controls all handle their own presses; only
      // the browser's default scroll/pinch/zoom is refused.
      if (event.cancelable) event.preventDefault();
    }

    /**
     * ★ A TAP IS NOT CANCELLED, AND NEITHER IS A TOUCH THAT DID NOT MOVE.
     *
     * Cancelling a touch sequence suppresses the \`touchend\` and \`click\` that follow —
     * which is what broke tap-to-place-the-pin. \`touchmove\` is still consumed so the
     * page cannot scroll under a pan, but only once the finger has actually TRAVELLED:
     * a touch that ends where it began is a tap, and a tap must reach the map.
     */
    var CONSUME_MIN_MOVE_PX = 8;
    var touchOrigin = null;

    document.addEventListener('touchstart', function (event) {
      var touch = event.touches && event.touches[0];
      touchOrigin = touch ? { x: touch.clientX, y: touch.clientY } : null;
      post({ type: 'gesture', active: true });
    }, { passive: true });

    document.addEventListener('touchmove', function (event) {
      if (!touchOrigin) return;

      var touch = event.touches && event.touches[0];
      if (!touch) return;

      var moved =
        Math.abs(touch.clientX - touchOrigin.x) > CONSUME_MIN_MOVE_PX ||
        Math.abs(touch.clientY - touchOrigin.y) > CONSUME_MIN_MOVE_PX;

      // A finger that has not left its start point is a tap in progress.
      if (moved) consumeTouch(event);
    }, { passive: false });

    document.addEventListener('touchend', function () {
      touchOrigin = null;
      post({ type: 'gesture', active: false });
    }, { passive: true });

    document.addEventListener('touchcancel', function () {
      touchOrigin = null;
      post({ type: 'gesture', active: false });
    }, { passive: true });

    // Double-tap zoom is the other gesture that steals a pan on a phone.
    document.addEventListener('gesturestart', function (event) {
      if (event.cancelable) event.preventDefault();
    }, { passive: false });

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

    /**
     * ★ IT ACCEPTS EITHER ENCODING, BECAUSE THE OTHER ONE WAS A SILENT BLACKOUT.
     *
     * This used to be a bare \`JSON.parse(payload)\`, and the app was handing it a
     * DOUBLE-encoded payload. The parse never failed — \`"{\\"lines\\":…}"\` is a valid
     * JSON string literal — it just returned the inner STRING, so \`data.lines\`,
     * \`data.markers\`, \`data.circles\`, \`data.accent\` and \`data.camera\` were all
     * \`undefined\` on every update. The guarded writes below therefore never ran.
     *
     * On a device that showed as a route line in the casing's near-black instead of
     * the origin's teal, and a pin in this document's boot colour instead of the
     * theme's: nothing had ever recoloured them. The browser was fine because it does
     * not go through this bridge at all.
     *
     * So the parse is repeated once when the first result is still a string. That
     * keeps the document correct whatever the caller sends, and it fails loudly rather
     * than quietly doing nothing if a payload is ever malformed.
     */
    window.__apply = function (payload) {
      var data = payload;

      for (var depth = 0; depth < 2 && typeof data === 'string'; depth += 1) {
        try {
          data = JSON.parse(data);
        } catch (e) {
          post({ type: 'unavailable', reason: 'payload: ' + String(e && e.message || e) });
          return;
        }
      }

      if (!data || typeof data !== 'object') return;

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
   * ★ NO ANCESTOR CLAIMS THE TOUCH, AND THAT IS THE FIX — NOT A CONCESSION.
   *
   * Three mechanisms were tried and two were measured wrong on an emulator:
   *
   *  1. a React `PanResponder` raised on a bridge report — asynchronous, so the
   *     page's `ScrollView` had already taken the drag;
   *  2. the same, tightened — some drags reached the map and stopped after a few
   *     points, because the WebView's recogniser gave the finger up;
   *  3. a gesture-handler `Gesture.Pan` here. A TAP on the map's `+` control zoomed
   *     it and a DRAG in the same box moved NOTHING — neither the map nor the page.
   *     An ancestor gesture claims the movement before the `WebView`'s own
   *     recogniser sees it, and `cancelsTouchesInView(false)` does not help: the
   *     handler still holds the touch.
   *
   * So the `WebView` keeps every touch in its box, which the tap already proved
   * works. The page's `ScrollView` is kept out of the way from inside instead: the
   * document calls `preventDefault` on its own touch events, so the page compositor
   * never treats the drag as a scroll, and `nestedScrollEnabled={false}` stops the
   * native view forwarding it upward.
   */

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

  /**
   * Hands one payload to the document.
   *
   * ★ THE DOUBLE ENCODING IS DELIBERATE, AND IT USED TO BE A SILENT BLACKOUT.
   *
   * `JSON.stringify(payload)` produces a JS string literal that is safe to embed in
   * injected source, and `__apply` parses it — so the argument the document receives
   * is JSON TEXT, which is why it takes two `JSON.stringify` calls to get there.
   *
   * The document's `__apply` used to be a bare `JSON.parse(payload)`, and that parse
   * never failed: `"{\"lines\":…}"` is a valid JSON string literal, so it returned the
   * inner STRING rather than the object. `data.lines`, `data.markers`, `data.circles`,
   * `data.accent` and `data.camera` were therefore all `undefined` on every update and
   * the guarded writes never ran — which is why a device drew a route line in the
   * casing's near-black and a pin in the document's boot colour while the browser drew
   * both correctly. `__apply` now unwraps a string payload, so this encoding is
   * correct by construction rather than by accident.
   */
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
          // The document reports its touches for diagnostics only. Nothing claims
          // them: the WebView owns every touch in its box. See `map-gesture.ts`.
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
    // ★ THE WEBVIEW OWNS ITS BOX. Nothing above it claims the touch.
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
        // ★ AND IT MUST NOT HAND A DRAG TO A PARENT SCROLL VIEW EITHER.
        //
        // This is the native half of the fix: without it the WebView asks its
        // ancestors to scroll instead of panning, which is the same defect one layer
        // down. The document's half is `preventDefault` on its own touch events.
        nestedScrollEnabled={false}
        onMessage={onMessage}
        onError={() => onUnavailable?.()}
        // A local HTML document may load the MapBox CDN; nothing else is allowed in.
        setSupportMultipleWindows={false}
      />
    </View>
  );
}


export type { MapCamera, MapLine, MapCircle, MapMarker, Coordinate };
