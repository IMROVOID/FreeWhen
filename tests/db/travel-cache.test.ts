/**
 * The database-backed travel cache.
 *
 * ★ THE KEY'S PRECISION MUST MATCH THE COLUMN'S, OR THE CACHE NEVER HITS.
 *
 * `travel_measurement.dest_lat` is `numeric(7,5)` and `venue.lat` is
 * `numeric(9,6)`, so the column ROUNDS on insert. A lookup with the
 * un-rounded value compares `35.123456` against a stored `35.12346` and
 * matches nothing — so the cache would never hit, and every request would
 * re-spend provider quota on the one thing the cache exists to prevent.
 *
 * These tests run against a live database, because the rounding happens in
 * PostgreSQL and not in the client.
 */

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { cacheKey, serveFromCache } from '@/src/routing/cache';
import { createDatabaseCacheStore } from '@/server/lib/travel-cache';

import { asOwner, closePool, databaseUrl } from './support';

const BUCKET = '2026-08-02T16:00:00.000Z';
const ORIGIN = { lat: 35.74, lng: 51.4 };

/** The server's pool reads DATABASE_URL; the harness reads TEST_DATABASE_URL. */
function bridgeDatabaseUrl(): void {
  process.env.DATABASE_URL = databaseUrl();
}

describe('the travel cache', { concurrency: false }, () => {
  before(async () => {
    bridgeDatabaseUrl();
  });

  after(async () => {
    // ★ DELETE ONLY THIS SUITE'S OWN ROWS.
    //
    // A `truncateAll()` here would take the whole table — and every other
    // suite's rows — out from under a suite that is running at the same
    // time. The suites SHARE one database, so a truncation is a statement
    // about every suite, not about this one.
    await asOwner(`delete from travel_measurement`);
    await closePool();
  });

  test('a measurement written to the cache is found again', async () => {
    // Arrange
    const store = createDatabaseCacheStore();
    const destination = { lat: 35.123456, lng: 51.654321 };
    const key = cacheKey({
      origin: ORIGIN,
      destination,
      mode: 'car',
      departureBucket: BUCKET,
    });

    const measurement = {
      minutes: 22,
      minutesRange: null,
      distanceMeters: 5000,
      transfers: null,
      walkMinutes: null,
      waitMinutes: null,
      costIrr: null,
      parkingCostIrr: null,
      confidence: 'high' as const,
      source: 'neshan_matrix' as const,
      fetchedAt: BUCKET,
    };

    // Act
    await store.set(key, { measurement, departureBucket: BUCKET, fetchedAt: BUCKET });
    const found = await store.get(key);

    // Assert — ★ the cache HITS. Before the precision fix this was always
    // null, because the key carried 6 decimals and the column stored 5.
    assert.ok(found, 'the cache must find what it stored');
    assert.equal(found.measurement.minutes, 22);
    assert.equal(found.measurement.confidence, 'high');
    assert.equal(found.measurement.source, 'neshan_matrix');
    assert.equal(found.measurement.costIrr, null);
  });

  test('the stored origin is snapped, and the record holds no user id', async () => {
    // Arrange
    const store = createDatabaseCacheStore();
    const key = cacheKey({
      origin: { lat: 35.744812, lng: 51.405043 },
      destination: { lat: 35.7, lng: 51.4 },
      mode: 'car',
      departureBucket: BUCKET,
    });

    const measurement = {
      minutes: 15,
      minutesRange: null,
      distanceMeters: 3000,
      transfers: null,
      walkMinutes: null,
      waitMinutes: null,
      costIrr: null,
      parkingCostIrr: null,
      confidence: 'high' as const,
      source: 'neshan_matrix' as const,
      fetchedAt: BUCKET,
    };

    // Act
    await store.set(key, { measurement, departureBucket: BUCKET, fetchedAt: BUCKET });

    const rows = await asOwner(
      `select origin_lat::text, origin_lng::text, dest_lat::text, dest_lng::text,
              mode, departure_bucket, confidence, source
         from travel_measurement
        where dest_lat = $1`,
      [35.7],
    );

    // Assert — ★ the origin is snapped to 2 dp (~200 m) and the row carries
    // NO user id: the table is shared across events and must contain no
    // personal data
    assert.equal(rows.rows.length, 1);
    const row = rows.rows[0] as Record<string, string>;

    // The `numeric` columns pad to their own scale, so the comparison is
    // numeric rather than textual.
    assert.equal(Number(row.origin_lat), 35.74);
    assert.equal(Number(row.origin_lng), 51.41);
    assert.equal(Number(row.dest_lat), 35.7);
    assert.equal(row.mode, 'car');
    assert.equal(row.confidence, 'high');
    assert.equal(row.source, 'neshan_matrix');

    for (const column of Object.keys(row)) {
      assert.ok(
        !/user|participant|auth/i.test(column),
        `the row must not carry a user identifier: ${column}`,
      );
    }
  });

  test('a cached record is served at medium, never at high', async () => {
    // Arrange
    const store = createDatabaseCacheStore();
    const destination = { lat: 35.5, lng: 51.6 };
    const key = cacheKey({
      origin: ORIGIN,
      destination,
      mode: 'car',
      departureBucket: BUCKET,
    });

    const measurement = {
      minutes: 30,
      minutesRange: null,
      distanceMeters: 7000,
      transfers: null,
      walkMinutes: null,
      waitMinutes: null,
      costIrr: null,
      parkingCostIrr: null,
      confidence: 'high' as const,
      source: 'neshan_matrix' as const,
      fetchedAt: BUCKET,
    };

    await store.set(key, { measurement, departureBucket: BUCKET, fetchedAt: BUCKET });

    // Act
    const found = await store.get(key);
    assert.ok(found);

    const served = serveFromCache(found, 'car', new Date(BUCKET));

    // Assert — a cached result is not a live one
    assert.equal(served.confidence, 'medium');
    assert.notEqual(served.minutesRange, null);
  });

  test('a null cost is stored as null, never as zero', async () => {
    // Arrange
    const store = createDatabaseCacheStore();
    const key = cacheKey({
      origin: ORIGIN,
      destination: { lat: 35.6, lng: 51.7 },
      mode: 'car',
      departureBucket: BUCKET,
    });

    const measurement = {
      minutes: 12,
      minutesRange: null,
      distanceMeters: 2000,
      transfers: null,
      walkMinutes: null,
      waitMinutes: null,
      costIrr: null,
      parkingCostIrr: null,
      confidence: 'high' as const,
      source: 'neshan_matrix' as const,
      fetchedAt: BUCKET,
    };

    // Act
    await store.set(key, { measurement, departureBucket: BUCKET, fetchedAt: BUCKET });

    const rows = await asOwner(
      `select cost_irr from travel_measurement where dest_lat = $1`,
      [35.6],
    );

    // Assert — ★ a zero cost would make a venue falsely "cheapest"
    assert.equal(rows.rows.length, 1);
    assert.equal((rows.rows[0] as Record<string, unknown>).cost_irr, null);
  });
});
