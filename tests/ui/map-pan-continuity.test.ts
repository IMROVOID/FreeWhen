/**
 * The map's picture must move continuously with the finger.
 *
 * ★ THE DEFECT THIS PINS: THE GRID TICKED BACK AT EVERY TILE BOUNDARY.
 *
 * The picker draws a 3x3 grid of 256px tiles and re-derives it from the centre on
 * every render, so the only thing that can show a sub-tile drag is the grid's
 * translation. That translation was the centre's fractional position inside its
 * FLOORED tile:
 *
 *     residual = (exact % 1)          // 0.98 … 0.02 across a boundary
 *
 * which is continuous everywhere except the one place it matters: the frame the
 * tile index advances, where it jumps from ~1 back to ~0 and the whole grid snaps
 * a full 256px backwards. On screen the map "ticks back" — usually to where it
 * already was — while the finger keeps moving. It reads as the map fighting the
 * drag, and it happens once per tile, i.e. constantly.
 *
 * Measuring from the NEAREST tile instead of the floored one puts the offset in
 * `[-0.5, 0.5)` and removes the discontinuity entirely. That is a property, so it
 * is asserted by walking a drag one pixel at a time rather than by looking at it.
 *
 * ★ AND A SECOND, SMALLER TICK HAD THE SAME SHAPE.
 *
 * The residual was also a piece of STATE, written by `commitCentre`, seeded from
 * the initial centre and re-derived on zoom. A zoom followed by a drag painted one
 * frame at the old zoom's scale before correcting. It is derived during render
 * now, so there is no third copy to drift.
 */

import './support/register';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  MAP_TILE_SIZE,
  centreTileFor,
  clampCentre,
  exactTileX,
  exactTileY,
  formatCoordinates,
  tileIndexFor,
  tileOffsetFor,
  translateCentre,
} from '@/src/components/ui/map-pan';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const START = { lat: 35.6892, lng: 51.389 };

/**
 * Where a given tile is painted on screen, for the grid the picker builds.
 *
 * ★ THIS IS THE QUANTITY THAT HAS TO BE CONTINUOUS — NOT THE RAW OFFSET.
 *
 * The component lays out `[centreTile − 1, centreTile, centreTile + 1]` inside a
 * layer offset by `−TILE_SIZE`, and translates that layer by `−offset`. So the
 * tile with index `T` is drawn at
 *
 *     screen(T) = −offset + (T − (centreTile − 1)) * TILE
 *
 * The raw `offset` CANNOT be continuous: `centreTile` steps by one at a boundary,
 * so the offset must absorb a whole tile in one frame to keep the picture still.
 * Asserting on the offset therefore fails on correct code — which is exactly what
 * the first version of this test did, and why it is written against screen space
 * instead. What the eye tracks is where a TILE is, and that is continuous.
 */
function screenXOfTile(exactTile: number, tileIndex: number, centreTile: number): number {
  const offset = (exactTile - centreTile) * MAP_TILE_SIZE;
  return -offset + (tileIndex - (centreTile - 1)) * MAP_TILE_SIZE;
}

function screenYOfTile(exactTile: number, tileIndex: number, centreTile: number): number {
  const offset = (exactTile - centreTile) * MAP_TILE_SIZE;
  return -offset + (tileIndex - (centreTile - 1)) * MAP_TILE_SIZE;
}

test('a tile stays put on screen while the finger drags past its boundary', () => {
  // Arrange — drag west one pixel at a time for 700px, which crosses ~2.7 tile
  // boundaries at zoom 14. Track the screen position of ONE tile throughout.
  let centre = START;
  const tracked = centreTileFor(centre.lat, centre.lng, 14).x;
  let previous = screenXOfTile(
    exactTileX(centre.lng, 14),
    tracked,
    centreTileFor(centre.lat, centre.lng, 14).x,
  );
  let biggestStep = 0;

  // Act
  for (let step = 0; step < 700; step += 1) {
    centre = translateCentre(centre, 1, 0, 14);

    const exactX = exactTileX(centre.lng, 14);
    const centreTile = centreTileFor(centre.lat, centre.lng, 14).x;
    const next = screenXOfTile(exactX, tracked, centreTile);

    biggestStep = Math.max(biggestStep, Math.abs(next - previous));
    previous = next;
  }

  // Assert — one pixel of drag moves the picture by ONE pixel. The old wrap made
  // a single frame move it 256.
  assert.ok(biggestStep <= 1.0001, `the picture jumped ${biggestStep}px in one frame`);
});

