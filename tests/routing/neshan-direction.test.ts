/**
 * The Neshan direction adapter — the per-pair fallback.
 *
 * ★ THE BOUND MUST COUNT ATTEMPTS, NOT SUCCESSES.
 *
 * A budget that counts resolutions is defeated by a failing provider: a
 * refusal increments nothing, so the loop keeps asking and issues every
 * pair instead of the bounded number. That is exactly the burst the bound
 * exists to prevent — a matrix outage turning into 150 individual
 * requests against a provider that is already struggling (Plan 04, Task 3).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createNeshanDirectionAdapter } from '@/src/routing/adapters/neshan-direction';
import { DIRECTION_FALLBACK_MAX_PAIRS } from '@/src/routing/config';
import type { ProviderTransport } from '@/src/routing/provider';

const TEHRAN = { lat: 35.7448, lng: 51.405 };
const NOW = new Date('2026-08-02T16:00:00.000Z');

/** A transport that counts its calls and always refuses. */
function refusingTransport(): { transport: ProviderTransport; calls: () => number } {
  let count = 0;
  return {
    transport: async () => {
      count += 1;
      // A quota refusal — the provider answers, but not usefully.
      return { status: 481, body: '{}' };
    },
    calls: () => count,
  };
}

/** A transport that always answers with a route. */
function servingTransport(): { transport: ProviderTransport; calls: () => number } {
  let count = 0;
  return {
    transport: async () => {
      count += 1;
      return {
        status: 200,
        body: JSON.stringify({
          routes: [{ legs: [{ distance: { value: 5000 }, duration: { value: 600 } }] }],
        }),
      };
    },
    calls: () => count,
  };
}

test('a refusing provider does not defeat the bound', async () => {
  // Arrange — 10 origins against 15 destinations: 150 pairs
  const { transport, calls } = refusingTransport();
  const adapter = createNeshanDirectionAdapter({
    transport,
    keys: () => 'test-key',
    now: () => NOW,
    sleep: async () => undefined,
  });

  // Act
  await adapter.measureMatrix!({
    origins: Array.from({ length: 10 }, (_, index) => ({
      lat: TEHRAN.lat + index * 0.01,
      lng: TEHRAN.lng,
    })),
    destinations: Array.from({ length: 15 }, (_, index) => ({
      lat: TEHRAN.lat + index * 0.001,
      lng: TEHRAN.lng + 0.01,
    })),
    mode: 'car',
    departureBucket: NOW.toISOString(),
  });

  // Assert — ★ the bound counts ATTEMPTS, so a provider that refuses
  // everything still stops at the bound
  assert.ok(
    calls() <= DIRECTION_FALLBACK_MAX_PAIRS,
    `expected at most ${DIRECTION_FALLBACK_MAX_PAIRS} requests, got ${calls()}`,
  );
});

test('a serving provider is bounded too', async () => {
  // Arrange
  const { transport, calls } = servingTransport();
  const adapter = createNeshanDirectionAdapter({
    transport,
    keys: () => 'test-key',
    now: () => NOW,
    sleep: async () => undefined,
  });

  // Act
  const result = await adapter.measureMatrix!({
    origins: Array.from({ length: 10 }, (_, index) => ({
      lat: TEHRAN.lat + index * 0.01,
      lng: TEHRAN.lng,
    })),
    destinations: Array.from({ length: 15 }, (_, index) => ({
      lat: TEHRAN.lat + index * 0.001,
      lng: TEHRAN.lng + 0.01,
    })),
    mode: 'car',
    departureBucket: NOW.toISOString(),
  });

  // Assert
  assert.ok(calls() <= DIRECTION_FALLBACK_MAX_PAIRS);
  assert.equal(result.resolved, DIRECTION_FALLBACK_MAX_PAIRS);
  assert.equal(result.total, 150);
});

test('a small matrix is not truncated', async () => {
  // Arrange
  const { transport, calls } = servingTransport();
  const adapter = createNeshanDirectionAdapter({
    transport,
    keys: () => 'test-key',
    now: () => NOW,
    sleep: async () => undefined,
  });

  // Act
  const result = await adapter.measureMatrix!({
    origins: [TEHRAN],
    destinations: [
      { lat: 35.7, lng: 51.4 },
      { lat: 35.71, lng: 51.41 },
    ],
    mode: 'car',
    departureBucket: NOW.toISOString(),
  });

  // Assert
  assert.equal(calls(), 2);
  assert.equal(result.resolved, 2);
});

test('a served route becomes a high-confidence measurement', async () => {
  // Arrange
  const { transport } = servingTransport();
  const adapter = createNeshanDirectionAdapter({
    transport,
    keys: () => 'test-key',
    now: () => NOW,
    sleep: async () => undefined,
  });

  // Act
  const measurement = await adapter.measure({
    origin: TEHRAN,
    destination: { lat: 35.7, lng: 51.4 },
    mode: 'car',
    departureBucket: NOW.toISOString(),
  });

  // Assert
  assert.ok(measurement);
  assert.equal(measurement.minutes, 10);
  assert.equal(measurement.distanceMeters, 5000);
  assert.equal(measurement.confidence, 'high');
  assert.equal(measurement.source, 'neshan_direction');
  assert.equal(measurement.costIrr, null);
});

test('a 481 is not retried by the direction adapter either', async () => {
  // Arrange
  let calls = 0;
  const adapter = createNeshanDirectionAdapter({
    transport: async () => {
      calls += 1;
      return { status: 481, body: '{}' };
    },
    keys: () => 'test-key',
    now: () => NOW,
    sleep: async () => undefined,
  });

  // Act
  const measurement = await adapter.measure({
    origin: TEHRAN,
    destination: { lat: 35.7, lng: 51.4 },
    mode: 'car',
    departureBucket: NOW.toISOString(),
  });

  // Assert
  assert.equal(calls, 1, 'an exhausted quota must not be retried');
  assert.equal(measurement, null);
});

test('the direction adapter declines a transit request', async () => {
  // Arrange
  let calls = 0;
  const adapter = createNeshanDirectionAdapter({
    transport: async () => {
      calls += 1;
      return { status: 200, body: '{}' };
    },
    keys: () => 'test-key',
    now: () => NOW,
    sleep: async () => undefined,
  });

  // Act / Assert — Neshan has no transit type
  assert.equal(adapter.supports!('transit'), false);
  assert.equal(adapter.supports!('car'), true);
  assert.equal(calls, 0);
});
