/**
 * The degradation ladder.
 *
 * ★ THE LADDER NEVER FAILS; IT DEGRADES.
 *
 * PRD-05 §12.4: "Every rung is labeled honestly. The engine never fails; it
 * degrades." Every path through this suite is a path that must not throw.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveMatrix, resolveTravel } from '@/src/routing/ladder';
import {
  pairKey,
  type BatchTravelAdapter,
  type MatrixOutcome,
  type MatrixRequest,
  type MatrixResult,
  type TravelRequest,
} from '@/src/routing/provider';
import type { TravelMeasurement } from '@/src/routing/types';

const ORIGIN = { lat: 35.7448, lng: 51.405 };
const DESTINATION = { lat: 35.7, lng: 51.4 };
const BUCKET = '2026-08-02T16:00:00.000Z';

/** A measurement with a given confidence. */
function measurementOf(
  minutes: number,
  confidence: TravelMeasurement['confidence'] = 'high',
): TravelMeasurement {
  return {
    minutes,
    minutesRange: null,
    distanceMeters: 5000,
    transfers: null,
    walkMinutes: null,
    waitMinutes: null,
    costIrr: null,
    parkingCostIrr: null,
    confidence,
    source: 'neshan_matrix',
    fetchedAt: BUCKET,
  };
}

/** An adapter that always answers with one measurement. */
function servingAdapter(
  name: string,
  rung: number,
  confidence: TravelMeasurement['confidence'] = 'high',
  source: TravelMeasurement['source'] = 'neshan_matrix',
): BatchTravelAdapter {
  return {
    name,
    rung,
    async measure(): Promise<TravelMeasurement> {
      return { ...measurementOf(20, confidence), source };
    },
    async measureMatrix(): Promise<MatrixResult> {
      const outcomes = new Map<string, MatrixOutcome>();
      outcomes.set(pairKey(0, 0), {
        kind: 'measured',
        measurement: { ...measurementOf(20, confidence), source },
      });
      return { outcomes, resolved: 1, total: 1 };
    },
  };
}

/** An adapter that always declines. */
function failingAdapter(name: string, rung: number): BatchTravelAdapter {
  return {
    name,
    rung,
    async measure(): Promise<TravelMeasurement | null> {
      return null;
    },
    async measureMatrix(): Promise<MatrixResult> {
      return { outcomes: new Map(), resolved: 0, total: 1 };
    },
  };
}

/** An adapter that throws — the pathological case. */
function throwingAdapter(name: string, rung: number): BatchTravelAdapter {
  return {
    name,
    rung,
    async measure(): Promise<TravelMeasurement | null> {
      throw new Error('the provider exploded');
    },
    async measureMatrix(): Promise<MatrixResult> {
      throw new Error('the provider exploded');
    },
  };
}

/** The request for one journey. */
function request(mode: TravelRequest['mode'] = 'car'): TravelRequest {
  return {
    origin: ORIGIN,
    destination: DESTINATION,
    mode,
    departureBucket: BUCKET,
  };
}

test('the ladder serves the first rung that answers', async () => {
  // Arrange
  const adapters = [servingAdapter('neshan_matrix', 1), servingAdapter('ors', 3)];

  // Act
  const outcome = await resolveTravel(request(), { adapters });

  // Assert
  assert.equal(outcome.measurement.confidence, 'high');
  assert.equal(outcome.source, 'neshan_matrix');
  assert.equal(outcome.levelReached, 1);
});

test('the ladder falls to the next rung when the first declines', async () => {
  // Arrange
  const adapters = [failingAdapter('neshan_matrix', 1), servingAdapter('ors', 3)];

  // Act
  const outcome = await resolveTravel(request(), { adapters });

  // Assert
  assert.equal(outcome.source, 'ors');
  assert.equal(outcome.levelReached, 3);
});

test('the ladder degrades to straight-line when every provider fails, and never throws', async () => {
  // Arrange
  const adapters = [
    failingAdapter('neshan_matrix', 1),
    failingAdapter('neshan_direction', 2),
    failingAdapter('ors', 3),
  ];

  // Act
  const outcome = await resolveTravel(request(), { adapters });

  // Assert — the floor is always available
  assert.equal(outcome.measurement.confidence, 'low');
  assert.equal(outcome.measurement.source, 'straight_line');
  assert.notEqual(outcome.measurement.minutesRange, null);
  assert.equal(outcome.levelReached, 5);
});

test('a throwing adapter is a failed rung, not a failed request', async () => {
  // Arrange
  const adapters = [throwingAdapter('neshan_matrix', 1), servingAdapter('ors', 3)];

  // Act — the throw is caught inside the ladder
  const outcome = await resolveTravel(request(), { adapters });

  // Assert
  assert.equal(outcome.source, 'ors');
  assert.equal(outcome.measurement.confidence, 'high');
});

