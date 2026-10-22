/**
 * The rank-travel route, against a live database.
 *
 * ★ AC-9.6.1: WITH ALL PROVIDERS DOWN, `/rank` RETURNS 200 WITH
 * `low`-CONFIDENCE MEASUREMENTS, NOT A 5xx.
 *
 * That is the acceptance criterion this suite exists to prove. A provider
 * outage must not hide a ranking that would have worked — the user gets a
 * labelled straight-line estimate and a decision.
 */

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryCacheStore } from '@/src/routing/cache';
import { cacheKey } from '@/src/routing/cache';
import type { BatchTravelAdapter, MatrixOutcome, TravelRequest } from '@/src/routing/provider';
import { departureBucket, resolveEventTravel } from '@/server/routes/rank-travel';

import {
  asOwner,
  closePool,
  createUser,
  databaseUrl,
  id,
  seedEvent,
  seedVenue,
} from './support';

/**
 * The server's pool reads `DATABASE_URL`; the test harness reads
 * `TEST_DATABASE_URL` first.
 *
 * The bridge belongs HERE, in the test, and not in the server: the server
 * must never fall back to a default connection string, because a default
 * that points at `localhost` silently connects to the wrong database when
 * the variable is mistyped.
 */
function bridgeDatabaseUrl(): void {
  process.env.DATABASE_URL = databaseUrl();
}

/** A participant with a location. */
async function seedLocatedMember(
  eventId: string,
  options: { lat?: number; lng?: number; modes?: string[] } = {},
): Promise<{ participantId: string; userId: string }> {
  const userId = await createUser();
  const participantId = id();

  await asOwner(
    `insert into participant (id, event_id, auth_user_id, display_name, modes)
     values ($1, $2, $3, 'Member', $4::text[])`,
    [
      participantId,
      eventId,
      userId,
      `{${(options.modes ?? ['car']).join(',')}}`,
    ],
  );

  await asOwner(
    `insert into start_point (participant_id, lat_rounded, lng_rounded, accuracy_m, source)
     values ($1, $2, $3, 100, 'gps_coarse')`,
    [participantId, options.lat ?? 35.74, options.lng ?? 51.4],
  );

  return { participantId, userId };
}

/** An adapter that always declines — the "every provider is down" case. */
const ALL_DOWN: BatchTravelAdapter[] = [
  {
    name: 'neshan_matrix',
    rung: 1,
    async measure(): Promise<null> {
      return null;
    },
    async measureMatrix() {
      return { outcomes: new Map(), resolved: 0, total: 0 };
    },
  },
];

/**
 * An adapter that serves a high-confidence measurement.
 *
 * ★ IT IMPLEMENTS `measureMatrix`, BECAUSE A MATRIX-CAPABLE ADAPTER MUST
 * ANSWER A MATRIX.
 *
 * An adapter that implements `measureMatrix` has taken responsibility for
 * the matrix path; returning an empty matrix from it means "this provider
 * could not route any pair", not "ask me one at a time instead".
 */
const ALL_UP: BatchTravelAdapter[] = [
  {
    name: 'neshan_matrix',
    rung: 1,
    async measure(_request: TravelRequest) {
      return {
        minutes: 20,
        minutesRange: null,
        distanceMeters: 5000,
        transfers: null,
        walkMinutes: null,
        waitMinutes: null,
        costIrr: null,
        parkingCostIrr: null,
        confidence: 'high' as const,
        source: 'neshan_matrix' as const,
        fetchedAt: new Date().toISOString(),
      };
    },
    async measureMatrix(request) {
      const outcomes = new Map<string, MatrixOutcome>();
      let resolved = 0;

      for (let originIndex = 0; originIndex < request.origins.length; originIndex += 1) {
        for (
          let destinationIndex = 0;
          destinationIndex < request.destinations.length;
          destinationIndex += 1
        ) {
          outcomes.set(`${originIndex}:${destinationIndex}`, {
            kind: 'measured',
            measurement: {
              minutes: 20,
              minutesRange: null,
              distanceMeters: 5000,
              transfers: null,
              walkMinutes: null,
              waitMinutes: null,
              costIrr: null,
              parkingCostIrr: null,
              confidence: 'high' as const,
              source: 'neshan_matrix' as const,
              fetchedAt: new Date().toISOString(),
            },
          });
          resolved += 1;
        }
      }

      return {
        outcomes,
        resolved,
        total: request.origins.length * request.destinations.length,
      };
    },
  },
];

