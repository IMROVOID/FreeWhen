/**
 * The device surface: pins that exist, and a drag that stays on the map.
 *
 * ★ TWO REPORTED DEFECTS, ONE FILE BECAUSE THEY ARE ONE COMPONENT.
 *
 *  - **"I don't see a map pin when selecting a location, on the app."**
 *    `InteractiveMap.native.tsx` accepted `markers` and drew NOTHING — the props were
 *    voided with a comment saying a renderer would come later. The browser drew every
 *    pin; a device drew none. So the selection in `Set your Location`, the place in
 *    `New Proposal` and every proposal pin on the event map were all invisible.
 *
 *  - **"When I drag the map vertically, the page scrolls instead."**
 *    The map runs inside a WebView, which does not hand its touches to React Native's
 *    responder system. `scrollEnabled={false}` stops the WebView scrolling ITSELF; it
 *    does not stop the `ScrollView` above it from claiming a vertical gesture that
 *    began on the map. The browser needed `touch-action: none` for the same reason and
 *    already had it.
 *
 * Both are properties of the generated document, so both are asserted against it.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const NATIVE = readFileSync('src/components/ui/InteractiveMap.native.tsx', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const WEB = readFileSync('src/components/ui/InteractiveMap.web.tsx', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/* ── Pins ─────────────────────────────────────────────────────────────────── */

test('a marker is drawn on a device, not accepted and dropped', () => {
  // Arrange — the two lines that made every pin invisible.
  const voided = /void markers;/.test(NATIVE);
  const renders = /applyMarkers\(map, data\.markers/.test(NATIVE);

  // Assert
  assert.equal(voided, false, 'the component still discards its markers');
  assert.ok(renders, 'the document never renders markers');
});

test('a marker is removed when the payload stops carrying it', () => {
  // Assert — an id in the registry and missing from the list means removed; without
  // this, a proposal withdrawn from the list keeps its pin on the map.
  assert.match(NATIVE, /if \(markersById\.hasOwnProperty\(id\) && !seen\[id\]\)/);
  assert.match(NATIVE, /markersById\[id\]\.remove\(\)/);
});

test('a marker is a pin on both platforms, never a circle', () => {
  // Arrange ★ THE REPORT: "display proposal locations by map pins, not circles."
  //
  // A circle says "something is here". A teardrop says "this place is here", and its
  // point sits on the coordinate instead of its centre — which matters the moment two
  // proposals are a street apart.
  const nativePin = /PIN_PATH/.test(NATIVE) && /viewBox="0 0 24 32"/.test(NATIVE);
  const webPin = /PIN_PATH/.test(WEB) && /viewBox="0 0 24 32"/.test(WEB);
  // THE ORIGIN IS THE ONE EXCEPTION, AND IT IS A DELIBERATE ONE (Plan 65).
  //
  // A proposal is a place the group is being asked to go to, so it is a teardrop whose
  // POINT is the coordinate. The viewer's own start point is not a destination, so it
  // is a circle centred on its coordinate - MapMarker.shape: 'circle'. The rule this
  // test protects is unchanged: a PLACE is a pin, never a dot.
  const rounded = /borderRadius = '50%'/.test(WEB) || /borderRadius = '50%'/.test(NATIVE);
  const guardedByShape = /marker\.shape === 'circle'/.test(WEB) && /marker\.shape === 'circle'/.test(NATIVE);

  assert.equal(rounded && !guardedByShape, false, 'a marker is a circle with no shape guard');

  // Assert
  assert.ok(nativePin, 'the device draws no pin shape');
  assert.ok(webPin, 'the browser draws no pin shape');
});

test('the pin’s point sits on the coordinate', () => {
  // Assert — `anchor: 'bottom'` puts the tip where the place is; `center` would put
  // the middle of the shape there, half a pin south of the truth.
  assert.match(NATIVE, /isCircle \? 'center' : 'bottom'/);
  assert.match(WEB, /circle \? 'center' : 'bottom'/);
});

test('a repainted pin does not lose its shape', () => {
  // ★ The pin body is built once and then recoloured. `innerHTML` on every repaint
  // would replace the node the compositor is drawing on every camera report.
  assert.match(NATIVE, /if \(element\.childElementCount === 0\)/);
  assert.match(WEB, /if \(element\.childElementCount === 0\)/);
});

test('the pin’s transform is computed, never concatenated', () => {
  // Assert — the first version appended `' scale(1.35)'`, which grew the selected pin
  // by another 35% on every marker refresh, without bound.
  assert.doesNotMatch(NATIVE, /style\.transform \+/);
  assert.doesNotMatch(WEB, /style\.transform \+/);
});

/* ── Drag ─────────────────────────────────────────────────────────────────── */

test('the document owns its gestures, so a vertical drag never scrolls the form', () => {
  // Arrange ★ THE REPORTED DEFECT IS SPECIFICALLY VERTICAL, because the ScrollView
  // above the map is vertical only — which is why a horizontal drag already worked.
  const noTouchAction = /touch-action: none;/.test(NATIVE);
  const noOverscroll = /overscroll-behavior: none;/.test(NATIVE);
  const noOverflow = /overflow: hidden;/.test(NATIVE);

  // Assert
  assert.ok(noTouchAction, 'a finger drag is claimable by the browser as a scroll');
  assert.ok(noOverscroll, 'a drag that reaches the document’s edge chains to the page');
  assert.ok(noOverflow, 'the document can itself scroll');
});

test('the map frame is also `touch-action: none` on the surface element', () => {
  // Assert — the attribute on `#map` covers the canvas; this covers the container
  // before the canvas exists.
  assert.match(NATIVE, /#map \{ position: absolute; inset: 0; touch-action: none; \}/);
});

test('the WebView itself is not scrollable', () => {
  // Assert — the other half: even with the document pinned, a scrollable WebView can
  // pan its own viewport.
  assert.match(NATIVE, /scrollEnabled=\{false\}/);
});

/* ── Areas ────────────────────────────────────────────────────────────────── */

test('an approximate area is drawn on a device, as a polygon', () => {
  // Arrange — `circles` was voided with `markers`, so a fuzzed area was invisible on
  // a device while the browser drew a 32-gon. A privacy guarantee that only holds in
  // one client is not a guarantee.
  assert.match(NATIVE, /applyAreas\(map, data\.circles/);
  assert.match(NATIVE, /var segments = 32;/);
  assert.equal(/void circles;/.test(NATIVE), false, 'the component still discards its areas');
});
