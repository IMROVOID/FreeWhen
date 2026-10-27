/**
 * Pull-to-sync geometry (Plan 49 T16).
 *
 * ★ THE ARITHMETIC IS THE TESTABLE PART.
 *
 * The drag is a `PanResponder`, which no Node test can drive. What the reader
 * actually experiences — how far the page moves, whether a release refreshes, when
 * the corners round, how the spinner turns — is pure, and that is what these
 * assertions pin.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BAND_HEIGHT,
  MAX_PULL,
  PULLED_RADIUS,
  REFRESH_THRESHOLD,
  bandOpacityFor,
  cornerRadiusFor,
  displacementFor,
  shouldRefresh,
  spinnerRotationFor,
} from '@/src/components/ui/pull-to-sync-geometry';

test('an upward or zero drag moves nothing', () => {
  // Act / Assert — a page must not lift when the reader scrolls down.
  assert.equal(displacementFor(0), 0);
  assert.equal(displacementFor(-50), 0);
  assert.equal(displacementFor(Number.NaN), 0);
});

test('the displacement grows with the drag', () => {
  // Act
  const small = displacementFor(20);
  const large = displacementFor(100);

  // Assert
  assert.ok(small > 0 && large > small, `${small} then ${large}`);
});

test('the displacement is damped, not one-to-one', () => {
  // ★ A page that follows the finger exactly overshoots its content and reveals a
  // blank band above it. Damping is what makes the page feel attached to something.
  assert.ok(displacementFor(40) < 40, 'the page follows the finger one-to-one');
});

test('the displacement is capped', () => {
  // Act / Assert — however hard the pull, the page cannot be dragged into the
  // middle of the screen.
  assert.equal(displacementFor(100_000), MAX_PULL);
});

test('a short pull does not refresh, a long one does', () => {
  // Arrange — find the smallest drag that clears the threshold.
  let drag = 0;
  while (!shouldRefresh(drag) && drag < 10_000) drag += 1;

  // Act / Assert
  assert.equal(shouldRefresh(drag - 1), false, 'a pull just under the threshold refreshed');
  assert.equal(shouldRefresh(drag), true, 'the threshold never becomes reachable');
});

test('the corners are square at rest and rounded while pulled', () => {
  // Act / Assert — the page is square against the header until it is lifted.
  assert.equal(cornerRadiusFor(0), 0);
  assert.ok(cornerRadiusFor(REFRESH_THRESHOLD) > 0);
  assert.equal(cornerRadiusFor(MAX_PULL), PULLED_RADIUS);
});

test('the revealed band fades in with the pull', () => {
  // Act / Assert
  assert.equal(bandOpacityFor(0), 0);
  assert.ok(bandOpacityFor(BAND_HEIGHT / 2) > 0);
  assert.equal(bandOpacityFor(BAND_HEIGHT), 1);
  assert.equal(bandOpacityFor(MAX_PULL), 1, 'the band overflows its own opacity');
});

test('the spinner turns as the reader pulls', () => {
  // Act / Assert — a full turn by the time the threshold is reached.
  assert.equal(spinnerRotationFor(0), 0);
  assert.equal(spinnerRotationFor(REFRESH_THRESHOLD), 360);
  assert.ok(spinnerRotationFor(2000) <= 360 * 2, 'the rotation is unbounded');
});
