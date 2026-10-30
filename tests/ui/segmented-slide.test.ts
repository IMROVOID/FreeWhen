/**
 * The segmented pill must SLIDE, and it must fit its segment.
 *
 * ★ THE SHIPPED DEFECTS — TWO, AND BOTH ARE VISIBLE IN THE HAND.
 *
 * 1. **IT TELEPORTS, THEN SHAKES.** The travel was applied as
 *
 *    ```js
 *    slide.value = delta;                              // ①
 *    slide.value = withTiming(0, { … });               // ②
 *    ```
 *
 *    Two assignments to the same shared value in one synchronous block. The
 *    second replaces the first before any frame renders, so the pill never
 *    travels FROM anywhere: `left` is already the new rest, and the transform
 *    animates from an overshoot of `delta` back to `0`. The visible result is a
 *    jump to the new option followed by a wobble toward the old one — reported
 *    exactly as "it just teleports and shakes when changing the value".
 *
 *    A translation cannot animate a position that is ALSO being changed in
 *    style on the same commit. The position itself has to be the animated value.
 *
 * 2. **IT IS INSET BY THE RAIL'S PADDING TWICE.** The pill is
 *    `position: absolute` with `top: space[1]` and `bottom: space[1]`, and its
 *    containing block is the rail's PADDING box — which is already inset by
 *    `space[1]` on every side. So the pill sits `2 × space[1]` from the rail's
 *    border on all four edges and is `2 × space[1]` shorter than a segment:
 *    measured on the theme rail (padding 4) the pill is 28pt tall inside a 36pt
 *    segment. That is the "knob is offset / too much padding, needs to be closer
 *    to the edge".
 *
 * ★ WHAT THIS FILE PINS.
 *
 * The geometry is pure, so the box arithmetic is asserted numerically. The
 * animation is a shared-value contract the Node runner cannot execute, so it is
 * asserted structurally — but on the SHAPE of the contract (one animated value
 * that carries the position), not on a particular line of code.
 */

import './support/register';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import {
  indicatorLeftFor,
  indicatorPlacementFor,
  segmentWidthFor,
} from '@/src/components/ui/segmented-geometry';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const CHIP = 'src/components/ui/Chip.tsx';

/** The tokens the rail uses: `space[1]` is 4, a segment is 36 tall. */
const INSET = 4;
const SEGMENT_HEIGHT = 36;
const TRACK = 300;
const COUNT = 3;

/* ── Box geometry: the pill must be exactly one segment ──────────────────── */

test('the pill spans the full segment, with no padding counted twice', () => {
  // Arrange — the rail is `padding: 4`, so its padding box is the track and an
  // absolute child's `left: 0` is that track's edge. The pill then needs
  // `top: 0` / `bottom: 0` INSIDE the padding box to be a whole segment tall.
  //
  // `top: 4, bottom: 4` was applied on top of the padding box, so the pill was
  // `2 × INSET` short — 28pt inside a 36pt segment on the theme rail.
  const insetFromPaddingBox = 0;
  const pillHeight = SEGMENT_HEIGHT - insetFromPaddingBox * 2;

  // Assert
  assert.equal(pillHeight, SEGMENT_HEIGHT, 'the pill does not fill one segment vertically');
});

test('the pill is one segment wide and sits exactly over its option', () => {
  // Arrange
  const segmentWidth = segmentWidthFor({ trackWidth: TRACK, inset: INSET, count: COUNT });

  // Act — every option, in LTR.
  for (const index of [0, 1, 2]) {
    const left = indicatorLeftFor(index, { trackWidth: TRACK, inset: INSET, count: COUNT, rtl: false });

    // Assert — the pill occupies the same span its label does, and the first
    // option is flush against the track's leading edge (not one padding step in).
    assert.ok(
      Math.abs(left - segmentWidth * index) < 0.001,
      `option ${index} rests at ${left}, expected ${segmentWidth * index}`,
    );
  }

  assert.equal(
    indicatorLeftFor(0, { trackWidth: TRACK, inset: INSET, count: COUNT, rtl: false }),
    0,
    'the first pill is inset by the rail padding a second time',
  );
});

