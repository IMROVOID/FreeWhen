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

test('NOTHING above the map claims the touch, which is the measured fix', () => {
  // ★ THIS IS A NEGATIVE RESULT, AND IT WAS MEASURED ON AN EMULATOR.
  //
  // Three mechanisms were tried against the installed APK:
  //
  //  1. a React `PanResponder` raised on a bridge report — asynchronous, so the
  //     page's ScrollView had already taken the drag;
  //  2. the same, tightened — some drags reached the map, then stopped after a few
  //     points because the WebView's recogniser gave the finger up;
  //  3. a gesture-handler `Gesture.Pan` on the map's wrapper. A TAP on the map's
  //     `+` control zoomed it, and a DRAG in the identical box moved NOTHING —
  //     neither the map nor the page. The ancestor gesture takes the movement before
  //     the WebView's own recogniser sees it, and cancelsTouchesInView(false) does not
  //     help: the handler still holds the touch.
  //
  // So the WebView owns every touch in its box, and the page is held off from inside.
  assert.doesNotMatch(NATIVE, /GestureDetector/, 'an ancestor gesture is back and will starve the map');
  assert.doesNotMatch(NATIVE, /Gesture\.Pan\(\)/, 'an ancestor pan gesture is back');
  assert.doesNotMatch(NATIVE, /from 'react-native-gesture-handler'/, 'the map re-imported the gesture library');
});

test('the document consumes its own touches instead of reporting them', () => {
  // ★ `{ passive: true }` CANNOT `preventDefault`, AND THAT WAS THE HOLE.
  //
  // The listener used to be passive: it only posted a message upward, so the page
  // compositor was free to read the same touch as a scroll. A non-passive handler
  // refuses that, which is what leaves the drag to the map for its whole life.
  assert.match(NATIVE, /function consumeTouch\(event\)/, 'the document does not consume its touches');
  assert.match(NATIVE, /if \(event\.cancelable\) event\.preventDefault\(\);/);
  assert.match(NATIVE, /document\.addEventListener\('touchstart', function \(event\) \{[\s\S]{0,200}?\}, \{ passive: false \}\)/);
  assert.match(NATIVE, /document\.addEventListener\('touchmove', consumeTouch, \{ passive: false \}\)/);
});

test('double-tap zoom cannot steal a pan either', () => {
  assert.match(NATIVE, /addEventListener\('gesturestart'/);
});

test('a long press does not start a selection or a callout mid-drag', () => {
  assert.match(NATIVE, /-webkit-user-select: none; user-select: none;/);
  assert.match(NATIVE, /-webkit-touch-callout: none;/);
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
