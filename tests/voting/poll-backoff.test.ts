/**
 * A failing poll backs off instead of retrying at full speed.
 *
 * See `src/features/voting/services/poll-backoff.ts` for why: with no backoff, a
 * persistent 500 became six requests a minute per screen, each running ten
 * sequential queries, from every open tab.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  POLL_CEILING_MS,
  POLL_FLOOR_MS,
  nextPollDelay,
} from '@/src/features/voting/services/poll-backoff';
import { POLL_INTERVAL_MS } from '@/src/features/voting/services/realtime-engine';

test('a healthy poll keeps the floor cadence', () => {
  // Arrange / Act
  const delay = nextPollDelay(0);

  // Assert
  assert.equal(delay, POLL_FLOOR_MS);
});

test('the floor is the engine the poll interval, so the two cannot disagree', () => {
  // Arrange / Act / Assert — two constants for one cadence is how they drift.
  assert.equal(POLL_FLOOR_MS, POLL_INTERVAL_MS);
});

test('each consecutive failure doubles the wait, up to the ceiling', () => {
  // Arrange — `nextPollDelay(n)` takes the number of failures, so the first
  // failure (n=1) waits one floor and the curve starts there. `2 * floor` is
  // 20s, `4 * floor` is 40s, and `8 * floor` (80s) is above the 60s ceiling, so
  // it is clamped.
  const expected = [
    POLL_FLOOR_MS,
    POLL_FLOOR_MS * 2,
    POLL_FLOOR_MS * 4,
    POLL_CEILING_MS,
  ];

  // Act
  const actual = [1, 2, 3, 4].map((failures) => nextPollDelay(failures));

  // Assert
  assert.deepEqual(actual, expected);
});

test('the wait is clamped at the ceiling and never grows past it', () => {
  // Arrange / Act
  const longOutage = nextPollDelay(30);

  // Assert — a tab left open overnight still polls once a minute, not once a day.
  assert.equal(longOutage, POLL_CEILING_MS);
  assert.ok(Number.isFinite(longOutage), 'the delay overflowed to Infinity');
});

test('a negative or non-finite failure count is treated as healthy', () => {
  // Arrange / Act / Assert — a caller that resets its counter to -1 must not
  // produce a fraction of the floor or a NaN timer.
  assert.equal(nextPollDelay(-1), POLL_FLOOR_MS);
  assert.equal(nextPollDelay(Number.NaN), POLL_FLOOR_MS);
  assert.equal(nextPollDelay(Number.POSITIVE_INFINITY), POLL_FLOOR_MS);
});

test('the ceiling is a real cap above the floor', () => {
  // Arrange / Act / Assert — a ceiling at or below the floor would make backoff
  // a no-op, which is the bug this module exists to fix.
  assert.ok(POLL_CEILING_MS > POLL_FLOOR_MS);
});