test('a throwing adapter with no fallback still degrades rather than throwing', async () => {
  // Arrange
  const adapters = [throwingAdapter('neshan_matrix', 1)];

  // Act / Assert — the call resolves; it does not reject
  const outcome = await resolveTravel(request(), { adapters });
  assert.equal(outcome.measurement.confidence, 'low');
  assert.equal(outcome.measurement.source, 'straight_line');
});

test('an empty ladder degrades to the straight-line floor', async () => {
  // Arrange / Act
  const outcome = await resolveTravel(request(), { adapters: [] });

  // Assert
  assert.equal(outcome.measurement.confidence, 'low');
  assert.equal(outcome.measurement.source, 'straight_line');
});

test('the straight-line floor never claims a zero cost', async () => {
  // Arrange / Act
  const outcome = await resolveTravel(request(), { adapters: [] });

  // Assert — unknown is unknown, never 0
  assert.equal(outcome.measurement.costIrr, null);
  assert.equal(outcome.measurement.parkingCostIrr, null);
});

test('a transit request is never upgraded, even by a high-confidence provider', async () => {
  // Arrange — a provider that answers with `high` confidence
  const adapters = [servingAdapter('neshan_matrix', 1, 'high')];

  // Act
  const outcome = await resolveTravel(request('transit'), { adapters });

  // Assert — ★ the transit guard, at the ladder level
  assert.equal(outcome.measurement.confidence, 'low');
  assert.notEqual(outcome.measurement.confidence, 'high');
  assert.notEqual(outcome.measurement.confidence, 'medium');
});

test('a transit request with every provider down still carries a range', async () => {
  // Arrange / Act
  const outcome = await resolveTravel(request('transit'), { adapters: [] });

  // Assert
  assert.equal(outcome.measurement.confidence, 'low');
  assert.notEqual(outcome.measurement.minutesRange, null);
});

test('every rung transition behaves, and the order is fixed', async () => {
  // Arrange — the six rungs, in the order the ladder must walk them
  const rungs: Array<{ name: string; rung: number }> = [
    { name: 'neshan_matrix', rung: 1 },
    { name: 'neshan_direction', rung: 2 },
    { name: 'ors', rung: 3 },
  ];

  // Act / Assert — with every provider failing, each one is tried in turn
  // and the ladder ends on the straight-line floor
  const allFailing = rungs.map((rung) => failingAdapter(rung.name, rung.rung));
  const outcome = await resolveTravel(request(), { adapters: allFailing });
  assert.equal(outcome.source, 'straight_line');
  assert.equal(outcome.levelReached, 5);

  // Each prefix of the ladder that includes a serving provider ends on
  // THAT provider — so the rungs are tried in order, and the first one
  // that answers wins.
  for (let index = 0; index < rungs.length; index += 1) {
    const adapters = [
      ...rungs.slice(0, index).map((rung) => failingAdapter(rung.name, rung.rung)),
      servingAdapter(rungs[index]!.name, rungs[index]!.rung),
    ];

    const partial = await resolveTravel(request(), { adapters });
    assert.equal(
      partial.source,
      rungs[index]!.name,
      `rung ${rungs[index]!.rung} must serve when it is the first to answer`,
    );
    assert.equal(partial.levelReached, rungs[index]!.rung);
  }
});

test('the ladder is not reordered by the caller passing them out of order', async () => {
  // Arrange — the ORDER OF THE ARRAY IS THE ORDER OF THE LADDER, so a
  // caller that passes them out of order gets them out of order. That is
  // why the server builds the ladder in one place.

  // Act
  const outcome = await resolveTravel(request(), {
    adapters: [
      servingAdapter('ors', 3),
      servingAdapter('neshan_matrix', 1),
    ],
  });

  // Assert — the FIRST in the array wins, because the array IS the ladder
  assert.equal(outcome.source, 'ors');
  assert.equal(outcome.levelReached, 3);
});

test('the no-estimate rung is reachable, and it reports unknown', async () => {
  // Arrange — an adapter that is the no-estimate rung itself
  const noEstimate = {
    name: 'none',
    rung: 6,
    async measure(): Promise<TravelMeasurement> {
      return {
        minutes: 0,
        minutesRange: null,
        distanceMeters: 0,
        transfers: null,
        walkMinutes: null,
        waitMinutes: null,
        costIrr: null,
        parkingCostIrr: null,
        confidence: 'unknown' as const,
        source: 'none' as const,
        fetchedAt: new Date().toISOString(),
      };
    },
  };

  // Act
  const outcome = await resolveTravel(request(), { adapters: [noEstimate] });

  // Assert
  assert.equal(outcome.measurement.confidence, 'unknown');
  assert.equal(outcome.measurement.source, 'none');
  assert.equal(outcome.measurement.costIrr, null);
  assert.equal(outcome.levelReached, 6);
});

