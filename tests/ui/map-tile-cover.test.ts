/**
 * The tile grid must cover the map frame, at every frame size and every drag.
 *
 * ★ THE DEFECT THIS PINS, MEASURED IN A BROWSER.
 *
 * `tileLayer` was pinned at `left: -TILE_SIZE, top: -TILE_SIZE` unconditionally.
 * That is only correct when the frame is exactly three tiles across, because the
 * grid is `3 × 256 = 768` and the shift assumes the centre tile's origin sits on
 * the frame's origin. The frame is `100%` wide and `MAP_HEIGHT` tall, so it almost
 * never is.
 *
 * Measured with `getBoundingClientRect` on an `expo export` served locally:
 *
 *   viewport 900  — frame x 210 w 480 h 538; the nine tiles spanned
 *                   x 13.8 … 781.8, i.e. the frame's right 294 px had NO tile;
 *   viewport 390  — frame x 20 w 350 h 538; the same 768 px grid, so 246 px of
 *                   the frame had no tile;
 *   after a 90 px drag the grid's right edge landed at x 187.8 inside a frame
 *   starting at x 210 — the whole picture slid off the frame.
 *
 * On screen that is the reported "the separate map segments are not aligned,
 * not seamless": where tiles ended, the `surface2` placeholder showed through in
 * rectangles, and the boundary between "tiles" and "no tiles" moved with the drag.
 *
 * ★ THE RULE IS COVERAGE, NOT A MAGIC OFFSET.
 *
 * Centring the grid on the measured frame — and adding rings of tiles until the
 * grid is at least the frame's size — is the general statement. The old constant
 * is then just the case where the frame happens to be one tile-span.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MAP_TILE_SIZE,
  gridOriginFor,
  gridSpanFor,
  tilesCover,
} from '@/src/components/ui/map-pan';

/** The frame widths and heights actually measured, plus the round cases. */
const WIDTHS = [320, 350, 400, 480, 520, 768, 900, 1024];
const HEIGHTS = [300, 380, 538, 600, 768, 900];

/** Sub-tile offsets across the whole range `tileOffsetFor` can produce. */
const OFFSETS = [-128, -127, -96, -33, -1, 0, 1, 47, 96, 127, 128];

function frame(width: number, height: number) {
  return { left: 0, top: 0, right: width, bottom: height };
}

function tiles(width: number, height: number, ox: number, oy: number) {
  const span = gridSpanFor({ canvasWidth: width, canvasHeight: height });
  const origin = gridOriginFor({ canvasWidth: width, canvasHeight: height });
  const out = [];

  for (let row = 0; row < span.count; row += 1) {
    for (let col = 0; col < span.count; col += 1) {
      const left = origin.left - ox + col * MAP_TILE_SIZE;
      const top = origin.top - oy + row * MAP_TILE_SIZE;
      out.push({
        left,
        top,
        right: left + MAP_TILE_SIZE,
        bottom: top + MAP_TILE_SIZE,
      });
    }
  }

  return out;
}

test('the grid is at least the frame, at every measured size', () => {
  for (const width of WIDTHS) {
    for (const height of HEIGHTS) {
      const span = gridSpanFor({ canvasWidth: width, canvasHeight: height });
      const extent = span.count * MAP_TILE_SIZE;

      assert.ok(
        extent >= width,
        `${width}×${height}: grid is ${extent}px wide, narrower than the frame`,
      );
      assert.ok(
        extent >= height,
        `${width}×${height}: grid is ${extent}px tall, shorter than the frame`,
      );
    }
  }
});

test('every pixel of the frame has a tile over it, wherever the grid is dragged', () => {
  const gaps: string[] = [];

  for (const width of WIDTHS) {
    for (const height of HEIGHTS) {
      for (const ox of OFFSETS) {
        for (const oy of OFFSETS) {
          if (!tilesCover(frame(width, height), tiles(width, height, ox, oy))) {
            gaps.push(`${width}×${height} offset (${ox},${oy})`);
          }
        }
      }
    }
  }

  assert.deepEqual(gaps, [], `the frame shows background where tiles should be:\n${gaps.slice(0, 8).join('\n')}`);
});

test('the centre tile is centred on the frame, so the pin sits on the right place', () => {
  for (const width of WIDTHS) {
    for (const height of HEIGHTS) {
      const origin = gridOriginFor({ canvasWidth: width, canvasHeight: height });

      // The middle slot of the grid must land where the frame's middle is. With
      // an odd tile count the centre slot's centre is the grid's centre.
      const span = gridSpanFor({ canvasWidth: width, canvasHeight: height }).count;
      const middle = origin.left + (Math.floor(span / 2) + 0.5) * MAP_TILE_SIZE;
      const middleY = origin.top + (Math.floor(span / 2) + 0.5) * MAP_TILE_SIZE;

      assert.ok(
        Math.abs(middle - width / 2) <= MAP_TILE_SIZE / 2 + 0.5,
        `${width}×${height}: centre tile at ${middle}, frame middle ${width / 2}`,
      );
      assert.ok(
        Math.abs(middleY - height / 2) <= MAP_TILE_SIZE / 2 + 0.5,
        `${width}×${height}: centre tile at ${middleY}, frame middle ${height / 2}`,
      );
    }
  }
});

test('a frame of exactly one tile-span reproduces the previous offset', () => {
  // The old constant was correct for this one case, so it must not move. A 768
  // frame needs one ring MORE than three tiles — the slack the drag needs — and
  // that grid, centred, lands its origin back on the old constant.
  const origin = gridOriginFor({ canvasWidth: 768, canvasHeight: 768 });
  assert.equal(origin.left, -MAP_TILE_SIZE);
  assert.equal(origin.top, -MAP_TILE_SIZE);
});

test('the picker centres the grid on its measured frame instead of a constant', () => {
  // Arrange
  const source = readFileSync('src/components/ui/LocationMapPicker.tsx', 'utf8');

  // Assert — the measurement is taken, and the layer uses it.
  assert.match(source, /onLayout/, 'the tile canvas is not measured');
  assert.match(source, /gridOriginFor|canvasWidth/, 'the grid origin does not use the measurement');
  assert.doesNotMatch(
    source.replace(/\/\*[\s\S]*?\*\//g, ''),
    /tileLayer:\s*\{[^}]*left:\s*-TILE_SIZE/,
    'the tile layer still pins a constant offset, which only fits a 3-tile frame',
  );
});
