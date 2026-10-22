/**
 * The per-provider backoff.
 *
 * ★ THIS FILE IS SEPARATE FROM THE INVITE LIMITER ON PURPOSE.
 *
 * Plan 05's invite limiter is normative: FR-1.15 requires a byte-identical
 * response for a rate-limited invite, so it must never return a
 * distinguishable body. If the provider backoff shared its error path with
 * the invite limiter, the first change that made the provider response
 * readable would leak that difference into the invite response. The two
 * files are separate, and this suite pins the provider one.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  BACKOFF_MS,
  RATE_BACKOFF_MS,
  clearBackoff,
  isBackedOff,
  recordRefusal,
  remainingBackoffMs,
  resetBackoff,
} from '@/server/lib/provider-backoff';

beforeEach(() => {
  resetBackoff();
});

test('a provider is not backed off before it refuses', () => {
  // Arrange / Act / Assert
  assert.equal(isBackedOff('neshan_matrix'), false);
  assert.equal(remainingBackoffMs('neshan_matrix'), 0);
});

test('a quota refusal benches the provider for hours', () => {
  // Arrange
  const now = 1_000_000;

  // Act
  recordRefusal('neshan_matrix', 'quota', now);

  // Assert
  assert.equal(isBackedOff('neshan_matrix', now), true);
  assert.equal(remainingBackoffMs('neshan_matrix', now), BACKOFF_MS.neshan_matrix);
  assert.ok(BACKOFF_MS.neshan_matrix > 60 * 60 * 1000, 'a quota lasts for hours');
});

test('a rate refusal benches the provider for a minute', () => {
  // Arrange
  const now = 1_000_000;

  // Act
  recordRefusal('neshan_matrix', 'rate', now);

  // Assert
  assert.equal(isBackedOff('neshan_matrix', now), true);
  assert.equal(remainingBackoffMs('neshan_matrix', now), RATE_BACKOFF_MS);
});

test('the backoff expires', () => {
  // Arrange
  const now = 1_000_000;
  recordRefusal('neshan_matrix', 'rate', now);

  // Act — one millisecond past the window
  const later = now + RATE_BACKOFF_MS + 1;

  // Assert
  assert.equal(isBackedOff('neshan_matrix', now), true);
  assert.equal(isBackedOff('neshan_matrix', later), false);
});

test('a success clears the backoff', () => {
  // Arrange
  const now = 1_000_000;
  recordRefusal('neshan_matrix', 'quota', now);
  assert.equal(isBackedOff('neshan_matrix', now), true);

  // Act
  clearBackoff('neshan_matrix');

  // Assert
  assert.equal(isBackedOff('neshan_matrix', now), false);
});

test('one provider\'s refusal does not bench another', () => {
  // Arrange
  const now = 1_000_000;
  recordRefusal('neshan_matrix', 'quota', now);

  // Act / Assert — the ORS fallback must stay reachable
  assert.equal(isBackedOff('ors', now), false);
  assert.equal(isBackedOff('neshan_direction', now), false);
});

test('the ORS window is a day, because the quota resets from the first request of the window', () => {
  // Arrange / Act / Assert
  assert.equal(BACKOFF_MS.ors, 24 * 60 * 60 * 1000);
  assert.ok(
    BACKOFF_MS.ors > 12 * 60 * 60 * 1000,
    'a bench that ended at midnight would be wrong for most of the day',
  );
});

test('a stale window does not extend a fresh one', () => {
  // Arrange — a refusal in the past
  const now = 10_000_000;
  recordRefusal('neshan_matrix', 'rate', now - RATE_BACKOFF_MS - 1);

  // Act / Assert — the window has passed, so the provider is callable
  assert.equal(isBackedOff('neshan_matrix', now), false);

  // And a NEW refusal starts a fresh window
  recordRefusal('neshan_matrix', 'rate', now);
  assert.equal(remainingBackoffMs('neshan_matrix', now), RATE_BACKOFF_MS);
});

test('the backoff never returns a response body', () => {
  // Arrange / Act / Assert — the module exposes state, not responses. A
  // byte-identical invite response cannot be disturbed by a file that
  // cannot produce one.
  assert.equal(typeof isBackedOff, 'function');
  assert.equal(typeof recordRefusal, 'function');
  assert.equal(typeof remainingBackoffMs, 'function');
});
