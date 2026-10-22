/**
 * The presentation union (Plan 08 Task 1, PRD-04 §13.4, FR-4.18–FR-4.19).
 *
 * ★ THE ASSERTION THAT MATTERS: A LOW-CONFIDENCE FIGURE CANNOT BE AN INTEGER.
 *
 * Every case below is about the type doing the work. If `displayMinutes` ever
 * returned `{ kind: 'exact' }` for a straight-line estimate, the honesty
 * claim in PRD-04 §8 would become a code-review convention instead of a
 * guarantee, and the range-vs-integer distinction would rot the first time
 * someone "simplified" a component.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  displayMinutes,
  hasFigure,
  isEstimated,
} from '../../src/features/venues/services/display-minutes';

describe('displayMinutes', () => {
  test('high confidence with a number renders as an exact integer', () => {
    // Arrange
    const measurement = { confidence: 'high' as const, minutes: 18, minutesRange: null };

    // Act
    const value = displayMinutes(measurement);

    // Assert
    assert.deepEqual(value, { kind: 'exact', minutes: 18 });
  });

  test('a supplied range always wins over the bare minutes', () => {
    // Arrange — a high-confidence measurement can still carry a range, and
    // the range is the more honest of the two.
    const measurement = {
      confidence: 'high' as const,
      minutes: 25,
      minutesRange: [22, 35] as [number, number],
    };

    // Act
    const value = displayMinutes(measurement);

    // Assert
    assert.deepEqual(value, { kind: 'range', low: 22, high: 35 });
  });

  test('a low-confidence measurement yields a range, never an integer', () => {
    // Arrange — straight-line, with a 20-minute headline figure.
    const measurement = { confidence: 'low' as const, minutes: 20, minutesRange: [14, 31] as [number, number] };

    // Act
    const value = displayMinutes(measurement);

    // Assert
    assert.equal(value.kind, 'range');
    assert.notEqual(value.kind, 'exact', 'a low-confidence figure must never be exact');
  });

  test('a medium-confidence measurement without a range still derives one', () => {
    // Arrange — a cached live result, no explicit interval.
    const measurement = { confidence: 'medium' as const, minutes: 30, minutesRange: null };

    // Act
    const value = displayMinutes(measurement);

    // Assert
    assert.equal(value.kind, 'range');
    if (value.kind !== 'range') return;
    assert.ok(value.low < 30, 'the derived band must straddle the estimate');
    assert.ok(value.high > 30, 'the derived band must straddle the estimate');
    assert.ok(value.low >= 0, 'a negative lower bound is not a time');
  });

  test('unknown confidence yields neither a number nor a range', () => {
    // Arrange — the fourth state, and the one that is easiest to get wrong.
    const measurement = { confidence: 'unknown' as const, minutes: 0, minutesRange: null };

    // Act
    const value = displayMinutes(measurement);

    // Assert
    assert.equal(value.kind, 'unknown');
    assert.equal(hasFigure(value), false);
  });

  test('unknown wins over a present number', () => {
    // Arrange — the pipeline does not trust this figure even though a number
    // is sitting next to it.
    const measurement = { confidence: 'unknown' as const, minutes: 12, minutesRange: [10, 15] as [number, number] };

    // Act
    const value = displayMinutes(measurement);

    // Assert
    assert.deepEqual(value, { kind: 'unknown' });
  });

  test('zero minutes is a measurement, not an absence', () => {
    // Arrange — a venue at the participant's door.
    const measurement = { confidence: 'high' as const, minutes: 0, minutesRange: null };

    // Act
    const value = displayMinutes(measurement);

    // Assert — zero renders as exact zero; it must NOT collapse into unknown.
    assert.deepEqual(value, { kind: 'exact', minutes: 0 });
    assert.equal(hasFigure(value), true);
  });

  test('a coarse estimate never renders as a precise integer anywhere', () => {
    // The invariant across every non-high confidence level, asserted as a
    // property rather than case by case.
    const levels = ['medium', 'low', 'unknown'] as const;

    for (const confidence of levels) {
      const value = displayMinutes({ confidence, minutes: 42, minutesRange: null });
      assert.notEqual(value.kind, 'exact', `${confidence} must never be exact`);
    }
  });
});

describe('isEstimated', () => {
  test('medium and low are estimates; high and unknown are not', () => {
    assert.equal(isEstimated('high'), false);
    assert.equal(isEstimated('medium'), true);
    assert.equal(isEstimated('low'), true);
    // `unknown` is not an estimate — it is the absence of one, which is a
    // different statement to make to the user.
    assert.equal(isEstimated('unknown'), false);
  });
});