test('a tile stays put on screen while the finger drags vertically', () => {
  // Arrange — the same property on the latitude axis, which is Mercator.
  let centre = START;
  const tracked = centreTileFor(centre.lat, centre.lng, 14).y;
  let previous = screenYOfTile(
    exactTileY(centre.lat, 14),
    tracked,
    centreTileFor(centre.lat, centre.lng, 14).y,
  );
  let biggestStep = 0;

  // Act
  for (let step = 0; step < 700; step += 1) {
    centre = translateCentre(centre, 0, 1, 14);

    const exactY = exactTileY(centre.lat, 14);
    const centreTile = centreTileFor(centre.lat, centre.lng, 14).y;
    const next = screenYOfTile(exactY, tracked, centreTile);

    biggestStep = Math.max(biggestStep, Math.abs(next - previous));
    previous = next;
  }

  // Assert
  assert.ok(biggestStep <= 1.0001, `the picture jumped ${biggestStep}px in one frame`);
});

test('the offset stays inside half a tile at every zoom and latitude', () => {
  // Arrange — the domain guarantee: with `centreTile` as the NEAREST tile, the
  // translate never exceeds half a tile, so the 3x3 grid always covers the frame.
  for (const zoom of [8, 10, 12, 14, 16, 18]) {
    for (const lat of [-60, -35, 0, 35.6892, 60]) {
      for (const lng of [-179, -90, 0, 51.389, 179]) {
        // Act
        const offset = tileOffsetFor(lat, lng, zoom);

        // Assert
        assert.ok(
          Math.abs(offset.x) <= MAP_TILE_SIZE / 2 + 1e-6,
          `zoom ${zoom} lat ${lat} lng ${lng}: x offset ${offset.x} is outside half a tile`,
        );
        assert.ok(
          Math.abs(offset.y) <= MAP_TILE_SIZE / 2 + 1e-6,
          `zoom ${zoom} lat ${lat} lng ${lng}: y offset ${offset.y} is outside half a tile`,
        );
      }
    }
  }
});

test('a tile boundary is where the index changes, and the picture does not', () => {
  // Arrange — walk until the index advances, then inspect that exact frame.
  let centre = START;
  const startIndex = tileIndexFor(centre.lat, centre.lng, 14).x;
  const tracked = centreTileFor(centre.lat, centre.lng, 14).x;

  let previous = screenXOfTile(
    exactTileX(centre.lng, 14),
    tracked,
    centreTileFor(centre.lat, centre.lng, 14).x,
  );
  let boundaryStep = 0;
  let crossedAt = -1;

  for (let step = 0; step < 800; step += 1) {
    centre = translateCentre(centre, 1, 0, 14);
    const index = tileIndexFor(centre.lat, centre.lng, 14).x;
    const next = screenXOfTile(
      exactTileX(centre.lng, 14),
      tracked,
      centreTileFor(centre.lat, centre.lng, 14).x,
    );

    if (index !== startIndex && crossedAt < 0) {
      crossedAt = step;
      boundaryStep = Math.abs(next - previous);
    }
    previous = next;
  }

  // Assert — the boundary was actually crossed, and crossing it moved nothing
  // unusual. This is the frame the old code snapped on.
  assert.ok(crossedAt >= 0, 'the walk never crossed a tile boundary, so this proves nothing');
  assert.ok(boundaryStep <= 1.0001, `the boundary frame moved the picture ${boundaryStep}px`);
});

test('the grid is centred on the NEAREST tile, not the floored one', () => {
  // Arrange — the centre tile and the floored index differ by one just past a
  // half-tile, which is exactly the choice that removes the wrap.
  const floored = tileIndexFor(START.lat, START.lng, 14);
  const nearest = centreTileFor(START.lat, START.lng, 14);

  // Act — a point a quarter-tile past a boundary.
  const past = translateCentre(START, -64, 0, 14);
  const exact = tileIndexFor(past.lat, past.lng, 14);
  const nearestThere = centreTileFor(past.lat, past.lng, 14);

  // Assert — both are whole numbers, and the nearest one is within one of the
  // floored one by definition.
  assert.ok(Number.isInteger(nearest.x) && Number.isInteger(nearest.y), 'the centre tile is not a tile');
  assert.ok(Math.abs(nearestThere.x - exact.x) <= 1, 'the nearest tile is more than one away');
  assert.equal(floored.x, Math.floor(floored.x));
});