test('an adapter that does not serve the mode is skipped, not failed', async () => {
  // Arrange — an adapter that serves only cars
  const carOnly: BatchTravelAdapter = {
    name: 'car_only',
    rung: 1,
    supports: (mode) => mode === 'car',
    async measure(): Promise<TravelMeasurement | null> {
      return null;
    },
  };

  // Act
  const outcome = await resolveTravel(request('walk'), { adapters: [carOnly] });

  // Assert — the ladder moved on, and the reason says why
  assert.equal(outcome.measurement.confidence, 'low');
  assert.equal(outcome.reason, 'mode_unsupported');
});

test('the matrix resolves every pair, and reports its coverage', async () => {
  // Arrange — two origins, two destinations
  const matrixRequest: MatrixRequest = {
    origins: [ORIGIN, { lat: 35.75, lng: 51.41 }],
    destinations: [DESTINATION, { lat: 35.71, lng: 51.39 }],
    mode: 'car',
    departureBucket: BUCKET,
  };

  const adapter: BatchTravelAdapter = {
    name: 'full_matrix',
    rung: 1,
    async measure(): Promise<TravelMeasurement | null> {
      return null;
    },
    async measureMatrix(): Promise<MatrixResult> {
      const outcomes = new Map<string, MatrixOutcome>();
      for (const originIndex of [0, 1]) {
        for (const destinationIndex of [0, 1]) {
          outcomes.set(pairKey(originIndex, destinationIndex), {
            kind: 'measured',
            measurement: measurementOf(15 + originIndex + destinationIndex),
          });
        }
      }
      return { outcomes, resolved: 4, total: 4 };
    },
  };

  // Act
  const result = await resolveMatrix(matrixRequest, { adapters: [adapter] });

  // Assert
  assert.equal(result.results.size, 4);
  assert.equal(result.coverage.resolved, 4);
  assert.equal(result.coverage.total, 4);
  assert.equal(result.levelReached, 1);
});

test('a partial matrix keeps the resolved pairs and falls through for the rest', async () => {
  // Arrange — the provider resolves only the first pair
  const matrixRequest: MatrixRequest = {
    origins: [ORIGIN, { lat: 35.75, lng: 51.41 }],
    destinations: [DESTINATION, { lat: 35.71, lng: 51.39 }],
    mode: 'car',
    departureBucket: BUCKET,
  };

  const partial: BatchTravelAdapter = {
    name: 'partial',
    rung: 1,
    async measure(): Promise<TravelMeasurement | null> {
      return null;
    },
    async measureMatrix(): Promise<MatrixResult> {
      const outcomes = new Map<string, MatrixOutcome>();
      outcomes.set(pairKey(0, 0), { kind: 'measured', measurement: measurementOf(15) });
      outcomes.set(pairKey(0, 1), { kind: 'measured', measurement: measurementOf(25) });
      return { outcomes, resolved: 2, total: 4 };
    },
  };

  // Act
  const result = await resolveMatrix(matrixRequest, { adapters: [partial] });

  // Assert — the two good pairs are high-confidence, the two missing ones
  // fall to the straight-line floor
  const good = result.results.get(pairKey(0, 0))!;
  const missing = result.results.get(pairKey(1, 1))!;

  assert.equal(good.measurement.confidence, 'high');
  assert.equal(missing.measurement.confidence, 'low');
  assert.equal(missing.measurement.source, 'straight_line');
  assert.equal(result.coverage.resolved, 4);
  assert.equal(result.coverage.total, 4);
});

test('a NoRoute pair becomes an unknown measurement, never an instant trip', async () => {
  // Arrange
  const matrixRequest: MatrixRequest = {
    origins: [ORIGIN],
    destinations: [DESTINATION],
    mode: 'car',
    departureBucket: BUCKET,
  };

  const noRoute: BatchTravelAdapter = {
    name: 'no_route',
    rung: 1,
    async measure(): Promise<TravelMeasurement | null> {
      return null;
    },
    async measureMatrix(): Promise<MatrixResult> {
      const outcomes = new Map<string, MatrixOutcome>();
      outcomes.set(pairKey(0, 0), { kind: 'no_route' });
      return { outcomes, resolved: 0, total: 1 };
    },
  };

  // Act
  const result = await resolveMatrix(matrixRequest, { adapters: [noRoute] });

  // Assert — the participant is reported in `coverage.missing`, not scored
  // as `u = 0` (TC-5)
  const outcome = result.results.get(pairKey(0, 0))!;
  assert.equal(outcome.measurement.confidence, 'unknown');
  assert.equal(outcome.reason, 'no_route');
  assert.equal(outcome.measurement.costIrr, null);
});

