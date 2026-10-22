/**
 * The partial matrix.
 *
 * ★ A MATRIX WHERE 6 OF 8 PAIRS RESOLVE IS A SUCCESS WITH PARTIAL
 * COVERAGE, NOT AN ERROR.
 *
 * PRD-05 §12.3 says so explicitly, and it is the single most likely way to
 * lose the primary rung in production: an all-or-nothing implementation
 * discards seven good measurements because one pair came back `NoRoute`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMatrixUrl,
  createNeshanMatrixAdapter,
  parseMatrixResponse,
} from '@/src/routing/adapters/neshan-matrix';
import type { ProviderTransport } from '@/src/routing/provider';

const TEHRAN = { lat: 35.7448, lng: 51.4050 };
const VENUE = { lat: 35.7, lng: 51.4 };
const NOW = new Date('2026-08-02T16:00:00.000Z');

/** A transport that answers with a fixed status and body. */
function fixedTransport(status: number, body: string): ProviderTransport {
  return async () => ({ status, body });
}

/** A transport that records what it was asked for. */
function recordingTransport(
  status: number,
  body: string,
  calls: Array<{ url: string; init: { method: string; headers: Record<string, string>; body?: string } }>,
): ProviderTransport {
  return async (url, init) => {
    calls.push({ url, init });
    return { status, body };
  };
}

/** A matrix body with the given per-element statuses. */
function matrixBody(statuses: string[]): string {
  return JSON.stringify({
    status: 'Ok',
    rows: [
      {
        elements: statuses.map((status) =>
          status === 'Ok'
            ? { status: 'Ok', duration: { value: 600 }, distance: { value: 5000 } }
            : { status },
        ),
      },
    ],
  });
}

test('six of eight resolved is a success with coverage, not an error', async () => {
  // Arrange — eight pairs, six of them `Ok`
  const statuses = [
    'Ok', 'Ok', 'Ok', 'NoRoute', 'Ok', 'Ok', 'Ok', 'UnknownError',
  ];
  const adapter = createNeshanMatrixAdapter({
    transport: fixedTransport(200, matrixBody(statuses)),
    keys: () => 'test-key',
    now: () => NOW,
    sleep: async () => undefined,
  });

  // Act
  const result = await adapter.measureMatrix!({
    origins: [TEHRAN],
    destinations: Array.from({ length: 8 }, (_, index) => ({
      lat: VENUE.lat + index * 0.01,
      lng: VENUE.lng,
    })),
    mode: 'car',
    departureBucket: NOW.toISOString(),
  });

  // Assert — the six good measurements survive
  assert.equal(result.resolved, 6);
  assert.equal(result.total, 8);
  assert.equal(result.outcomes.size, 8);

  let measured = 0;
  for (const outcome of result.outcomes.values()) {
    if (outcome.kind === 'measured') measured += 1;
  }
  assert.equal(measured, 6);
});

test('a NoRoute pair is an absence, not a low cost and not an instant trip', async () => {
  // Arrange
  const adapter = createNeshanMatrixAdapter({
    transport: fixedTransport(200, matrixBody(['NoRoute'])),
    keys: () => 'test-key',
    now: () => NOW,
    sleep: async () => undefined,
  });

  // Act
  const result = await adapter.measureMatrix!({
    origins: [TEHRAN],
    destinations: [VENUE],
    mode: 'car',
    departureBucket: NOW.toISOString(),
  });

  // Assert
  const outcome = result.outcomes.get('0:0');
  assert.ok(outcome);
  assert.equal(outcome.kind, 'no_route');
  assert.equal(result.resolved, 0);
});

test('an UnknownError pair is the provider\'s own uncertainty', () => {
  // Arrange
  const parsed = parseMatrixResponse(
    {
      status: 'Ok',
      rows: [{ elements: [{ status: 'UnknownError' }] }],
    },
    NOW.toISOString(),
  );

  // Act / Assert
  const outcome = parsed.get('0:0');
  assert.ok(outcome);
  assert.equal(outcome.kind, 'unknown');
});

