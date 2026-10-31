/**
 * The map corner controls: zoom in and out, and nothing that re-frames the map.
 *
 * ★ TWO REPORTS, ONE CONTROL SET.
 *
 * "Zoom in and out controls should be displayed on the Maps in the Event page (main
 * map and proposal maps), don't display the auto-pin control."
 *
 * "When I zoom in-out on the map it always returns to the selected location, like the
 * pin is always the pivot — I should be able to zoom and move freely, and only return
 * by pressing a button."
 *
 * The second one is why the FIRST cannot be built as a camera prop. A control written
 * as `setZoom(camera.zoom + 1)` writes the pose the map was BUILT with, the renderer
 * sees a new `cameraKey`, and `jumpTo` re-frames the map onto that pose — so the zoom
 * button is the pivot defect wearing a button's clothes. Zoom is therefore imperative,
 * through the surface's handle, exactly as a pinch is.
 */

import './support/register';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import { ZOOM_STEP, zoomControlAction } from '@/src/components/ui/map-imperative';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const WEB = code('src/components/ui/InteractiveMap.web.tsx');
const NATIVE = code('src/components/ui/InteractiveMap.native.tsx');
const SHARED = code('src/components/ui/InteractiveMap.tsx');
const EVENT_MAP = code('src/features/venues/components/EventRouteMap.tsx');
const PROPOSAL_MAP = code('src/features/proposals/components/ProposalRouteMap.tsx');
const PICKER = code('src/components/ui/LocationMapPicker.tsx');

/* ── The imperative rule ──────────────────────────────────────────────────── */

test('a press asks the surface to zoom', () => {
  // Arrange
  const asked: number[] = [];

  // Act
  const handled = zoomControlAction({ zoomBy: (delta) => asked.push(delta) }, ZOOM_STEP);

  // Assert
  assert.equal(handled, true);
  assert.deepEqual(asked, [ZOOM_STEP]);
});

test('a press with no surface does nothing, rather than throwing', () => {
  // Arrange — a build with no basemap draws no map, and its corner controls are not
  // drawn either; a stale press must still be harmless.
  assert.equal(zoomControlAction(null, 1), false);
  assert.equal(zoomControlAction(undefined, -1), false);
  assert.equal(zoomControlAction({ zoomBy: () => undefined }, 0), false);
  assert.equal(zoomControlAction({ zoomBy: () => undefined }, Number.NaN), false);
});

/* ── The surfaces draw the pair ───────────────────────────────────────────── */

test('both renderers declare the corner controls', () => {
  // Assert — the control is the caller's request, and each renderer draws it in its
  // own corner overlay: a DOM node in the browser, a document node in the WebView.
  assert.match(SHARED, /controls\?: boolean;/);
  assert.match(WEB, /data-map-controls/);
  assert.match(NATIVE, /data-map-controls/);
});

test('the controls cannot be mistaken for the basemap’s own', () => {
  // ★ MapBox ships a `NavigationControl` with a zoom pair, and the maps deliberately
  // do not use it: its chrome is the provider's, not the product's, and it would sit
  // on the map in a style nothing else on the screen shares.
  assert.doesNotMatch(WEB, /new mapboxgl\.NavigationControl/);
  assert.doesNotMatch(NATIVE, /mapboxgl\.NavigationControl/);
});

test('a zoom control moves the map, never the caller’s pose', () => {
  // ★ THIS IS THE "IT RETURNS TO THE PIN" DEFECT, PINNED.
  //
  // `map.zoomTo` keeps the centre the reader left the map at. A camera write would
  // carry a new `cameraKey` and re-frame the map onto the pose it was built with.
  assert.match(WEB, /map\.zoomTo\(map\.getZoom\(\) \+ delta/);
  assert.match(WEB, /onZoomIn=\{\(\) => mapRef\.current\?\.zoomTo\(\(mapRef\.current\?\.getZoom\(\) \?\? 0\) \+ ZOOM_STEP/);
  assert.match(WEB, /onZoomOut=\{\(\) => mapRef\.current\?\.zoomTo\(\(mapRef\.current\?\.getZoom\(\) \?\? 0\) - ZOOM_STEP/);
  assert.match(NATIVE, /window\.__zoom = function \(delta\) \{\s*\n\s*map\.zoomTo\(map\.getZoom\(\) \+ delta/);
  assert.match(NATIVE, /map\.zoomTo\(map\.getZoom\(\) \+ 1/);
  assert.match(NATIVE, /map\.zoomTo\(map\.getZoom\(\) - 1/);
});

test('the picker’s own buttons are gone, because the map draws them', () => {
  // ★ The picker used to have a React Native `+`/`−` column over the frame, and its
  // `changeZoom` wrote `framing` — the camera prop — which is the pivot defect. The
  // pair is now the map's, in the map's own corner, on both platforms.
  assert.doesNotMatch(PICKER, /changeZoom/);
  assert.doesNotMatch(PICKER, /t\('map\.zoomIn'\)/);
  assert.doesNotMatch(PICKER, /t\('map\.zoomOut'\)/);
  assert.match(PICKER, /ref=\{mapRef\}/);
  assert.match(PICKER, /controls/);
});

test('the picker keeps its locate-me control and loses nothing else', () => {
  // Assert — locate-me is the CONTROL the report did not ask to remove; the
  // auto-pin (re-centre onto the selection) is what it did.
  assert.match(PICKER, /location\.useCurrent/);
  assert.doesNotMatch(PICKER, /recentre\(\)/);
});

/* ── The decoration maps get the pair, and no auto-pin ────────────────────── */

test('the event map and every proposal map draw the zoom pair', () => {
  assert.match(EVENT_MAP, /controls/);
  assert.match(PROPOSAL_MAP, /controls/);
});

test('no decoration map draws a control that re-frames onto a pin', () => {
  // Assert — the event map and the cards are read-only views of a fact; a control
  // that recentres on a proposal is the one the report names.
  assert.doesNotMatch(EVENT_MAP, /recentre/);
  assert.doesNotMatch(PROPOSAL_MAP, /recentre/);
  assert.match(PROPOSAL_MAP, /controls but nothing that moves the camera|controls\n/);
});