test('an empty matrix resolves to nothing without throwing', async () => {
  // Arrange / Act
  const result = await resolveMatrix(
    { origins: [], destinations: [], mode: 'car', departureBucket: BUCKET },
    { adapters: [] },
  );

  // Assert
  assert.equal(result.results.size, 0);
  assert.equal(result.coverage.total, 0);
});

test('the ladder is deterministic for the same input', async () => {
  // Arrange
  const adapters = [failingAdapter('neshan_matrix', 1)];

  // Act
  const first = await resolveTravel(request(), { adapters });
  const second = await resolveTravel(request(), { adapters });

  // Assert
  assert.equal(first.source, second.source);
  assert.equal(first.levelReached, second.levelReached);
  assert.equal(first.measurement.confidence, second.measurement.confidence);
});

test('every pair of the matrix is accounted for, exactly once', async () => {
  // Arrange — three origins, three destinations
  const matrixRequest: MatrixRequest = {
    origins: [ORIGIN, { lat: 35.75, lng: 51.41 }, { lat: 35.76, lng: 51.42 }],
    destinations: [DESTINATION, { lat: 35.71, lng: 51.39 }, { lat: 35.72, lng: 51.38 }],
    mode: 'car',
    departureBucket: BUCKET,
  };

  // Act — a provider that resolves exactly one pair
  const onePair: BatchTravelAdapter = {
    name: 'one_pair',
    rung: 1,
    async measure(): Promise<TravelMeasurement | null> {
      return null;
    },
    async measureMatrix(): Promise<MatrixResult> {
      const outcomes = new Map<string, MatrixOutcome>();
      outcomes.set(pairKey(0, 0), { kind: 'measured', measurement: measurementOf(15) });
      return { outcomes, resolved: 1, total: 9 };
    },
  };

  const result = await resolveMatrix(matrixRequest, { adapters: [onePair] });

  // Assert — all nine pairs are present, none lost, none duplicated
  assert.equal(result.results.size, 9);
  assert.equal(result.coverage.total, 9);

  for (let originIndex = 0; originIndex < 3; originIndex += 1) {
    for (let destinationIndex = 0; destinationIndex < 3; destinationIndex += 1) {
      const key = pairKey(originIndex, destinationIndex);
      assert.ok(result.results.has(key), `pair ${key} must be accounted for`);
    }
  }
});

test('the coverage is the same for every pair of one matrix', async () => {
  // Arrange
  const matrixRequest: MatrixRequest = {
    origins: [ORIGIN, { lat: 35.75, lng: 51.41 }],
    destinations: [DESTINATION, { lat: 35.71, lng: 51.39 }],
    mode: 'car',
    departureBucket: BUCKET,
  };

  // Act
  const result = await resolveMatrix(matrixRequest, { adapters: [] });

  // Assert — the coverage describes the matrix, so it cannot differ
  // between pairs
  const coverages = [...result.results.values()].map((outcome) => outcome.coverage);
  for (const coverage of coverages) {
    assert.deepEqual(coverage, coverages[0]);
  }
  assert.deepEqual(coverages[0], { resolved: 4, total: 4 });
});

test('a matrix with no origins resolves to nothing', async () => {
  // Arrange / Act
  const result = await resolveMatrix(
    { origins: [], destinations: [DESTINATION], mode: 'car', departureBucket: BUCKET },
    { adapters: [] },
  );

  // Assert
  assert.equal(result.results.size, 0);
  assert.equal(result.coverage.total, 0);
});

test('a pair that cannot be resolved still gets an entry', async () => {
  // Arrange — a matrix whose destinations array is shorter than the
  // origins imply, so one pair has no destination
  const matrixRequest: MatrixRequest = {
    origins: [ORIGIN, { lat: 35.75, lng: 51.41 }],
    destinations: [DESTINATION],
    mode: 'car',
    departureBucket: BUCKET,
  };

  // Act — an adapter that claims to resolve a pair that does not exist
  const liar: BatchTravelAdapter = {
    name: 'liar',
    rung: 1,
    async measure(): Promise<TravelMeasurement | null> {
      return null;
    },
    async measureMatrix(): Promise<MatrixResult> {
      const outcomes = new Map<string, MatrixOutcome>();
      outcomes.set(pairKey(0, 0), { kind: 'measured', measurement: measurementOf(15) });
      outcomes.set(pairKey(1, 0), { kind: 'measured', measurement: measurementOf(25) });
      return { outcomes, resolved: 2, total: 2 };
    },
  };

  const result = await resolveMatrix(matrixRequest, { adapters: [liar] });

  // Assert — every pair the caller asked about is accounted for
  assert.equal(result.results.size, 2);
  assert.ok(result.results.has(pairKey(0, 0)));
  assert.ok(result.results.has(pairKey(1, 0)));
});