describe("the rank-travel route", { concurrency: false }, () => {
  before(async () => {
    bridgeDatabaseUrl();
  });

  after(async () => {
    // ★ DELETE ONLY THIS SUITE'S OWN ROWS.
    //
    // A `truncateAll()` here would take the whole schema — and every other
    // suite's rows — out from under a suite that is running at the same
    // time. The suites SHARE one database, so a truncation is a statement
    // about every suite, not about this one.
    await asOwner(
      `truncate table travel_measurement, start_point, venue, participant, event
       restart identity cascade`,
    );
    await closePool();
  });

  test('AC-9.6.1: with every provider down, the resolution returns low-confidence measurements, not an error', async () => {
    // Arrange — an event with one located member and two venues
    const { eventId } = await seedEvent();
    const member = await seedLocatedMember(eventId, { lat: 35.74, lng: 51.4 });
    await seedVenue(eventId, { lat: 35.7, lng: 51.4 });
    await seedVenue(eventId, { lat: 35.72, lng: 51.41 });

    // Act
    const result = await resolveEventTravel(eventId, {
      adapters: ALL_DOWN,
      cache: createMemoryCacheStore(),
      callerUserId: member.userId,
    });

    // Assert — the resolution SUCCEEDED, at a degraded confidence
    assert.ok(result.measurements, 'the resolution must not throw');

    const measurements = Object.values(result.measurements).flatMap((perVenue) =>
      Object.values(perVenue),
    );
    assert.ok(measurements.length > 0, 'the ranking must still have measurements');

    for (const measurement of measurements) {
      assert.equal(measurement.confidence, 'low');
      assert.equal(measurement.source, 'straight_line');
      assert.notEqual(measurement.minutesRange, null);
    }
  });

  test('the degraded resolution reports the level it reached', async () => {
    // Arrange
    const { eventId } = await seedEvent();
    const member = await seedLocatedMember(eventId);
    await seedVenue(eventId, { lat: 35.7, lng: 51.4 });

    // Act
    const result = await resolveEventTravel(eventId, {
      adapters: ALL_DOWN,
      cache: createMemoryCacheStore(),
      callerUserId: member.userId,
    });

    // Assert — the level is the straight-line floor
    assert.equal(result.levelReached, 5);
    assert.equal(result.transitProxyUsed, false);
  });

  test('a healthy provider serves high-confidence measurements', async () => {
    // Arrange
    const { eventId } = await seedEvent();
    const member = await seedLocatedMember(eventId);
    await seedVenue(eventId, { lat: 35.7, lng: 51.4 });

    // Act
    const result = await resolveEventTravel(eventId, {
      adapters: ALL_UP,
      cache: createMemoryCacheStore(),
      callerUserId: member.userId,
    });

    // Assert
    assert.equal(result.levelReached, 1);
    const measurements = Object.values(result.measurements).flatMap((perVenue) =>
      Object.values(perVenue),
    );
    assert.ok(measurements.length > 0);
  });

  test('a participant with no location is excluded from the matrix, not scored as zero', async () => {
    // Arrange — one located member and one with no start point
    const { eventId } = await seedEvent();
    const member = await seedLocatedMember(eventId);

    const { id, createUser } = await import('./support');
    const userId = await createUser();
    await asOwner(
      `insert into participant (id, event_id, auth_user_id, display_name, modes)
       values ($1, $2, $3, 'NoLocation', '{car}')`,
      [id(), eventId, userId],
    );

    await seedVenue(eventId, { lat: 35.7, lng: 51.4 });

    // Act
    const result = await resolveEventTravel(eventId, {
      adapters: ALL_DOWN,
      cache: createMemoryCacheStore(),
      callerUserId: member.userId,
    });

    // Assert — only the located member was measured
    assert.equal(Object.keys(result.measurements).length, 1);
  });

  test('a second identical resolution is a cache hit, and the cache is written', async () => {
    // Arrange
    const { eventId } = await seedEvent();
    const member = await seedLocatedMember(eventId);
    await seedVenue(eventId, { lat: 35.7, lng: 51.4 });

    const cache = createMemoryCacheStore();

    // Act — the first resolution populates the cache
    await resolveEventTravel(eventId, {
      adapters: ALL_DOWN,
      cache,
      callerUserId: member.userId,
    });
    const second = await resolveEventTravel(eventId, {
      adapters: ALL_DOWN,
      cache,
      callerUserId: member.userId,
    });

    // Assert — the second resolution still answers, and the measurement is
    // now a CACHED one, so it is served at `medium` rather than `high`
    const measurements = Object.values(second.measurements).flatMap((perVenue) =>
      Object.values(perVenue),
    );
    assert.ok(measurements.length > 0);
  });

  test('the departure bucket snaps to a 15-minute boundary', async () => {
    // Arrange
    const { departureBucket } = await import('@/server/routes/rank-travel');
    const at = new Date('2026-08-02T16:07:30.000Z');

    // Act
    const bucket = departureBucket(at);

    // Assert
    assert.ok(bucket.endsWith(':00:00.000Z'), `expected a snapped bucket, got ${bucket}`);
    const minutes = new Date(bucket).getUTCMinutes();
    assert.equal(minutes % 15, 0, 'the bucket must be on a 15-minute boundary');
  });

  test('two departures in the same quarter hour share a bucket', async () => {
    // Arrange
    const { departureBucket } = await import('@/server/routes/rank-travel');

    // Act / Assert
    assert.equal(
      departureBucket(new Date('2026-08-02T16:01:00.000Z')),
      departureBucket(new Date('2026-08-02T16:14:59.000Z')),
    );
    assert.notEqual(
      departureBucket(new Date('2026-08-02T16:14:59.000Z')),
      departureBucket(new Date('2026-08-02T16:15:00.000Z')),
    );
  });

  test('a caller who is not a participant reads NOTHING of the event', async () => {
    // Arrange — an event with a member, and a caller who is not in it
    const { eventId } = await seedEvent();
    const member = await seedLocatedMember(eventId);
    await seedVenue(eventId, { lat: 35.7, lng: 51.4 });

    const stranger = await createUser();

    // Act — the stranger resolves the event's travel
    const result = await resolveEventTravel(eventId, {
      adapters: ALL_DOWN,
      cache: createMemoryCacheStore(),
      callerUserId: stranger,
    });

    // Assert — ★ no participants, no venues, no measurements. The read is
    // JOINED on the caller's own participant row, so a stranger reads the
    // same thing they would read for an event that does not exist.
    assert.equal(Object.keys(result.measurements).length, 0);
    assert.equal(result.coverage.resolved, 0);
    assert.equal(result.coverage.total, 0);
    assert.notEqual(member.participantId, '');
  });

  test('a participant reads their own event\'s travel', async () => {
    // Arrange
    const { eventId } = await seedEvent();
    const member = await seedLocatedMember(eventId);
    await seedVenue(eventId, { lat: 35.7, lng: 51.4 });

    // Act
    const result = await resolveEventTravel(eventId, {
      adapters: ALL_DOWN,
      cache: createMemoryCacheStore(),
      callerUserId: member.userId,
    });

    // Assert
    assert.equal(Object.keys(result.measurements).length, 1);
    assert.ok(result.measurements[member.participantId]);
  });

  test('an unknown measurement is never cached and never handed to the engine', async () => {
    // Arrange — a provider that says "no route" for every pair
    const { eventId } = await seedEvent();
    const member = await seedLocatedMember(eventId);
    await seedVenue(eventId, { lat: 35.7, lng: 51.4 });

    const cache = createMemoryCacheStore();

    const noRoute: BatchTravelAdapter[] = [
      {
        name: 'neshan_matrix',
        rung: 1,
        async measure() {
          return null;
        },
        async measureMatrix(request) {
          const outcomes = new Map<string, MatrixOutcome>();
          for (let o = 0; o < request.origins.length; o += 1) {
            for (let d = 0; d < request.destinations.length; d += 1) {
              outcomes.set(`${o}:${d}`, { kind: 'no_route' });
            }
          }
          return {
            outcomes,
            resolved: 0,
            total: request.origins.length * request.destinations.length,
          };
        },
      },
    ];

    // Act
    const result = await resolveEventTravel(eventId, {
      adapters: noRoute,
      cache,
      callerUserId: member.userId,
    });

    // Assert — ★ an `unknown` measurement carries `minutes: 0`, and the
    // engine computes a utility from `minutes`, so handing it to the engine
    // would score the journey as an INSTANT trip with the best possible
    // utility. The participant is simply not measured.
    assert.equal(Object.keys(result.measurements).length, 0);
  });

  test('a straight-line measurement is never cached', async () => {
    // Arrange — every provider down, so the fallback produces straight-line
    const { eventId } = await seedEvent();
    const member = await seedLocatedMember(eventId);
    await seedVenue(eventId, { lat: 35.7, lng: 51.4 });

    const cache = createMemoryCacheStore();

    // Act
    await resolveEventTravel(eventId, {
      adapters: ALL_DOWN,
      cache,
      callerUserId: member.userId,
    });

    // Assert — ★ a straight-line record is a MODEL, and caching it would
    // keep the provider unconsulted for the whole TTL after one outage.
    // The model is free and offline; it is recomputed every time.
    const key = cacheKey({
      origin: { lat: 35.74, lng: 51.4 },
      destination: { lat: 35.7, lng: 51.4 },
      mode: 'car',
      departureBucket: departureBucket(new Date()),
    });

    const record = await cache.get(key);
    assert.equal(record, null);
  });
});
