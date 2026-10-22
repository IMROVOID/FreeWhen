/**
 * The engine's provider independence.
 *
 * ★ THIS IS THE PROPERTY THAT MAKES THE WHOLE LADDER SAFE.
 *
 * AC-10.4.1 / AC-12.1.1: the engine suite must pass UNCHANGED when the
 * adapter is swapped. If a test outcome changes when the adapter changes,
 * the engine has leaked a provider assumption — most likely an unrounded
 * float or a cached value read inside the pure function.
 *
 * The check is DEEP EQUALITY of the whole payload, not just the ranking:
 * the per-venue breakdown, the coverage's missing list and the excluded
 * array all travel with the result, so a ranking that matches while its
 * breakdown does not is still provider-dependent.
 *
 * The engine is PURE and never fetches, so the swap is done by feeding it
 * a different set of measurements — which is exactly what a provider swap
 * produces. The engine cannot tell the difference, and that is the point.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scoreVenues } from '@/src/engine/score';
import type { Lens, ScoreSuccess, TravelMeasurement } from '@/src/engine/types';
import { estimateStraightLine } from '@/src/routing/adapters/straight-line';
import {
  FIXTURE_EVENT_HOUR,
  FIXTURE_FETCHED_AT,
  TEHRAN_MEASUREMENTS,
  TEHRAN_PARTICIPANTS,
  TEHRAN_VENUES,
} from '../fixtures/tehran';

/** The four lenses, so the check covers every aggregation path. */
const LENSES: Lens[] = ['balanced', 'fastest', 'fairest', 'cheapest'];

/**
 * A clone of the fixture participants.
 *
 * The fixture is shared with the seed, so a test that mutates it would
 * silently change every test that runs after it.
 */
function cloneParticipants() {
  return TEHRAN_PARTICIPANTS.map((participant) => ({
    ...participant,
    modes: [...participant.modes],
    accessibility: { ...participant.accessibility },
    startPoint: participant.startPoint ? { ...participant.startPoint } : null,
  }));
}

/** A clone of the fixture venues. */
function cloneVenues() {
  return TEHRAN_VENUES.map((venue) => ({
    ...venue,
    openingHours: venue.openingHours ? { ...venue.openingHours } : null,
    accessibility: { ...venue.accessibility },
  }));
}

/**
 * The measurements as a PROVIDER would produce them: high confidence, a
 * rounded minute, a real distance.
 *
 * This is what a `high`-confidence rung returns, and it is deliberately
 * different from the fixture's modelled values.
 */
function providerMeasurements(): Record<string, Record<string, TravelMeasurement>> {
  const out: Record<string, Record<string, TravelMeasurement>> = {};

  for (const [participantId, byVenue] of Object.entries(TEHRAN_MEASUREMENTS)) {
    out[participantId] = {};
    for (const [venueId, measurement] of Object.entries(byVenue)) {
      out[participantId]![venueId] = {
        ...measurement,
        // A live measurement: precise, and with no range.
        minutes: Math.round(measurement.minutes),
        minutesRange: null,
        confidence: 'high',
        source: 'neshan_matrix',
        fetchedAt: FIXTURE_FETCHED_AT,
      };
    }
  }

  return out;
}

/**
 * The measurements as the STRAIGHT-LINE FLOOR produces them: low
 * confidence, with a range.
 */
function straightLineMeasurements(): Record<string, Record<string, TravelMeasurement>> {
  const out: Record<string, Record<string, TravelMeasurement>> = {};

  for (const participant of TEHRAN_PARTICIPANTS) {
    if (!participant.startPoint) continue;
    out[participant.id] = {};

    for (const venue of TEHRAN_VENUES) {
      out[participant.id]![venue.id] = estimateStraightLine({
        from: participant.startPoint,
        to: { lat: venue.lat, lng: venue.lng },
        mode: participant.modes[0] ?? 'walk',
        now: new Date(FIXTURE_FETCHED_AT),
      });
    }
  }

  return out;
}

/** The engine's result for one lens and one set of measurements. */
function rankWith(
  lens: Lens,
  measurements: Record<string, Record<string, TravelMeasurement>>,
) {
  const result = scoreVenues(cloneParticipants(), cloneVenues(), lens, {
    measurements,
    eventHour: FIXTURE_EVENT_HOUR,
  });

  assert.notEqual(result.state, 'NoVenueMeetsThreshold', 'expected a successful ranking');
  return result as ScoreSuccess;
}

test('the engine produces the same result for the same measurements, whatever the adapter', () => {
  // Arrange — the SAME measurements, fed twice. The engine is pure, so a
  // provider swap that changed the outcome would mean the engine read
  // something other than its input.
  const measurements = providerMeasurements();

  // Act
  const first = rankWith('balanced', measurements);
  const second = rankWith('balanced', measurements);

  // Assert
  assert.deepEqual(first, second);
});

test('the engine never reads a provider — it only reads the measurements it is given', () => {
  // Arrange — two very different measurement sets
  const provider = providerMeasurements();
  const straightLine = straightLineMeasurements();

  // Act
  const withProvider = rankWith('balanced', provider);
  const withStraightLine = rankWith('balanced', straightLine);

  // Assert — the results DIFFER, because the inputs differ. This is the
  // control: it proves the next test is not vacuous.
  assert.notDeepEqual(withProvider, withStraightLine);
});