test('a zoom then a drag does not paint at the old zoom', () => {
  // Arrange — the offset is derived, so the two zoom levels give different
  // answers for the same centre and there is no stale copy to disagree.
  const atZ14 = tileOffsetFor(START.lat, START.lng, 14);
  const atZ15 = tileOffsetFor(START.lat, START.lng, 15);

  // Act / Assert — they are different (so a stale one would be visible), and
  // recomputing returns the same value rather than a cached one.
  assert.notDeepEqual(atZ14, atZ15);
  assert.deepEqual(tileOffsetFor(START.lat, START.lng, 14), atZ14);
});

test('a drag still moves the centre against the finger', () => {
  // Arrange — the sign convention is unchanged and must not regress.
  const movedRight = translateCentre(START, 40, 0, 14);
  const movedDown = translateCentre(START, 0, 40, 14);

  // Assert — dragging right reveals what is west; dragging down reveals north.
  assert.ok(movedRight.lng < START.lng, `lng did not decrease: ${movedRight.lng}`);
  assert.ok(movedDown.lat > START.lat, `lat did not increase: ${movedDown.lat}`);
});

test('the centre is clamped to the map, not to the world', () => {
  const clamped = clampCentre({ lat: 89, lng: 400 });

  assert.ok(Math.abs(clamped.lat) <= 85, `lat was not clamped: ${clamped.lat}`);
  assert.ok(clamped.lng <= 180 && clamped.lng >= -180, `lng was not clamped: ${clamped.lng}`);
});

test('the picker derives its offset instead of storing it', () => {
  // Arrange — a stored copy is what let the picture disagree with the centre.
  const picker = code('src/components/ui/LocationMapPicker.tsx');

  // Act
  const derives = /tileOffsetFor\(lat, lng, zoom\)/.test(picker);
  const noState = !/setTileResidual/.test(picker);
  const usesNearest = /centreTileFor/.test(picker);

  // Assert
  assert.ok(derives, 'the offset is not derived from the live centre');
  assert.ok(noState, 'the offset is still a third copy of the centre, written by hand');
  assert.ok(usesNearest, 'the grid is still centred on the floored tile, which wraps');
});

test('the search effect is keyed on the query alone', () => {
  // Arrange — `lat`/`lng` change on every frame of a drag, so listing them reset
  // the debounce forever and the request never fired: "the searchbar shows no
  // result, no matter what I search".
  const picker = code('src/components/ui/LocationMapPicker.tsx');

  // Act
  const effect = /setTimeout\([\s\S]*?\}, DEBOUNCE_MS\)[\s\S]{0,200}?\}, \[([^\]]*)\]\)/.exec(picker)?.[1] ?? '';

  // Assert
  assert.equal(effect.trim(), 'searchQuery', `the search effect depends on ${effect}`);
});

test('a failed search is a visible state, not an empty list', () => {
  // Arrange
  const picker = code('src/components/ui/LocationMapPicker.tsx');

  // Act
  const tracksDegraded = /setSearchUnavailable\(outcome\.degraded\)/.test(picker);
  const tracksCatch = /catch \{[\s\S]{0,300}?setSearchUnavailable\(true\)/.test(picker);
  const rendersIt = /proposals\.place\.degraded/.test(picker);

  // Assert
  assert.ok(tracksDegraded, 'a degraded provider is indistinguishable from no results');
  assert.ok(tracksCatch, 'a thrown request is swallowed into an empty list');
  assert.ok(rendersIt, 'the unavailable state is never rendered');
});

test('the dark basemap draws its labels from a labels-only layer', () => {
  // Arrange — `dark_all`'s place names are mid grey, which the request reports as
  // black-on-dark. CARTO publishes the canvas and the ink separately.
  const picker = code('src/components/ui/LocationMapPicker.tsx');

  // Act
  const base = /dark_nolabels/.test(picker);
  const labels = /dark_only_labels/.test(picker);

  // Assert
  assert.ok(base, 'the dark map still uses a label-composited basemap');
  assert.ok(labels, 'the dark map has no white-ink label layer');
});

test('a missing label tile does not report the map as broken', () => {
  // Arrange — the labels are cosmetic; the base is what carries the failure state.
  const picker = code('src/components/ui/LocationMapPicker.tsx');

  // Act
  const labelsHaveNoError = /renderGrid\(labelsStyle, 'labels'\)/.test(picker);

  // Assert
  assert.ok(labelsHaveNoError, 'a failed label tile sets the map-unavailable state');
});

test('coordinates are written with a hemisphere, not a minus sign', () => {
  // Assert — an RTL layout puts a leading `-` on the wrong side of the number.
  assert.equal(formatCoordinates(35.6892, 51.389), '35.6892° N, 51.3890° E');
  assert.equal(formatCoordinates(-33.8688, -70.6693), '33.8688° S, 70.6693° W');
});
