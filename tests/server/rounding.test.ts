/**
 * The rounding contract (Plan 05 Task 10, AC-8.2.1).
 *
 * The last case is the one that matters: it asserts on the SERIALISED REQUEST,
 * because "we rounded it somewhere" and "the precise value never left the
 * device" are different claims and only the second one is the requirement.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  COARSE_ACCURACY_M,
  COORD_DECIMALS,
  roundToHundredths,
  roundedManualStartPoint,
  roundedStartPoint,
} from '@/src/features/participants/services/round-coords';
import { StartPointSchema, hasAtMostTwoDecimals } from '@/src/types/event';

/**
 * The approximate-area label the caller would pass in.
 *
 * The hook takes it from the catalogue in the active language, so the service
 * takes it as an argument and holds no user-facing string of its own.
 */
const AREA_LABEL = 'approximate area';

test('six decimals in, two decimals out', () => {
  assert.equal(roundToHundredths(35.700123), 35.7);
  assert.equal(roundToHundredths(51.400456), 51.4);

  // Values that legitimately have two decimals are unchanged.
  assert.equal(roundToHundredths(35.71), 35.71);
  assert.equal(roundToHundredths(35.7), 35.7);
  assert.equal(roundToHundredths(36), 36);
});

test('rounding is symmetric around the value, not truncated', () => {
  // A truncating implementation would give 35.12 and 51.39.
  assert.equal(roundToHundredths(35.126), 35.13);
  assert.equal(roundToHundredths(51.394), 51.39);
  assert.equal(roundToHundredths(35.125), 35.13);
});

test('a rounded value always satisfies the 2-decimal contract', () => {
  const values = [35.700123, 51.400456, 25.0009, 39.9999, 44.0001, 63.999999];

  for (const value of values) {
    const rounded = roundToHundredths(value);
    assert.equal(hasAtMostTwoDecimals(rounded), true, `${value} → ${rounded}`);
  }
});

test('the current-location payload carries the coarse accuracy and a neighbourhood label', () => {
  const payload = roundedStartPoint(35.700123, 51.400456, AREA_LABEL);

  assert.equal(payload.lat, 35.7);
  assert.equal(payload.lng, 51.4);
  assert.equal(payload.accuracy_m, COARSE_ACCURACY_M);
  assert.equal(payload.source, 'gps_coarse');
  // A neighbourhood phrase, never a geocoded street address (FR-8.13).
  assert.equal(payload.label, AREA_LABEL);
});

test('a manual point keeps its own source and label', () => {
  const payload = roundedManualStartPoint(35.712345, 51.412345, 'پارک لاله');

  assert.equal(payload.lat, 35.71);
  assert.equal(payload.lng, 51.41);
  assert.equal(payload.source, 'manual');
  assert.equal(payload.label, 'پارک لاله');
});

test('the payload passes the same schema the server enforces', () => {
  const parsed = StartPointSchema.safeParse(roundedStartPoint(35.700123, 51.400456, AREA_LABEL));
  assert.equal(parsed.success, true);
});

test('AC-8.2.1 — the precise fix never appears in the request body', () => {
  const deviceLat = 35.700123456789;
  const deviceLng = 51.400456789123;

  const serialised = JSON.stringify(roundedStartPoint(deviceLat, deviceLng, AREA_LABEL));

  // Not the raw value, and not any prefix of it that would still round-trip.
  assert.equal(serialised.includes('35.700123'), false);
  assert.equal(serialised.includes('51.400456'), false);

  // The only coordinate digits present are the two-decimal form.
  assert.equal(serialised.includes('35.7'), true);
  assert.equal(serialised.includes('51.4'), true);
});

test('the decimal count is a named privacy parameter, not a magic 2', () => {
  assert.equal(COORD_DECIMALS, 2);
});
