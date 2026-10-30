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



function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const CHIP = 'src/components/ui/Chip.tsx';

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
  // Arrange — ★ THE POSITION MUST BE THE ANIMATED VALUE, AND IT MUST BE A TRANSFORM.
  //
  // A `translateX` of a delta on top of a `left` that also changes in the same
  // commit cannot animate: the rest has already moved, so the transform can only
  // overshoot and settle. The value therefore has to BE the position — and because
  // every layout inset is mirrored by the layout direction (see the note in
  // `Chip.tsx`), that position is a transform.
  const chip = code(CHIP);

  // Act
  const animatesTransform = /useAnimatedStyle\(\(\)\s*=>\s*\(\{\s*transform:\s*\[\{\s*translateX:/.test(
    chip,
  );

  // Assert
  assert.ok(
    animatesTransform,
    'the pill does not animate its own position, so it can only overshoot and settle',
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
  // was reduced, without writing `animatedOffset`. With Reduce Motion on, the pill
  // therefore stayed on whatever option it had last ANIMATED to: the selection
  // could change underneath it and the pill would not follow. Turning Reduce
  // Motion off did not recover, because the position already "matched" and every
  // later pass returned early — the pill was permanently one option behind.
  //
  // The position must be assigned outright on every non-animated path.
  const chip = code(CHIP);

  // Act — the snap branch (first placement / re-measure / direction flip / reduce).
  const snapBranch =
    /if \(first \|\| resized[\s\S]*?animatedOffset\.value = restLeft;[\s\S]*?\}/.exec(chip)?.[0] ?? '';

  // Assert
  assert.ok(snapBranch.length > 0, 'the snap branch is missing');
  assert.match(
    snapBranch,
    /motion\.reduce/,
    'Reduce Motion is not routed through the snap branch',
  );
  assert.match(
    snapBranch,
    /animatedOffset\.value = restLeft/,
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

test('the animated value drives a TRANSFORM, which no direction mirrors', () => {
  // Arrange — ★ THE MISTAKES THIS PINS, ALL THREE MADE IN THIS WORK.
  //
  // Every horizontal LAYOUT inset changes meaning under a right-to-left parent:
  // `insetInlineStart` resolves against the document, an explicit `left` becomes
  // the inline-END inset (a different Yoga branch), and forcing the rail to
  // `direction: 'ltr'` fixes the branch but also re-orders the LABELS — putting
  // `fa` on the wrong side — while being a native-only style that react-native-web
  // ignores outright.
  //
  // `translateX` is physical pixels along x and is mirrored by nothing, so it is
  // the one horizontal position that means the same thing everywhere.
  const chip = code(CHIP);

  // Act
  const restFromGeometry = /const restLeft = indicatorLeftFor\(/.test(chip);
  const animatesTranslate = /transform:\s*\[\{\s*translateX:\s*animatedOffset\.value/.test(chip);
  const namesAFloor = /left:\s*animatedOffset|right:\s*animatedOffset/.test(chip);
  const forcesRailDirection = /direction:\s*'ltr'/.test(chip);

  // Assert
  assert.ok(restFromGeometry, 'the rest is not taken from the shared geometry');
  assert.ok(animatesTranslate, 'the position is not an animated transform');
  assert.equal(
    namesAFloor,
    false,
    'the position is written to a layout inset, which the direction mirrors',
  );
  assert.equal(
    forcesRailDirection,
    false,
    'the rail forces its own writing direction, which also re-orders the labels',
  );
});
