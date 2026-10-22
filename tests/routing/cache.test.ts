/**
 * The travel cache.
 *
 * ★ SERVING STALE DATA SILENTLY IS A LIE.
 *
 * A cache hit beyond its freshness window means `high` becomes `medium`,
 * which renders as «تخمینی» and not «زنده» (PRD-05 §5.5, §8.2).
 *
 * ★ THE CACHE HOLDS NO PERSONAL DATA.
 *
 * The origin is snapped to ~200 m BEFORE the key is built, so the cache is
 * shared across events and cannot become a location store (PRD-09 AS9.2).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  cacheKey,
  createMemoryCacheStore,
  isFresh,
  serveFromCache,
  servedConfidence,
  snapCoordinate,
  ttlFor,
  type CachedMeasurement,
} from '@/src/routing/cache';
import type { TravelMeasurement } from '@/src/routing/types';

const NOW = new Date('2026-08-02T16:00:00.000Z');

/** A cached record with a given confidence and age. */
function recordOf(
  confidence: TravelMeasurement['confidence'],
  ageMs: number,
  _mode = 'car',
): CachedMeasurement {
  const fetchedAt = new Date(NOW.getTime() - ageMs).toISOString();
  return {
    measurement: {
      minutes: 25,
      minutesRange: null,
      distanceMeters: 5000,
      transfers: null,
      walkMinutes: null,
      waitMinutes: null,
      costIrr: null,
      parkingCostIrr: null,
      confidence,
      source: 'neshan_matrix',
      fetchedAt,
    },
    departureBucket: '2026-08-02T16:00:00.000Z',
    fetchedAt,
  };
}

test('the origin is snapped to two decimal places — a ~200 m snap', () => {
  // Arrange / Act
  const snapped = snapCoordinate(35.744812);

  // Assert
  assert.equal(snapped, 35.74);
});

test('the cache key is geography and time, never a user', () => {
  // Arrange / Act
  const key = cacheKey({
    origin: { lat: 35.744812, lng: 51.405043 },
    destination: { lat: 35.7, lng: 51.4 },
    mode: 'car',
    departureBucket: '2026-08-02T16:00:00.000Z',
  });

  // Assert — the origin is snapped to 2 dp; the destination is a public
  // venue and keeps its precision
  assert.ok(key.startsWith('35.74|51.41|'), `expected a snapped origin, got ${key}`);
  assert.ok(key.includes('|35.7|51.4|car|'));
  assert.ok(key.endsWith('2026-08-02T16:00:00.000Z'));
});

test('two members at identical coordinates produce the same key', () => {
  // Arrange / Act
  const first = cacheKey({
    origin: { lat: 35.7448, lng: 51.405 },
    destination: { lat: 35.7, lng: 51.4 },
    mode: 'car',
    departureBucket: 'B',
  });
  const second = cacheKey({
    origin: { lat: 35.7448, lng: 51.405 },
    destination: { lat: 35.7, lng: 51.4 },
    mode: 'car',
    departureBucket: 'B',
  });

  // Assert
  assert.equal(first, second);
});

test('a cache hit within the TTL is served at medium, never at high', () => {
  // Arrange — a record fetched a minute ago
  const record = recordOf('high', 60_000);

  // Act
  const confidence = servedConfidence(record, 'car', NOW);

  // Assert — a cached result is not a live one
  assert.equal(confidence, 'medium');
  assert.notEqual(confidence, 'high');
});

test('a cache hit beyond the TTL is served at low', () => {
  // Arrange — a record fetched two hours ago, and the car TTL is one hour
  const record = recordOf('high', 2 * 60 * 60 * 1000);

  // Act
  const confidence = servedConfidence(record, 'car', NOW);

  // Assert
  assert.equal(confidence, 'low');
});

test('a walking record survives for seven days', () => {
  // Arrange — six days old
  const record = recordOf('high', 6 * 24 * 60 * 60 * 1000);

  // Act / Assert
  assert.equal(servedConfidence(record, 'walk', NOW), 'medium');
  assert.ok(ttlFor('walk') > 6 * 24 * 60 * 60 * 1000);
});

test('a transit record is never served above low, however fresh it is', () => {
  // Arrange — a transit record fetched a second ago
  const record = recordOf('high', 1000, 'transit');

  // Act
  const confidence = servedConfidence(record, 'transit', NOW);

  // Assert — ★ the transit proxy is permanent; its confidence never improves
  assert.equal(confidence, 'low');
  assert.notEqual(confidence, 'medium');
  assert.notEqual(confidence, 'high');
});

