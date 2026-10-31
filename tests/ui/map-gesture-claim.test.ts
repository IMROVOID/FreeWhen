/**
 * A vertical drag inside the map pans the map, not the page.
 *
 * ★ THE DEFECT THIS PINS, AS REPORTED.
 *
 * "When I try to drag the map vertically on the App, the page itself scrolls
 * instead. Horizontal drags are fine — it is like a scroll/interactivity priority
 * issue. When the user drags their finger inside the map box, only the map should
 * move, not the page. Web is already fine."
 *
 * The asymmetry is the diagnosis. On a device the map is a `WebView` running the
 * same `mapbox-gl` document the browser runs. `scrollEnabled={false}` stops the
 * WebView scrolling ITSELF and `touch-action: none` stops the DOCUMENT claiming the
 * finger as a scroll — but neither reaches React Native, because a WebView is an
 * opaque native view that does not participate in RN's responder negotiation. The
 * page's `ScrollView` is VERTICAL only, so it was the vertical drag an ancestor
 * happily claimed. Horizontal drags were fine because nothing above the map wanted
 * them.
 *
 * ★ SO THE PROOF IS STRUCTURAL: A NATIVE CLAIM MUST EXIST.
 *
 * A device gesture cannot be driven from Node. What CAN be asserted is the three
 * parts of the mechanism, and they are what the fix turns on:
 *
 *  1. the document reports the beginning and end of a touch over the bridge;
 *  2. the surface becomes the responder while that report says a finger is down;
 *  3. it refuses to hand the responder back when an ancestor asks for it.
 */

import './support/register';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import { claimsMapGesture, mapOwnsGesture } from '@/src/components/ui/map-gesture';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const NATIVE = code('src/components/ui/InteractiveMap.native.tsx');
const PULL = code('src/components/ui/PullToSync.tsx');

/* ── The rule ─────────────────────────────────────────────────────────────── */

test('a drag in either direction belongs to the map', () => {
  // Arrange / Act — the reported defect was specifically the VERTICAL axis, so a
  // rule that only spoke about horizontal travel would have passed it.
  const vertical = claimsMapGesture({ dx: 0, dy: 120 });
  const horizontal = claimsMapGesture({ dx: 120, dy: 0 });
  const diagonal = claimsMapGesture({ dx: 40, dy: -40 });

  // Assert
  assert.equal(vertical, true, 'a vertical drag is not the map’s');
  assert.equal(horizontal, true);
  assert.equal(diagonal, true);
});

test('a non-finite movement is not a gesture', () => {
  assert.equal(claimsMapGesture({ dx: Number.NaN, dy: 10 }), false);
  assert.equal(claimsMapGesture({ dx: 10, dy: Number.POSITIVE_INFINITY }), false);
});

test('the page-pull refuses exactly what the map claims', () => {
  // The same question asked by the other platform's responder, answered by the same
  // module, so the two cannot drift into disagreeing about a downward drag.
  assert.equal(mapOwnsGesture(true), true);
  assert.equal(mapOwnsGesture(false), false);
});

/* ── 1. The document reports the touch ────────────────────────────────────── */

test('the document reports a finger down and a finger up', () => {
  // Assert — this is the signal the app has nothing else to infer from: a WebView
  // gives React Native no touch events of its own.
  assert.match(NATIVE, /document\.addEventListener\('touchstart'/, 'no touchstart listener');
  assert.match(NATIVE, /document\.addEventListener\('touchend'/, 'no touchend listener');
  assert.match(NATIVE, /document\.addEventListener\('touchcancel'/, 'no touchcancel listener');
  assert.match(NATIVE, /post\(\{ type: 'gesture', active: true \}\)/);
  assert.match(NATIVE, /post\(\{ type: 'gesture', active: false \}\)/);
});

test('the bridge message carries the claim', () => {
  // Assert — a message the union does not name would be dropped by the switch.
  assert.match(NATIVE, /\{ type: 'gesture'; active: boolean \}/);
  assert.match(NATIVE, /case 'gesture':/);
  assert.match(NATIVE, /gestureHeld\.current = message\.active;/);
});

/* ── 2. The surface becomes the responder ─────────────────────────────────── */

test('the map is wrapped in a view that can hold the responder', () => {
  // Arrange — a `PanResponder` attached nowhere claims nothing.
  const wraps = /<View style=\{FRAME_STYLE\} \{\.\.\.responder\.panHandlers\}/.test(NATIVE);

  // Assert
  assert.ok(wraps, 'the WebView has no responder-holding parent, so an ancestor claims the drag');
});

test('the claim follows the document, not a direction', () => {
  // Arrange — the reported defect is a PRIORITY problem: the page won the
  // negotiation before the map was consulted, so the predicate must be "a finger is
  // down in the map", never "the drag looks vertical".
  const start = /onStartShouldSetPanResponder: \(\) => gestureHeld\.current/.test(NATIVE);
  const move = /onMoveShouldSetPanResponder: \(\) => gestureHeld\.current/.test(NATIVE);

  // Assert
  assert.ok(start, 'the surface does not claim a touch that begins in the map');
  assert.ok(move, 'the surface does not keep the claim while the finger travels');
});

test('the responder is refused to whoever asks for it mid-drag', () => {
  // ★ THIS IS THE LINE THE DEFECT TURNS ON.
  //
  // React Native asks `onPanResponderTerminationRequest` the moment an ancestor
  // wants the responder — and a `ScrollView` wants it on the first vertical
  // movement. Answering yes hands the map's drag straight back to the page, which is
  // exactly "the page scrolls instead".
  assert.match(
    NATIVE,
    /onPanResponderTerminationRequest: \(\) => !gestureHeld\.current/,
    'the surface gives the drag back to the page while a finger is in the map',
  );
});

test('the claim is released when the touch ends', () => {
  // Arrange — a claim that outlives its finger would make the page unscrollable
  // after one visit to the map.
  assert.match(NATIVE, /onPanResponderRelease: releaseClaim/);
  assert.match(NATIVE, /onPanResponderTerminate: releaseClaim/);
  assert.match(NATIVE, /gestureHeld\.current = false;/);
});

test('the WebView still does not scroll itself', () => {
  // Assert — the document's half of the same fix, kept.
  assert.match(NATIVE, /scrollEnabled=\{false\}/);
  assert.match(NATIVE, /touch-action: none;/);
  assert.match(NATIVE, /overscroll-behavior: none;/);
});

/* ── 3. The web responder asks the same module ────────────────────────────── */

test('the web pull keeps declining gestures that began on the map', () => {
  // ★ Web was reported as already fine, and it was — because `PullToSync` consults
  // the gesture's origin. That behaviour must survive this change, or the fix for
  // one platform becomes the regression on the other.
  assert.match(PULL, /startedOnMap\(event\)/);
  assert.match(PULL, /data-map-surface/);
});
