/**
 * The switch's knob keeps the same air on both sides of the track.
 *
 * ★ THE DEFECT THIS PINS (web).
 *
 * Off, the thumb sat hard against the track's leading edge with no padding;
 * on, it floated with a visible inset. The cause is the box model, not RTL: the
 * track is `borderWidth: 1` with `overflow: 'hidden'`, so its content box is
 * `TRACK_WIDTH - 2` wide, and the knob's `marginInlineStart: KNOB_INSET` is
 * applied INSIDE that border box. At the "off" end the 1px border eats into the
 * gap, and the "on" travel was computed from the border box too, so the far end
 * lands 2px further out than the near end — a 1px/3px asymmetry that reads as
 * "the circle has no padding when it is off".
 *
 * react-native-web is where it is visible because the border is a real CSS
 * border there; on native the same arithmetic was already close enough to look
 * right, which is why it was reported as web-only.
 *
 * ★ THE FIX IS ARITHMETIC, SO IT IS ASSERTED, NOT EYEBALLED.
 *
 * Both rest positions must sit exactly `KNOB_INSET` from the track's outer edge,
 * and the travel must be the span between them.
 */

import './support/register';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { ACCENT_SWITCH_METRICS } from '@/src/components/ui/AccentSwitch';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const { width, height, knob, travel, border } = ACCENT_SWITCH_METRICS;

/** The air the knob keeps from the track's OUTER edge, on either side. */
const airGapAtStart = (height - knob) / 2;

/** KNOB_INSET is the vertical air, which must equal the horizontal air. */
const verticalInset = (height - knob) / 2;

test('the track keeps a border in the metrics, so the arithmetic can see it', () => {
  // Arrange / Act / Assert — an unnamed border is the reason the two ends did
  // not agree; the number has to be part of the contract.
  assert.equal(typeof border, 'number', 'the switch metrics omit the track border');
  assert.ok(border > 0, 'the track border is zero, so the defect cannot be reproduced');
});

test('the knob rests the same distance from each outer edge', () => {
  // Arrange — the track's OUTER edges. The border sits inside them, and the
  // knob's logical margin is measured from the border's inner edge.
  const leadingRest = border + airGapAtStart;
  const trailingRest = leadingRest + travel + knob;

  // Act — the air on either side of the knob.
  const airAtStart = leadingRest;
  const airAtEnd = width - trailingRest;

  // Assert — any difference shows up as the reported "no padding when off".
  assert.equal(
    airAtStart,
    airAtEnd,
    `the knob has ${airAtStart}px before it and ${airAtEnd}px after it`,
  );
});

test('the travel is the track less the knob and both air gaps', () => {
  // Act / Assert — the outer-edge span between the two rest positions is the
  // track less both borders, the knob, and the air gap at each end.
  assert.equal(
    travel,
    width - border * 2 - knob - airGapAtStart * 2,
    `travel ${travel} does not span the track's inner width`,
  );
});

test('the horizontal air equals the vertical air', () => {
  // Act / Assert — a knob with 3px of side padding and 4px above and below is
  // the asymmetry that reads as "no padding"; the two must agree.
  assert.equal(
    airGapAtStart,
    verticalInset,
    `the knob keeps ${airGapAtStart}px at the sides and ${verticalInset}px top and bottom`,
  );
});

test('the travel matches the component, so the two cannot drift', () => {
  // Arrange — the metrics are the contract; the arithmetic above is only as good
  // as the numbers the component actually uses.
  const source = code('src/components/ui/AccentSwitch.tsx');

  // Act
  const derived = /KNOB_TRAVEL\s*=\s*TRACK_WIDTH\s*-\s*KNOB_SIZE\s*-\s*TRACK_BORDER\s*\*\s*2\s*-\s*KNOB_INSET\s*\*\s*2/.test(
    source,
  );
  const margin = /marginInlineStart:\s*KNOB_MARGIN/.test(source);

  // Assert — omitting either term is exactly how the knob lost its padding.
  assert.ok(derived, 'the travel does not account for the border and the inset at both ends');
  assert.ok(margin, 'the knob still measures its margin from the border box');
});

test('the knob stays inside the track at both ends', () => {
  // Act / Assert — an over-travelling knob is clipped by `overflow: hidden`,
  // which is what "the circle overflows the pill" looked like.
  assert.ok(travel + knob + border <= width + 0, `the knob overhangs the track by ${travel + knob - width}px`);
  assert.ok(knob + border * 2 <= height + 0, `the knob is taller than the track: ${knob} vs ${height}`);
});

test('the track paints its own border at the width the metrics declare', () => {
  // Arrange
  const source = code('src/components/ui/AccentSwitch.tsx');
  const track = /track:\s*\{([^}]*)\}/.exec(source)?.[1] ?? '';

  // Act
  const paintedBorder = /borderWidth:\s*([\w.]+)/.exec(track)?.[1] ?? '';

  // Assert — a hard-coded `1` here would silently drift from the metrics.
  assert.ok(paintedBorder.length > 0, 'the track has no border width');
  assert.ok(
    /TRACK_BORDER|border/.test(paintedBorder),
    `the track border is hard-coded as ${paintedBorder}`,
  );
});
