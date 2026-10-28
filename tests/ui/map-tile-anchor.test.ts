/**
 * The map's tile grid must be anchored PHYSICALLY, or it renders off-frame in Persian.
 *
 * ★ THE DEFECT THIS PINS — the real cause of "the map on proposal boxes is not loading".
 *
 * Every tile request SUCCEEDED. The key was present in the deployed bundle, CARTO
 * answered `200 image/png` for the exact URLs the picker builds, and nothing in the
 * runtime log failed. The map was still blank.
 *
 * `tileLayer` was `{ position: 'absolute', top: -256, start: -256 }`. `start` is a
 * LOGICAL inset: react-native-web compiles it to `inset-inline-start`, which resolves
 * against the document direction. `app/+html.tsx` puts `dir="rtl"` on `<html>`, so the
 * 3x3 grid was inset 256px from the RIGHT edge instead of the left — carrying the whole
 * picture out of the 380px-tall frame. The pins, the search bar and the controls kept
 * rendering, which is why it looked like "the tiles did not load" rather than "the tiles
 * are somewhere else".
 *
 * ★ THE GRID'S OFFSET IS GEOMETRY, NOT STYLE.
 *
 * The layer is shifted back by exactly one tile so the CENTRE tile's origin lands on the
 * frame's origin, and the residual translate then puts the exact centre under the
 * crosshair. That is a physical statement about a 256px image grid; a logical inset
 * makes it depend on the reading direction of the page, which is not a thing the
 * projection knows about.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const PICKER = 'src/components/ui/LocationMapPicker.tsx';

test('the tile layer is anchored with a physical left, not a logical start', () => {
  // Arrange
  const picker = code(PICKER);

  // Act
  const layer = /tileLayer:\s*\{([\s\S]{0,240}?)\},/.exec(picker)?.[1] ?? '';

  // Assert
  assert.ok(layer.length > 0, 'the tile layer style was not found');
  assert.ok(
    !/\bstart\s*:/.test(layer),
    'the tile layer still uses the logical `start` inset, so a right-to-left page pushes the grid off-frame',
  );
  assert.ok(
    !/\bend\s*:/.test(layer),
    'the tile layer uses the logical `end` inset',
  );
  assert.ok(/left\s*:/.test(layer), 'the tile layer has no physical left anchor');
});

test('the grid is shifted back by exactly one tile on both axes', () => {
  // Arrange — the 3x3 grid puts the centre tile in the middle, so the shift that lands
  // its origin on the frame's origin is one tile, and the same on both axes.
  const picker = code(PICKER);

  // Act
  const layer = /tileLayer:\s*\{([\s\S]{0,240}?)\},/.exec(picker)?.[1] ?? '';
  const top = /top:\s*(-?)(TILE_SIZE|MAP_TILE_SIZE)/.exec(layer);
  const left = /left:\s*(-?)(TILE_SIZE|MAP_TILE_SIZE)/.exec(layer);

  // Assert
  assert.ok(top, 'the vertical shift is not a whole tile');
  assert.ok(left, 'the horizontal shift is not a whole tile');
  assert.equal(top[1], '-', 'the vertical shift should be negative');
  assert.equal(left[1], '-', 'the horizontal shift should be negative');
});

test('every other map inset is direction-independent too', () => {
  // Arrange — the same class of bug can reappear on any inset in this file, and the
  // symptom is identical: controls or tiles in the wrong place on a Persian page.
  const picker = code(PICKER);

  // Act
  const logical = [...picker.matchAll(/\b(start|end)\s*:/g)].map((match) => match[0]);

  /**
   * A CENTRED pin legitimately uses `start: '50%'` with a negative `marginStart`: that
   * pair is symmetric, so it lands in the middle in both directions. Anything else is
   * a position that only works in one language.
   */
  const offensive = logical.filter((entry) => !/^(start|end):/.test(entry));

  // Assert
  assert.deepEqual(offensive, [], `unexpected logical insets: ${offensive.join(', ')}`);
});

test('the tile canvas still gets a real height from the frame', () => {
  // Arrange — `height: '100%'` only means anything if the parent has a height, and a
  // collapsed canvas hides the tiles just as effectively as a mis-anchored grid.
  const picker = code(PICKER);

  // Act
  const frame = /mapFrame:\s*\{([\s\S]{0,260}?)\},/.exec(picker)?.[1] ?? '';
  const canvas = /tileCanvas:\s*\{([\s\S]{0,200}?)\},/.exec(picker)?.[1] ?? '';

  // Assert
  assert.ok(/height:\s*MAP_HEIGHT/.test(frame), 'the frame has no explicit height');
  assert.ok(/height:\s*'100%'/.test(canvas), 'the canvas does not fill the frame');
});