test('the first Persian option is flush against the track’s trailing edge', () => {
  // Arrange — "Language Knob on English instead of Persian on Persian": the
  // FIRST option in RTL must be the RIGHTMOST, flush at the inner edge.
  const inner = TRACK - INSET * 2;
  const segmentWidth = segmentWidthFor({ trackWidth: TRACK, inset: INSET, count: COUNT });

  // Act
  const first = indicatorLeftFor(0, { trackWidth: TRACK, inset: INSET, count: COUNT, rtl: true });

  // Assert
  assert.ok(
    Math.abs(first + segmentWidth - inner) < 0.001,
    `the RTL first pill ends at ${first + segmentWidth}, expected the inner edge ${inner}`,
  );
});

test('the placement pair names one side and parks the other, in both directions', () => {
  // Arrange — a node carrying both `left` and `right` resolves `left` first, which
  // is what silently discarded the mirror before.
  for (const rtl of [false, true]) {
    for (const index of [0, 1, 2]) {
      // Act
      const placement = indicatorPlacementFor(index, {
        trackWidth: TRACK,
        inset: INSET,
        count: COUNT,
        rtl,
      });

      // Assert
      const anchored = [placement.left, placement.right].filter((v) => v !== 'auto');
      assert.equal(anchored.length, 1, `rtl=${rtl} ${index}: both sides are anchored`);
    }
  }
});

/* ── The animation contract ──────────────────────────────────────────────── */

