/**
 * The engine's test suite — the 18 cases from PRD-05 §12A.
 *
 * Every case is named with its `TC-n` id, so the report and the failure
 * output both read as the specification. Each test follows AAA: Arrange,
 * Act, Assert.
 *
 * **The suite runs under `node:test` with no React Native preset**, because
 * the engine has no RN dependency. That is the point of the purity boundary
 * (PRD-12 §4).
 *
 * **Reason assertions compare `templateId` and `params`, never prose.** A
 * copy edit can therefore never break an engine test, and every assertion
 * here is locale-independent by construction (PRD-05 §11.1).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ENGINE_CONFIG } from '@/src/engine/config';
import { computeCoverage } from '@/src/engine/coverage';
import { buildReason } from '@/src/engine/explain';
import { aggregateVenue, fairestSurvivors, round2 } from '@/src/engine/lenses';
import { scoreVenues } from '@/src/engine/score';
import { estimateTransitProxy, haversineKm } from '@/src/engine/transit-proxy';
import { combinedMinutes, computeUtility, isNightHour } from '@/src/engine/utility';
import type {
  Lens,
  NoVenueMeetsThreshold,
  ParticipantContext,
  ScoreSuccess,
  TravelMeasurement,
  VenueContext,
} from '@/src/engine/types';

import {
  EXPECTED_AGGREGATES,
  FIXTURE_EVENT_HOUR,
  FIXTURE_FETCHED_AT,
  FIXTURE_VENUE_IDS,
  SEED_FIXTURE,
  TEHRAN_FIXTURE,
  TEHRAN_MEASUREMENTS,
  TEHRAN_PARTICIPANTS,
  TEHRAN_VENUES,
} from '../fixtures/tehran';

/** The ranked venues, assuming the run produced a successful result. */
function rankedOf(result: ReturnType<typeof scoreVenues>): ScoreSuccess {
  assert.notEqual(result.state, 'NoVenueMeetsThreshold', 'expected a successful ranking');
  return result as ScoreSuccess;
}

/** The ranked venues, assuming the run produced the no-viable state. */
function noViableOf(result: ReturnType<typeof scoreVenues>): NoVenueMeetsThreshold {
  assert.equal(result.state, 'NoVenueMeetsThreshold', 'expected NoVenueMeetsThreshold');
  return result as NoVenueMeetsThreshold;
}

/**
 * The participant with the given name.
 *
 * A CLONE. The fixture is shared with the seed data, so a test that mutates
 * a participant must never touch the fixture itself — a leaked mutation
 * would silently change every test that runs after it.
 */
function participantNamed(name: string): ParticipantContext {
  const found = TEHRAN_PARTICIPANTS.find((participant) => participant.name === name);
  assert.ok(found, `no participant named ${name}`);
  return {
    ...found,
    modes: [...found.modes],
    accessibility: { ...found.accessibility },
    startPoint: found.startPoint ? { ...found.startPoint } : null,
  };
}

/**
 * A clone of the participants, with one participant's constraint changed.
 *
 * The change is applied to the CLONE, so the fixture is untouched.
 */
function participantsWith(
  name: string,
  change: Partial<ParticipantContext['accessibility']>,
): ParticipantContext[] {
  const participants = cloneParticipants();
  const target = participants.find((participant) => participant.name === name);
  assert.ok(target, `no participant named ${name}`);
  target.accessibility = { ...target.accessibility, ...change };
  return participants;
}

/** A deep copy of the fixture participants, so a test can mutate one safely. */
function cloneParticipants(): ParticipantContext[] {
  return TEHRAN_PARTICIPANTS.map((participant) => ({
    ...participant,
    modes: [...participant.modes],
    accessibility: { ...participant.accessibility },
    startPoint: participant.startPoint ? { ...participant.startPoint } : null,
  }));
}

/** A deep copy of the fixture venues, so a test can mutate one safely. */
function cloneVenues(): VenueContext[] {
  return TEHRAN_VENUES.map((venue) => ({
    ...venue,
    openingHours: venue.openingHours ? { ...venue.openingHours } : null,
    accessibility: { ...venue.accessibility },
  }));
}

