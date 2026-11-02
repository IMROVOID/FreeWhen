/**
 * The map's own gestures must reach the map, and the sheet must only move by its handle.
 *
 * ★ THREE REPORTS, THREE SEPARATE CAUSES, ALL FOUND ON A DEVICE.
 *
 *  1. **"Vertical dragging still scrolls the page or closes the Overlay; horizontal is
 *     fine."** The document's touch handler calls `preventDefault()` on EVERY touch.
 *     That is what stops the page scrolling, but the WebView still hands the drag up:
 *     the map's `#map` element is only as tall as the frame, and a vertical drag that
 *     leaves it is claimed by the scroll view, while a horizontal one never leaves it.
 *
 *  2. **"Nothing happens when I tap a location on the map; the pin should move there."**
 *     The same `preventDefault()` on `touchstart` suppresses the SYNTHETIC CLICK that
 *     `mapbox-gl` turns into its `click` event. `onPress` therefore never fires, and the
 *     picker never moves the pin. (Measured: a tap on a settled map changed 0 pixels.)
 *
 *  3. **"Overlays minimise when I hold anywhere on the Overlay and drag down; only the
 *     handle should."** `@gorhom/bottom-sheet`'s `enableContentPanningGesture` defaults
 *     to `true`, so the sheet's CONTENT is a drag surface for the same pan-down that
 *     collapses and closes it. (Measured: a drag from the sheet body dismissed it.)
 *
 * These are file-level assertions because the failure of each is a property of a
 * generated document or a component's props, not of a value a unit test can call. Two
 * of them were reproduced on an emulator against the installed APK first.
 */

import './support/register';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const NATIVE = code('src/components/ui/InteractiveMap.native.tsx');
const SHEET = code('src/components/ui/BottomSheet.tsx');

/* ── 2. A tap must reach the map ──────────────────────────────────────────── */

test('the document does not preventDefault on touchstart', () => {
  // ★ `preventDefault()` ON `touchstart` IS WHAT KILLED EVERY TAP.
  //
  // A browser synthesises `click` from a touch sequence unless the sequence is
  // cancelled. `mapbox-gl` listens for `click` and `touchend`; cancelling the start
  // means the `click` is never produced, so `onPress` never fired and the pin never
  // moved — while the map still panned, because panning is driven by `touchmove`.
  // The handler is `consumeTouch` by name, so the assertion is on what that function
  // DOES and on whether the touchstart listener calls it.
  const consume = /function consumeTouch\(event\) \{([\s\S]*?)\n {4}\}/.exec(NATIVE)?.[1] ?? '';
  const startHandler =
    /addEventListener\('touchstart', function \(([\s\S]*?)\}, \{ passive: (\w+) \}\)/.exec(NATIVE)?.[0] ?? '';

  assert.ok(startHandler.length > 0, 'the touchstart listener is gone');
  assert.ok(consume.length > 0, 'the touch consumer is gone');
  assert.match(consume, /preventDefault/, 'the consumer no longer stops the page scrolling');
  assert.doesNotMatch(
    startHandler,
    /consumeTouch|preventDefault/,
    'touchstart is cancelled, so the map never receives a click and taps do nothing',
  );
});

test('a tap is reported from the TOUCH, not from a synthesised click', () => {
  // ★ map.on('click') WAS THE ONLY SOURCE OF A PRESS, AND A CLICK IS SYNTHESISED.
  //
  // The browser produces a click only if it is satisfied the touch was not a gesture.
  // Inside a native WebView — where the touch arrives through Chromium's gesture
  // pipeline and the surface declares touch-action: none — that never happened, so no
  // handler ran at all and the pin never moved.
  //
  // touchend on the map is the guaranteed event, and the coordinate comes from
  // unproject so it is exact rather than a page offset.
  assert.match(NATIVE, /map\.on\('touchend'/, 'the map does not report a tap from its touch');
  assert.match(NATIVE, /map\.unproject\(\[touch\.clientX, touch\.clientY\]\)/, 'the tap is not converted to a coordinate');
  assert.match(NATIVE, /type: 'press'/);
});

test('a tap is distinguished from a drag, so panning never moves the pin', () => {
  // Assert — the same rule a click uses: small movement, short duration.
  assert.match(NATIVE, /TAP_MAX_MOVE_PX/);
  assert.match(NATIVE, /TAP_MAX_MS/);
  assert.match(NATIVE, /Math\.abs\(touch\.clientX - started\.x\) > TAP_MAX_MOVE_PX/);
});

test('a mouse click still reports a coordinate on a desktop build', () => {
  assert.match(NATIVE, /map\.on\('click'/, 'the click path was removed rather than kept');
});

test('a MOVING touch is still consumed, which keeps the page still', () => {
  // Arrange — the fix must not cost the vertical-drag behaviour that already works,
  // so consumption is gated on travel rather than removed.
  assert.match(NATIVE, /CONSUME_MIN_MOVE_PX/);
  assert.match(NATIVE, /if \(moved\) consumeTouch\(event\);/);
});

/* ── 1. A vertical drag must stay in the map ──────────────────────────────── */

test('the document claims its own gesture and refuses a parent scroll', () => {
  // Assert — the two levers that stop the page taking the drag.
  assert.match(NATIVE, /touch-action: none/, 'the document can be scrolled by the compositor');
  assert.match(NATIVE, /overscroll-behavior: none/, 'a drag at the edge chains to the page');
  assert.match(NATIVE, /nestedScrollEnabled=\{false\}/, 'the WebView forwards its drags upward');
});

test('the map layer covers the frame, so a drag never leaves it', () => {
  // ★ THE ASYMMETRY WAS THE CLUE: vertical was stolen, horizontal was not, because the
  // page's scroll view is vertical only — and because `#map` is inset to the frame, so
  // a finger that moves within it never touches the page at all.
  assert.match(NATIVE, /#map \{ position: absolute; inset: 0; touch-action: none; \}/);
});

/* ── 3. Only the handle moves the sheet ───────────────────────────────────── */

test('the sheet content is not a drag surface', () => {
  // ★ `enableContentPanningGesture` DEFAULTS TO `true`.
  //
  // That made the whole panel a pan-down target: holding anywhere in the content and
  // dragging down collapsed or dismissed the sheet, which is the reported "the
  // Overlays minimize when I hold from anywhere on the Overlay". Only the grabber
  // should move it, so content panning is off and handle panning stays on.
  assert.match(
    SHEET,
    /enableContentPanningGesture=\{false\}/,
    'the sheet content still pans the sheet, so a drag anywhere dismisses it',
  );
});

test('the handle still moves the sheet', () => {
  // Assert — turning the content gesture off must not turn the handle off with it.
  assert.match(SHEET, /enableHandlePanningGesture/, 'the handle can no longer move the sheet');
  assert.doesNotMatch(SHEET, /enableHandlePanningGesture=\{false\}/);
});

test('a non-dismissible gate keeps its existing constraints', () => {
  assert.match(SHEET, /enablePanDownToClose=\{dismissible\}/);
  assert.match(SHEET, /if \(dismissible\) sheetRef\.current\?\.close\(\)/);
});
