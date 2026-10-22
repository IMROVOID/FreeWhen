/**
 * The straight-line pre-filter.
 *
 * ★ THE DISTANCE IS THE MINIMUM, NOT THE MEAN.
 *
 * A venue 30 km from one member and 2 km from the rest is legitimate, and
 * must survive. A venue 30 km from EVERYONE is not, and must be dropped.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CANDIDATE_CAP, PRE_FILTER_MAX_KM } from '@/src/routing/config';
import { haversineMeters } from '@/src/routing/adapters/straight-line';
import { nearestOriginMeters, prefilterDestinations } from '@/src/routing/prefilter';

const TEHRAN = { lat: 35.7448, lng: 51.405 };

/** A point roughly `km` kilometres north of Tehran. */
function northOf(km: number): { lat: number; lng: number } {
  return { lat: TEHRAN.lat + km / 111, lng: TEHRAN.lng };
}

test('a venue nobody can reach is dropped', () => {
  // Arrange — one member, a venue 30 km away
  const result = prefilterDestinations(
    [{ lat: TEHRAN.lat, lng: TEHRAN.lng }],
    [{ id: 'v_far', ...northOf(30) }],
  );

  // Assert
  assert.equal(result.kept.length, 0);
  assert.equal(result.dropped.length, 1);
  assert.equal(result.dropped[0]!.destination.id, 'v_far');
});

test('a venue 30 km from ONE member survives, because the others are close', () => {
  // Arrange — one member 30 km away, one member 2 km away
  const result = prefilterDestinations(
    [
      { lat: northOf(30).lat, lng: northOf(30).lng },
      { lat: northOf(2).lat, lng: northOf(2).lng },
    ],
    [{ id: 'v_mixed', ...northOf(30) }],
  );

  // Assert — ★ the MINIMUM, not the mean
  assert.equal(result.kept.length, 1);
  assert.equal(result.dropped.length, 0);
});

test('the minimum is used, not the mean', () => {
  // Arrange — a destination 30 km north, and two origins: one 5 km away
  // and one 28 km away. The minimum is 5 km; the mean would be 16.5 km.
  const destination = northOf(30);
  const near = northOf(25);
  const far = northOf(2);

  // Act
  const nearest = nearestOriginMeters(destination, [near, far]);

  // Assert — the distance to the CLOSEST origin, not the mean
  const expected = haversineMeters(near, destination);
  const mean = (expected + haversineMeters(far, destination)) / 2;

  assert.ok(
    Math.abs(nearest - expected) < 1000,
    `expected ~${expected}, got ${nearest}`,
  );
  assert.ok(
    nearest < mean * 0.5,
    `the minimum (${nearest}) must be well under the mean (${mean})`,
  );
});

test('a venue just inside the radius survives', () => {
  // Arrange — 20 km away, the radius is 25 km
  const result = prefilterDestinations(
    [{ lat: TEHRAN.lat, lng: TEHRAN.lng }],
    [{ id: 'v_near', ...northOf(20) }],
  );

  // Assert
  assert.equal(result.kept.length, 1);
  assert.equal(result.dropped.length, 0);
});

test('a venue just outside the radius is dropped', () => {
  // Arrange — 30 km away, the radius is 25 km
  const result = prefilterDestinations(
    [{ lat: TEHRAN.lat, lng: TEHRAN.lng }],
    [{ id: 'v_far', ...northOf(30) }],
  );

  // Assert
  assert.equal(result.kept.length, 0);
  assert.equal(PRE_FILTER_MAX_KM, 25);
});

test('with no origins, nothing is dropped', () => {
  // Arrange — absence of a location is not a rejection
  const result = prefilterDestinations([], [{ id: 'v_any', ...northOf(500) }]);

  // Assert
  assert.equal(result.kept.length, 1);
  assert.equal(result.dropped.length, 0);
});

test('the candidate cap keeps the nearest candidates', () => {
  // Arrange — 20 nearby venues, the cap is 15
  const venues = Array.from({ length: 20 }, (_, index) => ({
    id: `v_${index}`,
    ...northOf(index + 1),
  }));

  // Act
  const result = prefilterDestinations(
    [{ lat: TEHRAN.lat, lng: TEHRAN.lng }],
    venues,
  );

  // Assert — the nearest fifteen survive
  assert.equal(result.kept.length, CANDIDATE_CAP);
  assert.equal(CANDIDATE_CAP, 15);

  const keptIds = result.kept.map((venue) => venue.id);
  assert.ok(keptIds.includes('v_0'), 'the nearest must survive');
  assert.ok(!keptIds.includes('v_19'), 'the furthest must be capped away');
});

test('the cap is applied AFTER the distance cut, so it keeps the nearest', () => {
  // Arrange — 10 unreachable venues and 20 reachable ones
  const unreachable = Array.from({ length: 10 }, (_, index) => ({
    id: `far_${index}`,
    ...northOf(40 + index),
  }));
  const reachable = Array.from({ length: 20 }, (_, index) => ({
    id: `near_${index}`,
    ...northOf(index + 1),
  }));

  // Act
  const result = prefilterDestinations(
    [{ lat: TEHRAN.lat, lng: TEHRAN.lng }],
    [...unreachable, ...reachable],
  );

  // Assert
  assert.equal(result.kept.length, CANDIDATE_CAP);
  assert.ok(result.kept.every((venue) => venue.id.startsWith('near_')));
  assert.equal(result.dropped.length, 10 + 5);
});

test('the pre-filter produces a distance, never a displayed time', () => {
  // Arrange / Act
  const result = prefilterDestinations(
    [{ lat: TEHRAN.lat, lng: TEHRAN.lng }],
    [{ id: 'v_1', ...northOf(5) }],
  );

  // Assert — the result carries a DISTANCE and no travel time at all
  assert.ok(result.nearestMetersById.get('v_1')! > 0);
  assert.ok(!('minutes' in result));
  assert.ok(!('minutesRange' in result));
});
