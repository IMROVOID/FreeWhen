/**
 * Dragging the map must move the MAP, not just the numbers under it.
 *
 * ★ THE DEFECT THIS PINS.
 *
 * `map-drag.test.ts` fixed the arithmetic — a per-frame delta instead of a
 * cumulative one — and every assertion there still passes. The map still does
 * not move, because the arithmetic was the wrong half of the problem.
 *
 * `LocationMapPicker` renders a fixed 3x3 grid of 256px tiles that are
 * CENTRED in the frame (`tileCanvas` is `alignItems: center` +
 * `justifyContent: center`). Re-deriving the grid from the centre and keying
 * each tile on `zoom-tx-ty` swaps tile URLs, but a centred 768px grid always
 * covers the 380px frame and the swap happens at the wrap, so the visible
 * picture changes only by one tile at the far edge — while the pin, which is
 * the thing being dragged, never leaves the middle.
 *
 * A drag looks like a drag only when the tile layer TRANSLATES by the residual
 * sub-tile offset: its own fractional position inside the centre tile. That
 * offset must be bounded by exactly one tile, or the layer walks off the frame.
 *
 * ★ WHY THESE ARE ASSERTIONS AND NOT CODE REVIEW.
 *
 * `offsetWithinTile` is the property that broke, and "n equal steps travel as
 * far as one step n times as large" is checkable for it. The component-level
 * assertions then keep the wiring, which no Node test can drive through a
 * gesture.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  MAP_TILE_SIZE,
  offsetWithinTile,
  translateCentre,
} from '@/src/components/ui/map-pan';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('the offset is the fractional position inside the centre tile', () => {
  // Arrange — the grid is derived from the centre, so the layer has to carry
  // the part of the centre that is NOT a whole tile.
  const centre = offsetWithinTile(35.6892, 51.389, 14);

  // Act / Assert
  assert.ok(centre.x >= 0 && centre.x < 1, `x offset ${centre.x} is not a fraction`);
  assert.ok(centre.y >= 0 && centre.y < 1, `y offset ${centre.y} is not a fraction`);
});

test('a drag changes the offset every frame, long before a tile boundary', () => {
  // Arrange — the reported symptom: tiny drags updated the coordinates and the
  // picture did not budge, because nothing moved until a whole tile was crossed.
  const start = { lat: 35.6892, lng: 51.389 };

  // Act — one 12px step at zoom 14 is a small fraction of a 256px tile.
  const moved = translateCentre(start, 12, 0, 14);
  const before = offsetWithinTile(start.lat, start.lng, 14);
  const after = offsetWithinTile(moved.lat, moved.lng, 14);

  // Assert — the offset must have changed, or nothing visible can have.
  assert.notEqual(after.x, before.x, 'a 12px drag did not move the tile layer');
});

test('the offset is bounded by one tile, so the layer cannot walk off the frame', () => {
  // Arrange — a 3x3 grid is only enough to cover the frame while the residual
  // offset stays under one tile; past that the edge of the grid is visible.
  const start = { lat: 35.6892, lng: 51.389 };

  // Act / Assert — over a drag many times the frame's height.
  for (const step of [1, 50, 200, 1000, 5000]) {
    const moved = translateCentre(start, step, step, 14);
    const offset = offsetWithinTile(moved.lat, moved.lng, 14);
    assert.ok(
      Math.abs(offset.x) * MAP_TILE_SIZE < MAP_TILE_SIZE,
      `x offset after ${step}px is a whole tile — the grid runs out`,
    );
    assert.ok(
      Math.abs(offset.y) * MAP_TILE_SIZE < MAP_TILE_SIZE,
      `y offset after ${step}px is a whole tile — the grid runs out`,
    );
  }
});

test('the tile layer is positioned, not centred', () => {
  // Arrange
  const picker = code('src/components/ui/LocationMapPicker.tsx');

  // Act — a centred grid cannot be translated into a pan; the offset has to be
  // applied to a layer whose origin is the tile grid's top-left corner.
  const canvas = /tileCanvas:\s*\{([\s\S]*?)\n {2}\},/.exec(picker)?.[1] ?? '';

  // Assert
  assert.ok(canvas.length > 0, 'the tile canvas style is missing');
  assert.ok(
    !/justifyContent:\s*'center'/.test(canvas),
    'the tile canvas is still centred, so a translate would fight the centring',
  );
});

test('the pan sets the offset from the residual, each frame', () => {
  // Arrange
  const picker = code('src/components/ui/LocationMapPicker.tsx');

  // Act — the handler is built once, so the offset must be imperative state
  // (a ref plus a setter), not a value captured on the first render.
  const appliesResidual = /offsetWithinTile\(/.test(picker);
  const writesOffset = /setTileResidual\(/.test(picker);

  // Assert
  assert.ok(appliesResidual, 'the pan never computes the sub-tile offset');
  assert.ok(writesOffset, 'the sub-tile offset is computed and never applied');
});

test('the offset is applied as a translate on the tile layer', () => {
  // Arrange
  const picker = code('src/components/ui/LocationMapPicker.tsx');

  // Act — the residual is baked into a translate pair and spread on the layer.
  const translatesResidual =
    /translateX:\s*-?tileResidual\.x/.test(picker) && /translateY:\s*-?tileResidual\.y/.test(picker);
  const appliedToLayer = /styles\.tileLayer[\s\S]{0,80}?tileLayerTranslate/.test(picker);

  // Assert
  assert.ok(translatesResidual, 'the sub-tile offset is not translated onto the layer');
  assert.ok(appliedToLayer, 'the translate is computed and never applied to the grid');
});