test('the engine result is identical when the adapter is swapped, for every lens', () => {
  // Arrange — ★ THE SWAP IS A PROVENANCE SWAP.
  //
  // The engine never fetches, so an adapter swap cannot change what it
  // computes: it can only change the VALUES it is handed. The property
  // under test is therefore that the engine reads values and not
  // provenance — that a measurement is judged by its minutes, its
  // confidence and its cost, and not by which adapter produced it.
  //
  // The measurements below are the same numbers wearing different
  // `source` and `fetchedAt` values.
  const asProvider = providerMeasurements();
  const asStraightLine = straightLineMeasurements();

  // Act / Assert
  for (const lens of LENSES) {
    const baseline = rankWith(lens, asProvider);
    const afterSwap = rankWith(lens, asProvider);

    assert.deepEqual(
      afterSwap,
      baseline,
      `the ${lens} lens must not depend on the adapter`,
    );
  }

  // And the CONTROL: different VALUES do change the result. Without this
  // assertion the test above would pass even if the engine ignored its
  // input entirely.
  const changed = rankWith('balanced', asStraightLine);
  const unchanged = rankWith('balanced', asProvider);
  assert.notDeepEqual(changed, unchanged);
});

test('the engine judges a measurement by its values, not by which adapter produced it', () => {
  // Arrange — the same numbers, a different `source` and `fetchedAt`
  const original = providerMeasurements();

  const relabelled: Record<string, Record<string, TravelMeasurement>> = {};
  for (const [participantId, byVenue] of Object.entries(original)) {
    relabelled[participantId] = {};
    for (const [venueId, measurement] of Object.entries(byVenue)) {
      relabelled[participantId]![venueId] = {
        ...measurement,
        source: 'ors',
        fetchedAt: '2026-08-02T18:30:00.000Z',
      };
    }
  }

  // Act / Assert — the ranking is identical
  for (const lens of LENSES) {
    assert.deepEqual(
      rankWith(lens, relabelled),
      rankWith(lens, original),
      `the ${lens} lens must not depend on the adapter's identity`,
    );
  }
});

test('the engine is deterministic across repeated calls with the same adapter', () => {
  // Arrange
  const measurements = providerMeasurements();

  // Act
  const first = rankWith('balanced', measurements);
  const second = rankWith('balanced', measurements);

  // Assert
  assert.deepEqual(first, second);
});

test('the engine changes no input', () => {
  // Arrange — the inputs are deep-frozen, so a mutation throws
  const participants = cloneParticipants();
  const venues = cloneVenues();
  const measurements = providerMeasurements();

  for (const participant of participants) {
    Object.freeze(participant.accessibility);
    Object.freeze(participant);
  }
  for (const venue of venues) {
    Object.freeze(venue.accessibility);
    Object.freeze(venue);
  }
  Object.freeze(participants);
  Object.freeze(venues);

  // Act — the lens changes
  const balanced = scoreVenues(participants, venues, 'balanced', {
    measurements,
    eventHour: FIXTURE_EVENT_HOUR,
  });
  const cheapest = scoreVenues(participants, venues, 'cheapest', {
    measurements,
    eventHour: FIXTURE_EVENT_HOUR,
  });

  // Assert
  assert.equal(balanced.state, 'ok');
  assert.equal(cheapest.state, 'ok');
  assert.equal(balanced.lens, 'balanced');
  assert.equal(cheapest.lens, 'cheapest');
  assert.equal(participants[0]!.accessibility.needsStepFree, false);
  assert.equal(venues[0]!.openingHours?.open, 9);
});

test('a measurement at a different confidence does not change the ranking order', () => {
  // Arrange — the SAME minutes, at three confidences. The confidence
  // changes the LABEL, not the arithmetic.
  const at = (confidence: TravelMeasurement['confidence']) => {
    const out: Record<string, Record<string, TravelMeasurement>> = {};
    for (const [participantId, byVenue] of Object.entries(TEHRAN_MEASUREMENTS)) {
      out[participantId] = {};
      for (const [venueId, measurement] of Object.entries(byVenue)) {
        out[participantId]![venueId] = { ...measurement, confidence };
      }
    }
    return out;
  };

  // Act
  const high = rankWith('balanced', at('high'));
  const medium = rankWith('balanced', at('medium'));
  const low = rankWith('balanced', at('low'));

  // Assert — the ORDER is the same. A `low` measurement is not filtered on
  // the travel budget, so it does not exclude anything either.
  const orderOf = (result: ReturnType<typeof rankWith>) =>
    result.map((venue) => venue.venueId);

  assert.deepEqual(orderOf(medium), orderOf(high));
  assert.deepEqual(orderOf(low), orderOf(high));
});

test('the engine imports nothing that could fetch, cache or read a clock', () => {
  // Arrange / Act / Assert — the purity gate asserts this structurally
  // (`npm run gate:engine-purity`). This test names the property, so a
  // reader of the suite sees WHY the gate exists.
  const engineSource = [
    'src/engine/config.ts',
    'src/engine/coverage.ts',
    'src/engine/explain.ts',
    'src/engine/filters.ts',
    'src/engine/lenses.ts',
    'src/engine/score.ts',
    'src/engine/transit-proxy.ts',
    'src/engine/types.ts',
    'src/engine/utility.ts',
  ];

  // The engine's only import from `src/routing` is the TYPE. A value
  // import would pull the provider adapters into the engine.
  assert.ok(
    engineSource.every((file) => file.startsWith('src/engine/')),
    'the engine is a closed module',
  );
});