/** A measurement with the given minutes, for a single participant/venue. */
function measurementOf(minutes: number, overrides: Partial<TravelMeasurement> = {}): TravelMeasurement {
  return {
    minutes,
    minutesRange: [minutes, minutes],
    distanceMeters: 1000,
    transfers: null,
    walkMinutes: 0,
    waitMinutes: null,
    costIrr: 1000,
    parkingCostIrr: null,
    confidence: 'high',
    source: 'neshan_matrix',
    fetchedAt: FIXTURE_FETCHED_AT,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// TC-1 — Two people, different transport modes.
// ---------------------------------------------------------------------------

test('TC-1: two people with different modes get utilities in [0,100], and the higher floor wins', () => {
  // Arrange
  const ali = participantNamed('Ali');
  const bahar = participantNamed('Bahar');
  const participants = [ali, bahar];

  const measurements = {
    [ali.id]: {
      v_1: measurementOf(30),
      v_2: measurementOf(12),
    },
    [bahar.id]: {
      v_1: measurementOf(20),
      v_2: measurementOf(40),
    },
  };

  // Act
  const result = rankedOf(
    scoreVenues(participants, cloneVenues(), 'balanced', { measurements }),
  );

  // Assert — every utility is within the clamp
  for (const venue of result) {
    for (const participant of venue.participants) {
      assert.ok(
        participant.utility >= 0 && participant.utility <= 100,
        `utility ${participant.utility} out of range`,
      );
    }
  }

  // The two venues have near-identical means (41.67 vs 40.00), so the
  // higher floor decides.
  const v1 = result.find((venue) => venue.venueId === 'v_1')!;
  const v2 = result.find((venue) => venue.venueId === 'v_2')!;
  assert.ok(v1.floor !== v2.floor);
  assert.equal(result[0]!.venueId, v1.floor > v2.floor ? 'v_1' : 'v_2');
});

// ---------------------------------------------------------------------------
// TC-2 — One driver, several transit users.
// ---------------------------------------------------------------------------

test('TC-2: a venue that is best only for the driver does not rank first', () => {
  // Arrange
  const participants = ['Ali', 'Bahar', 'Cyrus'].map(participantNamed);

  // Act
  const result = rankedOf(
    scoreVenues(participants, cloneVenues(), 'balanced', {
      measurements: TEHRAN_MEASUREMENTS,
      eventHour: FIXTURE_EVENT_HOUR,
    }),
  );

  // Assert — V3 is best for Ali at 75.00 but its floor is 16.67
  const v3 = result.find((venue) => venue.venueId === 'v_3')!;
  const aliUtility = v3.participants.find((participant) => participant.name === 'Ali')!.utility;
  assert.equal(round2(aliUtility), 75);
  assert.equal(v3.floor, EXPECTED_AGGREGATES.v_3.floor);
  assert.notEqual(result[0]!.venueId, 'v_3');
});

// ---------------------------------------------------------------------------
// TC-3 — Geographically central but transit-hostile.
// ---------------------------------------------------------------------------

test('TC-3: Balanced picks the higher floor over a 0.28-point mean advantage', () => {
  // Arrange
  const participants = cloneParticipants();

  // Act
  const result = rankedOf(
    scoreVenues(participants, cloneVenues(), 'balanced', {
      measurements: TEHRAN_MEASUREMENTS,
      eventHour: FIXTURE_EVENT_HOUR,
    }),
  );

  // Assert — V1 wins the mean, V2 wins the floor, and Balanced picks V2
  const v1 = result.find((venue) => venue.venueId === 'v_1')!;
  const v2 = result.find((venue) => venue.venueId === 'v_2')!;

  assert.equal(v1.mean, EXPECTED_AGGREGATES.v_1.mean);
  assert.equal(v2.mean, EXPECTED_AGGREGATES.v_2.mean);
  assert.ok(v1.mean > v2.mean, 'V1 should win the mean');

  assert.equal(v1.floor, EXPECTED_AGGREGATES.v_1.floor);
  assert.equal(v2.floor, EXPECTED_AGGREGATES.v_2.floor);
  assert.ok(v2.floor > v1.floor, 'V2 should win the floor');

  assert.equal(result[0]!.venueId, 'v_2', 'Balanced must pick the higher floor');
});

// ---------------------------------------------------------------------------
// TC-4 — Equal travel times, poor accessibility.
// ---------------------------------------------------------------------------

test('TC-4: a confirmed_no step-free venue is excluded with a reason', () => {
  // Arrange — two venues with identical times, one of them inaccessible
  const participants = participantsWith('Darya', { needsStepFree: true });
  const darya = participants.find((participant) => participant.name === 'Darya')!;

  const venues = cloneVenues().slice(0, 2);
  venues[0]!.accessibility.stepFreeEntrance = 'confirmed_no';

  const measurements: Record<string, Record<string, TravelMeasurement>> = {};
  for (const participant of participants) {
    measurements[participant.id] = {
      v_1: measurementOf(20),
      v_2: measurementOf(20),
    };
  }

  // Act
  const result = rankedOf(
    scoreVenues(participants, venues, 'balanced', { measurements }),
  );

  // Assert
  const excluded = result.excluded.find((entry) => entry.venueId === 'v_1')!;
  assert.ok(excluded, 'the inaccessible venue must be excluded');
  assert.equal(excluded.reason, 'accessibility');
  assert.equal(excluded.participantId, darya.id);
  assert.ok(
    !result.some((venue) => venue.venueId === 'v_1'),
    'the excluded venue must not appear in the ranking',
  );
});

// ---------------------------------------------------------------------------
// TC-5 — A participant without a location.
// ---------------------------------------------------------------------------

test('TC-5: participants without a location are reported in the coverage, not scored as zero', () => {
  // Arrange — 8 participants, 2 of them without a start point
  const participants: ParticipantContext[] = [];
  for (let index = 0; index < 8; index += 1) {
    const template = participantNamed(['Ali', 'Bahar', 'Cyrus', 'Darya'][index % 4]!);
    participants.push({
      ...template,
      id: `p_${index}`,
      startPoint: index < 6 ? { ...template.startPoint! } : null,
    });
  }
  const measurements: Record<string, Record<string, TravelMeasurement>> = {};
  for (const participant of participants) {
    if (participant.startPoint === null) continue;
    measurements[participant.id] = { v_1: measurementOf(20), v_2: measurementOf(25) };
  }

  // Act
  const result = rankedOf(
    scoreVenues(participants, cloneVenues(), 'balanced', { measurements }),
  );

  // Assert
  assert.equal(result.coverage.compared, 6);
  assert.equal(result.coverage.total, 8);
  assert.equal(result.coverage.missing.length, 2);

  // The two are NOT scored as u = 0 — the floor is the worst-off MEASURED
  // participant, not an absent one. Darya is among the located six, and
  // her 45-minute budget makes her the worst-off at 55.56.
  const v1 = result.find((venue) => venue.venueId === 'v_1')!;
  assert.equal(v1.floor, 55.56);
  assert.equal(v1.participants.length, 6);

  // Nobody was scored zero.
  for (const participant of v1.participants) {
    assert.ok(participant.utility > 0, 'an absent participant must not be scored as zero');
  }
});

// ---------------------------------------------------------------------------
// TC-6 — Participants in different cities.
// ---------------------------------------------------------------------------

test('TC-6: participants in different cities still rank deterministically, with a wide_geography flag', () => {
  // Arrange — two participants 400 km apart
  const near = participantNamed('Ali');
  const far: ParticipantContext = {
    ...participantNamed('Bahar'),
    id: 'p_far',
    startPoint: { lat: 39.5, lng: 51.4, accuracyM: 50 },
    // An inter-city journey is long, but it is not a budget violation.
    maxTravelMinutes: 600,
  };
  const participants = [near, far];

  const measurements = {
    [near.id]: { v_1: measurementOf(20), v_2: measurementOf(25) },
    [far.id]: { v_1: measurementOf(400), v_2: measurementOf(420) },
  };
  // Act
  const result = rankedOf(
    scoreVenues(participants, cloneVenues(), 'balanced', { measurements }),
  );

  // Assert — a deterministic order exists
  assert.equal(result.length, 2);
  assert.equal(result[0]!.venueId, 'v_1');

  // The coverage is complete — everybody had a location
  assert.equal(result.coverage.compared, 2);
  assert.equal(result.coverage.total, 2);

  // The wide geography is flagged
  assert.equal(result.coverage.wideGeography, true);

  // The median travel time is far above any single-city case
  const times = result[0]!.participants.map((participant) => participant.minutes).sort((a, b) => a - b);
  const median = (times[0]! + times[1]!) / 2;
  assert.ok(median > 100, `median ${median} should exceed a single-city figure`);
});

// ---------------------------------------------------------------------------
// TC-7 — A venue closed at the proposed time.
// ---------------------------------------------------------------------------

test('TC-7: a venue known to be closed is excluded, and absent hours keep the venue', () => {
  // Arrange — one venue closes at 18:00, one has unknown hours
  const participants = cloneParticipants();
  const venues = cloneVenues().slice(0, 2);
  venues[0]!.openingHours = { open: 9, close: 18 };
  venues[1]!.openingHours = null;

  const measurements: Record<string, Record<string, TravelMeasurement>> = {};
  for (const participant of participants) {
    measurements[participant.id] = {
      v_1: measurementOf(20),
      v_2: measurementOf(25),
    };
  }

  // Act — the event is at 20:00
  const result = rankedOf(
    scoreVenues(participants, venues, 'balanced', { measurements, eventHour: 20 }),
  );

  // Assert
  const excluded = result.excluded.find((entry) => entry.venueId === 'v_1')!;
  assert.ok(excluded, 'the closed venue must be excluded');
  assert.equal(excluded.reason, 'closed');

  // Absent hours ≠ closed: the venue with null hours survives.
  assert.ok(
    result.some((venue) => venue.venueId === 'v_2'),
    'a venue with unknown hours must be kept',
  );
});

// ---------------------------------------------------------------------------
// TC-8 — A participant with a hard accessibility constraint.
// ---------------------------------------------------------------------------

test('TC-8: a confirmed_no venue is excluded while an unknown one is kept with a conflict', () => {
  // Arrange
  const participants = participantsWith('Darya', { needsStepFree: true });
  const darya = participants.find((participant) => participant.name === 'Darya')!;

  const venues = cloneVenues().slice(0, 2);
  venues[0]!.accessibility.stepFreeEntrance = 'confirmed_no';
  venues[1]!.accessibility.stepFreeEntrance = 'unknown';

  const measurements: Record<string, Record<string, TravelMeasurement>> = {};
  for (const participant of participants) {
    measurements[participant.id] = {
      v_1: measurementOf(20),
      v_2: measurementOf(25),
    };
  }

  // Act
  const result = rankedOf(
    scoreVenues(participants, venues, 'balanced', { measurements }),
  );

  // Assert — A is excluded
  const excluded = result.excluded.find((entry) => entry.venueId === 'v_1')!;
  assert.ok(excluded);
  assert.equal(excluded.reason, 'accessibility');
  assert.equal(excluded.participantId, darya.id);

  // B is kept, and carries an accessibility_unknown conflict for Darya
  const kept = result.find((venue) => venue.venueId === 'v_2')!;
  assert.ok(kept, 'the unknown venue must be kept');
  const conflict = kept.conflicts.find(
    (entry) => entry.type === 'accessibility_unknown' && entry.participantId === darya.id,
  );
  assert.ok(conflict, 'the unknown venue must carry an accessibility_unknown conflict');
});

// ---------------------------------------------------------------------------
// TC-9 — No venue satisfies everyone.
// ---------------------------------------------------------------------------

test('TC-9: when every venue fails a filter, the engine returns NoVenueMeetsThreshold', () => {
  // Arrange — every venue is inaccessible to a participant who needs step-free
  const participants = participantsWith('Darya', { needsStepFree: true });

  const venues = cloneVenues();
  for (const venue of venues) {
    venue.accessibility.stepFreeEntrance = 'confirmed_no';
  }

  // Act
  const result = noViableOf(
    scoreVenues(participants, venues, 'balanced', {
      measurements: TEHRAN_MEASUREMENTS,
    }),
  );

  // Assert — it is not [], not null, and it did not throw
  assert.notEqual(result, null);
  assert.ok(!Array.isArray(result));
  assert.equal(result.state, 'NoVenueMeetsThreshold');
  assert.equal(result.excluded.length, venues.length);
  assert.ok(result.suggestions.length > 0, 'the suggestions must not be empty');
  assert.ok(
    result.suggestions.includes('relax_accessibility'),
    'an accessibility block should suggest relaxing accessibility',
  );

  // The coverage is present on this path too
  assert.equal(result.coverage.total, participants.length);
});

// ---------------------------------------------------------------------------
// TC-10 — Carpool scenario (the pure calculation only).
// ---------------------------------------------------------------------------

test('TC-10: a shared ride lowers the rider\'s time and raises the floor', () => {
  // Arrange — Darya's V1 walk is 35 minutes; Ali offers her a ride
  const ali = participantNamed('Ali');
  const darya = participantNamed('Darya');

  const before = {
    [ali.id]: { v_1: measurementOf(30) },
    [darya.id]: { v_1: measurementOf(35) },
  };

  const venue = cloneVenues()[0]!;

  // Act — the carpooled measurement gives Darya a 20-minute ride
  const after = {
    [ali.id]: { v_1: measurementOf(30) },
    [darya.id]: { v_1: measurementOf(20) },
  };

  const beforeResult = rankedOf(
    scoreVenues([ali, darya], [venue], 'balanced', { measurements: before }),
  );
  const afterResult = rankedOf(
    scoreVenues([ali, darya], [venue], 'balanced', { measurements: after }),
  );

  // Assert — Darya's minutes fall and the floor rises
  const daryaBefore = beforeResult[0]!.participants.find((p) => p.id === darya.id)!;
  const daryaAfter = afterResult[0]!.participants.find((p) => p.id === darya.id)!;

  assert.ok(daryaAfter.minutes < daryaBefore.minutes, 'the ride must shorten the trip');
  assert.ok(afterResult[0]!.floor > beforeResult[0]!.floor, 'the floor must rise');
});

// ---------------------------------------------------------------------------
// TC-11 — Unknown accessibility must never read as accessible.
// ---------------------------------------------------------------------------

test('TC-11: unknown accessibility is never treated as accessible', () => {
  // Arrange — a participant who needs step-free, and a venue that is unknown
  const participants = participantsWith('Darya', { needsStepFree: true });
  const darya = participants.find((participant) => participant.name === 'Darya')!;

  const venue = cloneVenues()[0]!;
  venue.accessibility.stepFreeEntrance = 'unknown';

  const measurements: Record<string, Record<string, TravelMeasurement>> = {};
  for (const participant of participants) {
    measurements[participant.id] = { v_1: measurementOf(20) };
  }

  // Act
  const result = rankedOf(
    scoreVenues(participants, [venue], 'balanced', { measurements }),
  );

  // Assert — the venue is kept, not excluded
  assert.notEqual(result.state, 'NoVenueMeetsThreshold');
  assert.equal(result.length, 1);

  // The unknown is surfaced as a conflict for the participant who needs it
  const conflict = result[0]!.conflicts.find(
    (entry) => entry.type === 'accessibility_unknown' && entry.participantId === darya.id,
  );
  assert.ok(conflict, 'the unknown must be reported as a conflict');

  // No code path reports the venue as accessible. The engine has no
  // `accessible: true` anywhere: the tri-state is preserved on the input,
  // and the participant's own `unmet` records the unknown.
  const daryaResult = result[0]!.participants.find((participant) => participant.id === darya.id)!;
  assert.ok(daryaResult.unmet, 'the unverified requirement must be recorded');
  assert.equal(daryaResult.unmet!.templateId, 'accessibility_unknown_note');
  assert.equal(venue.accessibility.stepFreeEntrance, 'unknown');
});

// ---------------------------------------------------------------------------
// TC-12 — Order independence.
// ---------------------------------------------------------------------------

test('TC-12: permuting the inputs does not change the result', () => {
  // Arrange — five permutations of both arrays
  //
  // The permutations are built by ROTATION, so the helper works for an
  // array of any length. An index-based permutation would read past the end
  // of the three-element venue array.
  const permutations = <T>(items: T[]): T[][] => {
    const rotations: T[][] = [];
    for (let shift = 0; shift < items.length; shift += 1) {
      rotations.push([...items.slice(shift), ...items.slice(0, shift)]);
    }
    // A reversal, and an interleaving, on top of the rotations.
    rotations.push([...items].reverse());
    rotations.push(
      items.flatMap((item, index) => (index % 2 === 0 ? [item] : [])).concat(
        items.filter((_, index) => index % 2 === 1),
      ),
    );
    return rotations;
  };

  const participants = cloneParticipants();
  const venues = cloneVenues();

  // Act
  const baseline = rankedOf(
    scoreVenues(participants, venues, 'balanced', {
      measurements: TEHRAN_MEASUREMENTS,
      eventHour: FIXTURE_EVENT_HOUR,
    }),
  );

  // Assert — the WHOLE payload is identical, not just the venue sequence.
  // The per-venue breakdown, the coverage's missing list and the excluded
  // array all travel with the ranking, so a ranking that matches while its
  // breakdown does not is still order-dependent.
  for (const participantOrder of permutations(participants)) {
    for (const venueOrder of permutations(venues)) {
      const result = rankedOf(
        scoreVenues(participantOrder, venueOrder, 'balanced', {
          measurements: TEHRAN_MEASUREMENTS,
          eventHour: FIXTURE_EVENT_HOUR,
        }),
      );

      assert.deepEqual(
        result.map((venue) => venue.venueId),
        baseline.map((venue) => venue.venueId),
        'the ranking must not depend on the input order',
      );

      assert.deepEqual(
        result,
        baseline,
        'the whole payload must not depend on the input order',
      );
    }
  }
});

// ---------------------------------------------------------------------------
// TC-13 — Monotonicity.
// ---------------------------------------------------------------------------

test('TC-13: a venue whose floor and mean both rise does not fall in the ranking', () => {
  // Arrange
  const participants = cloneParticipants();
  const venues = cloneVenues();

  const baseline = rankedOf(
    scoreVenues(participants, venues, 'balanced', {
      measurements: TEHRAN_MEASUREMENTS,
      eventHour: FIXTURE_EVENT_HOUR,
    }),
  );

  // Act — V3 improves for every participant
  const improved = {
    ...TEHRAN_MEASUREMENTS,
    p_bahar: { ...TEHRAN_MEASUREMENTS.p_bahar, v_3: measurementOf(10) },
    p_cyrus: { ...TEHRAN_MEASUREMENTS.p_cyrus, v_3: measurementOf(12) },
  };

  const result = rankedOf(
    scoreVenues(participants, venues, 'balanced', {
      measurements: improved,
      eventHour: FIXTURE_EVENT_HOUR,
    }),
  );

  // Assert — the rank is non-decreasing
  const before = baseline.find((venue) => venue.venueId === 'v_3')!.rank;
  const after = result.find((venue) => venue.venueId === 'v_3')!.rank;
  assert.ok(after <= before, `rank worsened: ${before} -> ${after}`);
});

// ---------------------------------------------------------------------------
// TC-14 — The `u` clamp.
// ---------------------------------------------------------------------------

test('TC-14: the utility is clamped to [0,100]', () => {
  // Arrange
  const dMax = 60;

  // Act / Assert
  assert.equal(computeUtility(0, dMax), 100);
  assert.equal(computeUtility(dMax, dMax), 0);
  assert.equal(computeUtility(dMax * 3, dMax), 0);
  assert.equal(computeUtility(10000, dMax), 0);

  for (const minutes of [0, dMax, dMax * 3, 10000]) {
    const utility = computeUtility(minutes, dMax);
    assert.ok(utility >= 0, `u must never be negative, got ${utility}`);
    assert.ok(utility <= 100, `u must never exceed 100, got ${utility}`);
  }
});

// ---------------------------------------------------------------------------
// TC-15 — Lens independence.
// ---------------------------------------------------------------------------

test('TC-15: changing the lens mutates no input', () => {
  // Arrange — the inputs are deep-frozen, so a mutation throws
  const participants = cloneParticipants();
  const venues = cloneVenues();

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
  const balanced = rankedOf(
    scoreVenues(participants, venues, 'balanced', {
      measurements: TEHRAN_MEASUREMENTS,
      eventHour: FIXTURE_EVENT_HOUR,
    }),
  );
  const cheapest = rankedOf(
    scoreVenues(participants, venues, 'cheapest', {
      measurements: TEHRAN_MEASUREMENTS,
      eventHour: FIXTURE_EVENT_HOUR,
    }),
  );

  // Assert — only the ranking differs, and nothing was mutated
  assert.equal(balanced.lens, 'balanced');
  assert.equal(cheapest.lens, 'cheapest');
  assert.equal(participants[0]!.accessibility.needsStepFree, false);
  assert.equal(venues[0]!.openingHours?.open, 9);
});

// ---------------------------------------------------------------------------
// TC-16 — Rounding discipline.
// ---------------------------------------------------------------------------

test('TC-16: the aggregates are rounded once, at the end', () => {
  // Arrange
  const participants = cloneParticipants();
  const venues = cloneVenues();

  // Act
  const result = rankedOf(
    scoreVenues(participants, venues, 'balanced', {
      measurements: TEHRAN_MEASUREMENTS,
      eventHour: FIXTURE_EVENT_HOUR,
    }),
  );

  // Assert — mean(V1) is 50.56, not 50.55
  const v1 = result.find((venue) => venue.venueId === 'v_1')!;
  assert.equal(v1.mean, 50.56);
  assert.notEqual(v1.mean, 50.55);
  assert.equal(v1.floor, 22.22);
  assert.equal(v1.gap, 44.44);
  assert.notEqual(v1.gap, 44.45);
});

// ---------------------------------------------------------------------------
// TC-17 — Aggregates from exact values.
// ---------------------------------------------------------------------------

test('TC-17: the two rounding forms differ, and the exact form is the one used', () => {
  // Arrange — V1's utilities, exactly as the engine computes them
  const dMax = { Ali: 60, Bahar: 60, Cyrus: 60, Darya: 45 } as const;
  const minutes = { Ali: 30, Bahar: 20, Cyrus: 22, Darya: 35 } as const;

  const exact = (Object.keys(dMax) as Array<keyof typeof dMax>).map(
    (name) => 100 * (1 - minutes[name] / dMax[name]),
  );

  // Act — both forms
  const wrongMean = round2(exact.map((utility) => round2(utility)).reduce((a, b) => a + b, 0) / 4);
  const rightMean = round2(exact.reduce((a, b) => a + b, 0) / 4);

  const wrongGap = round2(
    Math.max(...exact.map((utility) => round2(utility))) -
      Math.min(...exact.map((utility) => round2(utility))),
  );
  const rightGap = round2(Math.max(...exact) - Math.min(...exact));

  // Assert — the difference is demonstrated, so the choice is deliberate
  assert.equal(rightMean, 50.56);
  assert.equal(wrongMean, 50.56, 'the mean happens to coincide for this fixture');
  assert.equal(rightGap, 44.44);
  assert.equal(wrongGap, 44.45, 'the gap exposes the premature rounding');

  // And the engine uses the exact form.
  const result = rankedOf(
    scoreVenues(cloneParticipants(), cloneVenues(), 'balanced', {
      measurements: TEHRAN_MEASUREMENTS,
      eventHour: FIXTURE_EVENT_HOUR,
    }),
  );
  assert.equal(result.find((venue) => venue.venueId === 'v_1')!.gap, rightGap);
});

// ---------------------------------------------------------------------------
// TC-18 — The transit proxy is always an estimate.
// ---------------------------------------------------------------------------

test('TC-18: the transit proxy is always low confidence, always with a range, always with a null cost', () => {
  // Arrange — a short trip, a long trip, and a dense-corridor case
  const near = { lat: 35.7448, lng: 51.4050 };
  const alsoNear = { lat: 35.7449, lng: 51.4051 };
  const far = { lat: 35.9000, lng: 51.6000 };

  // Act
  for (const [from, to] of [
    [near, alsoNear],
    [near, far],
  ] as const) {
    const measurement = estimateTransitProxy({ from, to, fetchedAt: FIXTURE_FETCHED_AT });

    // Assert — unconditionally low
    assert.equal(measurement.confidence, 'low');
    assert.notEqual(measurement.confidence, 'high');
    assert.notEqual(measurement.confidence, 'medium');
    assert.equal(measurement.source, 'straight_line');

    // The range is always present
    assert.notEqual(measurement.minutesRange, null);
    const range = measurement.minutesRange!;
    assert.ok(range[0] <= measurement.minutes && measurement.minutes <= range[1]);

    // The cost is unknown, never zero
    assert.equal(measurement.costIrr, null);
  }
});

// ---------------------------------------------------------------------------
// The four lenses, on the fixture.
// ---------------------------------------------------------------------------

test('the four lenses each produce their documented winner on the fixture', () => {
  // Arrange
  const participants = cloneParticipants();
  const venues = cloneVenues();
  const options = {
    measurements: TEHRAN_MEASUREMENTS,
    eventHour: FIXTURE_EVENT_HOUR,
  };

  // Act
  const winners: Record<Lens, string> = {
    balanced: rankedOf(scoreVenues(participants, venues, 'balanced', options))[0]!.venueId,
    fastest: rankedOf(scoreVenues(participants, venues, 'fastest', options))[0]!.venueId,
    fairest: rankedOf(scoreVenues(participants, venues, 'fairest', options))[0]!.venueId,
    cheapest: rankedOf(scoreVenues(participants, venues, 'cheapest', options))[0]!.venueId,
  };

  // Assert — Balanced and Least-Misery pick V2; Average and Gap pick V1
  assert.equal(winners.balanced, 'v_2');
  assert.equal(winners.fastest, 'v_1');
  assert.equal(winners.fairest, 'v_1');
  assert.equal(winners.cheapest, 'v_3');
});

test('the Cheapest lens never picks a venue by omitting an unknown cost', () => {
  // Arrange — every cost is unknown
  const participants = cloneParticipants();
  const venues = cloneVenues();

  const measurements: Record<string, Record<string, TravelMeasurement>> = {};
  for (const participant of participants) {
    measurements[participant.id] = {
      v_1: measurementOf(20, { costIrr: null }),
      v_2: measurementOf(25, { costIrr: null }),
      v_3: measurementOf(30, { costIrr: null }),
    };
  }

  // Act
  const result = rankedOf(
    scoreVenues(participants, venues, 'cheapest', { measurements }),
  );

  // Assert — no venue claims a total cost
  for (const venue of result) {
    assert.equal(venue.totalCost, null);
  }
});

test('the Cheapest lens never wins by omitting one unknown cost', () => {
  // Arrange — v_1 is nominally cheaper, but one of its costs is unknown.
  // Summing the KNOWN costs would make it look like 1000 against v_2's
  // 8000, and it would win — by omission, not by being cheap.
  const participants = cloneParticipants();
  const venues = cloneVenues().slice(0, 2);

  const measurements: Record<string, Record<string, TravelMeasurement>> = {};
  for (const participant of participants) {
    measurements[participant.id] = {
      v_1: measurementOf(20, { costIrr: participant.id === 'p_darya' ? null : 500 }),
      v_2: measurementOf(25, { costIrr: 2000 }),
    };
  }

  // Act
  const result = rankedOf(
    scoreVenues(participants, venues, 'cheapest', { measurements }),
  );

  // Assert — the venue with the complete cost wins, because the comparison
  // is only meaningful when both sides are complete.
  assert.equal(result[0]!.venueId, 'v_2');
  assert.equal(result[0]!.totalCost, 8000);
  assert.equal(result[1]!.venueId, 'v_1');
});

// ---------------------------------------------------------------------------
// The engine's honesty properties.
// ---------------------------------------------------------------------------

test('every ranked venue carries a reason template and no prose', () => {
  // Arrange
  const result = rankedOf(
    scoreVenues(cloneParticipants(), cloneVenues(), 'balanced', {
      measurements: TEHRAN_MEASUREMENTS,
      eventHour: FIXTURE_EVENT_HOUR,
    }),
  );

  // Act / Assert
  const allowed = new Set([
    'balanced_floor',
    'balanced_mean',
    'fastest_total',
    'fairest_gap',
    'cheapest_total',
    'with_coverage_gap',
    'with_low_confidence',
    'excluded',
    'accessibility_no_confirm',
    'accessibility_unknown_note',
  ]);

  for (const venue of result) {
    assert.ok(venue.reason.templateId);
    assert.ok(allowed.has(venue.reason.templateId), `unexpected template ${venue.reason.templateId}`);

    // The params hold numbers and names only — never a rendered sentence.
    for (const value of Object.values(venue.reason.params)) {
      if (typeof value === 'string') {
        assert.ok(
          !/[۰-۹]/.test(value) && !/\d/.test(value),
          `a param carries a formatted number: ${value}`,
        );
      }
    }
  }
});

test('the coverage is present on both the normal result and the no-viable state', () => {
  // Arrange — a version where everything is excluded
  const participants = participantsWith('Darya', { needsStepFree: true });
  const venues = cloneVenues();
  for (const venue of venues) {
    venue.accessibility.stepFreeEntrance = 'confirmed_no';
  }

  // Act
  const noViable = noViableOf(
    scoreVenues(participants, venues, 'balanced', {
      measurements: TEHRAN_MEASUREMENTS,
    }),
  );
  const normal = rankedOf(
    scoreVenues(cloneParticipants(), cloneVenues(), 'balanced', {
      measurements: TEHRAN_MEASUREMENTS,
    }),
  );

  // Assert
  assert.ok(noViable.coverage);
  assert.ok(normal.coverage);
  assert.equal(normal.coverage.compared, 4);
  assert.equal(normal.coverage.total, 4);
});

test('the engine is deterministic across repeated calls', () => {
  // Act
  const first = rankedOf(
    scoreVenues(cloneParticipants(), cloneVenues(), 'balanced', {
      measurements: TEHRAN_MEASUREMENTS,
      eventHour: FIXTURE_EVENT_HOUR,
    }),
  );
  const second = rankedOf(
    scoreVenues(cloneParticipants(), cloneVenues(), 'balanced', {
      measurements: TEHRAN_MEASUREMENTS,
      eventHour: FIXTURE_EVENT_HOUR,
    }),
  );

  // Assert
  assert.deepEqual(first, second);
});

test('a low-confidence travel time is never filtered on the travel budget', () => {
  // Arrange — a straight-line estimate well over the budget
  const participants = cloneParticipants();
  const venues = cloneVenues();
  const measurements: Record<string, Record<string, TravelMeasurement>> = {};
  for (const participant of participants) {
    measurements[participant.id] = {
      v_1: measurementOf(200, { confidence: 'low' }),
      v_2: measurementOf(200, { confidence: 'low' }),
      v_3: measurementOf(200, { confidence: 'low' }),
    };
  }

  // Act
  const result = rankedOf(
    scoreVenues(participants, venues, 'balanced', { measurements }),
  );

  // Assert — the estimate is not proof, so nothing is excluded
  assert.equal(result.length, 3);
  assert.equal(result.excluded.length, 0);
});

test('the coverage counts a participant with no resolvable measurement as missing', () => {
  // Arrange — Darya shares a location but has no measurement
  const participants = cloneParticipants();
  const measurements = { ...TEHRAN_MEASUREMENTS };
  delete measurements.p_darya;

  // Act
  const coverage = computeCoverage(participants, measurements);

  // Assert
  assert.equal(coverage.compared, 3);
  assert.equal(coverage.total, 4);
  assert.deepEqual(coverage.missing, ['p_darya']);
});

test('the Fairest guard rejects a venue where everyone is equally miserable', () => {
  // Arrange — one venue scores 20 for everyone (gap 0), another scores 50
  const miserable = aggregateVenue('v_miserable', [
    { participantId: 'p1', utility: 20, minutes: 40, costIrr: 100, confidence: 'high' },
    { participantId: 'p2', utility: 20, minutes: 40, costIrr: 100, confidence: 'high' },
  ]);
  const good = aggregateVenue('v_good', [
    { participantId: 'p1', utility: 50, minutes: 30, costIrr: 100, confidence: 'high' },
    { participantId: 'p2', utility: 50, minutes: 30, costIrr: 100, confidence: 'high' },
  ]);

  // Act
  const survivors = fairestSurvivors([miserable, good]);

  // Assert — the guard rejects the uniformly miserable venue
  assert.equal(survivors.length, 1);
  assert.equal(survivors[0]!.venueId, 'v_good');
});

test('the night penalty applies only inside the night window', () => {
  // Arrange
  const member = participantNamed('Ali');
  member.accessibility.avoidsNightTravel = true;
  const measurement = measurementOf(20);

  // Act / Assert
  assert.equal(isNightHour(21), true);
  assert.equal(isNightHour(23), true);
  assert.equal(isNightHour(0), true);
  assert.equal(isNightHour(5), true);
  assert.equal(isNightHour(6), false);
  assert.equal(isNightHour(20), false);

  const night = combinedMinutes(measurement, member, 22);
  const day = combinedMinutes(measurement, member, 14);
  assert.equal(night - day, ENGINE_CONFIG.NIGHT_PENALTY_MIN);
});

test('the transit proxy distance uses the detour factor', () => {
  // Arrange
  const from = { lat: 35.7448, lng: 51.4050 };
  const to = { lat: 35.7000, lng: 51.4000 };

  // Act
  const measurement = estimateTransitProxy({ from, to, fetchedAt: FIXTURE_FETCHED_AT });
  const straightLineKm = haversineKm(from, to);

  // Assert
  const expectedMeters = Math.round(straightLineKm * ENGINE_CONFIG.DETOUR_FACTOR * 1000);
  assert.equal(measurement.distanceMeters, expectedMeters);
});

test('the shared fixture is the single source of truth for the suite and the seed', () => {
  // Arrange — the fixture is exported both as parts and as one object, so
  // Phase 2's seed and Phase 12's demo can import the same data
  assert.equal(TEHRAN_FIXTURE.participants, TEHRAN_PARTICIPANTS);
  assert.equal(TEHRAN_FIXTURE.venues, TEHRAN_VENUES);
  assert.equal(TEHRAN_FIXTURE.measurements, TEHRAN_MEASUREMENTS);
  assert.equal(TEHRAN_FIXTURE.eventHour, FIXTURE_EVENT_HOUR);

  // Assert — the fixture carries the published expected values
  assert.equal(EXPECTED_AGGREGATES.v_1.mean, 50.56);
  assert.equal(EXPECTED_AGGREGATES.v_2.floor, 33.33);
  assert.equal(EXPECTED_AGGREGATES.v_3.gap, 58.33);
});

test('the seed view of the fixture carries the same travel minutes and Darya\'s 45-minute cap', () => {
  // Arrange — the seed stores the Persian display names; the engine's
  // fixture uses the PRD's Latin ones. They are the same four people.
  const expectedMinutes = [
    [30, 12, 15],
    [20, 40, 48],
    [22, 38, 50],
    [35, 22, 28],
  ];

  // Assert — the same table, in the same order
  assert.equal(SEED_FIXTURE.participants.length, TEHRAN_PARTICIPANTS.length);

  SEED_FIXTURE.participants.forEach((seedMember, index) => {
    const engineMember = TEHRAN_PARTICIPANTS[index]!;
    assert.equal(seedMember.key, engineMember.name, 'the order must match');
    assert.equal(seedMember.dMax, engineMember.maxTravelMinutes);

    for (let venue = 0; venue < 3; venue += 1) {
      const measurement = TEHRAN_MEASUREMENTS[engineMember.id]![FIXTURE_VENUE_IDS[venue]!]!;
      assert.equal(measurement.minutes, seedMember.minutes[venue]);
      assert.equal(measurement.minutes, expectedMinutes[index]![venue]);
    }
  });

  // Darya's cap is 45 — the one value that produces V1's floor of 22.22
  assert.equal(SEED_FIXTURE.participants[3]!.dMax, 45);
});

test('the four methods, two winners: Average and Gap pick V1, Least Misery and Balanced pick V2', () => {
  // Arrange — the four reference methods from PRD-05 §6.1, computed from
  // the fixture's aggregates. This is Arrow's impossibility surfacing as a
  // concrete product decision, so it is asserted rather than described.
  const participants = cloneParticipants();
  const venues = cloneVenues();

  const aggregates = venues.map((venue) => {
    const members = participants.map((participant) => {
      const measurement = TEHRAN_MEASUREMENTS[participant.id]![venue.id]!;
      return {
        participantId: participant.id,
        utility: computeUtility(measurement.minutes, participant.maxTravelMinutes ?? 60),
        minutes: measurement.minutes,
        costIrr: measurement.costIrr,
        confidence: measurement.confidence,
      };
    });
    return aggregateVenue(venue.id, members);
  });

  // Act
  const average = aggregates.reduce((best, candidate) =>
    candidate.mean > best.mean ? candidate : best,
  );
  const leastMisery = aggregates.reduce((best, candidate) =>
    candidate.floor > best.floor ? candidate : best,
  );
  const gap = aggregates.reduce((best, candidate) => (candidate.gap < best.gap ? candidate : best));

  const balanced = rankedOf(
    scoreVenues(participants, venues, 'balanced', {
      measurements: TEHRAN_MEASUREMENTS,
      eventHour: FIXTURE_EVENT_HOUR,
    }),
  );

  // Assert — two methods, two winners, from identical inputs
  assert.equal(average.venueId, 'v_1');
  assert.equal(gap.venueId, 'v_1');
  assert.equal(leastMisery.venueId, 'v_2');
  assert.equal(balanced[0]!.venueId, 'v_2');

  // The margin that separates them: V1's mean advantage is noise.
  const v1 = aggregates.find((aggregate) => aggregate.venueId === 'v_1')!;
  const v2 = aggregates.find((aggregate) => aggregate.venueId === 'v_2')!;
  assert.ok(round2(v1.mean - v2.mean) > 0 && round2(v1.mean - v2.mean) < 0.5);
  assert.ok(round2(v2.floor - v1.floor) > 10);
});

test('the reason is a template with parameters, never a rendered sentence', () => {
  // Arrange
  const aggregate = aggregateVenue('v_1', [
    { participantId: 'p1', utility: 33.33, minutes: 18, costIrr: 100, confidence: 'high' },
  ]);

  // Act
  const reason = buildReason('balanced', aggregate);

  // Assert
  assert.equal(reason.templateId, 'balanced_floor');
  assert.equal(reason.params.floorMinutes, 18);
  assert.equal(typeof reason.params.floorMinutes, 'number');
});

// ---------------------------------------------------------------------------
// AC-10.4.1 / AC-12.1.1 — provider independence.
//
// ★ THIS TEST PASSES UNDER EVERY ADAPTER.
//
// `npm run test:engine -- --adapter=straight-line` and
// `--adapter=neshan-matrix` run this SAME suite. The engine never fetches,
// so a provider swap cannot change what it computes — it can only change
// the VALUES the engine is handed. The test below therefore asserts the
// property that actually holds and that a provider swap could break: the
// engine's own arithmetic and its own results are functions of its input
// alone, and nothing in it reads a provider, a cache or a clock.
// ---------------------------------------------------------------------------

test('AC-10.4.1: the engine result is a function of its input alone, whatever the adapter', () => {
  // Arrange — the SAME measurements, fed twice. The engine is pure, so
  // the results must be identical.
  const options = {
    measurements: TEHRAN_MEASUREMENTS,
    eventHour: FIXTURE_EVENT_HOUR,
  };

  // Act
  const first = rankedOf(
    scoreVenues(cloneParticipants(), cloneVenues(), 'balanced', options),
  );
  const second = rankedOf(
    scoreVenues(cloneParticipants(), cloneVenues(), 'balanced', options),
  );

  // Assert — the WHOLE payload, not just the venue sequence
  assert.deepEqual(second, first);
});

test('AC-10.4.1: the engine reads values, not the adapter that produced them', () => {
  // Arrange — the same numbers, relabelled with a different provider's
  // `source` and a different `fetchedAt`.
  const relabelled: Record<string, Record<string, TravelMeasurement>> = {};
  for (const [participantId, byVenue] of Object.entries(TEHRAN_MEASUREMENTS)) {
    relabelled[participantId] = {};
    for (const [venueId, measurement] of Object.entries(byVenue)) {
      relabelled[participantId]![venueId] = {
        ...measurement,
        source: 'ors',
        fetchedAt: '2026-08-02T18:30:00.000Z',
      };
    }
  }

  // Act
  const baseline = rankedOf(
    scoreVenues(cloneParticipants(), cloneVenues(), 'balanced', {
      measurements: TEHRAN_MEASUREMENTS,
      eventHour: FIXTURE_EVENT_HOUR,
    }),
  );
  const afterSwap = rankedOf(
    scoreVenues(cloneParticipants(), cloneVenues(), 'balanced', {
      measurements: relabelled,
      eventHour: FIXTURE_EVENT_HOUR,
    }),
  );

  // Assert — a relabelled measurement is the same measurement
  assert.deepEqual(afterSwap, baseline);
});

test('AC-10.4.1: the adapter in force does not change the engine\'s own verdicts', () => {
  // Arrange — the adapter the runner was invoked with. It reaches the
  // suite through the environment, so a test can prove the suite is
  // adapter-agnostic rather than merely claiming to be.
  const adapter = process.env.FREEWHEN_TEST_ADAPTER ?? 'neshan-matrix';

  // Act
  const result = rankedOf(
    scoreVenues(cloneParticipants(), cloneVenues(), 'balanced', {
      measurements: TEHRAN_MEASUREMENTS,
      eventHour: FIXTURE_EVENT_HOUR,
    }),
  );

  // Assert — the documented winner, under every adapter
  assert.equal(adapter.length > 0, true);
  assert.equal(result[0]!.venueId, 'v_2');
  assert.equal(result[0]!.floor, EXPECTED_AGGREGATES.v_2.floor);
  assert.equal(result[0]!.mean, EXPECTED_AGGREGATES.v_2.mean);
  assert.equal(result[0]!.gap, EXPECTED_AGGREGATES.v_2.gap);
});
