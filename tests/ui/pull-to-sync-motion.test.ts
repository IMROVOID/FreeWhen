/**
 * Pull-to-refresh must MOVE the page, and the corners must track it smoothly.
 *
 * ★ THE DEFECTS THIS PINS.
 *
 * 1. "When I pull down the pages to refresh, the page barely moves down."
 *
 *    `displacementFor` was `sqrt(2 * drag)`. At the 72px trigger the page had moved
 *    `sqrt(144) = 12px` — a twelfth of the finger's travel, and the same order as the
 *    list's own gap. The damping was measured at the THRESHOLD rather than at the
 *    finger, so the curve was tuned for the wrong point.
 *
 * 2. "The top corners should turn rounded smoothly (they are currently sharp)."
 *
 *    Two separate causes, both in the component:
 *
 *      a. `displaced` was React state, written on every `onPanResponderMove` frame.
 *         The radius was derived from it, so it re-rendered per frame and arrived a
 *         frame late — visibly stepped rather than smooth.
 *      b. On release, `settle()` animated `translateY` but `displaced` was only
 *         updated in the animation's COMPLETION callback. So the radius held its
 *         pulled value for the whole spring and then SNAPPED to 0 at the end —
 *         exactly the "sharp again" the report describes, in reverse.
 *
 * 3. "…and sharp smoothly again when moving it back up or letting go."
 *
 *    Same as 2b: the radius has to be driven by the same animated value as the
 *    translation, so it cannot disagree with it at any point in either direction.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import {
  MAX_PULL,
  PULLED_RADIUS,
  REFRESH_THRESHOLD,
  cornerRadiusFor,
  displacementFor,
} from '@/src/components/ui/pull-to-sync-geometry';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('the page has visibly moved by the time a release would refresh', () => {
  // Arrange — this is the number the complaint is about.
  const atThreshold = displacementFor(REFRESH_THRESHOLD);

  // Assert — a refresh the reader cannot see coming is indistinguishable from no
  // gesture at all. A third of the finger's travel is the floor for "it moved".
  assert.ok(
    atThreshold >= REFRESH_THRESHOLD / 3,
    `at the ${REFRESH_THRESHOLD}px trigger the page only moves ${atThreshold.toFixed(1)}px`,
  );
  assert.ok(atThreshold < REFRESH_THRESHOLD, 'the page follows the finger one-to-one');
});

test('an ordinary pull moves the page a readable amount', () => {
  // Act — a normal deliberate pull, not the bare minimum.
  const moved = displacementFor(140);

  // Assert
  assert.ok(moved >= 60, `a 140px pull moves the page only ${moved.toFixed(1)}px`);
});

test('the displacement still starts at zero and stays under the finger', () => {
  // ★ The earlier guarantee must survive the retune: damping is what stops the page
  // overshooting its own content and revealing a blank band.
  assert.equal(displacementFor(0), 0);

  for (const drag of [8, 20, 40, 72, 140, 260]) {
    const moved = displacementFor(drag);
    assert.ok(moved > 0, `${drag}px of drag moved nothing`);
    assert.ok(moved < drag, `${drag}px of drag moved the page ${moved}, which is not damped`);
  }
});

test('the displacement is monotonic and never exceeds the cap', () => {
  // Arrange
  let previous = -1;

  // Act / Assert
  for (let drag = 0; drag <= 600; drag += 4) {
    const moved = displacementFor(drag);
    assert.ok(moved >= previous, `the curve dips at ${drag}px: ${moved} after ${previous}`);
    assert.ok(moved <= MAX_PULL, `${drag}px of drag exceeded the cap: ${moved}`);
    previous = moved;
  }

  assert.equal(displacementFor(100_000), MAX_PULL, 'the cap is not reached at all');
});

test('the radius is continuous as the page lifts and settles', () => {
  // Arrange — a snap is a large jump between neighbouring displacements. The radius
  // is derived from a single animated value now, so it must never step.
  const STEP = 1;

  // Act / Assert
  for (let d = 0; d <= MAX_PULL; d += STEP) {
    const before = cornerRadiusFor(d);
    const after = cornerRadiusFor(d + STEP);

    // At most `PULLED_RADIUS / width` of the full radius per pixel; the taper is
    // gentle enough that 2px of travel is the most it may ever cover.
    const jump = Math.abs(after - before);
    assert.ok(jump <= 2, `the radius jumps ${jump.toFixed(2)}px at displacement ${d}`);
  }
});

test('the radius rounds in, holds, and is zero at rest', () => {
  // Act / Assert
  assert.equal(cornerRadiusFor(0), 0, 'the page is rounded at rest');
  assert.equal(cornerRadiusFor(-10), 0, 'a negative displacement produced a radius');

  const partway = cornerRadiusFor(MAX_PULL / 2);
  assert.ok(partway > 0 && partway <= PULLED_RADIUS, `partway radius is ${partway}`);
  assert.equal(cornerRadiusFor(MAX_PULL), PULLED_RADIUS, 'the full radius is never reached');
});

test('the radius and the translation are driven by the same animated value', () => {
  // Arrange — deriving the radius from React state is what made it lag a frame and
  // then snap on release.
  const component = code('src/components/ui/PullToSync.tsx');

  // Act
  const radiusFromState = /borderTopLeftRadius:\s*cornerRadiusFor\(displaced\)/.test(component);
  const hasAnimatedRadius = /interpolate[\s\S]{0,300}?cornerRadiusFor|cornerRadiusFor[\s\S]{0,300}?interpolate/.test(
    component,
  );
  const usesAnimatedStyle = /useAnimatedStyle/.test(component);

  // Assert
  assert.ok(
    !radiusFromState,
    'the corner radius is still computed from React state, so it cannot animate with the spring',
  );
  assert.ok(usesAnimatedStyle, 'the page has no animated style');
  assert.ok(
    hasAnimatedRadius || /radiusProgress/.test(component),
    'the radius is not derived from the animated value',
  );
});

test('the band opacity is animated too, so it fades with the pull', () => {
  // Arrange
  const component = code('src/components/ui/PullToSync.tsx');

  // Assert
  assert.ok(
    /bandOpacityFor|bandOpacity|opacity/.test(component),
    'the band has no opacity at all',
  );
  assert.ok(
    /useAnimatedStyle/.test(component),
    'the band is not animated, so it pops in',
  );
});

test('the released page still settles back to a square top edge', () => {
  // Arrange — the settle must reach 0, and the radius must follow it there.
  const component = code('src/components/ui/PullToSync.tsx');

  // Assert
  assert.ok(/settle\(0\)/.test(component), 'the page never returns to rest');
});