test('an unrecognised element status is never read as a measurement', () => {
  // Arrange — a status this code has never seen
  const parsed = parseMatrixResponse(
    {
      status: 'Ok',
      rows: [{ elements: [{ status: 'SomethingNew' }] }],
    },
    NOW.toISOString(),
  );

  // Act / Assert
  const outcome = parsed.get('0:0');
  assert.ok(outcome);
  assert.equal(outcome.kind, 'unknown');
});

test('a measured pair carries a high confidence and no range', () => {
  // Arrange
  const parsed = parseMatrixResponse(
    {
      status: 'Ok',
      rows: [
        {
          elements: [
            { status: 'Ok', duration: { value: 600 }, distance: { value: 5000 } },
          ],
        },
      ],
    },
    NOW.toISOString(),
  );

  // Act
  const outcome = parsed.get('0:0');

  // Assert — a live measurement is precise, so it carries no range
  assert.ok(outcome && outcome.kind === 'measured');
  assert.equal(outcome.measurement.minutes, 10);
  assert.equal(outcome.measurement.distanceMeters, 5000);
  assert.equal(outcome.measurement.confidence, 'high');
  assert.equal(outcome.measurement.minutesRange, null);
  assert.equal(outcome.measurement.source, 'neshan_matrix');
  assert.equal(outcome.measurement.fetchedAt, NOW.toISOString());
});

test('a measured pair never reports a zero cost', () => {
  // Arrange
  const parsed = parseMatrixResponse(
    {
      status: 'Ok',
      rows: [
        { elements: [{ status: 'Ok', duration: { value: 600 }, distance: { value: 5000 } }] },
      ],
    },
    NOW.toISOString(),
  );

  // Act / Assert — unknown is unknown, never 0
  const outcome = parsed.get('0:0');
  assert.ok(outcome && outcome.kind === 'measured');
  assert.equal(outcome.measurement.costIrr, null);
});

test('the key is sent as a header, never as a query string', async () => {
  // Arrange
  const calls: Array<{ url: string; init: { method: string; headers: Record<string, string>; body?: string } }> = [];
  const adapter = createNeshanMatrixAdapter({
    transport: recordingTransport(200, matrixBody(['Ok']), calls),
    keys: () => 'super-secret-key',
    now: () => NOW,
    sleep: async () => undefined,
  });

  // Act
  await adapter.measureMatrix!({
    origins: [TEHRAN],
    destinations: [VENUE],
    mode: 'car',
    departureBucket: NOW.toISOString(),
  });

  // Assert — the key is in the header, and NOT in the URL
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.init.headers['Api-Key'], 'super-secret-key');
  assert.ok(!calls[0]!.url.includes('super-secret-key'), 'the key must not be in the URL');
});

test('the origins and destinations are pipe-separated, and the type is car', () => {
  // Arrange / Act
  const url = buildMatrixUrl(
    [{ lat: 35.1, lng: 51.1 }, { lat: 35.2, lng: 51.2 }],
    [{ lat: 35.3, lng: 51.3 }],
    'car',
  );

  // Assert
  assert.ok(url.includes('type=car'));
  assert.ok(url.includes('35.1%2C51.1') || url.includes('35.1,51.1'));
  assert.ok(url.includes('%7C') || url.includes('|'), 'the points must be pipe-separated');
});

test('a 481 degrades immediately with no retry', async () => {
  // Arrange
  let calls = 0;
  const adapter = createNeshanMatrixAdapter({
    transport: async () => {
      calls += 1;
      return { status: 481, body: '{}' };
    },
    keys: () => 'test-key',
    now: () => NOW,
    sleep: async () => undefined,
  });

  // Act
  const result = await adapter.measureMatrix!({
    origins: [TEHRAN],
    destinations: [VENUE],
    mode: 'car',
    departureBucket: NOW.toISOString(),
  });

  // Assert — one call, and no measurement
  assert.equal(calls, 1, 'an exhausted quota must not be retried');
  assert.equal(result.resolved, 0);
  assert.equal(result.outcomes.size, 0);
});

