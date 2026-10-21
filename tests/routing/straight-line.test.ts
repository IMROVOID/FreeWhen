import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getTravelTime, noEstimate, straightLine } from '@/src/routing';
import { estimateStraightLine, haversineMeters } from '@/src/routing/adapters/straight-line';
import { DETOUR_FACTOR, MODE_SPEED_KMH } from '@/src/routing/config';
import type { TransportMode } from '@/src/routing/types';

const TEHRAN = { lat: 35.6892, lng: 51.3890 };
const NEARBY = { lat: 35.7000, lng: 51.4000 };
const FAR = { lat: 36.3000, lng: 51.6000 };

const NOW = new Date('2026-08-02T12:00:00Z');

test('computes the haversine distance between two points', () => {
  // Act
  const distance = haversineMeters(TEHRAN, NEARBY);

  // Assert — roughly 1.6 km, allowing for the spherical approximation
  assert.ok(distance > 1200 && distance < 2000, `expected ~1600m, got ${distance}`);
});

test('returns zero for the same point', () => {
  // Act / Assert
  assert.equal(Math.round(haversineMeters(TEHRAN, TEHRAN)), 0);
});

test('is deterministic for the same input', () => {
  // Act
  const first = estimateStraightLine({ from: TEHRAN, to: NEARBY, mode: 'car', now: NOW });
  const second = estimateStraightLine({ from: TEHRAN, to: NEARBY, mode: 'car', now: NOW });

  // Assert
  assert.deepEqual(first, second);
});

test('returns low confidence and the straight_line source for every mode', () => {
  // Act
  const modes: TransportMode[] = ['car', 'transit', 'walk', 'cycle', 'taxi'];
  const results = modes.map((mode) =>
    estimateStraightLine({ from: TEHRAN, to: NEARBY, mode, now: NOW }),
  );

  // Assert
  for (const result of results) {
    assert.equal(result.confidence, 'low');
    assert.equal(result.source, 'straight_line');
  }
});

test('never returns high or medium confidence for transit', () => {
  // Act — a short trip is the input most likely to tempt a higher confidence
  const shortTrip = estimateStraightLine({ from: TEHRAN, to: NEARBY, mode: 'transit', now: NOW });

  // Assert
  assert.equal(shortTrip.confidence, 'low');
  assert.notEqual(shortTrip.confidence, 'high');
  assert.notEqual(shortTrip.confidence, 'medium');
});

test('leaves costIrr null rather than zero', () => {
  // Act
  const result = estimateStraightLine({ from: TEHRAN, to: NEARBY, mode: 'car', now: NOW });

  // Assert — unknown cost must never read as free
  assert.equal(result.costIrr, null);
  assert.equal(result.parkingCostIrr, null);
});

test('always carries a minutes range', () => {
  // Act
  const result = estimateStraightLine({ from: TEHRAN, to: FAR, mode: 'car', now: NOW });

  // Assert
  assert.notEqual(result.minutesRange, null);
  const range = result.minutesRange as [number, number];
  assert.ok(range[0] <= result.minutes);
  assert.ok(result.minutes <= range[1]);
});

test('applies the detour factor to the straight-line distance', () => {
  // Act
  const result = estimateStraightLine({ from: TEHRAN, to: NEARBY, mode: 'car', now: NOW });

  // Assert
  const expected = Math.round(haversineMeters(TEHRAN, NEARBY) * DETOUR_FACTOR);
  assert.equal(result.distanceMeters, expected);
});

test('adds the fixed walk access time to a transit journey', () => {
  // Act
  const transit = estimateStraightLine({ from: TEHRAN, to: NEARBY, mode: 'transit', now: NOW });
  const car = estimateStraightLine({ from: TEHRAN, to: NEARBY, mode: 'car', now: NOW });

  // Assert — transit is slower than driving over the same distance
  assert.ok(transit.minutes > car.minutes);
  assert.equal(transit.walkMinutes, 8);
});

test('scales the estimate with the assumed mode speed', () => {
  // Act
  const walk = estimateStraightLine({ from: TEHRAN, to: FAR, mode: 'walk', now: NOW });
  const cycle = estimateStraightLine({ from: TEHRAN, to: FAR, mode: 'cycle', now: NOW });

  // Assert — walking is slower than cycling over the same distance
  assert.ok(walk.minutes > cycle.minutes);
  assert.ok(MODE_SPEED_KMH.walk < MODE_SPEED_KMH.cycle);
});

test('reports the distance covered and the time taken consistently', () => {
  // Act
  const result = estimateStraightLine({ from: TEHRAN, to: FAR, mode: 'car', now: NOW });

  // Assert — minutes ≈ distance / speed, with the speed in km/h
  const expectedMinutes = (result.distanceMeters / 1000 / MODE_SPEED_KMH.car) * 60;
  assert.ok(Math.abs(result.minutes - expectedMinutes) <= 1);
});

test('the ladder entrypoint returns a low-confidence straight-line measurement', async () => {
  // Act
  const result = await getTravelTime(TEHRAN, NEARBY, 'transit', NOW);

  // Assert
  assert.equal(result.confidence, 'low');
  assert.equal(result.source, 'straight_line');
  assert.equal(result.costIrr, null);
  assert.notEqual(result.minutesRange, null);
});

test('the ladder entrypoint is deterministic', async () => {
  // Act
  const first = await getTravelTime(TEHRAN, NEARBY, 'car', NOW);
  const second = await getTravelTime(TEHRAN, NEARBY, 'car', NOW);

  // Assert
  assert.deepEqual(first, second);
});

test('the no-estimate rung reports unknown confidence and a null cost', async () => {
  // Act
  const result = await noEstimate.measure(TEHRAN, NEARBY, 'car', NOW);

  // Assert
  assert.ok(result);
  assert.equal(result.confidence, 'unknown');
  assert.equal(result.source, 'none');
  assert.equal(result.costIrr, null);
});

test('the straight-line adapter is registered on the ladder', () => {
  // Act / Assert
  assert.equal(straightLine.name, 'straight_line');
});
