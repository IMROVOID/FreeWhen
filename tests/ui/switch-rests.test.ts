/**
 * The switch knob's two rests must be mirror images.
 *
 * ★ THE DEFECT THIS PINS, MEASURED ON THE EMULATOR.
 *
 * Against the shipped build (1080 px wide, 52 dp track ≈ 137 px), sampling the
 * switch's pixels row by row:
 *
 *   ON   track starts x=64, knob 86…148  →  22 px of air at the leading edge
 *   OFF  track starts x=64, knob 138…201 →   0 px of air at the trailing edge
 *
 * The knob was flush against the switch's edge in the OFF state and comfortably
 * inset in the ON state — "the circle is too much to the right with no padding",
 * exactly as reported.
 *
 * ★ THE CAUSE WAS TWO POSITIONING SYSTEMS ON ONE NODE.
 *
 * The knob rested on `marginInlineStart: KNOB_INSET` (a flex/layout declaration)
 * AND was moved by `translateX` (a transform). The margin was spent inside the
 * track's `justifyContent: 'center'` box and the translate applied afterwards, so
 * the two rests did not describe the same track. It also survived review because
 * the arithmetic was right: `KNOB_TRAVEL` is correct; it was being applied from
 * the wrong origin.
 *
 * The knob is now absolutely positioned from the leading edge — one anchor, one
 * transform — so the rests are mirror images by construction.
 */

import './support/register';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ACCENT_SWITCH_METRICS } from '@/src/components/ui/AccentSwitch';

function source(): string {
  return readFileSync('src/components/ui/AccentSwitch.tsx', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const { width, height, knob, inset, travel } = ACCENT_SWITCH_METRICS;

/** Where the knob sits at each rest, as a distance from the leading edge. */
const offRest = inset;
const onRest = inset + travel;

test('the two rests are mirror images inside the track', () => {
  // Act — the air each rest leaves at its own end.
  const airAtLeadingEdgeOff = offRest;
  const airAtTrailingEdgeOn = width - (onRest + knob);

  // Assert
  assert.equal(
    airAtLeadingEdgeOff,
    airAtTrailingEdgeOn,
    `OFF leaves ${airAtLeadingEdgeOff}px at the start, ON leaves ${airAtTrailingEdgeOn}px at the end`,
  );
});

test('the ON rest ends inside the track, never flush against it', () => {
  // Assert — flush is the shipped bug: 0px of air reads as "sticking to the edge".
  assert.ok(onRest + knob < width, 'the ON rest reaches the track edge');
  assert.ok(
    width - (onRest + knob) > 0,
    'the ON rest leaves no air, so the knob is flush with the switch edge',
  );
});

test('the knob is inset by the same amount horizontally and vertically', () => {
  // Assert — 3px of side air and 4px above and below is the asymmetry that reads
  // as "no padding" even when the side gap is non-zero.
  assert.equal(inset, (height - knob) / 2);
});

test('the knob is anchored on a physical side and positioned by one transform', () => {
  // Arrange
  const text = source();

  // Assert — the anchor is physical and chosen from the resolved direction...
  assert.match(text, /\{\s*right:\s*KNOB_INSET\s*\}/, 'no right-side anchor is resolved');
  assert.match(text, /\{\s*left:\s*KNOB_INSET\s*\}/, 'no left-side anchor is resolved');
  // ...NOT also a margin, which is the second positioning system that broke it.
  assert.doesNotMatch(text, /margin(Left|Right):\s*KNOB_INSET/, 'the knob is positioned twice');
  // The anchor needs a containing block, and the knob must be out of flow.
  assert.match(text, /track:\s*\{[^}]*position:\s*'relative'/, "the track is not the knob's containing block");
  assert.match(text, /knob:\s*\{[^}]*position:\s*'absolute'/, 'the knob is not absolutely positioned');
});

/**
 * ★ AN ABSOLUTE NODE WITH ONLY `top` FALLS BACK TO ITS STATIC POSITION.
 *
 * That is `left: 0` for this parent, so the OFF rest lost its inset and the ON
 * rest had a negative translate applied from x=0 — measured on the device as the
 * knob rendered as a half circle sliced off the track's left edge, clipped by the
 * track's `overflow: hidden`. The base style therefore declares `left`
 * explicitly, and the call site overrides the side the direction needs.
 */
test('the knob declares BOTH sides, so its rest never falls back to x=0', () => {
  const text = source();
  const knob = /knob:\s*\{([^}]*)\}/.exec(text)?.[1] ?? '';

  assert.match(knob, /left:\s*KNOB_INSET/, 'the knob has no explicit horizontal anchor');
  assert.match(knob, /top:\s*KNOB_INSET/, 'the knob has no explicit vertical anchor');
});

test('the travel is the track less the knob and the air at BOTH ends', () => {
  assert.equal(travel, width - knob - inset * 2);
});

test('the transform flips with the layout direction', () => {
  // Arrange — the knob is anchored at the READING edge, so "on" is the opposite
  // edge: positive x in LTR, negative in RTL. Both come from one decision.
  const text = source();

  // Assert
  assert.match(text, /signedTravel/, 'the travel has no direction sign');
  assert.match(text, /rtl \? -KNOB_TRAVEL : KNOB_TRAVEL/, 'the direction sign does not flip');
});