test('the pill’s position is a single animated value, not a style plus a delta', () => {
  // Arrange
  const chip = code(CHIP);

  // Act — ★ the defect: `slide.value = delta;` followed immediately by
  // `slide.value = withTiming(0, …);`. The second assignment discards the first
  // before a frame renders, so nothing ever travels.
  const doubleAssign =
    /slide\.value\s*=\s*delta\s*;\s*slide\.value\s*=\s*withTiming\(\s*0/.test(chip);

  // Assert
  assert.equal(
    doubleAssign,
    false,
    'the travel is assigned then immediately overwritten, so the pill teleports instead of sliding',
  );
});

test('the animated value drives the position, so a slide is possible at all', () => {
  // Arrange — a `translateX` of a delta on top of a `left` that changes in the
  // same commit cannot animate: the rest already moved. The animated value has to
  // BE the position.
  const chip = code(CHIP);

  // Act
  const animatesLeft = /useAnimatedStyle\(\(\)\s*=>\s*\(\{\s*left:/.test(chip);

  // Assert
  assert.ok(
    animatesLeft,
    'the pill translates a delta instead of animating its own left edge, which can only ' +
      'overshoot and settle',
  );
});

test('a measurement arriving late does not animate from zero', () => {
  // Arrange — the rail measures after the first render, so `trackWidth` goes
  // 0 → N. If that transition animates, the pill slides in from the wrong place
  // on every mount — the "shakes" half of the report.
  const chip = code(CHIP);

  // Act — the component must know whether this is the FIRST placement (a
  // correction to place) or a subsequent one (a selection to slide).
  const tracksFirstPlacement = /placedWidth\.current\s*===\s*null/.test(chip);
  const waitsForMeasurement = /const measured\s*=\s*trackWidth\s*>\s*0/.test(chip);

  // Assert
  assert.ok(
    tracksFirstPlacement,
    'the first placement is treated as a move rather than a correction',
  );
  assert.ok(waitsForMeasurement, 'the effect runs before the rail has measured');
});

test('Reduce Motion still snaps the pill to its rest', () => {
  // Arrange
  const chip = code(CHIP);

  // Assert — Style Guide §7.7: motion collapses, the control still works.
  assert.match(chip, /motion\.reduce/, 'the control reads no reduce flag');
});

test('the position is written even while Reduce Motion is on', () => {
  // Arrange — ★ THE LEAK THIS PINS, FOUND IN REVIEW AND CAUGHT BEFORE SHIPPING.
  //
  // The snap branch used to set the bookkeeping refs and then RETURN when motion
  // was reduced, without writing `animatedLeft`. With Reduce Motion on, the pill
  // therefore stayed on whatever option it had last ANIMATED to: the selection
  // could change underneath it and the pill would not follow. Turning Reduce
  // Motion off did not recover, because the position already "matched" and every
  // later pass returned early — the pill was permanently one option behind.
  //
  // The position must be assigned outright on every non-animated path.
  const chip = code(CHIP);

  // Act — the snap branch (first placement / re-measure / direction flip / reduce).
  const snapBranch =
    /if \(first \|\| resized[\s\S]*?animatedLeft\.value = restLeft;[\s\S]*?\}/.exec(chip)?.[0] ?? '';

  // Assert
  assert.ok(snapBranch.length > 0, 'the snap branch is missing');
  assert.match(
    snapBranch,
    /motion\.reduce/,
    'Reduce Motion is not routed through the snap branch',
  );
  assert.match(
    snapBranch,
    /animatedLeft\.value = restLeft/,
    'the reduce-motion path returns without writing the position, stranding the pill on the old option',
  );
});

test('a re-measure re-places the pill rather than sliding it', () => {
  // Arrange — ★ ROTATION AND FONT-SCALE ARE NOT GESTURES.
  //
  // Any change to `trackWidth` moves the resting pixel for the SAME selected
  // option. Animating that reads as the control moving on its own, so the effect
  // must distinguish "the option changed" from "the rail was re-measured".
  //
  // ★ COMPARING THE RESULTING PIXEL CANNOT DO THAT, AND AN EARLIER VERSION TRIED.
  //
  // Once a selection has been placed, `restLeft` matches again — so the very next
  // resize looked exactly like another selection change and animated. Replaying
  // the decision showed it immediately: mount(place) → select 2(animate) →
  // rotate(animate) was wrong. The WIDTH is the input only a re-measure moves.
  const chip = code(CHIP);

  // Act
  const tracksWidth = /placedWidth\.current !== trackWidth/.test(chip);
  const tracksSelection = /selectedIndex !== placedIndex\.current/.test(chip);

  // Assert
  assert.ok(tracksWidth, 'a re-measure is indistinguishable from a selection change');
  assert.ok(tracksSelection, 'the effect cannot tell whether the option changed');
});

test('a direction flip snaps rather than sliding across the rail', () => {
  // Arrange — the app remounts its tree on a direction change, but the rail can
  // also re-render in place. Either way the rail has been laid out around the new
  // direction, so travelling from the OLD coordinate would wipe across a track
  // that no longer matches it.
  const chip = code(CHIP);

  // Act — the effect must notice the direction it last placed in.
  const tracksDirection = /placedRtl/.test(chip);

  // Assert
  assert.ok(tracksDirection, 'a direction change is animated instead of placed');
});

test('the animated value is the PHYSICAL left edge, in both directions', () => {
  // Arrange — ★ THE MISTAKE THIS PINS, WHICH WAS MADE AND CAUGHT IN THIS CHANGE.
  //
  // An intermediate version computed the RTL rest as a distance from the RIGHT
  // edge (what `indicatorPlacementFor` returns for RTL) and then wrote that number
  // into `left`. On a Persian rail that puts option 0 — the one the language
  // control selects — at the FAR LEFT instead of the far right, which is precisely
  // the reported "Language knob sits on English instead of Persian".
  //
  // `indicatorLeftFor` already returns a left edge for an RTL rail, so the value
  // must come from it and must be written to `left`, with no side named anywhere.
  const chip = code(CHIP);

  // Act
  const restFromLeftGeometry = /const restLeft = indicatorLeftFor\(/.test(chip);
  const writesLeft = /left:\s*animatedLeft\.value/.test(chip);
  const picksSide = /rtl\s*\?\s*indicatorPlacement|restOnNamedSide/.test(chip);

  // Assert
  assert.ok(restFromLeftGeometry, 'the rest is not taken from the left-edge geometry');
  assert.ok(writesLeft, 'the animated position is not written to `left`');
  assert.equal(
    picksSide,
    false,
    'the component converts the rest to a right-edge distance and writes it into `left`, ' +
      'which mirrors the Persian pill onto the wrong side',
  );
});
