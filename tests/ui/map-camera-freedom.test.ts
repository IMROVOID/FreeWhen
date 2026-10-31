/**
 * The camera is the reader's: nothing a gesture reports may be written back.
 *
 * ★ THE REPORT: "WHEN I ZOOM IN-OUT ON THE MAP IT ALWAYS RETURNS TO THE PIN."
 *
 * `InteractiveMap` applies the `camera` prop once per distinct pose — that part was
 * fixed earlier, and `cameraKey` is what makes it work. What was NOT fixed is the
 * call sites: the event map and the proposal card rebuilt their camera from live
 * state on every render, so a gesture's report came back as a new pose the next time
 * anything re-rendered (a route landing, a vote, a parent state change) and the map
 * jumped back to the pin.
 *
 * ★ AND THE ZOOM CONTROL WAS THE SAME BUG AS A BUTTON.
 *
 * `changeZoom` wrote the picker's `framing`, which IS the camera prop — so pressing
 * `+` re-framed the map onto the pose it was built with. It is imperative now.
 *
 * So this file pins the RULE at the call sites, because the surface cannot enforce it:
 * a camera that is derived from live map state is a camera that undoes a gesture.
 */

import './support/register';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import { cameraKey } from '@/src/components/ui/map-camera';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const EVENT_MAP = code('src/features/venues/components/EventRouteMap.tsx');
const PROPOSAL_MAP = code('src/features/proposals/components/ProposalRouteMap.tsx');
const PICKER = code('src/components/ui/LocationMapPicker.tsx');
const WEB = code('src/components/ui/InteractiveMap.web.tsx');
const NATIVE = code('src/components/ui/InteractiveMap.native.tsx');

/* ── The surface ──────────────────────────────────────────────────────────── */

test('an equal pose is a no-op, which is what lets a gesture survive a re-render', () => {
  // Arrange — this is the whole mechanism, restated so a refactor that drops it
  // fails here rather than on a device.
  const pose = { centre: { lat: 35.6892, lng: 51.389 }, zoom: 14, pitch: 50, bearing: 0 };

  // Act / Assert
  assert.equal(cameraKey({ ...pose }), cameraKey(pose));
  assert.notEqual(cameraKey({ ...pose, zoom: 15 }), cameraKey(pose));
});

test('both renderers compare the pose before applying it', () => {
  assert.match(WEB, /appliedCameraRef\.current === wanted/);
  assert.match(NATIVE, /data\.cameraKey !== window\.__cameraKey/);
});

test('neither surface writes a reported camera back', () => {
  // Assert — the report goes up and stops there.
  const webMoveEnd = /map\.on\('moveend', \(\) => \{([\s\S]*?)\n {4}\}\)/.exec(WEB)?.[1] ?? '';
  const nativeMoveEnd = /map\.on\('moveend', function \(\) \{([\s\S]*?)\n {4}\}\)/.exec(NATIVE)?.[1] ?? '';

  assert.ok(webMoveEnd.length > 0);
  assert.ok(nativeMoveEnd.length > 0);
  assert.doesNotMatch(webMoveEnd, /jumpTo/, 'a settled gesture re-drives the camera');
  assert.doesNotMatch(nativeMoveEnd, /jumpTo/, 'a settled gesture re-drives the camera');
});

/* ── The call sites ───────────────────────────────────────────────────────── */

test('the event map keys its camera on coordinates, not on rebuilt arrays', () => {
  // Arrange — `destinations` is rebuilt by the screen on every render, so a memo that
  // depends on the array produces a new object every time.
  assert.match(EVENT_MAP, /const destinationKey = destinations/);
  assert.match(EVENT_MAP, /\}, \[originLat, originLng, destinationKey\]\);/);
});

test('the proposal card’s camera depends on the two endpoints only', () => {
  assert.match(PROPOSAL_MAP, /\}, \[drawableOrigin, destination\.lat, destination\.lng\]\);/);
});

test('the picker’s camera is written by deliberate actions only', () => {
  // Assert — `framing` is the only source of the camera, and the three writers are
  // mount, a chosen search result / locate-me (`flyTo`), and nothing else.
  assert.match(PICKER, /const camera: MapCamera = useMemo/);
  assert.match(PICKER, /\[framing, appearance\.pitch\]/);
  assert.doesNotMatch(PICKER, /setFraming\(\(current\) => \(\{ \.\.\.current, zoom/);
});

test('a camera move only re-biases the search', () => {
  // Assert — `noteCamera` was once the writer of the selection too, which made the
  // pin jump to the middle of the screen on every drag.
  const noteCamera = /const noteCamera = useCallback\(\(camera: MapCamera\) => \{([\s\S]*?)\}, \[\]\);/.exec(
    PICKER,
  )?.[1];

  assert.ok(noteCamera, 'noteCamera is gone');
  assert.match(noteCamera, /biasRef\.current = camera\.centre/);
  assert.doesNotMatch(noteCamera, /setLat|setLng|setFraming/);
});
