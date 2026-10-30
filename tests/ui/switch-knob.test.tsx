/**
 * The switch's knob keeps the same air on both sides of the track.
 *
 * ★ THE DEFECT THIS PINS, AS LAST REPORTED.
 *
 * "Remove the Toggle switch borders" and "the circle inside is too much toward
 * the edge on Off state, it has no spacing with the Switch edge". The two were
 * the same bug: the track carried a 1px hairline, so its content box was
 * `TRACK_WIDTH − 2`, the knob's `marginInlineStart` was measured inside that
 * border box, and the travel was computed from the border box too. Neither end
 * then sat at the declared inset, and the asymmetry showed worst at OFF.
 *
 * The fix was to delete the border rather than to add the correction term to
 * both ends of the arithmetic: the fill already separates an OFF switch from the
 * page, and with no border the two rests are exact mirror images of one another
 * by construction.
 *
 * ★ SO THE CONTRACT IS NOW: NO BORDER, AND EQUAL AIR AT BOTH RESTS.
 *
 * The earlier version of this file asserted the border EXISTED so the
 * arithmetic could account for it. That assertion is the thing that kept the
 * defect alive — it made a cosmetic hairline load-bearing. This file asserts its
 * absence instead, and then re-derives both rest positions from the metrics.
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

const { width, height, knob, inset, travel } = ACCENT_SWITCH_METRICS;

test('the track has no border, so nothing is measured inside one', () => {
  // Arrange
  const source = code('src/components/ui/AccentSwitch.tsx');
  const track = /track:\s*\{([^}]*)\}/.exec(source)?.[1] ?? '';

  // Act
  const painted = /borderWidth:\s*([\w.]+)/.exec(track)?.[1] ?? null;

  // Assert — an unnamed hairline is what made the two rests disagree.
  assert.equal(painted, null, `the track paints a border again: borderWidth: ${painted}`);
});

test('the knob rests the same distance from each outer edge', () => {
  // Arrange — no border, so the outer edge IS the content edge.
  //
  // The OFF rest is the margin (`inset`); the ON rest is that margin plus the
  // travel. Air at the trailing edge is therefore whatever the track has left
  // after the knob.
  const airAtStart = inset;
  const airAtEnd = width - (inset + travel + knob);

  // Act / Assert
  assert.equal(airAtStart, airAtEnd, `the knob has ${airAtStart}px before it and ${airAtEnd}px after it`);
});

test('the travel spans the track less the knob and both air gaps', () => {
  // The knob keeps `inset` of air at BOTH ends, and both are inside the track.
  assert.equal(travel, width - knob - inset * 2, `travel ${travel} does not span the track's width`);
});

test('the horizontal air equals the vertical air', () => {
  // Act / Assert — a knob with 3px of side padding and 4px above and below is
  // the asymmetry that reads as "no padding".
  assert.equal(inset, (height - knob) / 2, `the knob keeps ${inset}px at the sides and ${(height - knob) / 2}px vertically`);
});

test('the knob stays fully inside the track at both ends', () => {
  // Act / Assert — an over-travelling knob is clipped by `overflow: hidden`,
  // which is what "the circle overflows the pill" looked like.
  assert.ok(inset + travel + knob + inset === width, 'the two rests do not exactly span the track');
  assert.ok(knob <= height, `the knob is taller than the track: ${knob} vs ${height}`);
});

test('the component derives its travel and margin from the metrics', () => {
  // Arrange
  const source = code('src/components/ui/AccentSwitch.tsx');

  // Act
  const derived = /KNOB_TRAVEL\s*=\s*TRACK_WIDTH\s*-\s*KNOB_SIZE\s*-\s*KNOB_INSET\s*\*\s*2/.test(source);
  const anchored = /KNOB_INSET\b/.test(source);

  // Assert
  assert.ok(derived, 'the travel must leave air at BOTH ends of the track');
  assert.ok(anchored, 'the knob does not rest at the declared inset');
});

test('the knob inset is PHYSICAL, and applied as an anchor rather than a margin', () => {
  // Arrange — the reported defect, and the second one found on the device.
  //
  // `Pressy` splits a style into a layout object and a visual one with a whitelist
  // of physical keys, so `marginInlineStart` was discarded and the OFF knob lost
  // its air. Fixing that with a physical MARGIN was not enough: a margin and a
  // transform on one node are two positioning systems, and measured on the
  // emulator the rests stopped being mirror images (ON 22px of air, OFF 0px).
  //
  // The knob is now anchored from the leading edge — one `left`/`right` chosen
  // from the resolved direction — and moved by the transform alone.
  const source = code('src/components/ui/AccentSwitch.tsx');

  // Act
  const knob = /knob:\s*\{([^}]*)\}/.exec(source)?.[1] ?? '';
  const anchored = /\{\s*right:\s*KNOB_INSET\s*\}/.test(source) &&
    /\{\s*left:\s*KNOB_INSET\s*\}/.test(source);

  // Assert
  assert.ok(
    !/marginInlineStart/.test(knob),
    'the knob inset is declared with a logical key, which `Pressy` discards',
  );
  assert.ok(anchored, 'the knob does not anchor itself on a physical side');
  assert.ok(
    !/margin(Left|Right):\s*KNOB_INSET/.test(source),
    'the knob is positioned by both a margin and a transform',
  );
});

test('`Pressy` still hoists the physical keys and only the physical ones', () => {
  // Arrange — this is the fact the fix depends on, asserted where it can be seen:
  // if the whitelist ever grew logical keys the branch above would stop mattering,
  // and if it lost the physical ones the knob would break again silently.
  const pressy = code('src/components/ui/Pressy.tsx');
  const whitelist = /LAYOUT_PROPS = new Set\(\[([\s\S]*?)\]\)/.exec(pressy)?.[1] ?? '';

  // Assert
  assert.ok(/'marginLeft'/.test(whitelist), 'Pressy no longer hoists marginLeft');
  assert.ok(/'marginRight'/.test(whitelist), 'Pressy no longer hoists marginRight');
  assert.ok(!/marginInline/.test(whitelist), 'Pressy hoists logical keys, so the branch is redundant');
});

test('the travel flips with the layout direction', () => {
  // Arrange — the knob is anchored at the LOGICAL leading edge and moved by a
  // PHYSICAL translate, so the sign has to follow the direction. Reading the
  // direction once left the knob starting at the right margin and travelling
  // negative, i.e. straight out of the track.
  const source = code('src/components/ui/AccentSwitch.tsx');

  // Act
  const subscribes = /useLayoutDirection\(\)/.test(source);
  const signs = /rtl\s*\?\s*-KNOB_TRAVEL\s*:\s*KNOB_TRAVEL/.test(source);

  // Assert
  assert.ok(subscribes, 'the switch reads the direction once and never re-renders on a change');
  assert.ok(signs, 'the travel does not flip with the direction');
});