test('a 480 config fault is not retried either', async () => {
  // Arrange
  let calls = 0;
  const adapter = createNeshanMatrixAdapter({
    transport: async () => {
      calls += 1;
      return { status: 480, body: '{}' };
    },
    keys: () => 'test-key',
    now: () => NOW,
    sleep: async () => undefined,
  });

  // Act
  await adapter.measureMatrix!({
    origins: [TEHRAN],
    destinations: [VENUE],
    mode: 'car',
    departureBucket: NOW.toISOString(),
  });

  // Assert — retrying a config fault never helps
  assert.equal(calls, 1);
});

test('a 500 is retried exactly once', async () => {
  // Arrange
  let calls = 0;
  const adapter = createNeshanMatrixAdapter({
    transport: async () => {
      calls += 1;
      return { status: 500, body: '{}' };
    },
    keys: () => 'test-key',
    now: () => NOW,
    sleep: async () => undefined,
  });

  // Act
  await adapter.measureMatrix!({
    origins: [TEHRAN],
    destinations: [VENUE],
    mode: 'car',
    departureBucket: NOW.toISOString(),
  });

  // Assert — one original call and one retry
  assert.equal(calls, 2);
});

test('a 500 that succeeds on the retry is served', async () => {
  // Arrange
  let calls = 0;
  const adapter = createNeshanMatrixAdapter({
    transport: async () => {
      calls += 1;
      return calls === 1
        ? { status: 500, body: '{}' }
        : { status: 200, body: matrixBody(['Ok']) };
    },
    keys: () => 'test-key',
    now: () => NOW,
    sleep: async () => undefined,
  });

  // Act
  const result = await adapter.measureMatrix!({
    origins: [TEHRAN],
    destinations: [VENUE],
    mode: 'car',
    departureBucket: NOW.toISOString(),
  });

  // Assert
  assert.equal(calls, 2);
  assert.equal(result.resolved, 1);
});

test('an absent key declines the adapter rather than calling the provider', async () => {
  // Arrange
  let calls = 0;
  const adapter = createNeshanMatrixAdapter({
    transport: async () => {
      calls += 1;
      return { status: 200, body: matrixBody(['Ok']) };
    },
    keys: () => null,
    now: () => NOW,
    sleep: async () => undefined,
  });

  // Act
  const result = await adapter.measureMatrix!({
    origins: [TEHRAN],
    destinations: [VENUE],
    mode: 'car',
    departureBucket: NOW.toISOString(),
  });

  // Assert — an unconfigured service is skipped, not failed
  assert.equal(calls, 0);
  assert.equal(result.resolved, 0);
});

test('a 200 with an unparseable body is not a measurement', async () => {
  // Arrange
  const adapter = createNeshanMatrixAdapter({
    transport: fixedTransport(200, 'not json at all'),
    keys: () => 'test-key',
    now: () => NOW,
    sleep: async () => undefined,
  });

  // Act
  const result = await adapter.measureMatrix!({
    origins: [TEHRAN],
    destinations: [VENUE],
    mode: 'car',
    departureBucket: NOW.toISOString(),
  });

  // Assert
  assert.equal(result.resolved, 0);
});

test('a transit request is declined, because Neshan has no transit type', async () => {
  // Arrange
  let calls = 0;
  const adapter = createNeshanMatrixAdapter({
    transport: async () => {
      calls += 1;
      return { status: 200, body: matrixBody(['Ok']) };
    },
    keys: () => 'test-key',
    now: () => NOW,
    sleep: async () => undefined,
  });

  // Act / Assert — the adapter does not serve transit
  assert.equal(adapter.supports!('transit'), false);
  assert.equal(adapter.supports!('car'), true);
  assert.equal(adapter.supports!('taxi'), true);
  assert.equal(adapter.supports!('walk'), false);
  assert.equal(calls, 0);
});