test('the original fetchedAt is kept, so the client can say how old the figure is', () => {
  // Arrange
  const record = recordOf('high', 60_000);

  // Act
  const served = serveFromCache(record, 'car', NOW);

  // Assert
  assert.equal(served.fetchedAt, record.fetchedAt);
  assert.notEqual(served.fetchedAt, NOW.toISOString());
});

test('a downgraded measurement carries a range', () => {
  // Arrange — a `high` record with no range
  const record = recordOf('high', 60_000);

  // Act
  const served = serveFromCache(record, 'car', NOW);

  // Assert — a bare integer would read as a measurement
  assert.equal(served.confidence, 'medium');
  assert.notEqual(served.minutesRange, null);
  const range = served.minutesRange!;
  assert.ok(range[0] <= 25 && 25 <= range[1], 'the estimate must be inside the range');
});

test('a downgraded measurement gets a DERIVED range, not a degenerate one', () => {
  // Arrange — a `high` record with no range of its own
  const record = recordOf('high', 60_000);

  // Act
  const served = serveFromCache(record, 'car', NOW);

  // Assert — ★ `[25, 25]` would say "exactly 25 minutes", which is a claim
  // the cache cannot make about a figure it has downgraded
  const range = served.minutesRange!;
  assert.ok(range[0] < range[1], 'the range must have a width');
  assert.ok(range[0] < 25, 'the lower bound must be below the estimate');
  assert.ok(range[1] > 25, 'the upper bound must be above the estimate');
});

test('a record\'s own range is preserved when it has one', () => {
  // Arrange — a record with a real range
  const record = recordOf('medium', 60_000);
  record.measurement.minutesRange = [18, 32];

  // Act
  const served = serveFromCache(record, 'car', NOW);

  // Assert
  assert.deepEqual(served.minutesRange, [18, 32]);
});

test('the cache key snaps the destination to the column precision', () => {
  // Arrange — a venue at 6 decimal places
  const key = cacheKey({
    origin: { lat: 35.7448, lng: 51.405 },
    destination: { lat: 35.123456, lng: 51.654321 },
    mode: 'car',
    departureBucket: 'B',
  });

  // Assert — ★ the key's precision must not exceed the column's, or the
  // lookup compares `35.123456` against a stored `35.12346` and the cache
  // never hits
  const parts = key.split('|');
  assert.equal(parts[2], '35.12346');
  assert.equal(parts[3], '51.65432');
});

test('two venues inside the column precision share a cache key', () => {
  // Arrange / Act — venues 2 m apart
  const first = cacheKey({
    origin: { lat: 35.7448, lng: 51.405 },
    destination: { lat: 35.123451, lng: 51.654321 },
    mode: 'car',
    departureBucket: 'B',
  });
  const second = cacheKey({
    origin: { lat: 35.7448, lng: 51.405 },
    destination: { lat: 35.123449, lng: 51.654321 },
    mode: 'car',
    departureBucket: 'B',
  });

  // Assert — the unique constraint compares the ROUNDED value, so the key
  // must too, or two venues collide in the table
  assert.equal(first, second);
});

test('a fresh record is fresh, and a stale one is not', () => {
  // Arrange / Act / Assert
  assert.equal(isFresh(recordOf('high', 60_000), 'car', NOW), true);
  assert.equal(isFresh(recordOf('high', 2 * 60 * 60 * 1000), 'car', NOW), false);
});

test('a record with an unreadable timestamp is stale', () => {
  // Arrange
  const record: CachedMeasurement = {
    ...recordOf('high', 0),
    fetchedAt: 'not a date',
  };

  // Act / Assert
  assert.equal(isFresh(record, 'car', NOW), false);
});

test('a second identical request is a cache hit', async () => {
  // Arrange
  const store = createMemoryCacheStore();
  const key = cacheKey({
    origin: { lat: 35.7448, lng: 51.405 },
    destination: { lat: 35.7, lng: 51.4 },
    mode: 'car',
    departureBucket: '2026-08-02T16:00:00.000Z',
  });

  // Act — the first request misses
  const miss = await store.get(key);
  await store.set(key, recordOf('high', 0));
  const hit = await store.get(key);

  // Assert
  assert.equal(miss, null);
  assert.ok(hit);
  assert.equal(hit.measurement.confidence, 'high');
});

test('the cache key carries no personal data', () => {
  // Arrange / Act
  const key = cacheKey({
    origin: { lat: 35.7448, lng: 51.405 },
    destination: { lat: 35.7, lng: 51.4 },
    mode: 'car',
    departureBucket: '2026-08-02T16:00:00.000Z',
  });

  // Assert — six components, all geography or time
  assert.equal(key.split('|').length, 6);
  assert.ok(!/participant|user|p_\w+/i.test(key));
});
