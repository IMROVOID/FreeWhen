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

import { MAP_GESTURE_ALLOWANCE, claimsMapGesture, mapOwnsGesture } from '@/src/components/ui/map-gesture';

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
/* ── 1. The document reports the touch ────────────────────────────────────── */

test('the document reports a finger down and a finger up', () => {
  // ★ The report is now DIAGNOSTIC, and it is kept on purpose: it is the only signal
  // that a touch reached the document at all, which is what a future regression needs
  // in order to tell "the claim failed" from "the finger never arrived".
  assert.match(NATIVE, /document\.addEventListener\('touchstart'/, 'no touchstart listener');
  assert.match(NATIVE, /document\.addEventListener\('touchend'/, 'no touchend listener');
  assert.match(NATIVE, /post\(\{ type: 'gesture', active: true \}\)/);
  assert.match(NATIVE, /post\(\{ type: 'gesture', active: false \}\)/);
});

test('the bridge message still carries the gesture report', () => {
  // Assert — a message the union does not name would be dropped as a parse failure.
  assert.match(NATIVE, /\{ type: 'gesture'; active: boolean \}/);
  assert.match(NATIVE, /case 'gesture':/);
});

/* ── 2. The surface claims it NATIVELY ────────────────────────────────────── */

test('the map is wrapped in a native gesture detector', () => {
  // ★ A REACT PanResponder CANNOT WIN THIS RACE, AND THE FIRST VERSION DID NOT.
  //
  // The page's ScrollView is a NATIVE scroll view and claims a vertical drag with its
  // own recogniser the moment the finger travels. A PanResponder competes for the
  // same touch asynchronously — raised on a bridge report — so by the time the report
  // arrived the scroll view had already won. Most drags scrolled the page; the ones
  // that did not moved the map for about a centimetre. The claim has to be resolved by
  // the gesture-handler dispatcher, on the ancestor, before the scroll view is asked.
  assert.match(NATIVE, /from 'react-native-gesture-handler'/);
  assert.match(NATIVE, /<GestureDetector gesture=\{claimGesture\}>/, 'the map has no native interceptor');
  assert.match(NATIVE, /Gesture\.Pan\(\)/, 'the interceptor is not a pan gesture');
});

test('the interceptor claims on the first movement, not at one pixel', () => {
  // Arrange / Act — the allowance is what lets the WebView keep the finger below it.
  //
  // ★ minDistance(0) WAS TRIED AND IS WRONG. The interceptor suppresses the WebView
  // while it is active, so a claim at the first pixel pans the map by the allowance and
  // then hands the finger back — "the map only moves about a centimetre and I have to
  // drag again".
  assert.equal(MAP_GESTURE_ALLOWANCE, 6);
  assert.match(NATIVE, /\.minDistance\(MAP_GESTURE_ALLOWANCE\)/);
});

test('the interceptor stays on the UI thread', () => {
  // Assert — nothing has to be handed to JavaScript, so the decision never queues
  // behind a frame and the claim is never late.
  assert.match(NATIVE, /\.runOnJS\(false\)/);
});

test('the interceptor does not release when the finger leaves the box', () => {
  // Assert — a map drag that wanders past the frame must not be handed back mid-way.
  assert.match(NATIVE, /\.shouldCancelWhenOutside\(false\)/);
});

test('the old React responder is gone, and cannot come back by accident', () => {
  // Assert — the mechanism that was measured not to work.
  assert.doesNotMatch(NATIVE, /PanResponder\.create/, 'the asynchronous responder is back');
  assert.doesNotMatch(NATIVE, /\.\.\.responder\.panHandlers/, 'a PanResponder is still spread onto the wrapper');
});

test('the WebView still does not scroll itself', () => {
  // Assert — the document's half of the same fix, kept.
  assert.match(NATIVE, /scrollEnabled=\{false\}/);
  assert.match(NATIVE, /touch-action: none;/);
  assert.match(NATIVE, /overscroll-behavior: none;/);
});

test('the WebView does not hand a drag to a parent scroll view', () => {
  // Assert — the same defect one layer down: without this the WebView asks its
  // ancestors to scroll instead of panning.
  assert.match(NATIVE, /nestedScrollEnabled=\{false\}/);
});

test('the web pull keeps declining gestures that began on the map', () => {
  // ★ Web was reported as already fine, and it was — because `PullToSync` consults
  // the gesture's origin. That behaviour must survive this change, or the fix for
  // one platform becomes the regression on the other.
  assert.match(PULL, /startedOnMap\(event\)/);
  assert.match(PULL, /data-map-surface/);
});
