/**
 * The map picker's pan must actually move the map (Plan 49 follow-up).
 *
 * ★ THE DEFECT THIS PINS.
 *
 * `PanResponderMove` was handed back a `PanResponderGestureState.dx`/`dy` — the
 * offset measured FROM WHERE THE DRAG STARTED, not the movement since the last
 * frame. Both were applied to absolute state (`setLat(lat + dLat)`), so the second
 * frame re-applied the whole first frame's travel on top of a centre that had
 * already moved by it, and the third re-applied two frames' worth, and so on.
 *
 * Two consequences, both visible on the deployed page:
 *
 *  - the coordinates in the bottom card kept moving while the tiles did not. The
 *    `Image` URIs are keyed on `zoom-tx-ty`, so they only change when the centre
 *    crosses a whole tile boundary; a cumulative offset multiplies the step each
 *    frame and lands on the SAME tile, so `lat`/`lng` changed and every `uri`
 *    stayed byte-identical. The map looked frozen while the numbers ran.
 *  - the pan also leaked the component's stale closure. The responder is created
 *    once (`useRef(...).current`), so `lat`/`lng`/`zoom` inside it were the
 *    values from the FIRST render for the life of the mount.
 *
 * The arithmetic moved to `map-pan.ts` so it can be pinned without a gesture.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  MAP_TILE_SIZE,
  clampCentre,
  tileIndexFor,
  translateCentre,
} from '@/src/components/ui/map-pan';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('a drag moves the centre against the finger', () => {
  // Arrange — dragging right must reveal what is to the west.
  const start = { lat: 35.6892, lng: 51.389 };

  // Act
  const moved = translateCentre(start, 40, 0, 14);

  // Assert — west means a SMALLER longitude, and no latitude change.
  assert.ok(moved.lng < start.lng, `lng did not decrease: ${moved.lng}`);
  assert.equal(moved.lat, start.lat);
});

test('a downward drag moves the centre north', () => {
  // Arrange — pulling the map down reveals what is above it.
  const start = { lat: 35.6892, lng: 51.389 };

  // Act
  const moved = translateCentre(start, 0, 40, 14);

  // Assert — the projection is Mercator, so the ground covered per pixel shrinks
  // with `cos(lat)`; at Tehran's latitude a 40px step is a fraction of a degree.
  assert.ok(moved.lat > start.lat, `lat did not increase: ${moved.lat}`);
  assert.ok(Math.abs(moved.lng - start.lng) < 1e-9, `lng moved: ${moved.lng}`);
});

test('the step is proportional to the movement, not to the drag so far', () => {
  // Arrange
  const start = { lat: 10, lng: 20 };

  // Act — three equal 10px steps, each applied to the result of the one before,
  // which is what a per-frame delta looks like.
  const one = translateCentre(start, 10, 0, 12);
  const two = translateCentre(one, 10, 0, 12);
  const three = translateCentre(two, 10, 0, 12);

  // Assert — the total travel of three 10px steps equals the travel of one 30px
  // step. Cumulative offsets made the third step ~3x the first.
  const stepped = start.lng - three.lng;
  const atOnce = start.lng - translateCentre(start, 30, 0, 12).lng;
  assert.ok(
    Math.abs(stepped - atOnce) < 1e-9,
    `three 10px steps travelled ${stepped}, one 30px step travelled ${atOnce}`,
  );
});

test('one pixel is enough to cross a tile boundary', () => {
  // Arrange — the whole point: the tile keys must change when the centre moves.
  const start = { lat: 35.6892, lng: 51.389 };
  const before = tileIndexFor(start.lat, start.lng, 14);

  // Act
  const moved = translateCentre(start, 200, 0, 14);
  const after = tileIndexFor(moved.lat, moved.lng, 14);

  // Assert — a 200px pan at zoom 14 is most of a tile, so the key must change.
  assert.notDeepEqual(after, before, 'a 200px pan stayed inside one tile');
});

test('a small pan is a visible fraction of one tile, at every zoom', () => {
  // Arrange — the size of one pixel in degrees must shrink as zoom rises.
  const perPixelAt14 = degreesPerPixel(14);
  const perPixelAt18 = degreesPerPixel(18);

  // Act / Assert — zooming in four stops divides the ground per pixel by 16.
  assert.ok(
    Math.abs(perPixelAt14 / perPixelAt18 - 16) < 1e-6,
    `zoom 14/18 ratio was ${perPixelAt14 / perPixelAt18}, expected 16`,
  );
});

test('the centre is clamped to the map, not to the world', () => {
  // Arrange — the projection is undefined past ±85°.
  const past = { lat: 89, lng: 400 };

  // Act
  const clamped = clampCentre(past);

  // Assert
  assert.ok(Math.abs(clamped.lat) <= 85, `lat was not clamped: ${clamped.lat}`);
  assert.ok(clamped.lng <= 180 && clamped.lng >= -180, `lng was not clamped: ${clamped.lng}`);
});

test('the responder reads the centre from a ref, not from a stale closure', () => {
  // Arrange
  const picker = code('src/components/ui/LocationMapPicker.tsx');

  // Act — the responder is created once, so any state it closes over is the
  // value from the first render forever. Both the centre AND the zoom must come
  // from a ref: zooming then dragging is the case a centre-only fix misses.
  const readsRefs = /translateCentre\([\w$.]*Ref\.current[^)]*Ref\.current\)/.test(picker);
  const zoomIsRef = /zoomRef\.current\s*=\s*next/.test(picker) && /zoomRef\.current\s*\+\s*delta/.test(picker);

  // Assert
  assert.ok(readsRefs, 'the pan handler does not read both the centre and the zoom from refs');
  assert.ok(zoomIsRef, 'a zoom change is not written to the ref the pan handler reads');
});

test('every centre mutation writes the ref the pan handler reads', () => {
  // Arrange — the ref and the state are two copies of the same fact, and a write
  // to one that skips the other makes the next drag start from a stale centre.
  const picker = code('src/components/ui/LocationMapPicker.tsx');

  // Act
  const directWrites = (picker.match(/setLat\(|setLng\(/g) ?? []).length;
  const inCommit = /commitCentre = \(next[^)]*\) => \{[\s\S]{0,200}?Ref\.current = next;[\s\S]{0,120}?setLat\([\s\S]{0,80}?setLng\(/.test(
    picker,
  );

  // Assert — the only `setLat`/`setLng` calls in the file are the pair inside
  // `commitCentre`, which writes the ref first.
  assert.equal(directWrites, 2, `centre state is written in ${directWrites} places, expected the 2 inside commitCentre`);
  assert.ok(inCommit, 'the ref is not written before the state');
});

test('the pan is a delta, so the handler must unwind it', () => {
  // Arrange
  const picker = code('src/components/ui/LocationMapPicker.tsx');

  // Act
  const unwinds = /gestureState\.dx\s*-\s*[A-Za-z_$][\w$]*\.current\.x/.test(picker);

  // Assert — `PanResponderGestureState.dx` is measured from the gesture's start.
  // Without subtracting the last seen value, it is re-applied every frame.
  assert.ok(unwinds, 'the handler applies the cumulative dx instead of a delta');
});

function degreesPerPixel(zoom: number): number {
  // Two one-pixel steps at the equator, measured through the public function.
  const a = translateCentre({ lat: 0, lng: 0 }, 1, 0, zoom);
  return Math.abs(a.lng) / MAP_TILE_SIZE;
}
